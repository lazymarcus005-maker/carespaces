import {
  ConfiguredDeadlineService,
  configurationEnvironmentFromRuntime,
  DeadlinePolicyResolver,
  PostgresConfigurationRegistry,
} from '@carespaces/config';
import {
  InboxConsumer,
  InMemoryEventQueue,
  DeadlineCommandDispatcher,
  OutboxPublisher,
  PostgresDeadlineStore,
  PostgresEventStore,
  ScheduledDeadlineScheduler,
  deadlineCommandFromPayload,
  type BatchResult,
  type DeadlineBatchResult,
  type EventEnvelope,
} from '@carespaces/eventing';
import { PostgresOpsTaskService } from '@carespaces/operations';
import {
  NotificationDispatcher,
  PostgresNotificationService,
  SyntheticDeliveryAdapter,
  type NotificationBatchResult,
} from '@carespaces/notifications';
import { type NotificationClass } from '@carespaces/database';
import type { Pool } from 'pg';

export interface WorkerCycleResult {
  deadlines: DeadlineBatchResult;
  publisher: BatchResult;
  consumer: BatchResult;
  notifications: NotificationBatchResult;
}

function classQueue(
  notificationClass: NotificationClass,
): 'INCIDENT' | 'REPLACEMENT' | 'FINANCE' | 'GENERAL' {
  if (notificationClass === 'incident_ack' || notificationClass === 'sos')
    return 'INCIDENT';
  if (notificationClass === 'replacement_failed') return 'REPLACEMENT';
  if (notificationClass === 'payout_retry') return 'FINANCE';
  return 'GENERAL';
}

function classPriority(
  notificationClass: NotificationClass,
): 'CRITICAL' | 'HIGH' {
  return (
    notificationClass === 'incident_ack' ||
    notificationClass === 'sos' ||
    notificationClass === 'credential_expiry_block' ||
    notificationClass === 'replacement_failed'
      ? 'CRITICAL'
      : 'HIGH'
  );
}

