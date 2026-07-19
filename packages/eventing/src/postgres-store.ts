import {
  appendAuditEvent,
  claimInboxMessages,
  claimOutboxEvents,
  markInboxApplied,
  markInboxFailed,
  markOutboxFailed,
  markOutboxPublished,
  recordInboxMessage,
  replayInboxMessage,
  replayOutboxEvent,
  type ClaimedInboxMessage,
  type ClaimedOutboxEvent,
  type InboxMessageStatus,
  type OutboxEventStatus,
} from '@carespaces/database';
import type { Pool, PoolClient } from 'pg';
import type { EventEnvelope } from './queue.js';
import type { ClaimBatchOptions, EventStore } from './store.js';

export interface ReplayDeadLetterInput {
  kind: 'inbox' | 'outbox';
  id: string;
  reasonCode: string;
  correlationId: string;
}

function operationalError(error: Error): Error {
  return new Error(`${error.name}: operation failed`);
}

export class PostgresEventStore implements EventStore {
  constructor(private readonly pool: Pool) {}

  claimOutbox(options: ClaimBatchOptions = {}) {
    return claimOutboxEvents(this.pool, options);
  }

  markOutboxPublished(event: ClaimedOutboxEvent) {
    return markOutboxPublished(this.pool, {
      id: event.id,
      leaseId: event.leaseId,
    });
  }

  async markOutboxFailed(
    event: ClaimedOutboxEvent,
    error: Error,
    options: { retryAfterMs?: number; maxAttempts?: number } = {},
  ): Promise<OutboxEventStatus | null> {
    return this.withClient(async (client) => {
      const status = await markOutboxFailed(client, {
        id: event.id,
        leaseId: event.leaseId,
        errorMessage: operationalError(error).message,
        ...options,
      });
      if (status === 'DEAD_LETTER') {
        await this.appendDeadLetterAudit(client, {
          tenantId: event.tenantId,
          id: event.id,
          kind: 'outbox',
          eventType: event.eventType,
          attempts: event.attempts,
          error,
          correlationId: event.correlationId,
        });
      }
      return status;
    });
  }

  recordInbox(input: { source: string; envelope: EventEnvelope }) {
    return recordInboxMessage(this.pool, {
      source: input.source,
      messageId: input.envelope.event_id,
      eventType: input.envelope.event_type,
      payload: input.envelope,
      correlationId: input.envelope.correlation_id,
    });
  }

  claimInbox(options: ClaimBatchOptions & { source?: string } = {}) {
    return claimInboxMessages(this.pool, options);
  }

  markInboxApplied(message: ClaimedInboxMessage) {
    return markInboxApplied(this.pool, {
      id: message.id,
      leaseId: message.leaseId,
    });
  }

  async markInboxFailed(
    message: ClaimedInboxMessage,
    error: Error,
    options: { retryAfterMs?: number; maxAttempts?: number } = {},
  ): Promise<InboxMessageStatus | null> {
    return this.withClient(async (client) => {
      const status = await markInboxFailed(client, {
        id: message.id,
        leaseId: message.leaseId,
        errorMessage: operationalError(error).message,
        ...options,
      });
      if (status === 'DEAD_LETTER') {
        const envelope = message.payload as Partial<EventEnvelope>;
        await this.appendDeadLetterAudit(client, {
          tenantId:
            typeof envelope.tenant_id === 'string' ? envelope.tenant_id : null,
          id: message.id,
          kind: 'inbox',
          eventType: message.eventType,
          attempts: message.attempts,
          error,
          correlationId: message.correlationId,
        });
      }
      return status;
    });
  }

  async replayDeadLetter(input: ReplayDeadLetterInput): Promise<boolean> {
    return this.withClient(async (client) => {
      const replayed =
        input.kind === 'outbox'
          ? await replayOutboxEvent(client, input.id)
          : await replayInboxMessage(client, input.id);
      if (!replayed) return false;
      await appendAuditEvent(client, {
        actor: {},
        action: `event.${input.kind}.replayed`,
        subject: { type: `${input.kind}_event`, id: input.id },
        reasonCode: input.reasonCode,
        correlationId: input.correlationId,
        metadata: { systemActor: 'event-worker' },
      });
      return true;
    });
  }

  private async withClient<T>(
    operation: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await operation(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private appendDeadLetterAudit(
    client: PoolClient,
    input: {
      tenantId: string | null;
      id: string;
      kind: 'inbox' | 'outbox';
      eventType: string;
      attempts: number;
      error: Error;
      correlationId: string;
    },
  ): Promise<string> {
    return appendAuditEvent(client, {
      actor: { tenantId: input.tenantId },
      action: `event.${input.kind}.dead_lettered`,
      subject: { type: `${input.kind}_event`, id: input.id },
      reasonCode: 'delivery_attempts_exhausted',
      correlationId: input.correlationId,
      metadata: {
        systemActor: 'event-worker',
        eventType: input.eventType,
        attempts: input.attempts,
        errorType: input.error.name,
      },
    });
  }
}
