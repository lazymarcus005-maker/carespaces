import {
  appendAuditEvent,
  configurationValueHash,
  createNotificationIntent,
  createNotificationTemplate,
  createNotificationUserPreference,
  enqueueOutboxEvent,
  IdempotencyRequestConflictError,
  isCriticalNotificationClass,
  listNotificationDeliveryAttempts,
  listNotificationIntents,
  readNotificationIntent,
  readNotificationOperationalStatus,
  type CreateNotificationIntentInput,
  type CreateNotificationTemplateInput,
  type CreateNotificationUserPreferenceInput,
  type NotificationDeliveryAttemptRecord,
  type NotificationIntentRecord,
  type NotificationOperationalStatus,
} from '@carespaces/database';
import type { Pool, PoolClient } from 'pg';

export class NotificationPreferenceError extends Error {}
export class NotificationAuthorizationError extends Error {}

export interface NotificationCommandContext {
  commandId: string;
  correlationId: string;
  reasonCode: string;
}

export interface CreateManagedNotificationIntentInput
  extends Omit<CreateNotificationIntentInput, 'templateId'>,
    NotificationCommandContext {
  templateId: string;
  actor: { systemActor: string };
}

function assertCommandContext(ctx: NotificationCommandContext): void {
  if (!ctx.commandId.trim())
    throw new Error('Notification command ID is required');
  if (!ctx.correlationId.trim())
    throw new Error('Notification correlation ID is required');
  if (!ctx.reasonCode.trim())
    throw new Error('Notification reason code is required');
}

export class PostgresNotificationService {
  constructor(private readonly pool: Pool) {}

  async ensureTemplate(
    input: CreateNotificationTemplateInput,
  ): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await createNotificationTemplate(client, input);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async setPreference(
    input: CreateNotificationUserPreferenceInput,
  ): Promise<void> {
    if (isCriticalNotificationClass(input.notificationClass)) {
      throw new NotificationPreferenceError(
        `Critical class ${input.notificationClass} cannot be disabled`,
      );
    }
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await createNotificationUserPreference(client, input);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  createIntent(
    input: CreateManagedNotificationIntentInput,
  ): Promise<{ intent: NotificationIntentRecord; created: boolean }> {
    assertCommandContext(input);
    return this.executeCommand(
      'notification:create-intent',
      input.commandId,
      {
        templateId: input.templateId,
        notificationClass: input.notificationClass,
        channel: input.channel,
        subjectType: input.subjectType,
        subjectId: input.subjectId,
        recipientUserId: input.recipientUserId ?? null,
        recipientRef: input.recipientRef,
        bodyRedacted: input.bodyRedacted,
        sourceDedupeKey: input.sourceDedupeKey,
        actor: input.actor.systemActor,
        reasonCode: input.reasonCode,
      },
      async (client) => {
        const result = await createNotificationIntent(client, {
          id: input.id,
          tenantId: input.tenantId,
          templateId: input.templateId,
          notificationClass: input.notificationClass,
          channel: input.channel,
          subjectType: input.subjectType,
          subjectId: input.subjectId,
          recipientUserId: input.recipientUserId,
          recipientRef: input.recipientRef,
          bodyRedacted: input.bodyRedacted,
          correlationId: input.correlationId,
          sourceDedupeKey: input.sourceDedupeKey,
        });
        if (result.created) {
          await appendAuditEvent(client, {
            actor: { tenantId: input.tenantId },
            action: 'notification.intent.created',
            subject: { type: 'notification_intent', id: result.intent.id },
            reasonCode: input.reasonCode,
            correlationId: input.correlationId,
            metadata: {
              systemActor: input.actor.systemActor,
              notificationClass: input.notificationClass,
              channel: input.channel,
              subjectType: input.subjectType,
              isCritical: isCriticalNotificationClass(input.notificationClass),
            },
          });
          await enqueueOutboxEvent(client, {
            tenantId: input.tenantId,
            aggregateType: 'notification_intent',
            aggregateId: result.intent.id,
            eventType: 'notification.intent.created.v1',
            payload: {
              intentId: result.intent.id,
              notificationClass: result.intent.notificationClass,
              channel: result.intent.channel,
              subjectType: result.intent.subjectType,
              subjectId: result.intent.subjectId,
              recipientRef: result.intent.recipientRef,
            },
            correlationId: input.correlationId,
          });
        }
        return result;
      },
      (value) => value as { intent: NotificationIntentRecord; created: boolean },
    );
  }

  readIntent(id: string): Promise<NotificationIntentRecord | null> {
    return readNotificationIntent(this.pool, id);
  }

  listIntents(
    input: Parameters<typeof listNotificationIntents>[1],
  ): Promise<NotificationIntentRecord[]> {
    return listNotificationIntents(this.pool, input);
  }

  listAttempts(
    intentId: string,
  ): Promise<NotificationDeliveryAttemptRecord[]> {
    return listNotificationDeliveryAttempts(this.pool, intentId);
  }

  readOperationalStatus(): Promise<NotificationOperationalStatus[]> {
    return readNotificationOperationalStatus(this.pool);
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
            'Notification command ID was reused with different input',
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