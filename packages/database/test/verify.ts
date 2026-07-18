import { Pool } from 'pg';
import { migrateUp, migrationStatus, rollbackLatest } from '../src/migrator.js';
import { seedSynthetic } from '../src/seed.js';

const adminUrl = 'postgresql://postgres:postgres@127.0.0.1:54329/carespaces';
const testDatabase = 'carespaces_foundation_test';
const testUrl = `postgresql://postgres:postgres@127.0.0.1:54329/${testDatabase}`;
const appUrl = `postgresql://carespaces_app:carespaces_app@127.0.0.1:54329/${testDatabase}`;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function recreateDatabase(): Promise<void> {
  const admin = new Pool({ connectionString: adminUrl, max: 1 });
  await admin.query(`DROP DATABASE IF EXISTS ${testDatabase} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${testDatabase}`);
  await admin.end();
}

async function main(): Promise<void> {
  await recreateDatabase();
  const pool = new Pool({ connectionString: testUrl, max: 2 });

  const applied = await migrateUp(pool);
  assert(
    applied.length === 3 && applied[0] === '0001_foundation',
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

  const rolledBack = await rollbackLatest(pool);
  assert(
    rolledBack === '0003_audit_state_transition',
    'rollback did not select the latest migration',
  );
  assert(
    (await rollbackLatest(pool)) === '0002_identity_walking_skeleton',
    'identity rollback did not run after the latest migration',
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
    reapplied.length === 3,
    'restore rehearsal could not reapply migration',
  );
  await pool.end();

  const cleanup = new Pool({ connectionString: adminUrl, max: 1 });
  await cleanup.query(`DROP DATABASE IF EXISTS ${testDatabase} WITH (FORCE)`);
  await cleanup.end();
  console.log(
    'FND-04 passed: forward, ledger, seed guard, RLS, rollback and restore rehearsal.',
  );
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
