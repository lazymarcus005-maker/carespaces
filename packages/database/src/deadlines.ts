import { randomUUID } from 'node:crypto';
import type { EventQueryRunner } from './events.js';

export const deadlineTypes = [
  'PROVIDER_RESERVATION_EXPIRY',
  'PAYMENT_EXPIRY',
  'SHIFT_REMINDER',
  'PRE_SHIFT_CREDENTIAL_RECHECK',
  'INCIDENT_ACK_DEADLINE',
  'REPLACEMENT_DEADLINE',
  'CUSTOMER_APPROVAL_DEADLINE',
  'DISPUTE_EVIDENCE_DEADLINE',
  'CREDENTIAL_EXPIRY',
  'PAYOUT_RETRY',
] as const;

export type DeadlineType = (typeof deadlineTypes)[number];
export type ScheduledDeadlineStatus =
  'SCHEDULED' | 'LEASED' | 'FIRED' | 'CANCELLED' | 'DEAD_LETTER';

export class DeadlineDedupeConflictError extends Error {}

export interface CreateScheduledDeadlineInput {
  id?: string;
  eventId?: string;
  tenantId?: string | null;
  deadlineType: DeadlineType;
  subjectType: string;
  subjectId: string;
  commandType: string;
  expectedState?: string | null;
  expectedVersion?: number | null;
  policyVersion: string;
  dedupeKey: string;
  correlationId: string;
  dueAt: Date;
}

export interface ScheduledDeadlineRecord {
  id: string;
  eventId: string;
  tenantId: string | null;
  deadlineType: DeadlineType;
  subjectType: string;
  subjectId: string;
  commandType: string;
  expectedState: string | null;
  expectedVersion: number | null;
  policyVersion: string;
  dedupeKey: string;
  correlationId: string;
  dueAt: Date;
  status: ScheduledDeadlineStatus;
}

export interface ClaimedScheduledDeadline extends ScheduledDeadlineRecord {
  attempts: number;
  leaseId: string;
}

export interface DeadlineClaimOptions {
  leaseId?: string;
  limit?: number;
  leaseMs?: number;
  maxAttempts?: number;
}

