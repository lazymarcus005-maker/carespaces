import { randomUUID } from 'node:crypto';
import {
  OpsTaskDedupeConflictError,
  OpsTaskNotFoundError,
  OpsTaskStateError,
  StaleVersionError,
} from './errors.js';
import type { EventQueryRunner } from './events.js';

export const opsTaskQueues = [
  'VERIFICATION',
  'CLINICAL',
  'URGENT',
  'INCIDENT',
  'REPLACEMENT',
  'DISPUTE',
  'FINANCE',
  'GENERAL',
] as const;
export const opsTaskPriorities = ['LOW', 'NORMAL', 'HIGH', 'CRITICAL'] as const;
export const opsTaskStatuses = [
  'OPEN',
  'CLAIMED',
  'RESOLVED',
  'CANCELLED',
] as const;
export const opsTaskSubjectTypes = [
  'provider',
  'credential',
  'job',
  'assignment',
  'shift',
  'incident',
  'replacement_request',
  'dispute',
  'payment',
  'payout',
  'reconciliation',
  'notification',
  'scheduled_deadline',
  'system',
] as const;

export type OpsTaskQueue = (typeof opsTaskQueues)[number];
export type OpsTaskPriority = (typeof opsTaskPriorities)[number];
export type OpsTaskStatus = (typeof opsTaskStatuses)[number];
export type OpsTaskSubjectType = (typeof opsTaskSubjectTypes)[number];

export interface OpsTaskRecord {
  id: string;
  tenantId: string | null;
  taskType: string;
  subjectType: OpsTaskSubjectType;
  subjectId: string;
  queue: OpsTaskQueue;
  priority: OpsTaskPriority;
  ownerUserId: string | null;
  dueAt: Date | null;
  escalationLevel: number;
  status: OpsTaskStatus;
  resolutionCode: string | null;
  sourceDedupeKey: string;
  createdByUserId: string | null;
  createdBySystem: string | null;
  resolvedByUserId: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  resolvedAt: Date | null;
}

export interface CreateOpsTaskInput {
  id?: string;
  tenantId?: string | null;
  taskType: string;
  subjectType: OpsTaskSubjectType;
  subjectId: string;
  queue: OpsTaskQueue;
  priority: OpsTaskPriority;
  dueAt?: Date | null;
  sourceDedupeKey: string;
  createdByUserId?: string | null;
  createdBySystem?: string | null;
}

export interface OpsTaskOperationalStatus {
  queue: OpsTaskQueue;
  status: OpsTaskStatus;
  count: number;
  overdue: number;
  unowned: number;
  highestEscalationLevel: number;
  oldestDueAt: Date | null;
}

export interface OpsActorAccess {
  userId: string;
  role: string;
  queue: OpsTaskQueue;
}

export interface ListOpsTasksInput {
  queues: OpsTaskQueue[];
  status?: OpsTaskStatus;
  priority?: OpsTaskPriority;
  ownerUserId?: string;
  unownedOnly?: boolean;
  limit?: number;
}

const columns = `id, tenant_id, task_type, subject_type, subject_id, queue,
  priority, owner_user_id, due_at, escalation_level, status, resolution_code,
  source_dedupe_key, created_by_user_id, created_by_system,
  resolved_by_user_id, version, created_at, updated_at, resolved_at`;

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

export function opsTaskFromRow(row: Record<string, unknown>): OpsTaskRecord {
  return {
    id: asString(row.id),
    tenantId: asNullableString(row.tenant_id),
    taskType: asString(row.task_type),
    subjectType: asString(row.subject_type) as OpsTaskSubjectType,
    subjectId: asString(row.subject_id),
    queue: asString(row.queue) as OpsTaskQueue,
    priority: asString(row.priority) as OpsTaskPriority,
    ownerUserId: asNullableString(row.owner_user_id),
    dueAt: asNullableDate(row.due_at),
    escalationLevel: asNumber(row.escalation_level),
    status: asString(row.status) as OpsTaskStatus,
    resolutionCode: asNullableString(row.resolution_code),
    sourceDedupeKey: asString(row.source_dedupe_key),
    createdByUserId: asNullableString(row.created_by_user_id),
    createdBySystem: asNullableString(row.created_by_system),
    resolvedByUserId: asNullableString(row.resolved_by_user_id),
    version: asNumber(row.version),
    createdAt: asDate(row.created_at),
    updatedAt: asDate(row.updated_at),
    resolvedAt: asNullableDate(row.resolved_at),
  };
}

