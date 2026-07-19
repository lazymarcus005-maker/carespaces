import { randomUUID } from 'node:crypto';

export type OutboxEventStatus =
  'PENDING' | 'LEASED' | 'PUBLISHED' | 'DEAD_LETTER';
export type InboxMessageStatus =
  'RECEIVED' | 'PROCESSING' | 'APPLIED' | 'DEAD_LETTER';

export interface EventQueryRunner {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    values?: readonly unknown[],
  ): Promise<{ rows: Row[] }>;
}

export interface EnqueueOutboxEventInput {
  id?: string;
  tenantId?: string | null;
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  eventVersion?: number;
  payload: unknown;
  correlationId: string;
}

export interface ClaimedOutboxEvent {
  id: string;
  tenantId: string | null;
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  eventVersion: number;
  payload: unknown;
  correlationId: string;
  occurredAt: Date;
  attempts: number;
  leaseId: string;
}

export interface RecordInboxMessageInput {
  id?: string;
  source: string;
  messageId: string;
  eventType: string;
  payload: unknown;
  correlationId: string;
}

export interface InboxRecordResult {
  id: string;
  status: InboxMessageStatus;
  duplicate: boolean;
}

export interface ClaimedInboxMessage {
  id: string;
  source: string;
  messageId: string;
  eventType: string;
  payload: unknown;
  correlationId: string;
  attempts: number;
  leaseId: string;
}

export interface ClaimOptions {
  leaseId?: string;
  limit?: number;
  leaseMs?: number;
  maxAttempts?: number;
}

export interface MarkFailureInput {
  id: string;
  leaseId?: string | null;
  errorMessage: string;
  retryAfterMs?: number;
  maxAttempts?: number;
}

export interface MarkLeasedInput {
  id: string;
  leaseId?: string | null;
}

const DEFAULT_CLAIM_LIMIT = 25;
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

function outboxEventFromRow(
  row: Record<string, unknown>,
  leaseId: string,
): ClaimedOutboxEvent {
  return {
    id: asString(row.id),
    tenantId: asNullableString(row.tenant_id),
    aggregateType: asString(row.aggregate_type),
    aggregateId: asString(row.aggregate_id),
    eventType: asString(row.event_type),
    eventVersion: asNumber(row.event_version),
    payload: row.payload,
    correlationId: asString(row.correlation_id),
    occurredAt: asDate(row.occurred_at),
    attempts: asNumber(row.attempts),
    leaseId,
  };
}

function inboxMessageFromRow(
  row: Record<string, unknown>,
  leaseId: string,
): ClaimedInboxMessage {
  return {
    id: asString(row.id),
    source: asString(row.source),
    messageId: asString(row.message_id),
    eventType: asString(row.event_type),
    payload: row.payload,
    correlationId: asString(row.correlation_id),
    attempts: asNumber(row.attempts),
    leaseId,
  };
}

export async function enqueueOutboxEvent(
  client: EventQueryRunner,
  input: EnqueueOutboxEventInput,
): Promise<string> {
  const id = input.id ?? randomUUID();
  await client.query(
    `INSERT INTO platform.outbox_event
     (id, tenant_id, aggregate_type, aggregate_id, event_type, event_version,
      payload, correlation_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)`,
    [
      id,
      input.tenantId ?? null,
      input.aggregateType,
      input.aggregateId,
      input.eventType,
      input.eventVersion ?? 1,
      JSON.stringify(input.payload),
      input.correlationId,
    ],
  );
  return id;
}

