import { describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import {
  NotificationPreferenceError,
  PostgresNotificationService,
} from './notification-service.js';

const baseIntent = {
  templateKey: 'incident.ack_required',
  templateId: '91000000-0000-4000-8000-000000000001',
  notificationClass: 'incident_ack' as const,
  channel: 'push' as const,
  subjectType: 'incident' as const,
  subjectId: '31000000-0000-4000-8000-000000000001',
  recipientRef: 'admin-001',
  bodyRedacted: 'ACK required',
  correlationId: 'incident-1',
  sourceDedupeKey: 'incident-1:ack-notification',
};

describe('notification service guards', () => {
  const service = new PostgresNotificationService({} as never);

  it('requires a command ID before persistence', () => {
    expect(() =>
      service.createIntent({
        ...baseIntent,
        commandId: '',
        reasonCode: 'incident_ack_overdue',
        actor: { systemActor: 'incident-service' },
      }),
    ).toThrow('command ID is required');
  });

  it('requires a reason code before persistence', () => {
    expect(() =>
      service.createIntent({
        ...baseIntent,
        commandId: 'cmd-1',
        reasonCode: '',
        actor: { systemActor: 'incident-service' },
      }),
    ).toThrow('reason code is required');
  });

  it('rejects disabling a critical class preference', async () => {
    await expect(
      service.setPreference({
        userId: '01000000-0000-4000-8000-000000000001',
        notificationClass: 'incident_ack',
        channel: 'push',
        enabled: false,
      }),
    ).rejects.toThrow(NotificationPreferenceError);
  });

  it('allows disabling a non-critical class preference at the service guard', async () => {
    const pool = {
      connect: () => ({
        query: (sql: string) => {
          if (sql === 'BEGIN' || sql === 'COMMIT') return Promise.resolve();
          if (sql.startsWith('INSERT INTO notifications.notification_user_preference')) {
            return Promise.resolve({
              rows: [
                {
                  id: '92000000-0000-4000-8000-000000000001',
                  user_id: '01000000-0000-4000-8000-000000000001',
                  notification_class: 'shift_reminder',
                  channel: 'push',
                  enabled: false,
                  updated_at: new Date('2026-07-19T00:00:00.000Z'),
                },
              ],
            });
          }
          return Promise.resolve({ rows: [] });
        },
        release: () => undefined,
      }),
    } as unknown as Pool;
    const svc = new PostgresNotificationService(pool);
    await expect(
      svc.setPreference({
        userId: '01000000-0000-4000-8000-000000000001',
        notificationClass: 'shift_reminder',
        channel: 'push',
        enabled: false,
      }),
    ).resolves.toBeUndefined();
  });
});