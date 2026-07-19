import { describe, expect, it } from 'vitest';
import {
  cancelScheduledDeadline,
  claimDueScheduledDeadlines,
  createScheduledDeadline,
  DeadlineDedupeConflictError,
  readDeadlineOperationalStatus,
} from './deadlines.js';
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
  id: '10000000-0000-4000-8000-000000000001',
  event_id: '20000000-0000-4000-8000-000000000001',
  tenant_id: null,
  deadline_type: 'PROVIDER_RESERVATION_EXPIRY',
  subject_type: 'assignment',
  subject_id: '30000000-0000-4000-8000-000000000001',
  command_type: 'ExpireReservation',
  expected_state: 'RESERVED',
  expected_version: 3,
  policy_version: 'reservation-v1',
  dedupe_key: 'assignment-1:reservation-v1',
  correlation_id: 'request-1',
  due_at: new Date('2026-07-19T00:00:00.000Z'),
  status: 'SCHEDULED',
};

describe('scheduled deadline persistence', () => {
  it('creates a deadline once and returns the deduplicated record', async () => {
    const first = scripted([[row]]);
    await expect(
      createScheduledDeadline(first.client, {
        id: row.id,
        eventId: row.event_id,
        deadlineType: 'PROVIDER_RESERVATION_EXPIRY',
        subjectType: 'assignment',
        subjectId: row.subject_id,
        commandType: 'ExpireReservation',
        expectedState: 'RESERVED',
        expectedVersion: 3,
        policyVersion: 'reservation-v1',
        dedupeKey: row.dedupe_key,
        correlationId: 'request-1',
        dueAt: row.due_at,
      }),
    ).resolves.toMatchObject({ created: true, deadline: { id: row.id } });
    expect(first.calls[0]?.sql).toContain('ON CONFLICT (dedupe_key)');

    const duplicate = scripted([[], [row]]);
    await expect(
      createScheduledDeadline(duplicate.client, {
        deadlineType: 'PROVIDER_RESERVATION_EXPIRY',
        subjectType: 'assignment',
        subjectId: row.subject_id,
        commandType: 'ExpireReservation',
        expectedState: 'RESERVED',
        expectedVersion: 3,
        policyVersion: 'reservation-v1',
        dedupeKey: row.dedupe_key,
        correlationId: 'request-2',
        dueAt: row.due_at,
      }),
    ).resolves.toMatchObject({ created: false, deadline: { id: row.id } });

    const conflict = scripted([[], [row]]);
    await expect(
      createScheduledDeadline(conflict.client, {
        deadlineType: 'PROVIDER_RESERVATION_EXPIRY',
        subjectType: 'assignment',
        subjectId: row.subject_id,
        commandType: 'ExpireReservation',
        expectedState: 'CONFIRMED',
        expectedVersion: 4,
        policyVersion: 'reservation-v1',
        dedupeKey: row.dedupe_key,
        correlationId: 'request-3',
        dueAt: row.due_at,
      }),
    ).rejects.toBeInstanceOf(DeadlineDedupeConflictError);
  });

  it('claims due rows with a lease and skip-locked concurrency', async () => {
    const claim = scripted([[{ ...row, attempts: 1 }]]);
    const result = await claimDueScheduledDeadlines(claim.client, {
      leaseId: '40000000-0000-4000-8000-000000000001',
      limit: 10,
      leaseMs: 15_000,
      maxAttempts: 3,
    });
    expect(result[0]).toMatchObject({
      id: row.id,
      attempts: 1,
      leaseId: '40000000-0000-4000-8000-000000000001',
    });
    expect(claim.calls[0]?.sql).toContain('FOR UPDATE SKIP LOCKED');
    expect(claim.calls[0]?.values).toEqual([
      10,
      '40000000-0000-4000-8000-000000000001',
      3,
      15000,
    ]);
  });

  it('cancels active deadlines and returns operational overdue counts', async () => {
    const cancellation = scripted([[{ id: row.id }]]);
    await expect(
      cancelScheduledDeadline(cancellation.client, row.id),
    ).resolves.toBe(true);
    expect(cancellation.calls[0]?.sql).toContain("status = 'CANCELLED'");

    const status = scripted([
      [
        {
          status: 'SCHEDULED',
          count: '2',
          overdue: '1',
          oldest_due_at: row.due_at,
        },
      ],
    ]);
    await expect(readDeadlineOperationalStatus(status.client)).resolves.toEqual(
      [
        {
          status: 'SCHEDULED',
          count: 2,
          overdue: 1,
          oldestDueAt: row.due_at,
        },
      ],
    );
  });
});