export async function readOpsTask(
  client: EventQueryRunner,
  id: string,
): Promise<OpsTaskRecord | null> {
  const result = await client.query(
    `SELECT ${columns} FROM operations.ops_task WHERE id = $1`,
    [id],
  );
  return result.rows[0] ? opsTaskFromRow(result.rows[0]) : null;
}

export async function resolveOpsActorAccess(
  client: EventQueryRunner,
  input: { identityProvider: string; identitySubject: string },
): Promise<OpsActorAccess[]> {
  const result = await client.query(
    `SELECT user_id, role, queue
     FROM operations.resolve_actor_access($1, $2)
     ORDER BY role, queue`,
    [input.identityProvider, input.identitySubject],
  );
  return result.rows.map((row) => ({
    userId: asString(row.user_id),
    role: asString(row.role),
    queue: asString(row.queue) as OpsTaskQueue,
  }));
}

export async function listOpsTasks(
  client: EventQueryRunner,
  input: ListOpsTasksInput,
): Promise<OpsTaskRecord[]> {
  if (input.queues.length === 0) return [];
  const limit = Math.max(1, Math.min(input.limit ?? 50, 100));
  const result = await client.query(
    `SELECT ${columns} FROM operations.ops_task
     WHERE queue = ANY($1::text[])
       AND ($2::text IS NULL OR status = $2)
       AND ($3::text IS NULL OR priority = $3)
       AND ($4::uuid IS NULL OR owner_user_id = $4)
       AND (NOT $5::boolean OR owner_user_id IS NULL)
     ORDER BY
       CASE priority WHEN 'CRITICAL' THEN 1 WHEN 'HIGH' THEN 2
         WHEN 'NORMAL' THEN 3 ELSE 4 END,
       due_at ASC NULLS LAST, created_at ASC
     LIMIT $6`,
    [
      input.queues,
      input.status ?? null,
      input.priority ?? null,
      input.ownerUserId ?? null,
      input.unownedOnly ?? false,
      limit,
    ],
  );
  return result.rows.map(opsTaskFromRow);
}

export async function createOpsTask(
  client: EventQueryRunner,
  input: CreateOpsTaskInput,
): Promise<{ task: OpsTaskRecord; created: boolean }> {
  if (Boolean(input.createdByUserId) === Boolean(input.createdBySystem)) {
    throw new Error('Exactly one Ops Task creator is required');
  }
  const values = [
    input.id ?? randomUUID(),
    input.tenantId ?? null,
    input.taskType,
    input.subjectType,
    input.subjectId,
    input.queue,
    input.priority,
    input.dueAt ?? null,
    input.sourceDedupeKey,
    input.createdByUserId ?? null,
    input.createdBySystem ?? null,
  ];
  const inserted = await client.query(
    `INSERT INTO operations.ops_task
     (id, tenant_id, task_type, subject_type, subject_id, queue, priority,
      due_at, source_dedupe_key, created_by_user_id, created_by_system)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     ON CONFLICT (source_dedupe_key) DO NOTHING RETURNING ${columns}`,
    values,
  );
  if (inserted.rows[0])
    return { task: opsTaskFromRow(inserted.rows[0]), created: true };
  const existing = await client.query(
    `SELECT ${columns} FROM operations.ops_task WHERE source_dedupe_key = $1`,
    [input.sourceDedupeKey],
  );
  const task = existing.rows[0] ? opsTaskFromRow(existing.rows[0]) : null;
  if (!task) throw new Error('Ops Task dedupe record disappeared');
  if (
    task.tenantId !== (input.tenantId ?? null) ||
    task.taskType !== input.taskType ||
    task.subjectType !== input.subjectType ||
    task.subjectId !== input.subjectId ||
    task.queue !== input.queue ||
    task.priority !== input.priority ||
    task.dueAt?.getTime() !== input.dueAt?.getTime() ||
    task.createdByUserId !== (input.createdByUserId ?? null) ||
    task.createdBySystem !== (input.createdBySystem ?? null)
  ) {
    throw new OpsTaskDedupeConflictError();
  }
  return { task, created: false };
}

async function transitionFailure(
  client: EventQueryRunner,
  id: string,
  expectedVersion: number,
  message: string,
): Promise<never> {
  const task = await readOpsTask(client, id);
  if (!task) throw new OpsTaskNotFoundError();
  if (task.version !== expectedVersion)
    throw new StaleVersionError(expectedVersion, task.version);
  throw new OpsTaskStateError(message);
}

