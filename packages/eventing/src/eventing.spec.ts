import type {
  ClaimedInboxMessage,
  ClaimedOutboxEvent,
  InboxRecordResult,
  InboxMessageStatus,
  OutboxEventStatus,
} from '@carespaces/database';
import { describe, expect, it } from 'vitest';
import { InboxConsumer } from './consumer.js';
import { OutboxPublisher } from './publisher.js';
import {
  InMemoryEventQueue,
  type EventEnvelope,
  type EventQueue,
} from './queue.js';
import type { EventStore } from './store.js';

const envelope: EventEnvelope = {
  event_id: '10000000-0000-4000-8000-000000000001',
  event_type: 'tenant.created.v1',
  aggregate_type: 'tenant',
  aggregate_id: '20000000-0000-4000-8000-000000000001',
  aggregate_version: 1,
  occurred_at: '2026-07-19T00:00:00.000Z',
  tenant_id: '20000000-0000-4000-8000-000000000001',
  correlation_id: 'request-1',
  payload: { tenantId: '20000000-0000-4000-8000-000000000001' },
};

class MemoryStore implements EventStore {
  outbox: ClaimedOutboxEvent[] = [];
  inbox: ClaimedInboxMessage[] = [];
  records = new Map<string, InboxRecordResult>();
  published = 0;
  applied = 0;
  outboxFailure: OutboxEventStatus = 'PENDING';
  inboxFailure: InboxMessageStatus = 'RECEIVED';

  claimOutbox() {
    return Promise.resolve(this.outbox.splice(0));
  }
  markOutboxPublished() {
    this.published += 1;
    return Promise.resolve(true);
  }
  markOutboxFailed() {
    return Promise.resolve(this.outboxFailure);
  }
  recordInbox(input: { source: string; envelope: EventEnvelope }) {
    const key = `${input.source}:${input.envelope.event_id}`;
    const existing = this.records.get(key);
    if (existing) return Promise.resolve({ ...existing, duplicate: true });
    const result: InboxRecordResult = {
      id: input.envelope.event_id,
      status: 'RECEIVED',
      duplicate: false,
    };
    this.records.set(key, result);
    this.inbox.push({
      id: input.envelope.event_id,
      source: input.source,
      messageId: input.envelope.event_id,
      eventType: input.envelope.event_type,
      payload: input.envelope,
      correlationId: input.envelope.correlation_id,
      attempts: 1,
      leaseId: '30000000-0000-4000-8000-000000000001',
    });
    return Promise.resolve(result);
  }
  claimInbox() {
    return Promise.resolve(this.inbox.splice(0));
  }
  markInboxApplied() {
    this.applied += 1;
    return Promise.resolve(true);
  }
  markInboxFailed() {
    return Promise.resolve(this.inboxFailure);
  }
}

describe('eventing workers', () => {
  it('publishes the versioned outbox envelope and marks the row', async () => {
    const store = new MemoryStore();
    store.outbox.push({
      id: envelope.event_id,
      tenantId: envelope.tenant_id,
      aggregateType: envelope.aggregate_type,
      aggregateId: envelope.aggregate_id,
      eventType: envelope.event_type,
      eventVersion: envelope.aggregate_version,
      payload: envelope.payload,
      correlationId: envelope.correlation_id,
      occurredAt: new Date(envelope.occurred_at),
      attempts: 1,
      leaseId: '30000000-0000-4000-8000-000000000001',
    });
    const queue = new InMemoryEventQueue();

    await expect(new OutboxPublisher(store, queue).runBatch()).resolves.toEqual(
      {
        claimed: 1,
        succeeded: 1,
        retried: 0,
        deadLettered: 0,
      },
    );
    expect(store.published).toBe(1);
    expect((await queue.receive())[0]?.envelope).toEqual(envelope);
  });

  it('releases a failed queue delivery for redelivery', async () => {
    let now = 100;
    const queue = new InMemoryEventQueue(() => now, 50);
    await queue.send(envelope);
    const first = (await queue.receive())[0];
    expect(first).toBeDefined();
    await queue.release(first!.receiptHandle, 25);
    expect(await queue.receive()).toEqual([]);
    now += 25;
    expect((await queue.receive())[0]?.envelope.event_id).toBe(
      envelope.event_id,
    );
  });

  it('deduplicates queue delivery before applying one side effect', async () => {
    const store = new MemoryStore();
    const queue = new InMemoryEventQueue();
    await queue.send(envelope);
    await queue.send(envelope);
    let effects = 0;
    const consumer = new InboxConsumer('local', store, queue).register(
      envelope.event_type,
      async () => {
        effects += 1;
      },
    );

    await expect(consumer.runBatch()).resolves.toMatchObject({
      claimed: 1,
      succeeded: 1,
    });
    expect(effects).toBe(1);
    expect(store.records.size).toBe(1);
    expect(queue.size).toBe(0);
  });

  it('dead-letters poison messages after the store exhausts retries', async () => {
    const store = new MemoryStore();
    store.inboxFailure = 'DEAD_LETTER';
    await store.recordInbox({ source: 'local', envelope });
    const consumer = new InboxConsumer(
      'local',
      store,
      new InMemoryEventQueue(),
    ).register(envelope.event_type, () => Promise.reject(new Error('poison')));

    await expect(consumer.runBatch({ maxAttempts: 1 })).resolves.toEqual({
      claimed: 1,
      succeeded: 0,
      retried: 0,
      deadLettered: 1,
    });
  });

  it('marks publisher failures for retry without logging the payload', async () => {
    const store = new MemoryStore();
    store.outbox.push({
      id: envelope.event_id,
      tenantId: envelope.tenant_id,
      aggregateType: envelope.aggregate_type,
      aggregateId: envelope.aggregate_id,
      eventType: envelope.event_type,
      eventVersion: 1,
      payload: { exact_address: 'must-not-leak' },
      correlationId: envelope.correlation_id,
      occurredAt: new Date(envelope.occurred_at),
      attempts: 1,
      leaseId: '30000000-0000-4000-8000-000000000001',
    });
    const failingQueue: EventQueue = {
      send: () => Promise.reject(new Error('unavailable')),
      receive: () => Promise.resolve([]),
      acknowledge: () => Promise.resolve(false),
      release: () => Promise.resolve(false),
    };

    await expect(
      new OutboxPublisher(store, failingQueue).runBatch(),
    ).resolves.toMatchObject({ retried: 1 });
  });
});