export async function claimOutboxEvents(
  client: EventQueryRunner,
  options: ClaimOptions = {},
): Promise<ClaimedOutboxEvent[]> {
  const leaseId = options.leaseId ?? randomUUID();
  const result = await client.query(
    `WITH candidates AS (
       SELECT id
       FROM platform.outbox_event
       WHERE status IN ('PENDING', 'LEASED')
         AND published_at IS NULL
         AND dead_lettered_at IS NULL
         AND next_attempt_at <= clock_timestamp()
         AND (lease_expires_at IS NULL OR lease_expires_at <= clock_timestamp())
         AND attempts < $3
       ORDER BY occurred_at
       LIMIT $1
       FOR UPDATE SKIP LOCKED
     )
     UPDATE platform.outbox_event event
     SET status = 'LEASED',
         lease_id = $2,
         lease_expires_at = clock_timestamp() + ($4 * interval '1 millisecond'),
         attempts = event.attempts + 1
     FROM candidates
     WHERE event.id = candidates.id
     RETURNING event.id, event.tenant_id, event.aggregate_type,
       event.aggregate_id, event.event_type, event.event_version, event.payload,
       event.correlation_id, event.occurred_at, event.attempts`,
    [
      options.limit ?? DEFAULT_CLAIM_LIMIT,
      leaseId,
      options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
      options.leaseMs ?? DEFAULT_LEASE_MS,
    ],
  );
  return result.rows.map((row) => outboxEventFromRow(row, leaseId));
}

export async function markOutboxPublished(
  client: EventQueryRunner,
  input: MarkLeasedInput,
): Promise<boolean> {
  const result = await client.query(
    `UPDATE platform.outbox_event
     SET status = 'PUBLISHED',
         published_at = clock_timestamp(),
         lease_id = NULL,
         lease_expires_at = NULL,
         last_error = NULL
     WHERE id = $1 AND ($2::uuid IS NULL OR lease_id = $2)
     RETURNING id`,
    [input.id, input.leaseId ?? null],
  );
  return result.rows.length > 0;
}

export async function markOutboxFailed(
  client: EventQueryRunner,
  input: MarkFailureInput,
): Promise<OutboxEventStatus | null> {
  const result = await client.query<{ status: OutboxEventStatus }>(
    `UPDATE platform.outbox_event
     SET status = CASE
           WHEN attempts >= $4 THEN 'DEAD_LETTER'
           ELSE 'PENDING'
         END,
         last_error = $3,
         next_attempt_at = CASE
           WHEN attempts >= $4 THEN next_attempt_at
           ELSE clock_timestamp() + ($5 * interval '1 millisecond')
         END,
         dead_lettered_at = CASE
           WHEN attempts >= $4 THEN clock_timestamp()
           ELSE NULL
         END,
         lease_id = NULL,
         lease_expires_at = NULL
     WHERE id = $1 AND ($2::uuid IS NULL OR lease_id = $2)
     RETURNING status`,
    [
      input.id,
      input.leaseId ?? null,
      input.errorMessage,
      input.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
      input.retryAfterMs ?? DEFAULT_RETRY_AFTER_MS,
    ],
  );
  return result.rows[0]?.status ?? null;
}

export async function recordInboxMessage(
  client: EventQueryRunner,
  input: RecordInboxMessageInput,
): Promise<InboxRecordResult> {
  const id = input.id ?? randomUUID();
  const inserted = await client.query<{
    id: string;
    status: InboxMessageStatus;
  }>(
    `INSERT INTO platform.inbox_message
     (id, source, message_id, event_type, payload, correlation_id)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6)
     ON CONFLICT (source, message_id) DO NOTHING
     RETURNING id, status`,
    [
      id,
      input.source,
      input.messageId,
      input.eventType,
      JSON.stringify(input.payload),
      input.correlationId,
    ],
  );
  const insertedRow = inserted.rows[0];
  if (insertedRow) return { ...insertedRow, duplicate: false };

  const existing = await client.query<{
    id: string;
    status: InboxMessageStatus;
  }>(
    `SELECT id, status
     FROM platform.inbox_message
     WHERE source = $1 AND message_id = $2`,
    [input.source, input.messageId],
  );
  const existingRow = existing.rows[0];
  if (!existingRow) throw new Error('Inbox dedupe record disappeared');
  return { ...existingRow, duplicate: true };
}

