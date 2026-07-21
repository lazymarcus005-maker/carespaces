import { randomUUID } from 'node:crypto';
import { migrateUp, seedSynthetic } from '@carespaces/database';
import {
  DeadlineCommandDispatcher,
  InboxConsumer,
  InMemoryEventQueue,
  OutboxPublisher,
  PostgresDeadlineStore,
  PostgresEventStore,
  ScheduledDeadlineScheduler,
  deadlineCommandFromPayload,
  type EventEnvelope,
} from '@carespaces/eventing';
import {
  NotificationDispatcher,
  PostgresNotificationService,
  SyntheticDeliveryAdapter,
} from '@carespaces/notifications';
import { PostgresOpsTaskService } from '@carespaces/operations';
import { Pool } from 'pg';

const adminUrl = 'postgresql://postgres:postgres@127.0.0.1:54329/carespaces';
const databaseName = 'carespaces_notification_test';
const ownerUrl = `postgresql://postgres:postgres@127.0.0.1:54329/${databaseName}`;
const appUrl = `postgresql://carespaces_app:carespaces_app@127.0.0.1:54329/${databaseName}`;
const templateId = '91000000-0000-4000-8000-000000000001';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function seedTemplate(owner: Pool): Promise<void> {
  await owner.query(
    `INSERT INTO notifications.notification_template
     (id, key, notification_class, channel, display_name, body_template, is_critical)
     VALUES ($1, 'incident.ack_required', 'incident_ack', 'push',
             'Incident ACK required', 'Incident {{incidentId}} requires acknowledgement', true)
     ON CONFLICT (key) DO NOTHING`,
    [templateId],
  );
}

