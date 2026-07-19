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
  type BatchResult,
  type DeadlineBatchResult,
  type EventEnvelope,
} from '@carespaces/eventing';
import { deadlineCommandFromPayload } from '@carespaces/eventing';
import type { Pool } from 'pg';

export interface WorkerCycleResult {
  deadlines: DeadlineBatchResult;
  publisher: BatchResult;
  consumer: BatchResult;
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
  const deadlineDispatcher = new DeadlineCommandDispatcher();
  const consumer = new InboxConsumer('carespaces.local', store, queue)
    .register('tenant.created.v1', () => Promise.resolve())
    .register('tenant.synthetic-seeded.v1', () => Promise.resolve())
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
    async runCycle(): Promise<WorkerCycleResult> {
      const deadlineResult = await deadlineScheduler.runBatch({
        limit: 25,
        leaseMs: 30_000,
        maxAttempts: 5,
      });
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
      return {
        deadlines: deadlineResult,
        publisher: publisherResult,
        consumer: consumerResult,
      };
    },
  };
}
