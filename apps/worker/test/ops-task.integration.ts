import { type AuthorizationContext } from '@carespaces/authz';
import {
  migrateUp,
  OpsTaskDedupeConflictError,
  OpsTaskStateError,
  StaleVersionError,
} from '@carespaces/database';
import {
  OpsTaskAuthorizationError,
  PostgresOpsTaskService,
} from '@carespaces/operations';
import { Pool } from 'pg';

const adminUrl = 'postgresql://postgres:postgres@127.0.0.1:5433/carespaces';
const databaseName = 'carespaces_ops_task_test';
const ownerUrl = `postgresql://postgres:postgres@127.0.0.1:5433/${databaseName}`;
const appUrl = `postgresql://carespaces_app:carespaces_app@127.0.0.1:5433/${databaseName}`;
const officerOneId = '10000000-0000-4000-8000-000000000001';
const officerTwoId = '10000000-0000-4000-8000-000000000002';
const officerThreeId = '10000000-0000-4000-8000-000000000003';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function officer(actorUserId: string): AuthorizationContext {
  return {
    actorUserId,
    actorTenantId: 'platform',
    resourceTenantId: 'platform',
    role: 'SUPPORT_OFFICER',
    mfaVerified: true,
    privilegedSession: true,
  };
}

async function main(): Promise<void> {
  const admin = new Pool({ connectionString: adminUrl, max: 1 });
  await admin.query(`DROP DATABASE IF EXISTS ${databaseName} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${databaseName}`);
  await admin.end();

  const owner = new Pool({ connectionString: ownerUrl, max: 2 });
  await migrateUp(owner);
  await owner.query(
    `INSERT INTO iam.user_account (id, identity_provider, identity_subject)
     VALUES ($1, 'integration', 'ops-officer-1'),
            ($2, 'integration', 'ops-officer-2'),
            ($3, 'integration', 'ops-officer-3')`,
    [officerOneId, officerTwoId, officerThreeId],
  );

  const app = new Pool({ connectionString: appUrl, max: 6 });
  const service = new PostgresOpsTaskService(app);
  const taskId = '80000000-0000-4000-8000-000000000001';
  const dueAt = new Date(Date.now() - 60_000);
  const created = await service.create({
    id: taskId,
    taskType: 'deadline.incident_ack',
    subjectType: 'incident',
    subjectId: '30000000-0000-4000-8000-000000000001',
    queue: 'INCIDENT',
    priority: 'HIGH',
    dueAt,
    sourceDedupeKey: 'incident-1:ack-deadline',
    actor: { systemActor: 'incident-service' },
    commandId: 'create-incident-task-1',
    correlationId: 'incident-task-flow',
    reasonCode: 'ack_deadline_elapsed',
  });
  assert(
    created.created && created.task.version === 1,
    'feature task was not created',
  );

  const duplicate = await service.create({
    taskType: 'deadline.incident_ack',
    subjectType: 'incident',
    subjectId: '30000000-0000-4000-8000-000000000001',
    queue: 'INCIDENT',
    priority: 'HIGH',
    dueAt,
    sourceDedupeKey: 'incident-1:ack-deadline',
    actor: { systemActor: 'incident-service' },
    commandId: 'create-incident-task-duplicate',
    correlationId: 'incident-task-flow',
    reasonCode: 'ack_deadline_elapsed',
  });
  assert(
    !duplicate.created && duplicate.task.id === taskId,
    'source dedupe did not return the task',
  );

  let dedupeConflict = false;
  try {
    await service.create({
      taskType: 'deadline.incident_ack',
      subjectType: 'incident',
      subjectId: '30000000-0000-4000-8000-000000000001',
      queue: 'INCIDENT',
      priority: 'CRITICAL',
      dueAt,
      sourceDedupeKey: 'incident-1:ack-deadline',
      actor: { systemActor: 'incident-service' },
      commandId: 'create-incident-task-conflict',
      correlationId: 'incident-task-flow',
      reasonCode: 'ack_deadline_elapsed',
    });
  } catch (error) {
    dedupeConflict = error instanceof OpsTaskDedupeConflictError;
  }
  assert(dedupeConflict, 'changed source input reused a task dedupe key');

  let unauthorized = false;
  try {
    await service.claim({
      id: taskId,
      expectedVersion: 1,
      authorization: {
        actorUserId: officerOneId,
        actorTenantId: 'tenant-1',
        resourceTenantId: 'tenant-1',
        role: 'FAMILY_OWNER',
        membershipStatus: 'ACTIVE',
      },
      commandId: 'unauthorized-claim',
      correlationId: 'incident-task-flow',
      reasonCode: 'claim',
    });
  } catch (error) {
    unauthorized = error instanceof OpsTaskAuthorizationError;
  }
  assert(unauthorized, 'family actor claimed an Ops Task');

  const claims = await Promise.allSettled([
    service.claim({
      id: taskId,
      expectedVersion: 1,
      authorization: officer(officerOneId),
      commandId: 'officer-one-claim',
      correlationId: 'incident-task-race',
      reasonCode: 'queue_claim',
    }),
    service.claim({
      id: taskId,
      expectedVersion: 1,
      authorization: officer(officerTwoId),
      commandId: 'officer-two-claim',
      correlationId: 'incident-task-race',
      reasonCode: 'queue_claim',
    }),
  ]);
  const winningIndex = claims.findIndex(
    (result) => result.status === 'fulfilled',
  );
  const losing = claims.find((result) => result.status === 'rejected');
  assert(
    winningIndex >= 0 && losing?.status === 'rejected',
    'claim race did not produce one winner',
  );
  assert(
    losing.reason instanceof StaleVersionError,
    'claim loser did not receive a stale-version conflict',
  );
  const winnerId = winningIndex === 0 ? officerOneId : officerTwoId;
  const winnerCommand =
    winningIndex === 0 ? 'officer-one-claim' : 'officer-two-claim';

  const replay = await service.claim({
    id: taskId,
    expectedVersion: 1,
    authorization: officer(winnerId),
    commandId: winnerCommand,
    correlationId: 'incident-task-race',
    reasonCode: 'queue_claim',
  });
  assert(
    replay.version === 2 && replay.ownerUserId === winnerId,
    'claim replay changed its result',
  );

  const reassigned = await service.reassign({
    id: taskId,
    expectedVersion: 2,
    newOwnerUserId: officerThreeId,
    authorization: officer(winnerId),
    commandId: 'reassign-to-officer-three',
    correlationId: 'incident-task-flow',
    reasonCode: 'shift_handover',
  });
  assert(
    reassigned.version === 3 && reassigned.ownerUserId === officerThreeId,
    'task was not reassigned',
  );

  const escalated = await service.escalate({
    id: taskId,
    expectedVersion: 3,
    priority: 'CRITICAL',
    actor: { systemActor: 'deadline-service' },
    commandId: 'escalate-incident-task',
    correlationId: 'incident-task-flow',
    reasonCode: 'resolution_deadline_elapsed',
  });
  assert(
    escalated.version === 4 && escalated.escalationLevel === 1,
    'task was not escalated',
  );

  let nonOwnerRejected = false;
  try {
    await service.resolve({
      id: taskId,
      expectedVersion: 4,
      resolutionCode: 'incident_acknowledged',
      authorization: officer(officerOneId),
      commandId: 'non-owner-resolve',
      correlationId: 'incident-task-flow',
      reasonCode: 'resolved',
    });
  } catch (error) {
    nonOwnerRejected = error instanceof OpsTaskStateError;
  }
  assert(nonOwnerRejected, 'non-owner resolved a claimed task');

  const resolved = await service.resolve({
    id: taskId,
    expectedVersion: 4,
    resolutionCode: 'incident_acknowledged',
    authorization: officer(officerThreeId),
    commandId: 'owner-resolve',
    correlationId: 'incident-task-flow',
    reasonCode: 'incident_acknowledged',
  });
  assert(
    resolved.status === 'RESOLVED' && resolved.version === 5,
    'owner did not resolve the task',
  );

  const evidence = await owner.query<{
    audits: string;
    transitions: string;
    events: string;
    claim_events: string;
  }>(`SELECT
    (SELECT count(*) FROM platform.audit_event WHERE subject_type = 'ops_task' AND subject_id = '${taskId}')::text AS audits,
    (SELECT count(*) FROM platform.state_transition WHERE subject_type = 'ops_task' AND subject_id = '${taskId}')::text AS transitions,
    (SELECT count(*) FROM platform.outbox_event WHERE aggregate_type = 'ops_task' AND aggregate_id = '${taskId}')::text AS events,
    (SELECT count(*) FROM platform.outbox_event WHERE aggregate_id = '${taskId}' AND event_type = 'ops_task.claimed.v1')::text AS claim_events`);
  const row = evidence.rows[0];
  assert(
    row?.audits === '5' && row.transitions === '5' && row.events === '5',
    'task evidence is incomplete',
  );
  assert(row.claim_events === '1', 'claim replay duplicated its domain event');

  await app.end();
  await owner.end();
  const cleanup = new Pool({ connectionString: adminUrl, max: 1 });
  await cleanup.query(`DROP DATABASE IF EXISTS ${databaseName} WITH (FORCE)`);
  await cleanup.end();
  console.log(
    'PLT-06 passed: feature dedupe, authorization, atomic claim race, replay, reassignment, escalation, owner resolution and transactional evidence.',
  );
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
