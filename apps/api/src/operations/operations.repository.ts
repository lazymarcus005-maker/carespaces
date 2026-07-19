import { Inject, Injectable } from '@nestjs/common';
import {
  canManageOpsTaskQueue,
  type AuthorizationContext,
} from '@carespaces/authz';
import {
  listOpsTasks,
  resolveOpsActorAccess,
  type OpsActorAccess,
  type OpsTaskPriority,
  type OpsTaskQueue,
  type OpsTaskRecord,
  type OpsTaskStatus,
} from '@carespaces/database';
import { PostgresOpsTaskService } from '@carespaces/operations';
import { DatabaseService } from '../database/database.service';
import type { IdentityPrincipal } from '../identity/identity.types';

export class OpsAccessDeniedError extends Error {}

export interface OpsTaskListProjection {
  actor: { userId: string; roles: string[]; queues: OpsTaskQueue[] };
  tasks: OpsTaskRecord[];
  generatedAt: Date;
}

@Injectable()
export class OperationsRepository {
  private readonly tasks: PostgresOpsTaskService;

  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
  ) {
    this.tasks = new PostgresOpsTaskService(database.pool);
  }

  async list(
    principal: IdentityPrincipal,
    filter: {
      queue?: OpsTaskQueue;
      status?: OpsTaskStatus;
      priority?: OpsTaskPriority;
      ownership?: 'all' | 'mine' | 'unassigned';
      limit?: number;
    },
  ): Promise<OpsTaskListProjection> {
    const access = await this.authorizedAccess(principal);
    const userId = access[0]?.userId;
    if (!userId) throw new OpsAccessDeniedError('No active Ops queue access');
    const queues = [...new Set(access.map((row) => row.queue))];
    if (filter.queue && !queues.includes(filter.queue)) {
      throw new OpsAccessDeniedError('Queue is not assigned to this actor');
    }
    const selectedQueues = filter.queue ? [filter.queue] : queues;
    return {
      actor: {
        userId,
        roles: [...new Set(access.map((row) => row.role))],
        queues,
      },
      tasks: await listOpsTasks(this.database.pool, {
        queues: selectedQueues,
        status: filter.status,
        priority: filter.priority,
        ownerUserId: filter.ownership === 'mine' ? userId : undefined,
        unownedOnly: filter.ownership === 'unassigned',
        limit: filter.limit,
      }),
      generatedAt: new Date(),
    };
  }

  async claim(
    principal: IdentityPrincipal,
    input: CommandInput,
  ): Promise<OpsTaskRecord> {
    return this.tasks.claim({
      ...input,
      authorization: await this.contextForTask(principal, input.id),
    });
  }

  async reassign(
    principal: IdentityPrincipal,
    input: CommandInput & { newOwnerUserId: string },
  ): Promise<OpsTaskRecord> {
    return this.tasks.reassign({
      ...input,
      authorization: await this.contextForTask(principal, input.id),
    });
  }

  async escalate(
    principal: IdentityPrincipal,
    input: CommandInput & { priority?: OpsTaskPriority; dueAt?: Date },
  ): Promise<OpsTaskRecord> {
    const authorization = await this.contextForTask(principal, input.id);
    return this.tasks.escalate({
      ...input,
      actor: { authorization },
    });
  }

  async resolve(
    principal: IdentityPrincipal,
    input: CommandInput & { resolutionCode: string },
  ): Promise<OpsTaskRecord> {
    return this.tasks.resolve({
      ...input,
      authorization: await this.contextForTask(principal, input.id),
    });
  }

  private async contextForTask(
    principal: IdentityPrincipal,
    taskId: string,
  ): Promise<AuthorizationContext> {
    const task = await this.tasks.read(taskId);
    if (!task) throw new OpsAccessDeniedError('Ops Task is unavailable');
    const access = await this.authorizedAccess(principal);
    const matching = access.find((row) => row.queue === task.queue);
    if (!matching)
      throw new OpsAccessDeniedError('Queue is not assigned to this actor');
    return this.context(principal, matching, task.tenantId);
  }

  private async authorizedAccess(
    principal: IdentityPrincipal,
  ): Promise<OpsActorAccess[]> {
    const rows = await resolveOpsActorAccess(this.database.pool, {
      identityProvider: principal.provider,
      identitySubject: principal.subject,
    });
    return rows.filter((row) =>
      canManageOpsTaskQueue(this.context(principal, row, null), row.queue),
    );
  }

  private context(
    principal: IdentityPrincipal,
    access: OpsActorAccess,
    tenantId: string | null,
  ): AuthorizationContext {
    return {
      actorUserId: access.userId,
      actorTenantId: 'platform',
      resourceTenantId: tenantId ?? 'platform',
      role: access.role,
      mfaVerified: principal.mfaVerified,
      privilegedSession: principal.privilegedSession,
    };
  }
}

interface CommandInput {
  id: string;
  expectedVersion: number;
  commandId: string;
  correlationId: string;
  reasonCode: string;
}
