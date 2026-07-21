import { randomUUID } from 'node:crypto';
import type { EventQueryRunner } from './events.js';

export const notificationClasses = [
  'incident_ack',
  'sos',
  'credential_expiry_block',
  'replacement_failed',
  'shift_reminder',
  'reservation_expiry',
  'payment_expiry',
  'customer_approval_reminder',
  'dispute_update',
  'payout_retry',
  'system',
] as const;
export const criticalNotificationClasses = [
  'incident_ack',
  'sos',
  'credential_expiry_block',
  'replacement_failed',
] as const;
export const notificationChannels = [
  'push',
  'sms',
  'email',
  'in_app',
] as const;
export const notificationIntentStatuses = [
  'PENDING',
  'LEASED',
  'DELIVERED',
  'TERMINAL_FAILED',
  'CANCELLED',
] as const;
export const notificationAttemptStatuses = ['FIRED', 'FAILED', 'DEAD_LETTER'] as const;
export const notificationSubjectTypes = [
  'incident',
  'shift',
  'assignment',
  'credential',
  'replacement_request',
  'payment',
  'payout',
  'reconciliation',
  'dispute',
  'ops_task',
  'scheduled_deadline',
  'system',
] as const;

export type NotificationClass = (typeof notificationClasses)[number];
export type CriticalNotificationClass = (typeof criticalNotificationClasses)[number];
export type NotificationChannel = (typeof notificationChannels)[number];
export type NotificationIntentStatus = (typeof notificationIntentStatuses)[number];
export type NotificationAttemptStatus = (typeof notificationAttemptStatuses)[number];
export type NotificationSubjectType = (typeof notificationSubjectTypes)[number];

export function isCriticalNotificationClass(value: string): boolean {
  return (criticalNotificationClasses as readonly string[]).includes(value);
}

export class NotificationIntentDedupeConflictError extends Error {
  constructor(
    message = 'Notification intent dedupe key was reused with different input',
  ) {
    super(message);
    this.name = 'NotificationIntentDedupeConflictError';
  }
}