export async function claimInboxMessages(
  client: EventQueryRunner,
  options: ClaimOptions & { source?: string } = {},
): Promise<ClaimedInboxMessage[]> {
  const leaseId = options.leaseId ?? randomUUID();
  const result = await client.query(
    `WITH candidates AS (
       SELECT id
       FROM platform.inbox_message
       WHERE status IN ('RECEIVED', 'PROCESSING')
         AND dead_lettered_at IS NULL
         AND next_attempt_at <= clock_timestamp()
         AND (lease_expires_at IS NULL OR lease_expires_at <= clock_timestamp())
         AND attempts < $3
         AND ($5::text IS NULL OR source = $5)
       ORDER BY received_at
       LIMIT $1
       FOR UPDATE SKIP LOCKED
     )
     UPDATE platform.inbox_message message
     SET status = 'PROCESSING',
         lease_id = $2,
         lease_expires_at = clock_timestamp() + ($4 * interval '1 millisecond'),
         attempts = message.attempts + 1
     FROM candidates
     WHERE message.id = candidates.id
     RETURNING message.id, message.source, message.message_id,
       message.event_type, message.payload, message.correlation_id,
       message.attempts`,
    [
      options.limit ?? DEFAULT_CLAIM_LIMIT,
      leaseId,
      options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
      options.leaseMs ?? DEFAULT_LEASE_MS,
      options.source ?? null,
    ],
  );
  return result.rows.map((row) => inboxMessageFromRow(row, leaseId));
}

export async function markInboxApplied(
  client: EventQueryRunner,
  input: MarkLeasedInput,
): Promise<boolean> {
  const result = await client.query(
    `UPDATE platform.inbox_message
     SET status = 'APPLIED',
         processed_at = clock_timestamp(),
         lease_id = NULL,
         lease_expires_at = NULL,
         last_error = NULL
     WHERE id = $1 AND ($2::uuid IS NULL OR lease_id = $2)
     RETURNING id`,
    [input.id, input.leaseId ?? null],
  );
  return result.rows.length > 0;
}

export async function markInboxFailed(
  client: EventQueryRunner,
  input: MarkFailureInput,
): Promise<InboxMessageStatus | null> {
  const result = await client.query<{ status: InboxMessageStatus }>(
    `UPDATE platform.inbox_message
     SET status = CASE
           WHEN attempts >= $4 THEN 'DEAD_LETTER'
           ELSE 'RECEIVED'
         END,
         last_error = $3,
         next_attempt_at = CASE
           WHEN attempts >= $4 THEN next_attempt_at
           ELSE clock_timestamp() + ($5 * interval '1 millisecond')
         END,
         dead_lettered_at = CASE
           WHEN attempts >= $4 THEN clock_timestamp()
           ELSE NULL
         END,
         lease_id = NULL,
         lease_expires_at = NULL
     WHERE id = $1 AND ($2::uuid IS NULL OR lease_id = $2)
     RETURNING status`,
    [
      input.id,
      input.leaseId ?? null,
      input.errorMessage,
      input.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
      input.retryAfterMs ?? DEFAULT_RETRY_AFTER_MS,
    ],
  );
  return result.rows[0]?.status ?? null;
}

export async function replayOutboxEvent(
  client: EventQueryRunner,
  id: string,
): Promise<boolean> {
  const result = await client.query(
    `UPDATE platform.outbox_event
     SET status = 'PENDING', attempts = 0, next_attempt_at = clock_timestamp(),
         lease_id = NULL, lease_expires_at = NULL, last_error = NULL,
         dead_lettered_at = NULL
     WHERE id = $1 AND status = 'DEAD_LETTER'
     RETURNING id`,
    [id],
  );
  return result.rows.length > 0;
}

export async function replayInboxMessage(
  client: EventQueryRunner,
  id: string,
): Promise<boolean> {
  const result = await client.query(
    `UPDATE platform.inbox_message
     SET status = 'RECEIVED', attempts = 0, next_attempt_at = clock_timestamp(),
         lease_id = NULL, lease_expires_at = NULL, last_error = NULL,
         dead_lettered_at = NULL, processed_at = NULL
     WHERE id = $1 AND status = 'DEAD_LETTER'
     RETURNING id`,
    [id],
  );
  return result.rows.length > 0;
}
