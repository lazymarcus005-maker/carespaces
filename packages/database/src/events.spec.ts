import { describe, expect, it } from 'vitest';
import {
  claimInboxMessages,
  claimOutboxEvents,
  enqueueOutboxEvent,
  markInboxApplied,
  markInboxFailed,
  markOutboxFailed,
  markOutboxPublished,
  recordInboxMessage,
  replayInboxMessage,
  replayOutboxEvent,
  type EventQueryRunner,
} from './events.js';

interface QueryCall {
  sql: string;
  values: readonly unknown[] | undefined;
}

function createScriptedClient(rows: Record<string, unknown>[][] = []) {
  const calls: QueryCall[] = [];
  const client: EventQueryRunner = {
    query: <Row extends Record<string, unknown>>(
      sql: string,
      values?: readonly unknown[],
    ) => {
      calls.push({ sql, values });
      return Promise.resolve({ rows: (rows.shift() ?? []) as Row[] });
    },
  };
  return {
    calls,
    client,
  };
}

describe('inbox/outbox event backbone', () => {
  it('enqueues an outbox event with an envelope version and correlation id', async () => {
    const { calls, client } = createScriptedClient();

    const id = await enqueueOutboxEvent(client, {
      id: '10000000-0000-4000-8000-000000000001',
      tenantId: '20000000-0000-4000-8000-000000000001',
      aggregateType: 'tenant',
      aggregateId: '20000000-0000-4000-8000-000000000001',
      eventType: 'tenant.created.v1',
      payload: { tenantId: '20000000-0000-4000-8000-000000000001' },
      correlationId: 'request-1',
    });

    expect(id).toBe('10000000-0000-4000-8000-000000000001');
    expect(calls[0]?.sql).toContain('INSERT INTO platform.outbox_event');
    expect(calls[0]?.values).toEqual([
      '10000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000001',
      'tenant',
      '20000000-0000-4000-8000-000000000001',
      'tenant.created.v1',
      1,
      '{"tenantId":"20000000-0000-4000-8000-000000000001"}',
      'request-1',
    ]);
  });

  it('claims outbox events with a lease and skip-locked ordering', async () => {
    const { calls, client } = createScriptedClient([
      [
        {
          id: 'event-1',
          tenant_id: null,
          aggregate_type: 'tenant',
          aggregate_id: 'tenant-1',
          event_type: 'tenant.created.v1',
          event_version: 1,
          payload: { tenantId: 'tenant-1' },
          correlation_id: 'request-1',
          occurred_at: new Date('2026-07-19T00:00:00.000Z'),
          attempts: 1,
        },
      ],
    ]);

    const events = await claimOutboxEvents(client, {
      leaseId: '30000000-0000-4000-8000-000000000001',
      limit: 10,
      leaseMs: 15_000,
      maxAttempts: 3,
    });

    expect(events).toEqual([
      {
        id: 'event-1',
        tenantId: null,
        aggregateType: 'tenant',
        aggregateId: 'tenant-1',
        eventType: 'tenant.created.v1',
        eventVersion: 1,
        payload: { tenantId: 'tenant-1' },
        correlationId: 'request-1',
        occurredAt: new Date('2026-07-19T00:00:00.000Z'),
        attempts: 1,
        leaseId: '30000000-0000-4000-8000-000000000001',
      },
    ]);
    expect(calls[0]?.sql).toContain('FOR UPDATE SKIP LOCKED');
    expect(calls[0]?.values).toEqual([
      10,
      '30000000-0000-4000-8000-000000000001',
      3,
      15000,
    ]);
  });

  it('marks outbox delivery as published or retry/dead-letter safely', async () => {
    const published = createScriptedClient([[{ id: 'event-1' }]]);
    await expect(
      markOutboxPublished(published.client, {
        id: 'event-1',
        leaseId: '30000000-0000-4000-8000-000000000001',
      }),
    ).resolves.toBe(true);
    expect(published.calls[0]?.sql).toContain("status = 'PUBLISHED'");

    const failed = createScriptedClient([[{ status: 'DEAD_LETTER' }]]);
    await expect(
      markOutboxFailed(failed.client, {
        id: 'event-1',
        leaseId: '30000000-0000-4000-8000-000000000001',
        errorMessage: 'publisher unavailable',
        retryAfterMs: 250,
        maxAttempts: 1,
      }),
    ).resolves.toBe('DEAD_LETTER');
    expect(failed.calls[0]?.sql).toContain('WHEN attempts >= $4');
    expect(failed.calls[0]?.values).toEqual([
      'event-1',
      '30000000-0000-4000-8000-000000000001',
      'publisher unavailable',
      1,
      250,
    ]);
  });

  it('records inbox messages once and reports duplicate delivery state', async () => {
    const first = createScriptedClient([
      [{ id: 'message-1', status: 'RECEIVED' }],
    ]);
    await expect(
      recordInboxMessage(first.client, {
        id: 'message-1',
        source: 'psp',
        messageId: 'provider-event-1',
        eventType: 'payment.authorized.v1',
        payload: { paymentId: 'payment-1' },
        correlationId: 'webhook-1',
      }),
    ).resolves.toEqual({
      id: 'message-1',
      status: 'RECEIVED',
      duplicate: false,
    });

    const duplicate = createScriptedClient([
      [],
      [{ id: 'message-1', status: 'APPLIED' }],
    ]);
    await expect(
      recordInboxMessage(duplicate.client, {
        source: 'psp',
        messageId: 'provider-event-1',
        eventType: 'payment.authorized.v1',
        payload: { paymentId: 'payment-1' },
        correlationId: 'webhook-1',
      }),
    ).resolves.toEqual({
      id: 'message-1',
      status: 'APPLIED',
      duplicate: true,
    });
    expect(duplicate.calls[0]?.sql).toContain(
      'ON CONFLICT (source, message_id) DO NOTHING',
    );
    expect(duplicate.calls[1]?.sql).toContain(
      'WHERE source = $1 AND message_id = $2',
    );
  });

  it('claims and completes inbox processing with retry/dead-letter outcomes', async () => {
    const claimed = createScriptedClient([
      [
        {
          id: 'message-1',
          source: 'psp',
          message_id: 'provider-event-1',
          event_type: 'payment.authorized.v1',
          payload: { paymentId: 'payment-1' },
          correlation_id: 'webhook-1',
          attempts: 1,
        },
      ],
    ]);

    await expect(
      claimInboxMessages(claimed.client, {
        leaseId: '30000000-0000-4000-8000-000000000001',
        source: 'psp',
      }),
    ).resolves.toMatchObject([
      {
        id: 'message-1',
        source: 'psp',
        messageId: 'provider-event-1',
        eventType: 'payment.authorized.v1',
        leaseId: '30000000-0000-4000-8000-000000000001',
      },
    ]);
    expect(claimed.calls[0]?.sql).toContain('FOR UPDATE SKIP LOCKED');
    expect(claimed.calls[0]?.values?.[4]).toBe('psp');

    const applied = createScriptedClient([[{ id: 'message-1' }]]);
    await expect(
      markInboxApplied(applied.client, {
        id: 'message-1',
        leaseId: '30000000-0000-4000-8000-000000000001',
      }),
    ).resolves.toBe(true);
    expect(applied.calls[0]?.sql).toContain("status = 'APPLIED'");

    const failed = createScriptedClient([[{ status: 'RECEIVED' }]]);
    await expect(
      markInboxFailed(failed.client, {
        id: 'message-1',
        errorMessage: 'handler unavailable',
      }),
    ).resolves.toBe('RECEIVED');
    expect(failed.calls[0]?.sql).toContain("ELSE 'RECEIVED'");
  });

  it('requeues only dead-lettered inbox and outbox records', async () => {
    const outbox = createScriptedClient([[{ id: 'event-1' }]]);
    await expect(replayOutboxEvent(outbox.client, 'event-1')).resolves.toBe(
      true,
    );
    expect(outbox.calls[0]?.sql).toContain("status = 'DEAD_LETTER'");
    expect(outbox.calls[0]?.sql).toContain("status = 'PENDING'");

    const inbox = createScriptedClient([[]]);
    await expect(replayInboxMessage(inbox.client, 'message-1')).resolves.toBe(
      false,
    );
    expect(inbox.calls[0]?.sql).toContain("status = 'RECEIVED'");
  });
});
