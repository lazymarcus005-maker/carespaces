import { describe, expect, it } from 'vitest';
import {
  claimOpsTask,
  createOpsTask,
  readOpsTaskOperationalStatus,
} from './ops-tasks.js';
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
  id: '80000000-0000-4000-8000-000000000001',
  tenant_id: null,
  task_type: 'deadline.incident_ack',
  subject_type: 'incident',
  subject_id: '30000000-0000-4000-8000-000000000001',
  queue: 'INCIDENT',
  priority: 'CRITICAL',
  owner_user_id: null,
  due_at: new Date('2026-07-19T00:00:00.000Z'),
  escalation_level: 0,
  status: 'OPEN',
  resolution_code: null,
  source_dedupe_key: 'incident-1:ack-deadline',
  created_by_user_id: null,
  created_by_system: 'incident-service',
  resolved_by_user_id: null,
  version: 1,
  created_at: new Date('2026-07-19T00:00:00.000Z'),
  updated_at: new Date('2026-07-19T00:00:00.000Z'),
  resolved_at: null,
};

describe('Ops Task persistence', () => {
  it('creates a feature task once by source dedupe key', async () => {
    const first = scripted([[row]]);
    await expect(
      createOpsTask(first.client, {
        id: row.id,
        taskType: row.task_type,
        subjectType: 'incident',
        subjectId: row.subject_id,
        queue: 'INCIDENT',
        priority: 'CRITICAL',
        dueAt: row.due_at,
        sourceDedupeKey: row.source_dedupe_key,
        createdBySystem: row.created_by_system,
      }),
    ).resolves.toMatchObject({ created: true, task: { version: 1 } });
    expect(first.calls[0]?.sql).toContain(
      'ON CONFLICT (source_dedupe_key) DO NOTHING',
    );

    const duplicate = scripted([[], [row]]);
    await expect(
      createOpsTask(duplicate.client, {
        taskType: row.task_type,
        subjectType: 'incident',
        subjectId: row.subject_id,
        queue: 'INCIDENT',
        priority: 'CRITICAL',
        dueAt: row.due_at,
        sourceDedupeKey: row.source_dedupe_key,
        createdBySystem: row.created_by_system,
      }),
    ).resolves.toMatchObject({ created: false, task: { id: row.id } });
  });

  it('claims only the expected open version', async () => {
    const claimed = { ...row, status: 'CLAIMED', version: 2 };
    const db = scripted([[claimed]]);
    await expect(
      claimOpsTask(db.client, {
        id: row.id,
        expectedVersion: 1,
        ownerUserId: '10000000-0000-4000-8000-000000000001',
      }),
    ).resolves.toMatchObject({ status: 'CLAIMED', version: 2 });
    expect(db.calls[0]?.sql).toContain("version = $2 AND status = 'OPEN'");
  });

  it('maps queue health for operator visibility', async () => {
    const db = scripted([
      [
        {
          queue: 'INCIDENT',
          status: 'OPEN',
          count: '3',
          overdue: '1',
          unowned: '2',
          highest_escalation_level: '2',
          oldest_due_at: row.due_at,
        },
      ],
    ]);
    await expect(readOpsTaskOperationalStatus(db.client)).resolves.toEqual([
      {
        queue: 'INCIDENT',
        status: 'OPEN',
        count: 3,
        overdue: 1,
        unowned: 2,
        highestEscalationLevel: 2,
        oldestDueAt: row.due_at,
      },
    ]);
  });
});