export function createLocalWorker(pool: Pool) {
  const queue = new InMemoryEventQueue();
  const store = new PostgresEventStore(pool);
  const publisher = new OutboxPublisher(store, queue);
  const deadlineStore = new PostgresDeadlineStore(pool);
  const configurationRegistry = new PostgresConfigurationRegistry(pool);
  const deadlinePolicy = new DeadlinePolicyResolver(
    configurationRegistry,
    configurationEnvironmentFromRuntime(
      process.env.CONFIGURATION_ENVIRONMENT ?? process.env.NODE_ENV,
    ),
  );
  const configuredDeadlines = new ConfiguredDeadlineService(
    deadlineStore,
    deadlinePolicy,
  );
  const deadlineScheduler = new ScheduledDeadlineScheduler(deadlineStore);
  const opsTasks = new PostgresOpsTaskService(pool);
  const notifications = new PostgresNotificationService(pool);
  const notificationAdapter = new SyntheticDeliveryAdapter();
  const notificationDispatcher = new NotificationDispatcher(
    pool,
    notificationAdapter,
    {
      createFallbackOpsTask: async ({ intent, reasonCode, correlationId }) => {
        const result = await opsTasks.create({
          taskType: 'notification.delivery_failed',
          subjectType: 'notification',
          subjectId: intent.id,
          queue: classQueue(intent.notificationClass),
          priority: classPriority(intent.notificationClass),
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

  const deadlineDispatcher = new DeadlineCommandDispatcher()
    .register('ExpireReservation', {
      load: () => Promise.resolve({ state: 'RESERVED', version: 1 }),
      execute: () => Promise.resolve(),
    })
    .register('ExpirePaymentAttempt', {
      load: () => Promise.resolve({ state: 'PENDING', version: 1 }),
      execute: () => Promise.resolve(),
    })
    .register('SendShiftReminder', {
      load: () => Promise.resolve({ state: 'SCHEDULED', version: 1 }),
      execute: async (command) => {
        await notifications.createIntent({
          templateId: '00000000-0000-0000-0000-000000000000',
          notificationClass: 'shift_reminder',
          channel: 'in_app',
          subjectType: 'shift',
          subjectId: command.subjectId,
          recipientRef: 'provider',
          bodyRedacted: 'Shift reminder',
          correlationId: command.policyVersion,
          sourceDedupeKey: `deadline:${command.deadlineId}:shift_reminder`,
          commandId: `deadline-shift-reminder:${command.deadlineId}`,
          reasonCode: 'shift_reminder_due',
          actor: { systemActor: 'deadline-service' },
        });
      },
    })
    .register('EscalateIncident', {
      load: () => Promise.resolve({ state: 'OPEN', version: 1 }),
      execute: async (command) => {
        await notifications.createIntent({
          templateId: '00000000-0000-4000-8000-000000000000',
          notificationClass: 'incident_ack',
          channel: 'push',
          subjectType: 'incident',
          subjectId: command.subjectId,
          recipientRef: 'on-call-admin',
          bodyRedacted: 'Incident acknowledgement required',
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
    })
    .register('RetryPayoutSubmission', {
      load: () => Promise.resolve({ state: 'PENDING', version: 1 }),
      execute: async (command) => {
        await notifications.createIntent({
          templateId: '00000000-0000-0000-0000-000000000000',
          notificationClass: 'payout_retry',
          channel: 'in_app',
          subjectType: 'payout',
          subjectId: command.subjectId,
          recipientRef: 'finance-admin',
          bodyRedacted: 'Payout retry required',
          correlationId: command.policyVersion,
          sourceDedupeKey: `deadline:${command.deadlineId}:payout_retry`,
          commandId: `deadline-payout-retry:${command.deadlineId}`,
          reasonCode: 'payout_retry_due',
          actor: { systemActor: 'deadline-service' },
        });
      },
    })
    .register('AdvanceDisputeReview', {
      load: () => Promise.resolve({ state: 'OPEN', version: 1 }),
      execute: () => Promise.resolve(),
    })
    .register('AutoCompleteJob', {
      load: () => Promise.resolve({ state: 'OPEN', version: 1 }),
      execute: () => Promise.resolve(),
    })
    .register('RevalidateAssignmentProvider', {
      load: () => Promise.resolve({ state: 'CONFIRMED', version: 1 }),
      execute: () => Promise.resolve(),
    })
    .register('ExpireCredential', {
      load: () => Promise.resolve({ state: 'ACTIVE', version: 1 }),
      execute: () => Promise.resolve(),
    });

  const recordDeadlineDeadLetterNotification = async (
    deadlineId: string,
    deadlineType: string,
  ): Promise<void> => {
    try {
      await notifications.createIntent({
        templateId: '00000000-0000-0000-0000-000000000000',
        notificationClass: 'system',
        channel: 'in_app',
        subjectType: 'scheduled_deadline',
        subjectId: deadlineId,
        recipientRef: 'ops-admin',
        bodyRedacted: `Deadline ${deadlineType} dead-lettered`,
        correlationId: `deadline-dead-letter:${deadlineId}`,
        sourceDedupeKey: `deadline-dead-letter:${deadlineId}`,
        commandId: `deadline-dead-letter:${deadlineId}`,
        reasonCode: 'deadline_dead_lettered',
        actor: { systemActor: 'deadline-service' },
      });
    } catch {
      // best-effort: do not break the worker cycle
    }
  };

  const consumer = new InboxConsumer('carespaces.local', store, queue)
    .register('tenant.created.v1', () => Promise.resolve())
    .register('tenant.synthetic-seeded.v1', () => Promise.resolve())
    .register('notification.intent.created.v1', () => Promise.resolve())
    .register('deadline.command-due.v1', async (message) => {
      const envelope = message.payload as EventEnvelope;
      const command = deadlineCommandFromPayload(envelope.payload);
      const result = await deadlineDispatcher.dispatch(command);
      await deadlineStore.recordDispatchOutcome(
        command,
        result,
        message.correlationId,
      );
    });
  for (const eventType of [
    'ops_task.created.v1',
    'ops_task.claimed.v1',
    'ops_task.reassigned.v1',
    'ops_task.escalated.v1',
    'ops_task.resolved.v1',
  ]) {
    consumer.register(eventType, () => Promise.resolve());
  }

  return {
    configuredDeadlines,
    deadlineDispatcher,
    notificationDispatcher,
    notifications,
    async runCycle(): Promise<WorkerCycleResult> {
      const deadlineResult = await deadlineScheduler.runBatch({
        limit: 25,
        leaseMs: 30_000,
        maxAttempts: 5,
      });
      if (deadlineResult.deadLettered > 0) {
        const deadLettered = await pool.query<{
          id: string;
          deadline_type: string;
        }>(
          `SELECT id, deadline_type FROM platform.scheduled_deadline
           WHERE status = 'DEAD_LETTER' AND dead_lettered_at > clock_timestamp() - interval '1 minute'
           ORDER BY dead_lettered_at DESC LIMIT 5`,
        );
        for (const row of deadLettered.rows) {
          await recordDeadlineDeadLetterNotification(
            row.id,
            row.deadline_type,
          );
        }
      }
      const publisherResult = await publisher.runBatch({
        limit: 25,
        leaseMs: 30_000,
        maxAttempts: 5,
      });
      const consumerResult = await consumer.runBatch({
        limit: 25,
        leaseMs: 30_000,
        maxAttempts: 5,
      });
      const notificationResult = await notificationDispatcher.runBatch({
        limit: 25,
        leaseMs: 30_000,
        maxAttempts: 5,
      });
      return {
        deadlines: deadlineResult,
        publisher: publisherResult,
        consumer: consumerResult,
        notifications: notificationResult,
      };
    },
  };
}