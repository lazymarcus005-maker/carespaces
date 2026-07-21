import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  NotFoundException,
  Param,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import {
  NotificationAttemptListResponseSchema,
  NotificationChannelSchema,
  NotificationClassSchema,
  NotificationIntentListResponseSchema,
  NotificationIntentSchema,
  NotificationIntentStatusSchema,
  type NotificationAttemptListResponse,
  type NotificationAttempt,
  type NotificationClass,
  type NotificationIntent,
  type NotificationIntentListResponse,
} from '@carespaces/api-contracts';
import {
  type NotificationDeliveryAttemptRecord,
  type NotificationIntentRecord,
  type NotificationSubjectType,
} from '@carespaces/database';
import { z } from 'zod';
import { AuthenticationGuard } from '../identity/authentication.guard';
import type { AuthenticatedRequest } from '../identity/identity.types';
import {
  NotificationAccessDeniedError,
  NotificationsRepository,
} from './notifications.repository';

const IntentIdSchema = z.uuid();
const ListQuerySchema = z.object({
  class: z.union([NotificationClassSchema, z.array(NotificationClassSchema)]).optional(),
  status: NotificationIntentStatusSchema.optional(),
  channel: NotificationChannelSchema.optional(),
  recipientUserId: z.uuid().optional(),
  subjectType: z.string().optional(),
  subjectId: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

function normalizeClasses(
  value: z.infer<typeof ListQuerySchema>['class'],
): NotificationClass[] | undefined {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') return [value as NotificationClass];
  return undefined;
}

@ApiTags('notifications')
@ApiBearerAuth()
@UseGuards(AuthenticationGuard)
@Controller('notifications/intents')
export class NotificationsController {
  constructor(
    @Inject(NotificationsRepository)
    private readonly repository: NotificationsRepository,
  ) {}

  @Get()
  @ApiOkResponse({
    schema: { $ref: '#/components/schemas/NotificationIntentListResponse' },
  })
  async listIntents(
    @Req() request: AuthenticatedRequest,
    @Query() query: unknown,
  ): Promise<NotificationIntentListResponse> {
    const parsed = ListQuerySchema.safeParse(query);
    if (!parsed.success)
      throw new BadRequestException('Invalid notification filters');
    try {
      const projection = await this.repository.listIntents(
        request.principal,
        {
          classes: normalizeClasses(parsed.data.class),
          status: parsed.data.status,
          recipientUserId: parsed.data.recipientUserId,
          subjectType: parsed.data.subjectType as
            | NotificationSubjectType
            | undefined,
          subjectId: parsed.data.subjectId,
          limit: parsed.data.limit,
        },
      );
      return NotificationIntentListResponseSchema.parse({
        intents: projection.intents.map(serializeIntent),
        generatedAt: projection.generatedAt.toISOString(),
      });
    } catch (error) {
      throw this.handle(error);
    }
  }

  @Get(':id')
  @ApiOkResponse({ schema: { $ref: '#/components/schemas/NotificationIntent' } })
  async readIntent(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
  ): Promise<NotificationIntent> {
    const parsedId = IntentIdSchema.safeParse(id);
    if (!parsedId.success)
      throw new BadRequestException('Valid intent id is required');
    try {
      const intent = await this.repository.readIntent(
        request.principal,
        parsedId.data,
      );
      if (!intent)
        throw new NotFoundException('Notification intent not found');
      return NotificationIntentSchema.parse(serializeIntent(intent));
    } catch (error) {
      throw this.handle(error);
    }
  }

  @Get(':id/attempts')
  @ApiOkResponse({
    schema: { $ref: '#/components/schemas/NotificationAttemptListResponse' },
  })
  async listAttempts(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
  ): Promise<NotificationAttemptListResponse> {
    const parsedId = IntentIdSchema.safeParse(id);
    if (!parsedId.success)
      throw new BadRequestException('Valid intent id is required');
    try {
      const projection = await this.repository.listAttempts(
        request.principal,
        parsedId.data,
      );
      return NotificationAttemptListResponseSchema.parse({
        intentId: projection.intentId,
        attempts: projection.attempts.map(serializeAttempt),
        generatedAt: projection.generatedAt.toISOString(),
      });
    } catch (error) {
      throw this.handle(error);
    }
  }

  private handle(error: unknown): unknown {
    if (error instanceof NotificationAccessDeniedError)
      return new ForbiddenException(error.message);
    return error;
  }
}

function serializeIntent(intent: NotificationIntentRecord): NotificationIntent {
  return {
    id: intent.id,
    tenantId: intent.tenantId,
    notificationClass: intent.notificationClass,
    channel: intent.channel,
    subjectType: intent.subjectType,
    subjectId: intent.subjectId,
    recipientUserId: intent.recipientUserId,
    recipientRef: intent.recipientRef,
    bodyRedacted: intent.bodyRedacted,
    correlationId: intent.correlationId,
    status: intent.status,
    attempts: intent.attempts,
    nextAttemptAt: intent.nextAttemptAt.toISOString(),
    deliveredAt: intent.deliveredAt?.toISOString() ?? null,
    terminalFailedAt: intent.terminalFailedAt?.toISOString() ?? null,
    lastError: intent.lastError,
    acknowledgedAt: intent.acknowledgedAt?.toISOString() ?? null,
    opsTaskId: intent.opsTaskId,
    version: intent.version,
    createdAt: intent.createdAt.toISOString(),
    updatedAt: intent.updatedAt.toISOString(),
  };
}

function serializeAttempt(
  attempt: NotificationDeliveryAttemptRecord,
): NotificationAttempt {
  return {
    id: attempt.id,
    intentId: attempt.intentId,
    attemptNumber: attempt.attemptNumber,
    channel: attempt.channel,
    adapterName: attempt.adapterName,
    status: attempt.status,
    providerMessageRef: attempt.providerMessageRef,
    errorClass: attempt.errorClass,
    errorMessage: attempt.errorMessage,
    startedAt: attempt.startedAt.toISOString(),
    completedAt: attempt.completedAt?.toISOString() ?? null,
  };
}