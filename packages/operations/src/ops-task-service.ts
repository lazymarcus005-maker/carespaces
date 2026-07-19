import {
  canManageOpsTaskQueue,
  type AuthorizationContext,
} from '@carespaces/authz';
import {
  appendAuditedStateTransition,
  claimOpsTask,
  configurationValueHash,
  createOpsTask,
  enqueueOutboxEvent,
  escalateOpsTask,
  IdempotencyRequestConflictError,
  readOpsTask,
  readOpsTaskOperationalStatus,
  reassignOpsTask,
  resolveOpsTask,
  type CreateOpsTaskInput,
  type OpsTaskOperationalStatus,
  type OpsTaskPriority,
  type OpsTaskRecord,
} from '@carespaces/database';
import type { Pool, PoolClient } from 'pg';

export class OpsTaskAuthorizationError extends Error {}

export type OpsTaskCreator =
  { systemActor: string } | { authorization: AuthorizationContext };

export interface OpsTaskCommandContext {
  commandId: string;
  correlationId: string;
  reasonCode: string;
}

export interface CreateManagedOpsTaskInput
  extends
    Omit<CreateOpsTaskInput, 'createdByUserId' | 'createdBySystem'>,
    OpsTaskCommandContext {
  actor: OpsTaskCreator;
}

type StoredTask = Omit<
  OpsTaskRecord,
  'dueAt' | 'createdAt' | 'updatedAt' | 'resolvedAt'
> & {
  dueAt: string | null;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
};

function taskFromStored(value: StoredTask): OpsTaskRecord {
  return {
    ...value,
    dueAt: value.dueAt ? new Date(value.dueAt) : null,
    createdAt: new Date(value.createdAt),
    updatedAt: new Date(value.updatedAt),
    resolvedAt: value.resolvedAt ? new Date(value.resolvedAt) : null,
  };
}

function actorUserId(actor: OpsTaskCreator): string | null {
  return 'authorization' in actor ? actor.authorization.actorUserId : null;
}

function auditActor(actor: OpsTaskCreator, tenantId: string | null) {
  return { tenantId, userId: actorUserId(actor) };
}

function systemActor(actor: OpsTaskCreator): string | null {
  return 'systemActor' in actor ? actor.systemActor : null;
}

function assertCommandContext(context: OpsTaskCommandContext): void {
  if (!context.commandId.trim())
    throw new Error('Ops Task command ID is required');
  if (!context.correlationId.trim())
    throw new Error('Ops Task correlation ID is required');
  if (!context.reasonCode.trim())
    throw new Error('Ops Task reason code is required');
}

export class PostgresOpsTaskService {
  constructor(private readonly pool: Pool) {}

  create(
    input: CreateManagedOpsTaskInput,
  ): Promise<{ task: OpsTaskRecord; created: boolean }> {
    assertCommandContext(input);
    if ('authorization' in input.actor) {
      this.assertAuthorized(
        input.actor.authorization,
        input.tenantId ?? null,
        input.queue,
      );
    }
    return this.executeCommand(
      'ops-task:create',
      input.commandId,
      {
        taskType: input.taskType,
        subjectType: input.subjectType,
        subjectId: input.subjectId,
        tenantId: input.tenantId ?? null,
        queue: input.queue,
        priority: input.priority,
        dueAt: input.dueAt?.toISOString() ?? null,
        sourceDedupeKey: input.sourceDedupeKey,
        actor: actorUserId(input.actor) ?? systemActor(input.actor),
        reasonCode: input.reasonCode,
      },
      async (client) => {
        const result = await createOpsTask(client, {
          id: input.id,
          tenantId: input.tenantId,
          taskType: input.taskType,
          subjectType: input.subjectType,
          subjectId: input.subjectId,
          queue: input.queue,
          priority: input.priority,
          dueAt: input.dueAt,
          sourceDedupeKey: input.sourceDedupeKey,
          createdByUserId: actorUserId(input.actor),
          createdBySystem: systemActor(input.actor),
        });
        if (result.created) {
          await this.recordTransition(client, {
            task: result.task,
            actor: input.actor,
            action: 'ops_task.created',
            eventType: 'ops_task.created.v1',
            fromState: null,
            expectedVersion: 0,
            reasonCode: input.reasonCode,
            correlationId: input.correlationId,
          });
        }
        return result;
      },
      (value) => ({
        task: taskFromStored(value.task as StoredTask),
        created: value.created as boolean,
      }),
    );
  }

