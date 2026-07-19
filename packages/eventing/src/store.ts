import type {
  ClaimedInboxMessage,
  ClaimedOutboxEvent,
  InboxRecordResult,
  InboxMessageStatus,
  OutboxEventStatus,
} from '@carespaces/database';
import type { EventEnvelope } from './queue.js';

export interface ClaimBatchOptions {
  limit?: number;
  leaseMs?: number;
  maxAttempts?: number;
}

export interface EventStore {
  claimOutbox(options?: ClaimBatchOptions): Promise<ClaimedOutboxEvent[]>;
  markOutboxPublished(event: ClaimedOutboxEvent): Promise<boolean>;
  markOutboxFailed(
    event: ClaimedOutboxEvent,
    error: Error,
    options?: { retryAfterMs?: number; maxAttempts?: number },
  ): Promise<OutboxEventStatus | null>;
  recordInbox(input: {
    source: string;
    envelope: EventEnvelope;
  }): Promise<InboxRecordResult>;
  claimInbox(
    options?: ClaimBatchOptions & { source?: string },
  ): Promise<ClaimedInboxMessage[]>;
  markInboxApplied(message: ClaimedInboxMessage): Promise<boolean>;
  markInboxFailed(
    message: ClaimedInboxMessage,
    error: Error,
    options?: { retryAfterMs?: number; maxAttempts?: number },
  ): Promise<InboxMessageStatus | null>;
}
