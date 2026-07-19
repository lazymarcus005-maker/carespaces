import {
  ConfiguredDeadlineService,
  ConfigurationApprovalError,
  ConfigurationIntegrityError,
  DeadlinePolicyResolver,
  PostgresConfigurationRegistry,
} from '@carespaces/config';
import { migrateUp, syntheticDeadlinePolicy } from '@carespaces/database';
import { PostgresDeadlineStore } from '@carespaces/eventing';
import { Pool } from 'pg';

const adminUrl = 'postgresql://postgres:postgres@127.0.0.1:54329/carespaces';
const databaseName = 'carespaces_config_test';
const ownerUrl = `postgresql://postgres:postgres@127.0.0.1:54329/${databaseName}`;
const appUrl = `postgresql://carespaces_app:carespaces_app@127.0.0.1:54329/${databaseName}`;
const authorId = '10000000-0000-4000-8000-000000000001';
const approverId = '10000000-0000-4000-8000-000000000002';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function main(): Promise<void> {
  const admin = new Pool({ connectionString: adminUrl, max: 1 });
  await admin.query(`DROP DATABASE IF EXISTS ${databaseName} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${databaseName}`);
  await admin.end();

  const owner = new Pool({ connectionString: ownerUrl, max: 2 });
  await migrateUp(owner);
  await owner.query(
    `INSERT INTO iam.user_account
     (id, identity_provider, identity_subject)
     VALUES ($1, 'integration', 'config-author'),
            ($2, 'integration', 'config-approver')`,
    [authorId, approverId],
  );

  const app = new Pool({ connectionString: appUrl, max: 3 });
  const registry = new PostgresConfigurationRegistry(app);
  const firstId = '70000000-0000-4000-8000-000000000001';
  const secondId = '70000000-0000-4000-8000-000000000002';

  await registry.createDraft({
    id: firstId,
    configKey: 'platform.release-flags',
    environment: 'production',
    version: 'v1',
    value: { newBookingFlow: false },
    changeReason: 'production_baseline',
    createdByUserId: authorId,
    correlationId: 'config-v1-draft',
  });

  let sameActorRejected = false;
  try {
    await registry.approve({
      id: firstId,
      approvedByUserId: authorId,
      reasonCode: 'self_approval_attempt',
      correlationId: 'config-v1-self-approve',
    });
  } catch (error) {
    sameActorRejected = error instanceof ConfigurationApprovalError;
  }
  assert(sameActorRejected, 'production self-approval was accepted');

  await registry.approve({
    id: firstId,
    approvedByUserId: approverId,
    reasonCode: 'reviewed',
    correlationId: 'config-v1-approve',
  });
  await registry.activate({
    id: firstId,
    activatedByUserId: approverId,
    reasonCode: 'initial_release',
    correlationId: 'config-v1-activate',
  });

  await registry.createDraft({
    id: secondId,
    configKey: 'platform.release-flags',
    environment: 'production',
    version: 'v2',
    value: { newBookingFlow: true },
    changeReason: 'enable_new_booking',
    createdByUserId: authorId,
    supersedesId: firstId,
    correlationId: 'config-v2-draft',
  });
  await registry.approve({
    id: secondId,
    approvedByUserId: approverId,
    reasonCode: 'reviewed',
    correlationId: 'config-v2-approve',
  });
  await registry.activate({
    id: secondId,
    activatedByUserId: approverId,
    reasonCode: 'release',
    correlationId: 'config-v2-activate',
  });
  assert(
    (
      await registry.readActive<{ newBookingFlow: boolean }>({
        configKey: 'platform.release-flags',
        environment: 'production',
      })
    )?.id === secondId,
    'new configuration did not replace the active version',
  );

  await registry.rollback({
    targetId: firstId,
    activatedByUserId: approverId,
    reasonCode: 'release_regression',
    correlationId: 'config-v1-rollback',
  });
  assert(
    (
      await registry.readActive({
        configKey: 'platform.release-flags',
        environment: 'production',
      })
    )?.id === firstId,
    'rollback did not reactivate the retired version',
  );

  const deadlinePolicyId = '70000000-0000-4000-8000-000000000003';
  await registry.createDraft({
    id: deadlinePolicyId,
    configKey: 'platform.deadlines',
    environment: 'development',
    version: 'deadline-policy-integration-v1',
    value: syntheticDeadlinePolicy,
    changeReason: 'deadline_integration',
    createdByUserId: authorId,
    correlationId: 'deadline-policy-draft',
  });
  await registry.approve({
    id: deadlinePolicyId,
    approvedByUserId: authorId,
    reasonCode: 'local_review',
    correlationId: 'deadline-policy-approve',
  });
  await registry.activate({
    id: deadlinePolicyId,
    activatedByUserId: authorId,
    reasonCode: 'local_activation',
    correlationId: 'deadline-policy-activate',
  });

  const now = new Date('2026-07-19T00:00:00.000Z');
  const configuredDeadlines = new ConfiguredDeadlineService(
    new PostgresDeadlineStore(app),
    new DeadlinePolicyResolver(registry, 'development'),
  );
  const scheduled = await configuredDeadlines.schedule({
    deadlineType: 'PAYMENT_EXPIRY',
    subjectType: 'payment_attempt',
    subjectId: '30000000-0000-4000-8000-000000000001',
    dedupeKey: 'configuration-integration:payment-expiry',
    correlationId: 'configured-deadline-schedule',
    now,
  });
  assert(
    scheduled.deadline.commandType === 'ExpirePaymentAttempt' &&
      scheduled.deadline.policyVersion === 'deadline-policy-integration-v1' &&
      scheduled.deadline.dueAt.getTime() === now.getTime() + 15 * 60_000,
    'active policy did not control deadline scheduling',
  );

  await owner.query(
    `UPDATE platform.configuration_version
     SET value = '{"newBookingFlow":true}'::jsonb
     WHERE id = $1`,
    [firstId],
  );
  let tamperingRejected = false;
  try {
    await registry.readActive({
      configKey: 'platform.release-flags',
      environment: 'production',
    });
  } catch (error) {
    tamperingRejected = error instanceof ConfigurationIntegrityError;
  }
  assert(tamperingRejected, 'tampered active configuration was accepted');

  const evidence = await owner.query<{
    active: string;
    retired: string;
    rollback_audits: string;
    deadline_audits: string;
  }>(`SELECT
    (SELECT count(*) FROM platform.configuration_version WHERE status = 'ACTIVE')::text AS active,
    (SELECT count(*) FROM platform.configuration_version WHERE status = 'RETIRED')::text AS retired,
    (SELECT count(*) FROM platform.audit_event WHERE action = 'configuration.rolled_back')::text AS rollback_audits,
    (SELECT count(*) FROM platform.audit_event WHERE action = 'deadline.scheduled')::text AS deadline_audits`);
  const evidenceRow = evidence.rows[0];
  assert(
    evidenceRow?.active === '2',
    'active configuration evidence is incomplete',
  );
  assert(
    evidenceRow.retired === '1',
    'retired configuration evidence is incomplete',
  );
  assert(evidenceRow.rollback_audits === '1', 'rollback was not audited');
  assert(
    evidenceRow.deadline_audits === '1',
    'configured deadline was not audited',
  );

  await app.end();
  await owner.end();
  const cleanup = new Pool({ connectionString: adminUrl, max: 1 });
  await cleanup.query(`DROP DATABASE IF EXISTS ${databaseName} WITH (FORCE)`);
  await cleanup.end();
  console.log(
    'FND-07 passed: four-eyes approval, activation, replacement, rollback, configured deadlines, audit evidence and tamper rejection.',
  );
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
