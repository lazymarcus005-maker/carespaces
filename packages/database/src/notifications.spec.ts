import { describe, expect, it } from 'vitest';
import {
  claimPendingNotificationIntents,
  createNotificationIntent,
  isCriticalNotificationClass,
  readNotificationOperationalStatus,
} from './notifications.js';
import type { EventQueryRunner } from './events.js';

function scripted(rows: Record<string, unknown>[][]) {
  const calls: Array<{ sql: string }> = [];
  const client: EventQueryRunner = {
    query: <Row extends Record<string, unknown>>(sql: string) => {
      calls.push({ sql });
      return Promise.resolve({ rows: (rows.shift() ?? []) as Row[] });
    },
  };
  return { calls, client };
}

const intentRow = {
  id: '90000000-0000-4000-8000-000000000001',
  tenant_id: null,
  template_id: '91000000-0000-4000-8000-000000000001',
  notification_class: 'incident_ack',
  channel: 'push',
  subject_type: 'incident',
  subject_id: '31000000-0000-4000-8000-000000000001',
  recipient_user_id: null,
  recipient_ref: 'admin-001',
  body_redacted: 'Incident ACK required',
  correlation_id: 'incident-1',
  source_dedupe_key: 'incident-1:ack-notification',
  status: 'PENDING',
  attempts: 0,
  next_attempt_at: new Date('2026-07-19T00:00:00.000Z'),
  lease_id: null,
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
};

describe('notification persistence', () => {
  it('marks incident_ack as a critical class', () => {
    expect(isCriticalNotificationClass('incident_ack')).toBe(true);
    expect(isCriticalNotificationClass('shift_reminder')).toBe(false);
  });

  it('creates an intent once by source dedupe key', async () => {
    const first = scripted([[intentRow]]);
    await expect(
      createNotificationIntent(first.client, {
        templateId: intentRow.template_id,
        notificationClass: 'incident_ack',
        channel: 'push',
        subjectType: 'incident',
        subjectId: intentRow.subject_id,
        recipientRef: 'admin-001',
        bodyRedacted: 'Incident ACK required',
        correlationId: 'incident-1',
        sourceDedupeKey: 'incident-1:ack-notification',
      }),
    ).resolves.toMatchObject({ created: true, intent: { version: 1 } });
    expect(first.calls[0]?.sql).toContain(
      'ON CONFLICT (source_dedupe_key) DO NOTHING',
    );
  });

  it('claims due intents with skip locked', async () => {
    const db = scripted([
      [
        {
          ...intentRow,
          status: 'LEASED',
          attempts: 1,
          lease_id: 'lease-1',
        },
      ],
    ]);
    await expect(
      claimPendingNotificationIntents(db.client, { limit: 5 }),
    ).resolves.toHaveLength(1);
    expect(db.calls[0]?.sql).toContain('FOR UPDATE SKIP LOCKED');
  });

  it('maps operational status for operator visibility', async () => {
    const db = scripted([
      [
        {
          status: 'PENDING',
          count: '3',
          overdue: '1',
          dead_lettered: '0',
          oldest_next_attempt_at: intentRow.next_attempt_at,
        },
      ],
    ]);
    await expect(readNotificationOperationalStatus(db.client)).resolves.toEqual([
      {
        status: 'PENDING',
        count: 3,
        overdue: 1,
        deadLettered: 0,
        oldestNextAttemptAt: intentRow.next_attempt_at,
      },
    ]);
  });
});