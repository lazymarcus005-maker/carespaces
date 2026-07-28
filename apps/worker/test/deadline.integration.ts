import { randomUUID } from 'node:crypto';
import { migrateUp } from '@carespaces/database';
import {
  deadlineCommandFromPayload,
  DeadlineCommandDispatcher,
  InboxConsumer,
  InMemoryEventQueue,
  OutboxPublisher,
  PostgresDeadlineStore,
  PostgresEventStore,
  ScheduledDeadlineScheduler,
  type DeadlineDispatchResult,
  type EventEnvelope,
} from '@carespaces/eventing';
import { Pool } from 'pg';

const adminUrl = 'postgresql://postgres:postgres@127.0.0.1:5433/carespaces';
const databaseName = 'carespaces_deadline_test';
const ownerUrl = `postgresql://postgres:postgres@127.0.0.1:5433/${databaseName}`;
const appUrl = `postgresql://carespaces_app:carespaces_app@127.0.0.1:5433/${databaseName}`;
const tenantId = '02000000-0000-4000-8000-000000000001';

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
  const app = new Pool({ connectionString: appUrl, max: 3 });
  const deadlineStore = new PostgresDeadlineStore(app);
  const dueAt = new Date(Date.now() - 60_000);

  const matching = await deadlineStore.create({
    id: randomUUID(),
    eventId: randomUUID(),
    tenantId,
    deadlineType: 'PROVIDER_RESERVATION_EXPIRY',
    subjectType: 'assignment',
    subjectId: '31000000-0000-4000-8000-000000000001',
    commandType: 'ExpireReservation',
    expectedState: 'RESERVED',
    expectedVersion: 3,
    policyVersion: 'reservation-v1',
    dedupeKey: 'assignment-1:reservation-expiry:v1',
    correlationId: 'deadline-matching-verification',
    dueAt,
  });
  const duplicate = await deadlineStore.create({
    tenantId,
    deadlineType: 'PROVIDER_RESERVATION_EXPIRY',
    subjectType: 'assignment',
    subjectId: '31000000-0000-4000-8000-000000000001',
    commandType: 'ExpireReservation',
    expectedState: 'RESERVED',
    expectedVersion: 3,
    policyVersion: 'reservation-v1',
    dedupeKey: 'assignment-1:reservation-expiry:v1',
    correlationId: 'deadline-duplicate-verification',
    dueAt,
  });
  assert(!duplicate.created, 'duplicate deadline was created');
  assert(
    duplicate.deadline.id === matching.deadline.id,
    'deadline dedupe returned a different record',
  );

  await deadlineStore.create({
    id: randomUUID(),
    eventId: randomUUID(),
    tenantId,
    deadlineType: 'PROVIDER_RESERVATION_EXPIRY',
    subjectType: 'assignment',
    subjectId: '31000000-0000-4000-8000-000000000002',
    commandType: 'ExpireReservation',
    expectedState: 'RESERVED',
    expectedVersion: 3,
    policyVersion: 'reservation-v1',
    dedupeKey: 'assignment-2:reservation-expiry:v1',
    correlationId: 'deadline-stale-verification',
    dueAt,
  });

  const cancelled = await deadlineStore.create({
    id: randomUUID(),
    eventId: randomUUID(),
    tenantId,
    deadlineType: 'SHIFT_REMINDER',
    subjectType: 'shift',
    subjectId: '32000000-0000-4000-8000-000000000001',
    commandType: 'SendShiftReminder',
    policyVersion: 'reminder-v1',
    dedupeKey: 'shift-1:reminder:v1',
    correlationId: 'deadline-cancel-verification',
    dueAt: new Date(Date.now() + 60_000),
  });
  assert(
    await deadlineStore.cancel({
      id: cancelled.deadline.id,
      reasonCode: 'shift_cancelled',
      correlationId: 'deadline-cancel-verification',
    }),
    'active deadline was not cancelled',
  );

  const conflictEventId = randomUUID();
  await owner.query(
    `INSERT INTO platform.outbox_event
     (id, tenant_id, aggregate_type, aggregate_id, event_type, payload,
      correlation_id, status, published_at)
     VALUES ($1, $2, 'test', $2, 'integration.existing.v1', '{}',
       'deadline-failure-verification', 'PUBLISHED', clock_timestamp())`,
    [conflictEventId, tenantId],
  );
  await deadlineStore.create({
    id: randomUUID(),
    eventId: conflictEventId,
    tenantId,
    deadlineType: 'PAYMENT_EXPIRY',
    subjectType: 'payment',
    subjectId: '33000000-0000-4000-8000-000000000001',
    commandType: 'ExpirePaymentAttempt',
    expectedState: 'PENDING',
    expectedVersion: 1,
    policyVersion: 'payment-v1',
    dedupeKey: 'payment-1:expiry:v1',
    correlationId: 'deadline-failure-verification',
    dueAt,
  });

  const schedulerResult = await new ScheduledDeadlineScheduler(
    deadlineStore,
  ).runBatch({ maxAttempts: 1 });
  assert(
    schedulerResult.fired === 2 && schedulerResult.deadLettered === 1,
    'deadline scheduler did not produce fired and DLQ outcomes',
  );

  const eventStore = new PostgresEventStore(app);
  const queue = new InMemoryEventQueue();
  await new OutboxPublisher(eventStore, queue).runBatch();
  const dispatchResults: DeadlineDispatchResult[] = [];
  let effects = 0;
  const dispatcher = new DeadlineCommandDispatcher().register(
    'ExpireReservation',
    {
      load: (command) =>
        Promise.resolve(
          command.subjectId.endsWith('1')
            ? { state: 'RESERVED', version: 3 }
            : { state: 'CONFIRMED', version: 4 },
        ),
      execute: () => {
        effects += 1;
        return Promise.resolve();
      },
    },
  );
  const consumer = new InboxConsumer('deadline-integration', eventStore, queue);
  consumer.register('deadline.command-due.v1', async (message) => {
    const envelope = message.payload as EventEnvelope;
    const command = deadlineCommandFromPayload(envelope.payload);
    const result = await dispatcher.dispatch(command);
    dispatchResults.push(result);
    await deadlineStore.recordDispatchOutcome(
      command,
      result,
      message.correlationId,
    );
  });
  await consumer.runBatch();

  assert(effects === 1, 'stale deadline produced a business side effect');
  assert(
    dispatchResults.includes('EXECUTED') &&
      dispatchResults.includes('NOOP_STATE_CHANGED'),
    'deadline state recheck evidence is incomplete',
  );

  const evidence = await owner.query<{
    fired: string;
    cancelled: string;
    dead_lettered: string;
    command_executed: string;
    command_noop: string;
    inbox_applied: string;
  }>(`SELECT
    (SELECT count(*) FROM platform.scheduled_deadline WHERE status = 'FIRED')::text AS fired,
    (SELECT count(*) FROM platform.scheduled_deadline WHERE status = 'CANCELLED')::text AS cancelled,
    (SELECT count(*) FROM platform.scheduled_deadline WHERE status = 'DEAD_LETTER')::text AS dead_lettered,
    (SELECT count(*) FROM platform.audit_event WHERE action = 'deadline.command.executed')::text AS command_executed,
    (SELECT count(*) FROM platform.audit_event WHERE action = 'deadline.command.noop')::text AS command_noop,
    (SELECT count(*) FROM platform.inbox_message WHERE status = 'APPLIED')::text AS inbox_applied`);
  const row = evidence.rows[0];
  assert(row?.fired === '2', 'fired deadline evidence is incomplete');
  assert(row.cancelled === '1', 'cancelled deadline evidence is incomplete');
  assert(row.dead_lettered === '1', 'deadline DLQ evidence is incomplete');
  assert(row.command_executed === '1', 'executed command was not audited');
  assert(row.command_noop === '1', 'stale command no-op was not audited');
  assert(row.inbox_applied === '2', 'deadline inbox messages were not applied');

  await app.end();
  await owner.end();
  const cleanup = new Pool({ connectionString: adminUrl, max: 1 });
  await cleanup.query(`DROP DATABASE IF EXISTS ${databaseName} WITH (FORCE)`);
  await cleanup.end();
  console.log(
    'PLT-02 passed: idempotent create/cancel/fire, state recheck, DLQ and operational evidence.',
  );
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
