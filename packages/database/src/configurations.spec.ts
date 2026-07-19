import { describe, expect, it } from 'vitest';
import {
  approveConfigurationVersion,
  configurationValueHash,
  createConfigurationVersion,
  listConfigurationStatus,
} from './configurations.js';
import type { EventQueryRunner } from './events.js';

function scripted(rows: Record<string, unknown>[][]) {
  const calls: Array<{ sql: string; values?: readonly unknown[] }> = [];
  const client: EventQueryRunner = {
    query: <Row extends Record<string, unknown>>(
      sql: string,
      values?: readonly unknown[],
    ) => {
      calls.push({ sql, values });
      return Promise.resolve({ rows: (rows.shift() ?? []) as Row[] });
    },
  };
  return { calls, client };
}

const row = {
  id: '70000000-0000-4000-8000-000000000001',
  config_key: 'platform.deadlines',
  environment: 'production',
  version: 'v1',
  value: { enabled: true },
  value_hash: configurationValueHash({ enabled: true }),
  status: 'DRAFT',
  change_reason: 'initial_policy',
  created_by_user_id: '10000000-0000-4000-8000-000000000001',
  approved_by_user_id: null,
  activated_by_user_id: null,
  supersedes_id: null,
  created_at: new Date('2026-07-19T00:00:00.000Z'),
  approved_at: null,
  activated_at: null,
  retired_at: null,
};

describe('versioned configuration persistence', () => {
  it('hashes JSON canonically regardless of object key order', () => {
    expect(configurationValueHash({ b: 2, a: { d: 4, c: 3 } })).toBe(
      configurationValueHash({ a: { c: 3, d: 4 }, b: 2 }),
    );
  });

  it('stores a draft with its canonical hash', async () => {
    const db = scripted([[row]]);
    await expect(
      createConfigurationVersion(db.client, {
        id: row.id,
        configKey: row.config_key,
        environment: 'production',
        version: row.version,
        value: row.value,
        changeReason: row.change_reason,
        createdByUserId: row.created_by_user_id,
      }),
    ).resolves.toMatchObject({ id: row.id, status: 'DRAFT' });
    expect(db.calls[0]?.values?.[5]).toBe(row.value_hash);
  });

  it('enforces four-eyes approval in the update predicate', async () => {
    const db = scripted([[{ id: row.id }]]);
    await expect(
      approveConfigurationVersion(db.client, {
        id: row.id,
        approvedByUserId: '10000000-0000-4000-8000-000000000002',
      }),
    ).resolves.toBe(true);
    expect(db.calls[0]?.sql).toContain(
      "environment NOT IN ('staging', 'production')",
    );
    expect(db.calls[0]?.sql).toContain('created_by_user_id <> $2');
  });

  it('maps the operational status projection', async () => {
    const activatedAt = new Date('2026-07-19T01:00:00.000Z');
    const db = scripted([
      [
        {
          config_key: row.config_key,
          environment: 'production',
          version: 'v2',
          status: 'ACTIVE',
          activated_at: activatedAt,
        },
      ],
    ]);
    await expect(
      listConfigurationStatus(db.client, 'production'),
    ).resolves.toEqual([
      {
        configKey: row.config_key,
        environment: 'production',
        version: 'v2',
        status: 'ACTIVE',
        activatedAt,
      },
    ]);
  });
});