  claim(
    input: OpsTaskCommandContext & {
      id: string;
      expectedVersion: number;
      authorization: AuthorizationContext;
    },
  ): Promise<OpsTaskRecord> {
    return this.humanTransition('claimed', input, (client) =>
      claimOpsTask(client, {
        id: input.id,
        expectedVersion: input.expectedVersion,
        ownerUserId: input.authorization.actorUserId,
      }),
    );
  }

  reassign(
    input: OpsTaskCommandContext & {
      id: string;
      expectedVersion: number;
      newOwnerUserId: string;
      authorization: AuthorizationContext;
    },
  ): Promise<OpsTaskRecord> {
    return this.humanTransition(
      'reassigned',
      input,
      (client) =>
        reassignOpsTask(client, {
          id: input.id,
          expectedVersion: input.expectedVersion,
          ownerUserId: input.newOwnerUserId,
        }),
      { newOwnerUserId: input.newOwnerUserId },
    );
  }

  resolve(
    input: OpsTaskCommandContext & {
      id: string;
      expectedVersion: number;
      resolutionCode: string;
      authorization: AuthorizationContext;
    },
  ): Promise<OpsTaskRecord> {
    return this.humanTransition(
      'resolved',
      input,
      (client) =>
        resolveOpsTask(client, {
          id: input.id,
          expectedVersion: input.expectedVersion,
          actorUserId: input.authorization.actorUserId,
          resolutionCode: input.resolutionCode,
        }),
      { resolutionCode: input.resolutionCode },
    );
  }

  async escalate(
    input: OpsTaskCommandContext & {
      id: string;
      expectedVersion: number;
      priority?: OpsTaskPriority;
      dueAt?: Date;
      actor: OpsTaskCreator;
    },
  ): Promise<OpsTaskRecord> {
    assertCommandContext(input);
    return this.executeCommand(
      'ops-task:escalate',
      input.commandId,
      {
        id: input.id,
        expectedVersion: input.expectedVersion,
        priority: input.priority ?? null,
        dueAt: input.dueAt?.toISOString() ?? null,
        actor: actorUserId(input.actor) ?? systemActor(input.actor),
        reasonCode: input.reasonCode,
      },
      async (client) => {
        const before = await this.requiredTask(client, input.id);
        if ('authorization' in input.actor) {
          this.assertAuthorized(
            input.actor.authorization,
            before.tenantId,
            before.queue,
          );
        }
        const task = await escalateOpsTask(client, input);
        await this.recordTransition(client, {
          task,
          actor: input.actor,
          action: 'ops_task.escalated',
          eventType: 'ops_task.escalated.v1',
          fromState: before.status,
          expectedVersion: input.expectedVersion,
          reasonCode: input.reasonCode,
          correlationId: input.correlationId,
        });
        return task;
      },
      (value) => taskFromStored(value as StoredTask),
    );
  }

  read(id: string): Promise<OpsTaskRecord | null> {
    return readOpsTask(this.pool, id);
  }

  readOperationalStatus(): Promise<OpsTaskOperationalStatus[]> {
    return readOpsTaskOperationalStatus(this.pool);
  }

  private humanTransition(
    action: 'claimed' | 'reassigned' | 'resolved',
    input: OpsTaskCommandContext & {
      id: string;
      expectedVersion: number;
      authorization: AuthorizationContext;
    },
    transition: (client: PoolClient) => Promise<OpsTaskRecord>,
    request: Record<string, unknown> = {},
  ): Promise<OpsTaskRecord> {
    assertCommandContext(input);
    return this.executeCommand(
      `ops-task:${action}`,
      input.commandId,
      {
        id: input.id,
        expectedVersion: input.expectedVersion,
        actorUserId: input.authorization.actorUserId,
        reasonCode: input.reasonCode,
        ...request,
      },
      async (client) => {
        const before = await this.requiredTask(client, input.id);
        this.assertAuthorized(
          input.authorization,
          before.tenantId,
          before.queue,
        );
        const task = await transition(client);
        await this.recordTransition(client, {
          task,
          actor: { authorization: input.authorization },
          action: `ops_task.${action}`,
          eventType: `ops_task.${action}.v1`,
          fromState: before.status,
          expectedVersion: input.expectedVersion,
          reasonCode: input.reasonCode,
          correlationId: input.correlationId,
        });
        return task;
      },
      (value) => taskFromStored(value as StoredTask),
    );
  }

