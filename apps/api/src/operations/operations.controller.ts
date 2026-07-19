import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiHeader,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import {
  EscalateOpsTaskRequestSchema,
  OpsTaskCommandSchema,
  OpsTaskListResponseSchema,
  OpsTaskPrioritySchema,
  OpsTaskQueueSchema,
  OpsTaskSchema,
  OpsTaskStatusSchema,
  ReassignOpsTaskRequestSchema,
  ResolveOpsTaskRequestSchema,
  type OpsTask,
  type OpsTaskListResponse,
} from '@carespaces/api-contracts';
import { OpsTaskStateError, type OpsTaskRecord } from '@carespaces/database';
import { z } from 'zod';
import { AuthenticationGuard } from '../identity/authentication.guard';
import type { AuthenticatedRequest } from '../identity/identity.types';
import {
  OpsAccessDeniedError,
  OperationsRepository,
} from './operations.repository';

const TaskIdSchema = z.uuid();
const CommandIdSchema = z.string().regex(/^[a-zA-Z0-9._:-]{1,128}$/);
const ListQuerySchema = z.object({
  queue: OpsTaskQueueSchema.optional(),
  status: OpsTaskStatusSchema.optional(),
  priority: OpsTaskPrioritySchema.optional(),
  ownership: z.enum(['all', 'mine', 'unassigned']).default('all'),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

@ApiTags('operations')
@ApiBearerAuth()
@UseGuards(AuthenticationGuard)
@Controller('ops/tasks')
export class OperationsController {
  constructor(
    @Inject(OperationsRepository)
    private readonly repository: OperationsRepository,
  ) {}

  @Get()
  @ApiOkResponse({
    schema: { $ref: '#/components/schemas/OpsTaskListResponse' },
  })
  async list(
    @Req() request: AuthenticatedRequest,
    @Query() query: unknown,
  ): Promise<OpsTaskListResponse> {
    const parsed = ListQuerySchema.safeParse(query);
    if (!parsed.success)
      throw new BadRequestException('Invalid Ops Task filters');
    try {
      const projection = await this.repository.list(
        request.principal,
        parsed.data,
      );
      return OpsTaskListResponseSchema.parse({
        ...projection,
        generatedAt: projection.generatedAt.toISOString(),
        tasks: projection.tasks.map(serializeTask),
      });
    } catch (error) {
      return this.handle(error);
    }
  }

  @Post(':id/claim')
  @HttpCode(200)
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiBody({ schema: { $ref: '#/components/schemas/OpsTaskCommand' } })
  @ApiOkResponse({ schema: { $ref: '#/components/schemas/OpsTask' } })
  claim(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: unknown,
    @Headers('idempotency-key') commandId: string | undefined,
    @Headers('x-request-id') correlationId: string,
  ): Promise<OpsTask> {
    return this.command(
      request,
      id,
      body,
      commandId,
      correlationId,
      OpsTaskCommandSchema,
      (input) => this.repository.claim(request.principal, input),
    );
  }

  @Post(':id/reassign')
  @HttpCode(200)
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiBody({ schema: { $ref: '#/components/schemas/ReassignOpsTaskRequest' } })
  @ApiOkResponse({ schema: { $ref: '#/components/schemas/OpsTask' } })
  reassign(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: unknown,
    @Headers('idempotency-key') commandId: string | undefined,
    @Headers('x-request-id') correlationId: string,
  ): Promise<OpsTask> {
    return this.command(
      request,
      id,
      body,
      commandId,
      correlationId,
      ReassignOpsTaskRequestSchema,
      (input) => this.repository.reassign(request.principal, input),
    );
  }

  @Post(':id/escalate')
  @HttpCode(200)
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiBody({ schema: { $ref: '#/components/schemas/EscalateOpsTaskRequest' } })
  @ApiOkResponse({ schema: { $ref: '#/components/schemas/OpsTask' } })
  escalate(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: unknown,
    @Headers('idempotency-key') commandId: string | undefined,
    @Headers('x-request-id') correlationId: string,
  ): Promise<OpsTask> {
    return this.command(
      request,
      id,
      body,
      commandId,
      correlationId,
      EscalateOpsTaskRequestSchema,
      (input) =>
        this.repository.escalate(request.principal, {
          ...input,
          dueAt: input.dueAt ? new Date(input.dueAt) : undefined,
        }),
    );
  }

  @Post(':id/resolve')
  @HttpCode(200)
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiBody({ schema: { $ref: '#/components/schemas/ResolveOpsTaskRequest' } })
  @ApiOkResponse({ schema: { $ref: '#/components/schemas/OpsTask' } })
  @ApiConflictResponse({
    schema: { $ref: '#/components/schemas/ErrorResponse' },
  })
  @ApiForbiddenResponse({
    schema: { $ref: '#/components/schemas/ErrorResponse' },
  })
  resolve(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: unknown,
    @Headers('idempotency-key') commandId: string | undefined,
    @Headers('x-request-id') correlationId: string,
  ): Promise<OpsTask> {
    return this.command(
      request,
      id,
      body,
      commandId,
      correlationId,
      ResolveOpsTaskRequestSchema,
      (input) => this.repository.resolve(request.principal, input),
    );
  }

  private async command<
    T extends { expectedVersion: number; reasonCode: string },
  >(
    request: AuthenticatedRequest,
    id: string,
    body: unknown,
    commandId: string | undefined,
    correlationId: string,
    schema: z.ZodType<T>,
    execute: (
      input: T & { id: string; commandId: string; correlationId: string },
    ) => Promise<OpsTaskRecord>,
  ): Promise<OpsTask> {
    const parsedId = TaskIdSchema.safeParse(id);
    const parsedCommand = CommandIdSchema.safeParse(commandId);
    const parsedBody = schema.safeParse(body);
    if (!parsedId.success || !parsedCommand.success || !parsedBody.success) {
      throw new BadRequestException(
        'Valid task, command, and transition input are required',
      );
    }
    try {
      const task = await execute({
        ...parsedBody.data,
        id: parsedId.data,
        commandId: parsedCommand.data,
        correlationId,
      });
      return OpsTaskSchema.parse(serializeTask(task));
    } catch (error) {
      return this.handle(error);
    }
  }

  private handle(error: unknown): never {
    if (error instanceof OpsAccessDeniedError)
      throw new ForbiddenException(error.message);
    if (error instanceof OpsTaskStateError) {
      throw new ConflictException(error.message);
    }
    throw error;
  }
}

function serializeTask(task: OpsTaskRecord) {
  return {
    id: task.id,
    tenantId: task.tenantId,
    taskType: task.taskType,
    subjectType: task.subjectType,
    subjectId: task.subjectId,
    queue: task.queue,
    priority: task.priority,
    ownerUserId: task.ownerUserId,
    dueAt: task.dueAt?.toISOString() ?? null,
    escalationLevel: task.escalationLevel,
    status: task.status,
    resolutionCode: task.resolutionCode,
    version: task.version,
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
    resolvedAt: task.resolvedAt?.toISOString() ?? null,
  };
}
