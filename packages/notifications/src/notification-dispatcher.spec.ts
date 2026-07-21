import { describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { NotificationDispatcher } from './notification-dispatcher.js';
import {
  type DeliveryAdapter,
  type DeliveryResult,
  SyntheticDeliveryAdapter,
} from './delivery-adapter.js';

interface ScriptedPool {
  rowsFor: (sql: string) => Record<string, unknown>[];
  committed: boolean;
  rolledBack: boolean;
  queries: string[];
}

function scriptedPool(
  matchers: Array<{ match: (sql: string) => boolean; rows: Record<string, unknown>[] }>,
): {
  pool: Pool;
  script: ScriptedPool;
} {
  const queries: string[] = [];
  let committed = false;
  let rolledBack = false;
  const client = {
    query: <T extends { rows: unknown[] }>(sql: string): Promise<T> => {
      queries.push(sql);
      if (sql === 'BEGIN') return Promise.resolve({ rows: [] } as unknown as T);
      if (sql === 'COMMIT') {
        committed = true;
        return Promise.resolve({ rows: [] } as unknown as T);
      }
      if (sql === 'ROLLBACK') {
        rolledBack = true;
        return Promise.resolve({ rows: [] } as unknown as T);
      }
      for (const matcher of matchers) {
        if (matcher.match(sql)) {
          return Promise.resolve({ rows: [...matcher.rows] } as unknown as T);
        }
      }
      return Promise.resolve({ rows: [] } as unknown as T);
    },
    release: () => undefined,
  };
  const pool = {
    connect: () => Promise.resolve(client),
  } as unknown as Pool;
  return {
    pool,
    script: {
      rowsFor: () => [],
      committed,
      rolledBack,
      queries,
    },
  };
}

function sqlIncludes(needle: string) {
  return (sql: string) => sql.includes(needle);
}

function intentRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: '90000000-0000-4000-8000-000000000001',
    tenant_id: null,
    template_id: '91000000-0000-4000-8000-000000000001',
    notification_class: 'incident_ack',
    channel: 'push',
    subject_type: 'incident',
    subject_id: '31000000-0000-4000-8000-000000000001',
    recipient_user_id: null,
    recipient_ref: 'admin-001',
    body_redacted: 'ACK required',
    correlation_id: 'incident-1',
    source_dedupe_key: 'incident-1:ack-notification',
    status: 'LEASED',
    attempts: 1,
    next_attempt_at: new Date('2026-07-19T00:00:00.000Z'),
    lease_id: 'lease-1',
    lease_expires_at: null,
    delivered_at: null,
    terminal_failed_at: null,
    cancelled_at: null,
    last_error: null,
    acknowledged_at: null,
    ops_task_id: null,
    version: 1,
    created_at: new Date('2026-07-19T00:00:00.000Z'),
    updated_at: new Date('2026-07-19T00:00:00.000Z'),
    ...overrides,
  };
}

function firedAttemptRow() {
  return {
    id: '93000000-0000-4000-8000-000000000001',
    intent_id: '90000000-0000-4000-8000-000000000001',
    attempt_number: 1,
    channel: 'push',
    adapter_name: 'synthetic-local',
    status: 'FIRED',
    provider_message_ref: 'synthetic:1',
    error_class: null,
    error_message: null,
    lease_id: 'lease-1',
    started_at: new Date('2026-07-19T00:00:00.000Z'),
    completed_at: new Date('2026-07-19T00:00:00.100Z'),
  };
}

