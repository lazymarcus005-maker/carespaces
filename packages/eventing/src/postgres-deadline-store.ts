import {
  appendAuditEvent,
  cancelScheduledDeadline,
  claimDueScheduledDeadlines,
  createScheduledDeadline,
  enqueueOutboxEvent,
  markScheduledDeadlineFailed,
  markScheduledDeadlineFired,
  readDeadlineOperationalStatus,
  type ClaimedScheduledDeadline,
  type CreateScheduledDeadlineInput,
  type ScheduledDeadlineStatus,
} from '@carespaces/database';
import type { Pool, PoolClient } from 'pg';
import type { DeadlineStore } from './deadline.js';
import type { DeadlineCommand, DeadlineDispatchResult } from './deadline.js';

function operationalError(error: Error): string {
  return `${error.name}: operation failed`;
}

export class PostgresDeadlineStore implements DeadlineStore {
  constructor(private readonly pool: Pool) {}

  create(input: CreateScheduledDeadlineInput) {
    return this.withClient(async (client) => {
      const result = await createScheduledDeadline(client, input);
      if (result.created) {
        await appendAuditEvent(client, {
          actor: { tenantId: input.tenantId },
          action: 'deadline.scheduled',
          subject: { type: 'scheduled_deadline', id: result.deadline.id },
          reasonCode: 'domain_deadline_created',
          correlationId: input.correlationId,
          metadata: {
            systemActor: 'deadline-service',
            deadlineType: input.deadlineType,
            subjectType: input.subjectType,
            dueAt: input.dueAt.toISOString(),
            policyVersion: input.policyVersion,
          },
        });
      }
      return result;
    });
  }

  cancel(input: { id: string; reasonCode: string; correlationId: string }) {
    return this.withClient(async (client) => {
      const cancelled = await cancelScheduledDeadline(client, input.id);
      if (cancelled) {
        await appendAuditEvent(client, {
          actor: {},
          action: 'deadline.cancelled',
          subject: { type: 'scheduled_deadline', id: input.id },
          reasonCode: input.reasonCode,
          correlationId: input.correlationId,
          metadata: { systemActor: 'deadline-service' },
        });
      }
      return cancelled;
    });
  }

  claimDue(options = {}) {
    return claimDueScheduledDeadlines(this.pool, options);
  }

  fire(deadline: ClaimedScheduledDeadline) {
    return this.withClient(async (client) => {
      await enqueueOutboxEvent(client, {
        id: deadline.eventId,
        tenantId: deadline.tenantId,
        aggregateType: 'scheduled_deadline',
        aggregateId: deadline.id,
        eventType: 'deadline.command-due.v1',
        payload: {
          deadlineId: deadline.id,
          deadlineType: deadline.deadlineType,
          subjectType: deadline.subjectType,
          subjectId: deadline.subjectId,
          commandType: deadline.commandType,
          expectedState: deadline.expectedState,
          expectedVersion: deadline.expectedVersion,
          policyVersion: deadline.policyVersion,
        },
        correlationId: deadline.correlationId,
      });
      const fired = await markScheduledDeadlineFired(client, {
        id: deadline.id,
        leaseId: deadline.leaseId,
      });
      if (!fired) throw new Error('Deadline lease was lost before commit');
      await appendAuditEvent(client, {
        actor: { tenantId: deadline.tenantId },
        action: 'deadline.fired',
        subject: { type: 'scheduled_deadline', id: deadline.id },
        reasonCode: 'deadline_due',
        correlationId: deadline.correlationId,
        metadata: {
          systemActor: 'deadline-service',
          deadlineType: deadline.deadlineType,
          commandType: deadline.commandType,
          attempts: deadline.attempts,
        },
      });
      return true;
    });
  }

  fail(
    deadline: ClaimedScheduledDeadline,
    error: Error,
    options: { retryAfterMs?: number; maxAttempts?: number } = {},
  ): Promise<ScheduledDeadlineStatus | null> {
    return this.withClient(async (client) => {
      const status = await markScheduledDeadlineFailed(client, {
        id: deadline.id,
        leaseId: deadline.leaseId,
        errorMessage: operationalError(error),
        ...options,
      });
      if (status === 'DEAD_LETTER') {
        await appendAuditEvent(client, {
          actor: { tenantId: deadline.tenantId },
          action: 'deadline.dead_lettered',
          subject: { type: 'scheduled_deadline', id: deadline.id },
          reasonCode: 'deadline_attempts_exhausted',
          correlationId: deadline.correlationId,
          metadata: {
            systemActor: 'deadline-service',
            deadlineType: deadline.deadlineType,
            attempts: deadline.attempts,
            errorType: error.name,
          },
        });
      }
      return status;
    });
  }

  readOperationalStatus() {
    return readDeadlineOperationalStatus(this.pool);
  }

  recordDispatchOutcome(
    command: DeadlineCommand,
    result: DeadlineDispatchResult,
    correlationId: string,
  ): Promise<string> {
    return this.withClient((client) => {
      return appendAuditEvent(client, {
        actor: {},
        action:
          result === 'EXECUTED'
            ? 'deadline.command.executed'
            : 'deadline.command.noop',
        subject: { type: 'scheduled_deadline', id: command.deadlineId },
        reasonCode: result.toLowerCase(),
        correlationId,
        metadata: {
          systemActor: 'deadline-service',
          commandType: command.commandType,
          result,
        },
      });
    });
  }

  private async withClient<T>(
    operation: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await operation(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
