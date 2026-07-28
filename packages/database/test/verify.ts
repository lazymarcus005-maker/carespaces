import { Pool } from 'pg';
import { readAuditTimeline } from '../src/audit-query.js';
import { migrateUp, migrationStatus, rollbackLatest } from '../src/migrator.js';
import { seedSynthetic } from '../src/seed.js';

const adminUrl = 'postgresql://postgres:postgres@127.0.0.1:5433/carespaces';
const testDatabase = 'carespaces_foundation_test';
const testUrl = `postgresql://postgres:postgres@127.0.0.1:5433/${testDatabase}`;
const appUrl = `postgresql://carespaces_app:carespaces_app@127.0.0.1:5433/${testDatabase}`;
const auditReaderUrl = `postgresql://carespaces_audit_reader:carespaces_audit_reader@127.0.0.1:5433/${testDatabase}`;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function recreateDatabase(): Promise<void> {
  const admin = new Pool({ connectionString: adminUrl, max: 1 });
  await admin.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'carespaces_audit_reader') THEN
        CREATE ROLE carespaces_audit_reader LOGIN PASSWORD 'carespaces_audit_reader' NOSUPERUSER NOBYPASSRLS;
      END IF;
    END
    $$
  `);
  await admin.query(`DROP DATABASE IF EXISTS ${testDatabase} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${testDatabase}`);
  await admin.end();
}

async function main(): Promise<void> {
  await recreateDatabase();
  const pool = new Pool({ connectionString: testUrl, max: 2 });

  const applied = await migrateUp(pool);
  assert(
    applied.length === 10 && applied[0] === '0001_foundation',
    'forward migration failed',
  );
  const status = await migrationStatus(pool);
  assert(
    status[0]?.appliedAt instanceof Date,
    'migration ledger did not record application',
  );
  assert(
    (await migrateUp(pool)).length === 0,
    'an applied migration was not idempotent',
  );

  process.env.NODE_ENV = 'production';
  let productionSeedRejected = false;
  try {
    await seedSynthetic(pool, testUrl);
  } catch {
    productionSeedRejected = true;
  } finally {
    delete process.env.NODE_ENV;
  }
  assert(
    productionSeedRejected,
    'production synthetic seed guard did not reject the operation',
  );

  process.env.ALLOW_SYNTHETIC_SEED = 'true';
  await seedSynthetic(pool, testUrl);
  const seeded = await pool.query<{ count: string }>(
    'SELECT count(*) FROM iam.tenant',
  );
  assert(seeded.rows[0]?.count === '1', 'synthetic seed was not applied');

  const notificationTemplates = await pool.query<{ count: string }>(
    'SELECT count(*)::text AS count FROM notifications.notification_template',
  );
  assert(
    Number(notificationTemplates.rows[0]?.count) >= 2,
    'synthetic notification templates were not seeded',
  );
  const notificationIntents = await pool.query<{ count: string }>(
    'SELECT count(*)::text AS count FROM notifications.notification_intent',
  );
  assert(
    Number(notificationIntents.rows[0]?.count) >= 2,
    'synthetic notification intents were not seeded',
  );
  const acknowledgedIntents = await pool.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM notifications.notification_intent
     WHERE acknowledged_at IS NOT NULL`,
  );
  assert(
    acknowledgedIntents.rows[0]?.count === '0',
    'synthetic notification intents exposed an acknowledgement timestamp (delivery ≠ ack)',
  );
  const notificationPolicy = await pool.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM platform.configuration_version
     WHERE config_key = 'platform.notifications' AND environment = 'development'`,
  );
  assert(
    notificationPolicy.rows[0]?.count === '1',
    'synthetic notification policy configuration was not seeded',
  );

  await pool.query(`
    INSERT INTO iam.tenant (id, display_name, created_by_user_id)
    VALUES (
      '02000000-0000-4000-8000-000000000002',
      'Hidden Family',
      '01000000-0000-4000-8000-000000000001'
    )
  `);

  const appPool = new Pool({ connectionString: appUrl, max: 1 });
  const appClient = await appPool.connect();
  try {
    await appClient.query('BEGIN');
    await appClient.query(
      "SELECT set_config('app.current_tenant_id', $1, true)",
      ['02000000-0000-4000-8000-000000000001'],
    );
    const visible = await appClient.query(
      'SELECT id FROM iam.tenant ORDER BY id',
    );
    assert(visible.rows.length === 1, 'RLS exposed a cross-tenant row');
    await appClient.query('ROLLBACK');
  } finally {
    appClient.release();
    await appPool.end();
  }

  const auditReaderPool = new Pool({
    connectionString: auditReaderUrl,
    max: 1,
  });
  const auditRows = await readAuditTimeline(
    {
      reader: auditReaderPool,
      writer: pool,
      nextId: () => '03000000-0000-4000-8000-000000000001',
    },
    {
      actor: {
        tenantId: '02000000-0000-4000-8000-000000000001',
        userId: '01000000-0000-4000-8000-000000000001',
      },
      reasonCode: 'foundation_verification',
      correlationId: 'audit-query-verification',
      filter: { tenantId: '02000000-0000-4000-8000-000000000001' },
    },
  );
  assert(
    auditRows.length > 0,
    'audit reader could not query the timeline projection',
  );
  const tracedRead = await pool.query<{ count: string }>(
    "SELECT count(*)::text AS count FROM platform.audit_event WHERE action = 'audit.timeline.read' AND correlation_id = 'audit-query-verification'",
  );
  assert(
    tracedRead.rows[0]?.count === '1',
    'privileged audit read was not traced',
  );
  let auditMutationRejected = false;
  try {
    await auditReaderPool.query('DELETE FROM platform.audit_event');
  } catch {
    auditMutationRejected = true;
  }
  assert(
    auditMutationRejected,
    'audit reader could mutate append-only audit data',
  );
  await auditReaderPool.end();

  const rolledBack = await rollbackLatest(pool);
  assert(
    rolledBack === '0010_notification_intents',
    'rollback did not select the latest notification migration',
  );
  assert(
    (await rollbackLatest(pool)) === '0009_ops_queue_access',
    'rollback did not select the ops queue access migration after notification rollback',
  );
  assert(
    (await rollbackLatest(pool)) === '0008_ops_task_core',
    'Ops Task core migration did not follow queue access rollback',
  );
  assert(
    (await rollbackLatest(pool)) === '0007_versioned_configuration',
    'configuration migration did not follow Ops Task rollback',
  );
  assert(
    (await rollbackLatest(pool)) === '0006_scheduled_deadline_service',
    'deadline migration did not follow configuration rollback',
  );
  assert(
    (await rollbackLatest(pool)) === '0005_inbox_outbox_backbone',
    'event backbone rollback did not run after the deadline migration',
  );
  assert(
    (await rollbackLatest(pool)) === '0004_privileged_audit_projection',
    'audit projection rollback did not run after the event backbone migration',
  );
  assert(
    (await rollbackLatest(pool)) === '0003_audit_state_transition',
    'audit transition rollback did not run after the projection migration',
  );
  assert(
    (await rollbackLatest(pool)) === '0002_identity_walking_skeleton',
    'identity rollback did not run after the audit migration',
  );
  assert(
    (await rollbackLatest(pool)) === '0001_foundation',
    'foundation rollback did not run after the latest migration',
  );
  const iamSchema = await pool.query(
    "SELECT 1 FROM pg_namespace WHERE nspname = 'iam'",
  );
  assert(
    iamSchema.rows.length === 0,
    'down migration left the IAM schema behind',
  );

  const reapplied = await migrateUp(pool);
  assert(
    reapplied.length === 10,
    'restore rehearsal could not reapply migration',
  );
  await pool.end();

  const cleanup = new Pool({ connectionString: adminUrl, max: 1 });
  await cleanup.query(`DROP DATABASE IF EXISTS ${testDatabase} WITH (FORCE)`);
  await cleanup.end();
  console.log(
    'FND-04/FND-07/PLT-01/PLT-02/PLT-04/PLT-06/OPS-01/OPS-02 passed: forward, ledger, seed guard, RLS, versioned configuration, async/deadline/Ops Task backbone, queue access projection, notification intents, privileged audit read, rollback and restore rehearsal.',
  );
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