describe('NotificationDispatcher', () => {
  it('marks intent DELIVERED when adapter returns FIRED', async () => {
    const adapter: DeliveryAdapter = {
      name: 'synthetic-local',
      deliver: () =>
        Promise.resolve({
          status: 'FIRED',
          providerMessageRef: 'synthetic:1',
        } as DeliveryResult),
    };
    const { pool } = scriptedPool([
      {
        match: sqlIncludes("SET status = 'LEASED'"),
        rows: [intentRow()],
      },
      {
        match: sqlIncludes('INSERT INTO notifications.notification_delivery_attempt'),
        rows: [firedAttemptRow()],
      },
      {
        match: sqlIncludes("SET status = 'DELIVERED'"),
        rows: [intentRow({ status: 'DELIVERED', delivered_at: new Date('2026-07-19T00:00:00.100Z'), version: 2 })],
      },
    ]);
    const dispatcher = new NotificationDispatcher(pool, adapter);
    const result = await dispatcher.runBatch({ limit: 1 });
    expect(result.claimed).toBe(1);
    expect(result.fired).toBe(1);
    expect(result.deadLettered).toBe(0);
  });

  it('retries a transient failure under maxAttempts', async () => {
    const adapter: DeliveryAdapter = {
      name: 'synthetic-local',
      deliver: () =>
        Promise.resolve({
          status: 'FAILED',
          errorClass: 'Transient',
          errorMessage: 'boom',
          retryable: true,
        } as DeliveryResult),
    };
    const { pool } = scriptedPool([
      {
        match: sqlIncludes("SET status = 'LEASED'"),
        rows: [intentRow()],
      },
      {
        match: sqlIncludes('INSERT INTO notifications.notification_delivery_attempt'),
        rows: [
          {
            ...firedAttemptRow(),
            status: 'FAILED',
            provider_message_ref: null,
            error_class: 'Transient',
            error_message: 'boom',
          },
        ],
      },
      {
        match: sqlIncludes("SET status = CASE"),
        rows: [intentRow({ status: 'PENDING', version: 2 })],
      },
    ]);
    const dispatcher = new NotificationDispatcher(pool, adapter, {
      maxAttempts: 5,
    });
    const result = await dispatcher.runBatch({ limit: 1 });
    expect(result.retried).toBe(1);
    expect(result.deadLettered).toBe(0);
    expect(result.fallbackTasksCreated).toBe(0);
  });

  it('dead-letters and creates an Ops Task fallback when attempts exhaust', async () => {
    const adapter: DeliveryAdapter = {
      name: 'synthetic-local',
      deliver: () =>
        Promise.resolve({
          status: 'FAILED',
          errorClass: 'Permanent',
          errorMessage: 'gone',
          retryable: false,
        } as DeliveryResult),
    };
    let fallbackCalls = 0;
    const { pool } = scriptedPool([
      {
        match: sqlIncludes("SET status = 'LEASED'"),
        rows: [intentRow()],
      },
      {
        match: sqlIncludes('INSERT INTO notifications.notification_delivery_attempt'),
        rows: [
          {
            ...firedAttemptRow(),
            status: 'DEAD_LETTER',
            provider_message_ref: null,
            error_class: 'Permanent',
            error_message: 'gone',
          },
        ],
      },
      {
        match: sqlIncludes("SET status = CASE"),
        rows: [intentRow({ status: 'TERMINAL_FAILED', terminal_failed_at: new Date('2026-07-19T00:00:00.100Z'), version: 2 })],
      },
      {
        match: sqlIncludes('ops_task_id = $2'),
        rows: [intentRow({ ops_task_id: '80000000-0000-4000-8000-000000000099', version: 3 })],
      },
    ]);
    const dispatcher = new NotificationDispatcher(pool, adapter, {
      maxAttempts: 1,
      createFallbackOpsTask: () => {
        fallbackCalls += 1;
        return Promise.resolve('80000000-0000-4000-8000-000000000099');
      },
    });
    const result = await dispatcher.runBatch({ limit: 1 });
    expect(result.deadLettered).toBe(1);
    expect(result.fallbackTasksCreated).toBe(1);
    expect(fallbackCalls).toBe(1);
  });

  it('uses SyntheticDeliveryAdapter and succeeds by default', async () => {
    const { pool } = scriptedPool([
      {
        match: sqlIncludes("SET status = 'LEASED'"),
        rows: [intentRow()],
      },
      {
        match: sqlIncludes('INSERT INTO notifications.notification_delivery_attempt'),
        rows: [firedAttemptRow()],
      },
      {
        match: sqlIncludes("SET status = 'DELIVERED'"),
        rows: [intentRow({ status: 'DELIVERED', version: 2 })],
      },
    ]);
    const dispatcher = new NotificationDispatcher(pool, new SyntheticDeliveryAdapter());
    const result = await dispatcher.runBatch({ limit: 1 });
    expect(result.fired).toBe(1);
  });
});