async function main(): Promise<void> {
  const admin = new Pool({ connectionString: adminUrl, max: 1 });
  await admin.query(`DROP DATABASE IF EXISTS ${databaseName} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${databaseName}`);
  await admin.end();

  const owner = new Pool({ connectionString: ownerUrl, max: 2 });
  await migrateUp(owner);
  process.env.ALLOW_SYNTHETIC_SEED = 'true';
  await seedSynthetic(owner, ownerUrl);
  await seedTemplate(owner);

  const app = new Pool({ connectionString: appUrl, max: 6 });
  const notifications = new PostgresNotificationService(app);
  const opsTasks = new PostgresOpsTaskService(app);

  const successIntent = await notifications.createIntent({
    templateId,
    notificationClass: 'incident_ack',
    channel: 'push',
    subjectType: 'incident',
    subjectId: '31000000-0000-4000-8000-000000000001',
    recipientRef: 'on-call-admin',
    bodyRedacted: 'Incident ACK required',
    correlationId: 'incident-1',
    sourceDedupeKey: 'incident-1:ack-notification',
    commandId: 'notification-test-success',
    reasonCode: 'incident_ack_overdue',
    actor: { systemActor: 'incident-service' },
  });
  assert(successIntent.created, 'success intent was not created');

  const dispatcher = new NotificationDispatcher(
    app,
    new SyntheticDeliveryAdapter(),
    {
      maxAttempts: 1,
      createFallbackOpsTask: async ({ intent, reasonCode, correlationId }) => {
        const result = await opsTasks.create({
          taskType: 'notification.delivery_failed',
          subjectType: 'notification',
          subjectId: intent.id,
          queue: 'INCIDENT',
          priority: 'CRITICAL',
          dueAt: new Date(Date.now() + 30 * 60_000),
          sourceDedupeKey: `notification-fallback:${intent.id}`,
          actor: { systemActor: 'notification-service' },
          commandId: `notification-fallback:${intent.id}`,
          correlationId,
          reasonCode,
        });
        return result.task.id;
      },
    },
  );

  const successBatch = await dispatcher.runBatch({ limit: 25, maxAttempts: 1 });
  assert(
    successBatch.fired === 1 && successBatch.deadLettered === 0,
    'successful delivery did not fire',
  );
  const successIntentAfter = await notifications.readIntent(successIntent.intent.id);
  assert(
    successIntentAfter?.status === 'DELIVERED' &&
      successIntentAfter?.deliveredAt !== null,
    'delivered intent was not marked DELIVERED',
  );
  const successAttempts = await notifications.listAttempts(successIntent.intent.id);
  assert(
    successAttempts.length === 1 && successAttempts[0]?.status === 'FIRED',
    'FIRED attempt evidence is missing',
  );

  const failingAdapter = new SyntheticDeliveryAdapter();
  const failingIntent = await notifications.createIntent({
    templateId,
    notificationClass: 'incident_ack',
    channel: 'push',
    subjectType: 'incident',
    subjectId: '31000000-0000-4000-8000-000000000002',
    recipientRef: 'on-call-admin',
    bodyRedacted: 'Incident ACK required (failure path)',
    correlationId: 'incident-2',
    sourceDedupeKey: 'incident-2:ack-notification',
    commandId: 'notification-test-failure',
    reasonCode: 'incident_ack_overdue',
    actor: { systemActor: 'incident-service' },
  });
  failingAdapter.failOnce(failingIntent.intent.id);
  const failingDispatcher = new NotificationDispatcher(app, failingAdapter, {
    maxAttempts: 1,
    createFallbackOpsTask: async ({ intent, reasonCode, correlationId }) => {
      const result = await opsTasks.create({
        taskType: 'notification.delivery_failed',
        subjectType: 'notification',
        subjectId: intent.id,
        queue: 'INCIDENT',
        priority: 'CRITICAL',
        dueAt: new Date(Date.now() + 30 * 60_000),
        sourceDedupeKey: `notification-fallback:${intent.id}`,
        actor: { systemActor: 'notification-service' },
        commandId: `notification-fallback:${intent.id}`,
        correlationId,
        reasonCode,
      });
      return result.task.id;
    },
  });
  const failingBatch = await failingDispatcher.runBatch({
    limit: 25,
    maxAttempts: 1,
  });
  assert(
    failingBatch.deadLettered === 1 && failingBatch.fallbackTasksCreated === 1,
    'terminal failure did not dead-letter and create a fallback Ops Task',
  );
  const failingIntentAfter = await notifications.readIntent(failingIntent.intent.id);
  assert(
    failingIntentAfter?.status === 'TERMINAL_FAILED' &&
      failingIntentAfter?.opsTaskId !== null,
    'terminal-failed intent did not record its Ops Task fallback',
  );
  const evidence = await owner.query<{ count: string }>(
    `SELECT count(*)::text AS count
     FROM notifications.notification_dead_letter_evidence
     WHERE intent_id = $1`,
    [failingIntent.intent.id],
  );
  assert(
    evidence.rows[0]?.count === '1',
    'dead-letter evidence row was not recorded',
  );

  const deadlineStore = new PostgresDeadlineStore(app);
  const deadlineId = randomUUID();
  const incidentSubject = '31000000-0000-4000-8000-000000000003';
  await deadlineStore.create({
    id: deadlineId,
    eventId: randomUUID(),
    deadlineType: 'INCIDENT_ACK_DEADLINE',
    subjectType: 'incident',
    subjectId: incidentSubject,
    commandType: 'EscalateIncident',
    expectedState: 'OPEN',
    expectedVersion: 1,
    policyVersion: 'incident-ack-v1',
    dedupeKey: `incident-${incidentSubject}:ack-deadline:v1`,
    correlationId: 'deadline-notification-verification',
    dueAt: new Date(Date.now() - 60_000),
  });

  const deadlineScheduler = new ScheduledDeadlineScheduler(deadlineStore);
  const deadlineResult = await deadlineScheduler.runBatch({ maxAttempts: 1 });
  assert(
    deadlineResult.fired === 1,
    'incident ack deadline did not fire into the outbox',
  );

  const eventStore = new PostgresEventStore(app);
  const queue = new InMemoryEventQueue();
  await new OutboxPublisher(eventStore, queue).runBatch();
  const deadlineDispatcher = new DeadlineCommandDispatcher().register(
    'EscalateIncident',
    {
      load: () => Promise.resolve({ state: 'OPEN', version: 1 }),
      execute: async (command) => {
        await notifications.createIntent({
          templateId,
          notificationClass: 'incident_ack',
          channel: 'push',
          subjectType: 'incident',
          subjectId: command.subjectId,
          recipientRef: 'on-call-admin',
          bodyRedacted: 'Incident ACK required (deadline path)',
          correlationId: command.policyVersion,
          sourceDedupeKey: `deadline:${command.deadlineId}:incident_ack`,
          commandId: `deadline-incident-ack:${command.deadlineId}`,
          reasonCode: 'incident_ack_overdue',
          actor: { systemActor: 'deadline-service' },
        });
        await opsTasks.create({
          taskType: 'incident.ack_overdue',
          subjectType: 'incident',
          subjectId: command.subjectId,
          queue: 'INCIDENT',
          priority: 'CRITICAL',
          dueAt: new Date(Date.now() + 15 * 60_000),
          sourceDedupeKey: `deadline-incident-ack-task:${command.deadlineId}`,
          actor: { systemActor: 'deadline-service' },
          commandId: `deadline-incident-ack-task:${command.deadlineId}`,
          correlationId: command.policyVersion,
          reasonCode: 'incident_ack_overdue',
        });
      },
    },
  );
  const consumer = new InboxConsumer('notification-integration', eventStore, queue);
  consumer.register('deadline.command-due.v1', async (message) => {
    const envelope = message.payload as EventEnvelope;
    const command = deadlineCommandFromPayload(envelope.payload);
    const result = await deadlineDispatcher.dispatch(command);
    await deadlineStore.recordDispatchOutcome(
      command,
      result,
      message.correlationId,
    );
  });
  await consumer.runBatch();

  const deadlineIntent = await app.query<{ id: string }>(
    `SELECT id FROM notifications.notification_intent
     WHERE source_dedupe_key = $1`,
    [`deadline:${deadlineId}:incident_ack`],
  );
  assert(deadlineIntent.rows[0]?.id, 'deadline did not create a notification intent');

  const deadlineNotificationBatch = await dispatcher.runBatch({
    limit: 25,
    maxAttempts: 1,
  });
  assert(
    deadlineNotificationBatch.fired >= 1,
    'deadline-created notification intent was not delivered',
  );

  const deadlineTask = await owner.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM operations.ops_task
     WHERE task_type = 'incident.ack_overdue' AND subject_id = $1`,
    [incidentSubject],
  );
  assert(
    deadlineTask.rows[0]?.count === '1',
    'deadline did not create an Ops Task fallback',
  );

  const auditEvidence = await owner.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM platform.audit_event
     WHERE action = 'notification.intent.created'`,
  );
  assert(
    Number(auditEvidence.rows[0]?.count) >= 3,
    'notification intent creation was not audited for every intent',
  );

  const outboxEvidence = await owner.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM platform.outbox_event
     WHERE aggregate_type = 'notification_intent'`,
  );
  assert(
    Number(outboxEvidence.rows[0]?.count) >= 3,
    'notification intent outbox events were not enqueued',
  );

  await app.end();
  await owner.end();
  delete process.env.ALLOW_SYNTHETIC_SEED;
  const cleanup = new Pool({ connectionString: adminUrl, max: 1 });
  await cleanup.query(`DROP DATABASE IF EXISTS ${databaseName} WITH (FORCE)`);
  await cleanup.end();
  console.log(
    'OPS-02 worker passed: synthetic delivery, retry/DLQ with Ops Task fallback, deadline→notification→Ops Task path and audit/outbox evidence.',
  );
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});