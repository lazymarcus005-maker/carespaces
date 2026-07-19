import type { ClaimedInboxMessage } from '@carespaces/database';
import type { EventQueue } from './queue.js';
import type { BatchResult } from './publisher.js';
import type { ClaimBatchOptions, EventStore } from './store.js';

export type EventHandler = (message: ClaimedInboxMessage) => Promise<void>;

export class InboxConsumer {
  private readonly handlers = new Map<string, EventHandler>();

  constructor(
    private readonly source: string,
    private readonly store: EventStore,
    private readonly queue: EventQueue,
  ) {}

  register(eventType: string, handler: EventHandler): this {
    this.handlers.set(eventType, handler);
    return this;
  }

  async runBatch(options: ClaimBatchOptions = {}): Promise<BatchResult> {
    const deliveries = await this.queue.receive(options.limit);
    for (const delivery of deliveries) {
      try {
        await this.store.recordInbox({
          source: this.source,
          envelope: delivery.envelope,
        });
        await this.queue.acknowledge(delivery.receiptHandle);
      } catch {
        await this.queue.release(delivery.receiptHandle, options.leaseMs);
      }
    }

    const messages = await this.store.claimInbox({
      ...options,
      source: this.source,
    });
    const result: BatchResult = {
      claimed: messages.length,
      succeeded: 0,
      retried: 0,
      deadLettered: 0,
    };
    for (const message of messages) {
      try {
        const handler = this.handlers.get(message.eventType);
        if (!handler) throw new Error(`No handler for ${message.eventType}`);
        await handler(message);
        await this.store.markInboxApplied(message);
        result.succeeded += 1;
      } catch (cause) {
        const error =
          cause instanceof Error ? cause : new Error('Event handler failed');
        const status = await this.store.markInboxFailed(
          message,
          error,
          options,
        );
        if (status === 'DEAD_LETTER') result.deadLettered += 1;
        else if (status === 'RECEIVED') result.retried += 1;
      }
    }
    return result;
  }
}