export interface NotificationTemplateRecord {
  id: string;
  key: string;
  notificationClass: NotificationClass;
  channel: NotificationChannel;
  displayName: string;
  bodyTemplate: string;
  isCritical: boolean;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface NotificationIntentRecord {
  id: string;
  tenantId: string | null;
  templateId: string;
  notificationClass: NotificationClass;
  channel: NotificationChannel;
  subjectType: NotificationSubjectType;
  subjectId: string;
  recipientUserId: string | null;
  recipientRef: string;
  bodyRedacted: string;
  correlationId: string;
  sourceDedupeKey: string;
  status: NotificationIntentStatus;
  attempts: number;
  nextAttemptAt: Date;
  leaseId: string | null;
  leaseExpiresAt: Date | null;
  deliveredAt: Date | null;
  terminalFailedAt: Date | null;
  cancelledAt: Date | null;
  lastError: string | null;
  acknowledgedAt: Date | null;
  opsTaskId: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export type ClaimedNotificationIntent = NotificationIntentRecord;

export interface NotificationDeliveryAttemptRecord {
  id: string;
  intentId: string;
  attemptNumber: number;
  channel: NotificationChannel;
  adapterName: string;
  status: NotificationAttemptStatus;
  providerMessageRef: string | null;
  errorClass: string | null;
  errorMessage: string | null;
  leaseId: string | null;
  startedAt: Date;
  completedAt: Date | null;
}

export interface NotificationUserPreferenceRecord {
  id: string;
  userId: string;
  notificationClass: NotificationClass;
  channel: NotificationChannel;
  enabled: boolean;
  updatedAt: Date;
}

export interface NotificationOperationalStatus {
  status: NotificationIntentStatus;
  count: number;
  overdue: number;
  deadLettered: number;
  oldestNextAttemptAt: Date | null;
}

export interface CreateNotificationTemplateInput {
  id?: string;
  key: string;
  notificationClass: NotificationClass;
  channel: NotificationChannel;
  displayName: string;
  bodyTemplate: string;
  isCritical?: boolean;
}

export interface CreateNotificationUserPreferenceInput {
  id?: string;
  userId: string;
  notificationClass: NotificationClass;
  channel: NotificationChannel;
  enabled: boolean;
}

export interface CreateNotificationIntentInput {
  id?: string;
  tenantId?: string | null;
  templateId: string;
  notificationClass: NotificationClass;
  channel: NotificationChannel;
  subjectType: NotificationSubjectType;
  subjectId: string;
  recipientUserId?: string | null;
  recipientRef: string;
  bodyRedacted: string;
  correlationId: string;
  sourceDedupeKey: string;
}

export interface ListNotificationIntentsInput {
  classes?: NotificationClass[];
  status?: NotificationIntentStatus;
  recipientUserId?: string;
  subjectType?: NotificationSubjectType;
  subjectId?: string;
  limit?: number;
}

export interface IntentClaimOptions {
  leaseId?: string;
  limit?: number;
  leaseMs?: number;
  maxAttempts?: number;
}

export interface MarkIntentFiredInput {
  intentId: string;
  leaseId: string | null;
  attemptNumber: number;
  adapterName: string;
  providerMessageRef: string;
}

export interface MarkIntentFailedInput {
  intentId: string;
  leaseId: string | null;
  attemptNumber: number;
  adapterName: string;
  errorClass: string;
  errorMessage: string;
  retryAfterMs?: number;
  maxAttempts?: number;
}

export interface RecordDeadLetterEvidenceInput {
  intentId: string;
  finalAttemptId: string;
  reasonCode: string;
  errorClass?: string | null;
  errorMessage?: string | null;
  opsTaskId?: string | null;
}

const DEFAULT_LIMIT = 25;
const DEFAULT_LEASE_MS = 30_000;
const DEFAULT_RETRY_AFTER_MS = 60_000;
const DEFAULT_MAX_ATTEMPTS = 5;

function asString(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Expected database string');
  return value;
}

function asNullableString(value: unknown): string | null {
  return value === null || value === undefined ? null : asString(value);
}

function asNumber(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return Number.parseInt(value, 10);
  throw new Error('Expected database number');
}

function asDate(value: unknown): Date {
  if (value instanceof Date) return value;
  if (typeof value === 'string') return new Date(value);
  throw new Error('Expected database date');
}

function asNullableDate(value: unknown): Date | null {
  return value === null || value === undefined ? null : asDate(value);
}

function templateFromRow(row: Record<string, unknown>): NotificationTemplateRecord {
  return {
    id: asString(row.id),
    key: asString(row.key),
    notificationClass: asString(row.notification_class) as NotificationClass,
    channel: asString(row.channel) as NotificationChannel,
    displayName: asString(row.display_name),
    bodyTemplate: asString(row.body_template),
    isCritical: Boolean(row.is_critical),
    version: asNumber(row.version),
    createdAt: asDate(row.created_at),
    updatedAt: asDate(row.updated_at),
  };
}

function intentFromRow(row: Record<string, unknown>): NotificationIntentRecord {
  return {
    id: asString(row.id),
    tenantId: asNullableString(row.tenant_id),
    templateId: asString(row.template_id),
    notificationClass: asString(row.notification_class) as NotificationClass,
    channel: asString(row.channel) as NotificationChannel,
    subjectType: asString(row.subject_type) as NotificationSubjectType,
    subjectId: asString(row.subject_id),
    recipientUserId: asNullableString(row.recipient_user_id),
    recipientRef: asString(row.recipient_ref),
    bodyRedacted: asString(row.body_redacted),
    correlationId: asString(row.correlation_id),
    sourceDedupeKey: asString(row.source_dedupe_key),
    status: asString(row.status) as NotificationIntentStatus,
    attempts: asNumber(row.attempts),
    nextAttemptAt: asDate(row.next_attempt_at),
    leaseId: asNullableString(row.lease_id),
    leaseExpiresAt: asNullableDate(row.lease_expires_at),
    deliveredAt: asNullableDate(row.delivered_at),
    terminalFailedAt: asNullableDate(row.terminal_failed_at),
    cancelledAt: asNullableDate(row.cancelled_at),
    lastError: asNullableString(row.last_error),
    acknowledgedAt: asNullableDate(row.acknowledged_at),
    opsTaskId: asNullableString(row.ops_task_id),
    version: asNumber(row.version),
    createdAt: asDate(row.created_at),
    updatedAt: asDate(row.updated_at),
  };
}

function attemptFromRow(
  row: Record<string, unknown>,
): NotificationDeliveryAttemptRecord {
  return {
    id: asString(row.id),
    intentId: asString(row.intent_id),
    attemptNumber: asNumber(row.attempt_number),
    channel: asString(row.channel) as NotificationChannel,
    adapterName: asString(row.adapter_name),
    status: asString(row.status) as NotificationAttemptStatus,
    providerMessageRef: asNullableString(row.provider_message_ref),
    errorClass: asNullableString(row.error_class),
    errorMessage: asNullableString(row.error_message),
    leaseId: asNullableString(row.lease_id),
    startedAt: asDate(row.started_at),
    completedAt: asNullableDate(row.completed_at),
  };
}

function preferenceFromRow(
  row: Record<string, unknown>,
): NotificationUserPreferenceRecord {
  return {
    id: asString(row.id),
    userId: asString(row.user_id),
    notificationClass: asString(row.notification_class) as NotificationClass,
    channel: asString(row.channel) as NotificationChannel,
    enabled: Boolean(row.enabled),
    updatedAt: asDate(row.updated_at),
  };
}

const templateColumns = `id, key, notification_class, channel, display_name,
  body_template, is_critical, version, created_at, updated_at`;

const intentColumns = `id, tenant_id, template_id, notification_class, channel,
  subject_type, subject_id, recipient_user_id, recipient_ref, body_redacted,
  correlation_id, source_dedupe_key, status, attempts, next_attempt_at,
  lease_id, lease_expires_at, delivered_at, terminal_failed_at, cancelled_at,
  last_error, acknowledged_at, ops_task_id, version, created_at, updated_at`;

const attemptColumns = `id, intent_id, attempt_number, channel, adapter_name,
  status, provider_message_ref, error_class, error_message, lease_id,
  started_at, completed_at`;

export async function createNotificationTemplate(
  client: EventQueryRunner,
  input: CreateNotificationTemplateInput,
): Promise<NotificationTemplateRecord> {
  const isCritical =
    input.isCritical ?? isCriticalNotificationClass(input.notificationClass);
  const result = await client.query(
    `INSERT INTO notifications.notification_template
     (id, key, notification_class, channel, display_name, body_template, is_critical)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (key) DO UPDATE
     SET display_name = EXCLUDED.display_name,
         body_template = EXCLUDED.body_template,
         is_critical = EXCLUDED.is_critical,
         updated_at = clock_timestamp()
     RETURNING ${templateColumns}`,
    [
      input.id ?? randomUUID(),
      input.key,
      input.notificationClass,
      input.channel,
      input.displayName,
      input.bodyTemplate,
      isCritical,
    ],
  );
  if (!result.rows[0]) throw new Error('Notification template upsert returned no row');
  return templateFromRow(result.rows[0]);
}

export async function createNotificationUserPreference(
  client: EventQueryRunner,
  input: CreateNotificationUserPreferenceInput,
): Promise<NotificationUserPreferenceRecord> {
  const result = await client.query(
    `INSERT INTO notifications.notification_user_preference
     (id, user_id, notification_class, channel, enabled)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (user_id, notification_class, channel) DO UPDATE
     SET enabled = EXCLUDED.enabled, updated_at = clock_timestamp()
     RETURNING id, user_id, notification_class, channel, enabled, updated_at`,
    [
      input.id ?? randomUUID(),
      input.userId,
      input.notificationClass,
      input.channel,
      input.enabled,
    ],
  );
  if (!result.rows[0])
    throw new Error('Notification preference upsert returned no row');
  return preferenceFromRow(result.rows[0]);
}

export async function createNotificationIntent(
  client: EventQueryRunner,
  input: CreateNotificationIntentInput,
): Promise<{ intent: NotificationIntentRecord; created: boolean }> {
  const values = [
    input.id ?? randomUUID(),
    input.tenantId ?? null,
    input.templateId,
    input.notificationClass,
    input.channel,
    input.subjectType,
    input.subjectId,
    input.recipientUserId ?? null,
    input.recipientRef,
    input.bodyRedacted,
    input.correlationId,
    input.sourceDedupeKey,
  ];
  const inserted = await client.query(
    `INSERT INTO notifications.notification_intent
     (id, tenant_id, template_id, notification_class, channel, subject_type,
      subject_id, recipient_user_id, recipient_ref, body_redacted,
      correlation_id, source_dedupe_key)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     ON CONFLICT (source_dedupe_key) DO NOTHING RETURNING ${intentColumns}`,
    values,
  );
  if (inserted.rows[0])
    return { intent: intentFromRow(inserted.rows[0]), created: true };
  const existing = await client.query(
    `SELECT ${intentColumns} FROM notifications.notification_intent
     WHERE source_dedupe_key = $1`,
    [input.sourceDedupeKey],
  );
  const intent = existing.rows[0] ? intentFromRow(existing.rows[0]) : null;
  if (!intent) throw new Error('Notification intent dedupe record disappeared');
  if (
    intent.tenantId !== (input.tenantId ?? null) ||
    intent.templateId !== input.templateId ||
    intent.notificationClass !== input.notificationClass ||
    intent.channel !== input.channel ||
    intent.subjectType !== input.subjectType ||
    intent.subjectId !== input.subjectId ||
    intent.recipientUserId !== (input.recipientUserId ?? null) ||
    intent.recipientRef !== input.recipientRef ||
    intent.bodyRedacted !== input.bodyRedacted
  ) {
    throw new NotificationIntentDedupeConflictError();
  }
  return { intent, created: false };
}

export async function claimPendingNotificationIntents(
  client: EventQueryRunner,
  options: IntentClaimOptions = {},
): Promise<ClaimedNotificationIntent[]> {
  const leaseId = options.leaseId ?? randomUUID();
  const result = await client.query(
    `WITH candidates AS (
       SELECT id FROM notifications.notification_intent
       WHERE status IN ('PENDING', 'LEASED')
         AND next_attempt_at <= clock_timestamp()
         AND terminal_failed_at IS NULL
         AND (lease_expires_at IS NULL OR lease_expires_at <= clock_timestamp())
         AND attempts < $3
       ORDER BY notifications.due_priority(notification_class), next_attempt_at
       LIMIT $1
       FOR UPDATE SKIP LOCKED
     )
     UPDATE notifications.notification_intent intent
     SET status = 'LEASED',
         lease_id = $2,
         lease_expires_at = clock_timestamp() + ($4 * interval '1 millisecond'),
         attempts = intent.attempts + 1,
         updated_at = clock_timestamp()
     FROM candidates
     WHERE intent.id = candidates.id
     RETURNING ${intentColumns}`,
    [
      options.limit ?? DEFAULT_LIMIT,
      leaseId,
      options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
      options.leaseMs ?? DEFAULT_LEASE_MS,
    ],
  );
  return result.rows.map((row) => ({
    ...intentFromRow(row),
    leaseId,
  }));
}

export async function markIntentAttemptFired(
  client: EventQueryRunner,
  input: MarkIntentFiredInput,
): Promise<{
  intent: NotificationIntentRecord;
  attempt: NotificationDeliveryAttemptRecord;
}> {
  const attemptId = randomUUID();
  const attemptResult = await client.query(
    `INSERT INTO notifications.notification_delivery_attempt
     (id, intent_id, attempt_number, channel, adapter_name, status,
      provider_message_ref, lease_id, completed_at)
     SELECT $1, $2, $3, intent.channel, $4, 'FIRED', $5, $6, clock_timestamp()
     FROM notifications.notification_intent intent WHERE intent.id = $2
     RETURNING ${attemptColumns}`,
    [
      attemptId,
      input.intentId,
      input.attemptNumber,
      input.adapterName,
      input.providerMessageRef,
      input.leaseId,
    ],
  );
  if (!attemptResult.rows[0])
    throw new Error('Notification delivery attempt insert returned no row');
  const intentResult = await client.query(
    `UPDATE notifications.notification_intent
     SET status = 'DELIVERED', delivered_at = clock_timestamp(),
         lease_id = NULL, lease_expires_at = NULL, last_error = NULL,
         version = version + 1, updated_at = clock_timestamp()
     WHERE id = $1 AND status = 'LEASED'
     RETURNING ${intentColumns}`,
    [input.intentId],
  );
  if (!intentResult.rows[0])
    throw new Error('Notification intent lease was lost before firing');
  return {
    intent: intentFromRow(intentResult.rows[0]),
    attempt: attemptFromRow(attemptResult.rows[0]),
  };
}

export async function markIntentAttemptFailed(
  client: EventQueryRunner,
  input: MarkIntentFailedInput,
): Promise<{
  intent: NotificationIntentRecord;
  attempt: NotificationDeliveryAttemptRecord;
  deadLettered: boolean;
}> {
  const maxAttempts = input.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const deadLettered = input.attemptNumber >= maxAttempts;
  const attemptStatus = deadLettered ? 'DEAD_LETTER' : 'FAILED';
  const attemptId = randomUUID();
  const attemptResult = await client.query(
    `INSERT INTO notifications.notification_delivery_attempt
     (id, intent_id, attempt_number, channel, adapter_name, status,
      error_class, error_message, lease_id, completed_at)
     SELECT $1, $2, $3, intent.channel, $4, $5, $6, $7, $8, clock_timestamp()
     FROM notifications.notification_intent intent WHERE intent.id = $2
     RETURNING ${attemptColumns}`,
    [
      attemptId,
      input.intentId,
      input.attemptNumber,
      input.adapterName,
      attemptStatus,
      input.errorClass,
      input.errorMessage,
      input.leaseId,
    ],
  );
  if (!attemptResult.rows[0])
    throw new Error('Notification delivery attempt insert returned no row');
  const intentResult = await client.query(
    `UPDATE notifications.notification_intent
     SET status = CASE WHEN $4 THEN 'TERMINAL_FAILED' ELSE 'PENDING' END,
         terminal_failed_at = CASE WHEN $4 THEN clock_timestamp() ELSE terminal_failed_at END,
         next_attempt_at = CASE WHEN $4 THEN next_attempt_at
           ELSE clock_timestamp() + ($5 * interval '1 millisecond') END,
         last_error = $3,
         lease_id = NULL,
         lease_expires_at = NULL,
         version = version + 1,
         updated_at = clock_timestamp()
     WHERE id = $1 AND status = 'LEASED'
     RETURNING ${intentColumns}`,
    [
      input.intentId,
      input.attemptNumber,
      `${input.errorClass}: ${input.errorMessage}`,
      deadLettered,
      input.retryAfterMs ?? DEFAULT_RETRY_AFTER_MS,
    ],
  );
  if (!intentResult.rows[0])
    throw new Error('Notification intent lease was lost before failure mark');
  return {
    intent: intentFromRow(intentResult.rows[0]),
    attempt: attemptFromRow(attemptResult.rows[0]),
    deadLettered,
  };
}

export async function attachIntentOpsTask(
  client: EventQueryRunner,
  input: { intentId: string; opsTaskId: string },
): Promise<boolean> {
  const result = await client.query(
    `UPDATE notifications.notification_intent
     SET ops_task_id = $2, version = version + 1, updated_at = clock_timestamp()
     WHERE id = $1 RETURNING id`,
    [input.intentId, input.opsTaskId],
  );
  return result.rows.length > 0;
}

export async function recordDeadLetterEvidence(
  client: EventQueryRunner,
  input: RecordDeadLetterEvidenceInput,
): Promise<string> {
  const id = randomUUID();
  await client.query(
    `INSERT INTO notifications.notification_dead_letter_evidence
     (id, intent_id, final_attempt_id, reason_code, error_class, error_message, ops_task_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      id,
      input.intentId,
      input.finalAttemptId,
      input.reasonCode,
      input.errorClass ?? null,
      input.errorMessage ?? null,
      input.opsTaskId ?? null,
    ],
  );
  return id;
}

export async function readNotificationIntent(
  client: EventQueryRunner,
  id: string,
): Promise<NotificationIntentRecord | null> {
  const result = await client.query(
    `SELECT ${intentColumns} FROM notifications.notification_intent WHERE id = $1`,
    [id],
  );
  return result.rows[0] ? intentFromRow(result.rows[0]) : null;
}

export async function listNotificationIntents(
  client: EventQueryRunner,
  input: ListNotificationIntentsInput,
): Promise<NotificationIntentRecord[]> {
  const limit = Math.max(1, Math.min(input.limit ?? 50, 100));
  const result = await client.query(
    `SELECT ${intentColumns} FROM notifications.notification_intent
     WHERE ($1::text[] IS NULL OR notification_class = ANY($1::text[]))
       AND ($2::text IS NULL OR status = $2)
       AND ($3::uuid IS NULL OR recipient_user_id = $3)
       AND ($4::text IS NULL OR subject_type = $4)
       AND ($5::uuid IS NULL OR subject_id = $5)
     ORDER BY notifications.due_priority(notification_class), created_at DESC
     LIMIT $6`,
    [
      input.classes ?? null,
      input.status ?? null,
      input.recipientUserId ?? null,
      input.subjectType ?? null,
      input.subjectId ?? null,
      limit,
    ],
  );
  return result.rows.map(intentFromRow);
}

export async function listNotificationDeliveryAttempts(
  client: EventQueryRunner,
  intentId: string,
): Promise<NotificationDeliveryAttemptRecord[]> {
  const result = await client.query(
    `SELECT ${attemptColumns} FROM notifications.notification_delivery_attempt
     WHERE intent_id = $1 ORDER BY attempt_number`,
    [intentId],
  );
  return result.rows.map(attemptFromRow);
}

export async function readNotificationOperationalStatus(
  client: EventQueryRunner,
): Promise<NotificationOperationalStatus[]> {
  const result = await client.query(
    `SELECT status,
        count(*)::text AS count,
        count(*) FILTER (
          WHERE status IN ('PENDING', 'LEASED') AND next_attempt_at < clock_timestamp()
        )::text AS overdue,
        count(*) FILTER (WHERE status = 'TERMINAL_FAILED')::text AS dead_lettered,
        min(next_attempt_at) FILTER (WHERE status IN ('PENDING', 'LEASED')) AS oldest_next_attempt_at
     FROM notifications.notification_intent
     GROUP BY status ORDER BY status`,
  );
  return result.rows.map((row) => ({
    status: asString(row.status) as NotificationIntentStatus,
    count: asNumber(row.count),
    overdue: asNumber(row.overdue),
    deadLettered: asNumber(row.dead_lettered),
    oldestNextAttemptAt: asNullableDate(row.oldest_next_attempt_at),
  }));
}