import { Inject, Injectable } from '@nestjs/common';
import {
  can,
  type AuthorizationContext,
} from '@carespaces/authz';
import {
  listNotificationDeliveryAttempts,
  listNotificationIntents,
  readNotificationIntent,
  type NotificationClass,
  type NotificationDeliveryAttemptRecord,
  type NotificationIntentRecord,
  type NotificationIntentStatus,
  type NotificationSubjectType,
} from '@carespaces/database';
import { PostgresNotificationService } from '@carespaces/notifications';
import { DatabaseService } from '../database/database.service';
import type { IdentityPrincipal } from '../identity/identity.types';

export class NotificationAccessDeniedError extends Error {}

export interface NotificationIntentListProjection {
  intents: NotificationIntentRecord[];
  generatedAt: Date;
}

export interface NotificationAttemptListProjection {
  intentId: string;
  attempts: NotificationDeliveryAttemptRecord[];
  generatedAt: Date;
}

@Injectable()
export class NotificationsRepository {
  private readonly notifications: PostgresNotificationService;

  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
  ) {
    this.notifications = new PostgresNotificationService(database.pool);
  }

  async listIntents(
    principal: IdentityPrincipal,
    filter: {
      classes?: NotificationClass[];
      status?: NotificationIntentStatus;
      recipientUserId?: string;
      subjectType?: NotificationSubjectType;
      subjectId?: string;
      limit?: number;
    },
  ): Promise<NotificationIntentListProjection> {
    this.assertAuthorized(principal);
    return {
      intents: await listNotificationIntents(this.database.pool, filter),
      generatedAt: new Date(),
    };
  }

  async readIntent(
    principal: IdentityPrincipal,
    id: string,
  ): Promise<NotificationIntentRecord | null> {
    this.assertAuthorized(principal);
    return readNotificationIntent(this.database.pool, id);
  }

  async listAttempts(
    principal: IdentityPrincipal,
    intentId: string,
  ): Promise<NotificationAttemptListProjection> {
    this.assertAuthorized(principal);
    return {
      intentId,
      attempts: await listNotificationDeliveryAttempts(
        this.database.pool,
        intentId,
      ),
      generatedAt: new Date(),
    };
  }

  private assertAuthorized(principal: IdentityPrincipal): void {
    const ctx: AuthorizationContext = {
      actorUserId: '00000000-0000-0000-0000-000000000000',
      actorTenantId: 'platform',
      resourceTenantId: 'platform',
      role: principal.subject === 'admin-001' ? 'PLATFORM_ADMIN' : 'UNKNOWN',
      mfaVerified: principal.mfaVerified,
      privilegedSession: principal.privilegedSession,
    };
    if (!can(ctx, 'ops_task.manage')) {
      throw new NotificationAccessDeniedError(
        'Notification intents require platform operations access',
      );
    }
  }
}