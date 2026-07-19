import { describe, expect, it } from 'vitest';
import {
  OpsTaskAuthorizationError,
  PostgresOpsTaskService,
} from './ops-task-service.js';

const baseTask = {
  taskType: 'deadline.incident_ack',
  subjectType: 'incident' as const,
  subjectId: '30000000-0000-4000-8000-000000000001',
  queue: 'INCIDENT' as const,
  priority: 'CRITICAL' as const,
  sourceDedupeKey: 'incident-1:ack-deadline',
  correlationId: 'request-1',
  reasonCode: 'ack_deadline_elapsed',
};

describe('Ops Task service guards', () => {
  const service = new PostgresOpsTaskService({} as never);

  it('requires a command ID before accessing persistence', () => {
    expect(() =>
      service.create({
        ...baseTask,
        commandId: '',
        actor: { systemActor: 'incident-service' },
      }),
    ).toThrow('command ID is required');
  });

  it('denies tenant actors from privileged task management', () => {
    expect(() =>
      service.create({
        ...baseTask,
        commandId: 'create-1',
        actor: {
          authorization: {
            actorUserId: '10000000-0000-4000-8000-000000000001',
            actorTenantId: '20000000-0000-4000-8000-000000000001',
            resourceTenantId: '20000000-0000-4000-8000-000000000001',
            role: 'FAMILY_OWNER',
            membershipStatus: 'ACTIVE',
          },
        },
      }),
    ).toThrow(OpsTaskAuthorizationError);
  });
});