export interface DeadlineOperationalStatus {
  status: ScheduledDeadlineStatus;
  count: number;
  overdue: number;
  oldestDueAt: Date | null;
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

function asNullableNumber(value: unknown): number | null {
  return value === null || value === undefined ? null : asNumber(value);
}

function asDate(value: unknown): Date {
  if (value instanceof Date) return value;
  if (typeof value === 'string') return new Date(value);
  throw new Error('Expected database date');
}

function deadlineFromRow(
  row: Record<string, unknown>,
): ScheduledDeadlineRecord {
  return {
    id: asString(row.id),
    eventId: asString(row.event_id),
    tenantId: asNullableString(row.tenant_id),
    deadlineType: asString(row.deadline_type) as DeadlineType,
    subjectType: asString(row.subject_type),
    subjectId: asString(row.subject_id),
    commandType: asString(row.command_type),
    expectedState: asNullableString(row.expected_state),
    expectedVersion: asNullableNumber(row.expected_version),
    policyVersion: asString(row.policy_version),
    dedupeKey: asString(row.dedupe_key),
    correlationId: asString(row.correlation_id),
    dueAt: asDate(row.due_at),
    status: asString(row.status) as ScheduledDeadlineStatus,
  };
}

const returningColumns = `id, event_id, tenant_id, deadline_type, subject_type,
  subject_id, command_type, expected_state, expected_version, policy_version,
  dedupe_key, correlation_id, due_at, status`;

export async function createScheduledDeadline(
  client: EventQueryRunner,
  input: CreateScheduledDeadlineInput,
): Promise<{ deadline: ScheduledDeadlineRecord; created: boolean }> {
  const inserted = await client.query(
    `INSERT INTO platform.scheduled_deadline
     (id, event_id, tenant_id, deadline_type, subject_type, subject_id,
      command_type, expected_state, expected_version, policy_version,
      dedupe_key, correlation_id, due_at, next_attempt_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $13)
     ON CONFLICT (dedupe_key) DO NOTHING
     RETURNING ${returningColumns}`,
    [
      input.id ?? randomUUID(),
      input.eventId ?? randomUUID(),
      input.tenantId ?? null,
      input.deadlineType,
      input.subjectType,
      input.subjectId,
      input.commandType,
      input.expectedState ?? null,
      input.expectedVersion ?? null,
      input.policyVersion,
      input.dedupeKey,
      input.correlationId,
      input.dueAt,
    ],
  );
  const insertedRow = inserted.rows[0];
  if (insertedRow)
    return { deadline: deadlineFromRow(insertedRow), created: true };

  const existing = await client.query(
    `SELECT ${returningColumns}
     FROM platform.scheduled_deadline WHERE dedupe_key = $1`,
    [input.dedupeKey],
  );
  const existingRow = existing.rows[0];
  if (!existingRow) throw new Error('Deadline dedupe record disappeared');
  const deadline = deadlineFromRow(existingRow);
  if (
    deadline.tenantId !== (input.tenantId ?? null) ||
    deadline.deadlineType !== input.deadlineType ||
    deadline.subjectType !== input.subjectType ||
    deadline.subjectId !== input.subjectId ||
    deadline.commandType !== input.commandType ||
    deadline.expectedState !== (input.expectedState ?? null) ||
    deadline.expectedVersion !== (input.expectedVersion ?? null) ||
    deadline.policyVersion !== input.policyVersion ||
    deadline.dueAt.getTime() !== input.dueAt.getTime()
  ) {
    throw new DeadlineDedupeConflictError(
      'Deadline dedupe key was reused with different scheduling input',
    );
  }
  return { deadline, created: false };
}

export async function cancelScheduledDeadline(
  client: EventQueryRunner,
  id: string,
): Promise<boolean> {
  const result = await client.query(
    `UPDATE platform.scheduled_deadline
     SET status = 'CANCELLED', cancelled_at = clock_timestamp(),
         lease_id = NULL, lease_expires_at = NULL
     WHERE id = $1 AND status IN ('SCHEDULED', 'LEASED')
     RETURNING id`,
    [id],
  );
  return result.rows.length > 0;
}

export async function claimDueScheduledDeadlines(
  client: EventQueryRunner,
  options: DeadlineClaimOptions = {},
): Promise<ClaimedScheduledDeadline[]> {
  const leaseId = options.leaseId ?? randomUUID();
  const result = await client.query(
    `WITH candidates AS (
       SELECT id FROM platform.scheduled_deadline
       WHERE status IN ('SCHEDULED', 'LEASED')
         AND due_at <= clock_timestamp()
         AND next_attempt_at <= clock_timestamp()
         AND dead_lettered_at IS NULL
         AND (lease_expires_at IS NULL OR lease_expires_at <= clock_timestamp())
         AND attempts < $3
       ORDER BY due_at
       LIMIT $1
       FOR UPDATE SKIP LOCKED
     )
     UPDATE platform.scheduled_deadline deadline
     SET status = 'LEASED', lease_id = $2,
         lease_expires_at = clock_timestamp() + ($4 * interval '1 millisecond'),
         attempts = deadline.attempts + 1
     FROM candidates WHERE deadline.id = candidates.id
     RETURNING deadline.*, deadline.attempts`,
    [
      options.limit ?? DEFAULT_LIMIT,
      leaseId,
      options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
      options.leaseMs ?? DEFAULT_LEASE_MS,
    ],
  );
  return result.rows.map((row) => ({
    ...deadlineFromRow(row),
    attempts: asNumber(row.attempts),
    leaseId,
  }));
}

export async function markScheduledDeadlineFired(
  client: EventQueryRunner,
  input: { id: string; leaseId: string },
): Promise<boolean> {
  const result = await client.query(
    `UPDATE platform.scheduled_deadline
     SET status = 'FIRED', fired_at = clock_timestamp(), last_error = NULL,
         lease_id = NULL, lease_expires_at = NULL
     WHERE id = $1 AND status = 'LEASED' AND lease_id = $2
     RETURNING id`,
    [input.id, input.leaseId],
  );
  return result.rows.length > 0;
}

export async function markScheduledDeadlineFailed(
  client: EventQueryRunner,
  input: {
    id: string;
    leaseId: string;
    errorMessage: string;
    retryAfterMs?: number;
    maxAttempts?: number;
  },
): Promise<ScheduledDeadlineStatus | null> {
  const result = await client.query<{ status: ScheduledDeadlineStatus }>(
    `UPDATE platform.scheduled_deadline
     SET status = CASE WHEN attempts >= $4 THEN 'DEAD_LETTER' ELSE 'SCHEDULED' END,
         last_error = $3,
         next_attempt_at = CASE WHEN attempts >= $4 THEN next_attempt_at
           ELSE clock_timestamp() + ($5 * interval '1 millisecond') END,
         dead_lettered_at = CASE WHEN attempts >= $4 THEN clock_timestamp() ELSE NULL END,
         lease_id = NULL, lease_expires_at = NULL
     WHERE id = $1 AND status = 'LEASED' AND lease_id = $2
     RETURNING status`,
    [
      input.id,
      input.leaseId,
      input.errorMessage,
      input.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
      input.retryAfterMs ?? DEFAULT_RETRY_AFTER_MS,
    ],
  );
  return result.rows[0]?.status ?? null;
}

export async function readDeadlineOperationalStatus(
  client: EventQueryRunner,
): Promise<DeadlineOperationalStatus[]> {
  const result = await client.query<{
    status: ScheduledDeadlineStatus;
    count: string;
    overdue: string;
    oldest_due_at: Date | null;
  }>(
    `SELECT status, count(*)::text AS count,
       count(*) FILTER (
         WHERE status IN ('SCHEDULED', 'LEASED') AND due_at < clock_timestamp()
       )::text AS overdue,
       min(due_at) FILTER (WHERE status IN ('SCHEDULED', 'LEASED')) AS oldest_due_at
     FROM platform.scheduled_deadline
     GROUP BY status ORDER BY status`,
  );
  return result.rows.map((row) => ({
    status: row.status,
    count: asNumber(row.count),
    overdue: asNumber(row.overdue),
    oldestDueAt: row.oldest_due_at ? asDate(row.oldest_due_at) : null,
  }));
}
