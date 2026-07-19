import type { EventQueue } from './queue.js';
import type { ClaimBatchOptions, EventStore } from './store.js';

export interface BatchResult {
  claimed: number;
  succeeded: number;
  retried: number;
  deadLettered: number;
}

export class OutboxPublisher {
  constructor(
    private readonly store: EventStore,
    private readonly queue: EventQueue,
  ) {}

  async runBatch(options: ClaimBatchOptions = {}): Promise<BatchResult> {
    const events = await this.store.claimOutbox(options);
    const result: BatchResult = {
      claimed: events.length,
      succeeded: 0,
      retried: 0,
      deadLettered: 0,
    };
    for (const event of events) {
      try {
        await this.queue.send({
          event_id: event.id,
          event_type: event.eventType,
          aggregate_type: event.aggregateType,
          aggregate_id: event.aggregateId,
          aggregate_version: event.eventVersion,
          occurred_at: event.occurredAt.toISOString(),
          tenant_id: event.tenantId,
          correlation_id: event.correlationId,
          payload: event.payload,
        });
        await this.store.markOutboxPublished(event);
        result.succeeded += 1;
      } catch (cause) {
        const error =
          cause instanceof Error ? cause : new Error('Queue send failed');
        const status = await this.store.markOutboxFailed(event, error, options);
        if (status === 'DEAD_LETTER') result.deadLettered += 1;
        else if (status === 'PENDING') result.retried += 1;
      }
    }
    return result;
  }
}