export async function claimOpsTask(
  client: EventQueryRunner,
  input: { id: string; expectedVersion: number; ownerUserId: string },
): Promise<OpsTaskRecord> {
  const result = await client.query(
    `UPDATE operations.ops_task SET status = 'CLAIMED', owner_user_id = $3,
       version = version + 1, updated_at = clock_timestamp()
     WHERE id = $1 AND version = $2 AND status = 'OPEN'
     RETURNING ${columns}`,
    [input.id, input.expectedVersion, input.ownerUserId],
  );
  if (result.rows[0]) return opsTaskFromRow(result.rows[0]);
  return transitionFailure(
    client,
    input.id,
    input.expectedVersion,
    'Only an open Ops Task can be claimed',
  );
}

export async function reassignOpsTask(
  client: EventQueryRunner,
  input: { id: string; expectedVersion: number; ownerUserId: string },
): Promise<OpsTaskRecord> {
  const result = await client.query(
    `UPDATE operations.ops_task SET owner_user_id = $3,
       version = version + 1, updated_at = clock_timestamp()
     WHERE id = $1 AND version = $2 AND status = 'CLAIMED'
     RETURNING ${columns}`,
    [input.id, input.expectedVersion, input.ownerUserId],
  );
  if (result.rows[0]) return opsTaskFromRow(result.rows[0]);
  return transitionFailure(
    client,
    input.id,
    input.expectedVersion,
    'Only a claimed Ops Task can be reassigned',
  );
}

export async function resolveOpsTask(
  client: EventQueryRunner,
  input: {
    id: string;
    expectedVersion: number;
    actorUserId: string;
    resolutionCode: string;
  },
): Promise<OpsTaskRecord> {
  const result = await client.query(
    `UPDATE operations.ops_task SET status = 'RESOLVED', resolution_code = $4,
       resolved_by_user_id = $3, resolved_at = clock_timestamp(),
       version = version + 1, updated_at = clock_timestamp()
     WHERE id = $1 AND version = $2 AND status = 'CLAIMED' AND owner_user_id = $3
     RETURNING ${columns}`,
    [input.id, input.expectedVersion, input.actorUserId, input.resolutionCode],
  );
  if (result.rows[0]) return opsTaskFromRow(result.rows[0]);
  return transitionFailure(
    client,
    input.id,
    input.expectedVersion,
    'Only the current owner can resolve a claimed Ops Task',
  );
}

export async function escalateOpsTask(
  client: EventQueryRunner,
  input: {
    id: string;
    expectedVersion: number;
    priority?: OpsTaskPriority;
    dueAt?: Date;
  },
): Promise<OpsTaskRecord> {
  const result = await client.query(
    `UPDATE operations.ops_task SET escalation_level = escalation_level + 1,
       priority = COALESCE($3, priority), due_at = COALESCE($4, due_at),
       version = version + 1, updated_at = clock_timestamp()
     WHERE id = $1 AND version = $2 AND status IN ('OPEN', 'CLAIMED')
     RETURNING ${columns}`,
    [
      input.id,
      input.expectedVersion,
      input.priority ?? null,
      input.dueAt ?? null,
    ],
  );
  if (result.rows[0]) return opsTaskFromRow(result.rows[0]);
  return transitionFailure(
    client,
    input.id,
    input.expectedVersion,
    'Only an active Ops Task can be escalated',
  );
}

export async function readOpsTaskOperationalStatus(
  client: EventQueryRunner,
): Promise<OpsTaskOperationalStatus[]> {
  const result = await client.query(
    `SELECT queue, status, count(*)::text AS count,
       count(*) FILTER (WHERE status IN ('OPEN', 'CLAIMED') AND due_at < clock_timestamp())::text AS overdue,
       count(*) FILTER (WHERE status = 'OPEN' AND owner_user_id IS NULL)::text AS unowned,
       max(escalation_level)::text AS highest_escalation_level,
       min(due_at) FILTER (WHERE status IN ('OPEN', 'CLAIMED')) AS oldest_due_at
     FROM operations.ops_task GROUP BY queue, status ORDER BY queue, status`,
  );
  return result.rows.map((row) => ({
    queue: asString(row.queue) as OpsTaskQueue,
    status: asString(row.status) as OpsTaskStatus,
    count: asNumber(row.count),
    overdue: asNumber(row.overdue),
    unowned: asNumber(row.unowned),
    highestEscalationLevel: asNumber(row.highest_escalation_level),
    oldestDueAt: asNullableDate(row.oldest_due_at),
  }));
}