  private assertAuthorized(
    context: AuthorizationContext,
    tenantId: string | null,
    queue: string,
  ): void {
    if (
      !canManageOpsTaskQueue(
        { ...context, resourceTenantId: tenantId ?? 'platform' },
        queue,
      )
    ) {
      throw new OpsTaskAuthorizationError('Actor cannot manage this Ops Task');
    }
  }

  private async requiredTask(
    client: PoolClient,
    id: string,
  ): Promise<OpsTaskRecord> {
    const task = await readOpsTask(client, id);
    if (!task) throw new Error('Ops Task not found');
    return task;
  }

  private async recordTransition(
    client: PoolClient,
    input: {
      task: OpsTaskRecord;
      actor: OpsTaskCreator;
      action: string;
      eventType: string;
      fromState: string | null;
      expectedVersion: number;
      reasonCode: string;
      correlationId: string;
    },
  ): Promise<void> {
    const metadata = {
      queue: input.task.queue,
      priority: input.task.priority,
      ownerUserId: input.task.ownerUserId,
      escalationLevel: input.task.escalationLevel,
      systemActor: systemActor(input.actor),
    };
    await appendAuditedStateTransition(client, {
      actor: auditActor(input.actor, input.task.tenantId),
      action: input.action,
      subject: { type: 'ops_task', id: input.task.id },
      fromState: input.fromState,
      toState: input.task.status,
      reasonCode: input.reasonCode,
      correlationId: input.correlationId,
      expectedVersion: input.expectedVersion,
      resultingVersion: input.task.version,
      metadata,
    });
    await enqueueOutboxEvent(client, {
      tenantId: input.task.tenantId,
      aggregateType: 'ops_task',
      aggregateId: input.task.id,
      eventType: input.eventType,
      payload: {
        taskId: input.task.id,
        taskType: input.task.taskType,
        subjectType: input.task.subjectType,
        subjectId: input.task.subjectId,
        queue: input.task.queue,
        priority: input.task.priority,
        ownerUserId: input.task.ownerUserId,
        dueAt: input.task.dueAt?.toISOString() ?? null,
        escalationLevel: input.task.escalationLevel,
        status: input.task.status,
        version: input.task.version,
      },
      correlationId: input.correlationId,
    });
  }

  private async executeCommand<T>(
    scope: string,
    commandId: string,
    request: unknown,
    operation: (client: PoolClient) => Promise<T>,
    decode: (value: Record<string, unknown>) => T,
  ): Promise<T> {
    const client = await this.pool.connect();
    const requestHash = configurationValueHash(request);
    try {
      await client.query('BEGIN');
      await client.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
        [`${scope}:${commandId}`],
      );
      const existing = await client.query<{
        request_hash: string;
        response: Record<string, unknown>;
      }>(
        `SELECT request_hash, response FROM platform.idempotency_record
         WHERE scope = $1 AND key = $2 AND expires_at > clock_timestamp()`,
        [scope, commandId],
      );
      const replay = existing.rows[0];
      if (replay) {
        if (replay.request_hash !== requestHash) {
          throw new IdempotencyRequestConflictError(
            'Ops Task command ID was reused with different input',
          );
        }
        await client.query('COMMIT');
        return decode(replay.response);
      }
      const result = await operation(client);
      await client.query(
        `INSERT INTO platform.idempotency_record
         (scope, key, request_hash, response, expires_at)
         VALUES ($1, $2, $3, $4::jsonb, clock_timestamp() + interval '7 days')`,
        [scope, commandId, requestHash, JSON.stringify(result)],
      );
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
