import {
  attachIntentOpsTask,
  claimPendingNotificationIntents,
  markIntentAttemptFailed,
  markIntentAttemptFired,
  recordDeadLetterEvidence,
  type NotificationIntentRecord,
} from '@carespaces/database';
import type { Pool, PoolClient } from 'pg';
import type { DeliveryAdapter } from './delivery-adapter.js';

export interface NotificationBatchResult {
  claimed: number;
  fired: number;
  retried: number;
  deadLettered: number;
  fallbackTasksCreated: number;
}

export interface OpsTaskFallbackInput {
  intent: NotificationIntentRecord;
  reasonCode: string;
  correlationId: string;
}

export interface NotificationDispatcherOptions {
  limit?: number;
  leaseMs?: number;
  maxAttempts?: number;
  retryAfterMs?: number;
  createFallbackOpsTask?: (input: OpsTaskFallbackInput) => Promise<string>;
}

const DEFAULT_LIMIT = 25;
const DEFAULT_LEASE_MS = 30_000;
const DEFAULT_RETRY_AFTER_MS = 60_000;
const DEFAULT_MAX_ATTEMPTS = 5;

export class NotificationDispatcher {
  constructor(
    private readonly pool: Pool,
    private readonly adapter: DeliveryAdapter,
    private readonly options: NotificationDispatcherOptions = {},
  ) {}

  async runBatch(
    overrides: NotificationDispatcherOptions = {},
  ): Promise<NotificationBatchResult> {
    const opts = { ...this.options, ...overrides };
    const result: NotificationBatchResult = {
      claimed: 0,
      fired: 0,
      retried: 0,
      deadLettered: 0,
      fallbackTasksCreated: 0,
    };
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const claimed = await claimPendingNotificationIntents(client, {
        limit: opts.limit ?? DEFAULT_LIMIT,
        leaseMs: opts.leaseMs ?? DEFAULT_LEASE_MS,
        maxAttempts: opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
      });
      result.claimed = claimed.length;
      for (const intent of claimed) {
        await this.processIntent(client, intent, opts, result);
      }
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async processIntent(
    client: PoolClient,
    intent: NotificationIntentRecord,
    opts: NotificationDispatcherOptions,
    result: NotificationBatchResult,
  ): Promise<void> {
    const request = {
      intentId: intent.id,
      channel: intent.channel,
      recipientRef: intent.recipientRef,
      bodyRedacted: intent.bodyRedacted,
      notificationClass: intent.notificationClass,
      correlationId: intent.correlationId,
      attemptNumber: intent.attempts,
    };
    let outcome;
    try {
      outcome = await this.adapter.deliver(request);
    } catch (cause) {
      const error = cause instanceof Error ? cause : new Error('adapter threw');
      outcome = {
        status: 'FAILED' as const,
        errorClass: error.name,
        errorMessage: error.message,
        retryable: true,
      };
    }
    if (outcome.status === 'FIRED') {
      await markIntentAttemptFired(client, {
        intentId: intent.id,
        leaseId: intent.leaseId,
        attemptNumber: intent.attempts,
        adapterName: this.adapter.name,
        providerMessageRef: outcome.providerMessageRef,
      });
      result.fired += 1;
      return;
    }
    const maxAttempts = opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    const deadLettered =
      intent.attempts >= maxAttempts || !outcome.retryable;
    const failed = await markIntentAttemptFailed(client, {
      intentId: intent.id,
      leaseId: intent.leaseId,
      attemptNumber: intent.attempts,
      adapterName: this.adapter.name,
      errorClass: outcome.errorClass,
      errorMessage: outcome.errorMessage,
      retryAfterMs: opts.retryAfterMs ?? DEFAULT_RETRY_AFTER_MS,
      maxAttempts,
    });
    if (deadLettered || failed.deadLettered) {
      result.deadLettered += 1;
      const finalAttempt = failed.attempt;
      let opsTaskId: string | undefined;
      if (opts.createFallbackOpsTask) {
        const reasonCode = `notification.${intent.notificationClass}.delivery_failed`;
        opsTaskId = await opts.createFallbackOpsTask({
          intent,
          reasonCode,
          correlationId: intent.correlationId,
        });
        if (opsTaskId) {
          await attachIntentOpsTask(client, {
            intentId: intent.id,
            opsTaskId,
          });
          result.fallbackTasksCreated += 1;
        }
      }
      await recordDeadLetterEvidence(client, {
        intentId: intent.id,
        finalAttemptId: finalAttempt.id,
        reasonCode: 'delivery_attempts_exhausted',
        errorClass: finalAttempt.errorClass,
        errorMessage: finalAttempt.errorMessage,
        opsTaskId: opsTaskId ?? null,
      });
    } else {
      result.retried += 1;
    }
  }
}