export interface EventEnvelope {
  event_id: string;
  event_type: string;
  aggregate_type: string;
  aggregate_id: string;
  aggregate_version: number;
  occurred_at: string;
  tenant_id: string | null;
  correlation_id: string;
  payload: unknown;
}

export interface QueueDelivery {
  receiptHandle: string;
  envelope: EventEnvelope;
}

export interface EventQueue {
  send(envelope: EventEnvelope): Promise<void>;
  receive(limit?: number): Promise<QueueDelivery[]>;
  acknowledge(receiptHandle: string): Promise<boolean>;
  release(receiptHandle: string, retryAfterMs?: number): Promise<boolean>;
}

interface InMemoryQueueEntry {
  id: number;
  delivery: number;
  envelope: EventEnvelope;
  receiptHandle: string | null;
  visibleAt: number;
}

export class InMemoryEventQueue implements EventQueue {
  private readonly entries: InMemoryQueueEntry[] = [];
  private nextId = 1;

  constructor(
    private readonly now: () => number = Date.now,
    private readonly visibilityTimeoutMs = 30_000,
  ) {}

  send(envelope: EventEnvelope): Promise<void> {
    this.entries.push({
      id: this.nextId++,
      delivery: 0,
      envelope: structuredClone(envelope),
      receiptHandle: null,
      visibleAt: this.now(),
    });
    return Promise.resolve();
  }

  receive(limit = 25): Promise<QueueDelivery[]> {
    const now = this.now();
    const deliveries = this.entries
      .filter((entry) => entry.visibleAt <= now)
      .slice(0, limit)
      .map((entry) => {
        entry.delivery += 1;
        entry.receiptHandle = `${entry.id}:${entry.delivery}`;
        entry.visibleAt = now + this.visibilityTimeoutMs;
        return {
          receiptHandle: entry.receiptHandle,
          envelope: structuredClone(entry.envelope),
        };
      });
    return Promise.resolve(deliveries);
  }

  acknowledge(receiptHandle: string): Promise<boolean> {
    const index = this.entries.findIndex(
      (entry) => entry.receiptHandle === receiptHandle,
    );
    if (index < 0) return Promise.resolve(false);
    this.entries.splice(index, 1);
    return Promise.resolve(true);
  }

  release(receiptHandle: string, retryAfterMs = 0): Promise<boolean> {
    const entry = this.entries.find(
      (candidate) => candidate.receiptHandle === receiptHandle,
    );
    if (!entry) return Promise.resolve(false);
    entry.receiptHandle = null;
    entry.visibleAt = this.now() + retryAfterMs;
    return Promise.resolve(true);
  }

  get size(): number {
    return this.entries.length;
  }
}
