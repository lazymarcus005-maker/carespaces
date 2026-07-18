import {
  appendAuditEvent,
  type AuditActor,
  type QueryRunner,
} from './audit.js';

export interface AuditTimelineRow {
  recordType: 'AUDIT_EVENT' | 'STATE_TRANSITION';
  id: string;
  tenantId: string | null;
  actorUserId: string | null;
  action: string | null;
  subjectType: string;
  subjectId: string | null;
  fromState: string | null;
  toState: string | null;
  reasonCode: string | null;
  correlationId: string;
  expectedVersion: number | null;
  resultingVersion: number | null;
  metadata: Record<string, unknown>;
  occurredAt: Date;
}

interface AuditTimelineDatabaseRow {
  record_type: AuditTimelineRow['recordType'];
  id: string;
  tenant_id: string | null;
  actor_user_id: string | null;
  action: string | null;
  subject_type: string;
  subject_id: string | null;
  from_state: string | null;
  to_state: string | null;
  reason_code: string | null;
  correlation_id: string;
  expected_version: number | null;
  resulting_version: number | null;
  metadata: Record<string, unknown>;
  occurred_at: Date;
}

export interface AuditTimelineFilter {
  tenantId?: string;
  subjectType?: string;
  subjectId?: string;
  correlationId?: string;
  occurredBefore?: Date;
  limit?: number;
}

export interface PrivilegedAuditRequest {
  actor: Required<Pick<AuditActor, 'userId'>> & AuditActor;
  reasonCode: string;
  correlationId: string;
  filter: AuditTimelineFilter;
}

export interface AuditQueryDependencies {
  reader: QueryRunner;
  writer: QueryRunner;
  nextId?: () => string;
}

interface RowsResult<Row> {
  rows: Row[];
}

const sensitiveMetadataKeys = new Set([
  'accesstoken',
  'diagnosis',
  'documenttoken',
  'documenturl',
  'exactaddress',
  'medication',
  'otp',
  'password',
  'patientname',
  'rawpsppayload',
  'refreshtoken',
  'token',
]);

function normalizeKey(key: string): string {
  return key.replaceAll(/[^a-zA-Z0-9]/g, '').toLowerCase();
}

export function redactAuditMetadata(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactAuditMetadata);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, nestedValue]) => [
      key,
      sensitiveMetadataKeys.has(normalizeKey(key))
        ? '[REDACTED]'
        : redactAuditMetadata(nestedValue),
    ]),
  );
}

function validateRequest(request: PrivilegedAuditRequest): void {
  if (!request.actor.userId?.trim())
    throw new Error('Audit reader userId is required');
  if (!request.reasonCode.trim())
    throw new Error('Audit read reasonCode is required');
  if (!request.correlationId.trim())
    throw new Error('Audit read correlationId is required');
  const hasScope = Boolean(
    request.filter.tenantId ||
    request.filter.correlationId ||
    (request.filter.subjectType && request.filter.subjectId),
  );
  if (!hasScope)
    throw new Error(
      'Audit query requires a bounded tenant, correlation, or subject scope',
    );
  const limit = request.filter.limit ?? 100;
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
    throw new Error('Audit query limit must be an integer from 1 to 500');
  }
}

async function traceAccess(
  writer: QueryRunner,
  request: PrivilegedAuditRequest,
  action: 'audit.timeline.read' | 'audit.timeline.export',
  nextId?: () => string,
): Promise<void> {
  await appendAuditEvent(
    writer,
    {
      actor: request.actor,
      action,
      subject: {
        type: 'audit_timeline',
        id: request.filter.tenantId ?? null,
      },
      reasonCode: request.reasonCode,
      correlationId: request.correlationId,
      metadata: { filter: request.filter },
    },
    { nextId },
  );
}

async function queryTimeline(
  reader: QueryRunner,
  filter: AuditTimelineFilter,
): Promise<AuditTimelineRow[]> {
  const predicates: string[] = [];
  const values: unknown[] = [];
  const add = (predicate: string, value: unknown): void => {
    values.push(value);
    predicates.push(predicate.replace('?', `$${values.length}`));
  };

  if (filter.tenantId) add('tenant_id = ?', filter.tenantId);
  if (filter.subjectType) add('subject_type = ?', filter.subjectType);
  if (filter.subjectId) add('subject_id = ?', filter.subjectId);
  if (filter.correlationId) add('correlation_id = ?', filter.correlationId);
  if (filter.occurredBefore) add('occurred_at < ?', filter.occurredBefore);
  values.push(filter.limit ?? 100);

  const result = (await reader.query(
    `SELECT record_type, id, tenant_id, actor_user_id, action, subject_type, subject_id,
            from_state, to_state, reason_code, correlation_id, expected_version,
            resulting_version, metadata, occurred_at
     FROM platform.audit_timeline
     WHERE ${predicates.join(' AND ')}
     ORDER BY occurred_at DESC, id DESC
     LIMIT $${values.length}`,
    values,
  )) as RowsResult<AuditTimelineDatabaseRow>;

  return result.rows.map((row) => ({
    recordType: row.record_type,
    id: row.id,
    tenantId: row.tenant_id,
    actorUserId: row.actor_user_id,
    action: row.action,
    subjectType: row.subject_type,
    subjectId: row.subject_id,
    fromState: row.from_state,
    toState: row.to_state,
    reasonCode: row.reason_code,
    correlationId: row.correlation_id,
    expectedVersion: row.expected_version,
    resultingVersion: row.resulting_version,
    metadata: redactAuditMetadata(row.metadata) as Record<string, unknown>,
    occurredAt: row.occurred_at,
  }));
}

export async function readAuditTimeline(
  dependencies: AuditQueryDependencies,
  request: PrivilegedAuditRequest,
): Promise<AuditTimelineRow[]> {
  validateRequest(request);
  await traceAccess(
    dependencies.writer,
    request,
    'audit.timeline.read',
    dependencies.nextId,
  );
  return queryTimeline(dependencies.reader, request.filter);
}

function csvCell(value: unknown): string {
  const text =
    value instanceof Date ? value.toISOString() : String(value ?? '');
  return `"${text.replaceAll('"', '""')}"`;
}

export async function exportAuditTimelineCsv(
  dependencies: AuditQueryDependencies,
  request: PrivilegedAuditRequest,
): Promise<string> {
  validateRequest(request);
  await traceAccess(
    dependencies.writer,
    request,
    'audit.timeline.export',
    dependencies.nextId,
  );
  const rows = await queryTimeline(dependencies.reader, request.filter);
  const header = [
    'recordType',
    'id',
    'tenantId',
    'actorUserId',
    'action',
    'subjectType',
    'subjectId',
    'fromState',
    'toState',
    'reasonCode',
    'correlationId',
    'expectedVersion',
    'resultingVersion',
    'occurredAt',
  ];
  return [
    header.map(csvCell).join(','),
    ...rows.map((row) =>
      header
        .map((key) => csvCell(row[key as keyof AuditTimelineRow]))
        .join(','),
    ),
  ].join('\n');
}
