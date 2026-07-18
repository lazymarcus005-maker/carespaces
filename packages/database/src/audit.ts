import { randomUUID } from 'node:crypto';

export interface QueryRunner {
  query(sql: string, values: unknown[]): Promise<unknown>;
}

export interface AuditActor {
  tenantId?: string | null;
  userId?: string | null;
}

export interface AuditSubject {
  type: string;
  id?: string | null;
}

export interface AppendAuditEventInput {
  actor: AuditActor;
  action: string;
  subject: AuditSubject;
  reasonCode?: string | null;
  correlationId: string;
  metadata?: Record<string, unknown>;
}

export interface StateTransitionInput {
  actor: AuditActor;
  subject: Required<AuditSubject>;
  fromState?: string | null;
  toState: string;
  reasonCode?: string | null;
  correlationId: string;
  expectedVersion?: number | null;
  resultingVersion: number;
  metadata?: Record<string, unknown>;
}

export interface AuditWriterOptions {
  nextId?: () => string;
}

export async function appendAuditEvent(
  client: QueryRunner,
  input: AppendAuditEventInput,
  options: AuditWriterOptions = {},
): Promise<string> {
  const id = options.nextId?.() ?? randomUUID();
  await client.query(
    `INSERT INTO platform.audit_event
     (id, tenant_id, actor_user_id, action, subject_type, subject_id, reason_code, correlation_id, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)`,
    [
      id,
      input.actor.tenantId ?? null,
      input.actor.userId ?? null,
      input.action,
      input.subject.type,
      input.subject.id ?? null,
      input.reasonCode ?? null,
      input.correlationId,
      JSON.stringify(input.metadata ?? {}),
    ],
  );
  return id;
}

export async function appendStateTransition(
  client: QueryRunner,
  input: StateTransitionInput,
  options: AuditWriterOptions = {},
): Promise<string> {
  const id = options.nextId?.() ?? randomUUID();
  await client.query(
    `INSERT INTO platform.state_transition
     (id, tenant_id, actor_user_id, subject_type, subject_id, from_state, to_state,
      reason_code, correlation_id, expected_version, resulting_version, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb)`,
    [
      id,
      input.actor.tenantId ?? null,
      input.actor.userId ?? null,
      input.subject.type,
      input.subject.id,
      input.fromState ?? null,
      input.toState,
      input.reasonCode ?? null,
      input.correlationId,
      input.expectedVersion ?? null,
      input.resultingVersion,
      JSON.stringify(input.metadata ?? {}),
    ],
  );
  return id;
}

export async function appendAuditedStateTransition(
  client: QueryRunner,
  input: StateTransitionInput & { action: string },
  options: AuditWriterOptions = {},
): Promise<{ auditEventId: string; stateTransitionId: string }> {
  const auditEventId = await appendAuditEvent(
    client,
    {
      actor: input.actor,
      action: input.action,
      subject: input.subject,
      reasonCode: input.reasonCode,
      correlationId: input.correlationId,
      metadata: {
        ...input.metadata,
        fromState: input.fromState ?? null,
        toState: input.toState,
        expectedVersion: input.expectedVersion ?? null,
        resultingVersion: input.resultingVersion,
      },
    },
    options,
  );
  const stateTransitionId = await appendStateTransition(client, input, options);
  return { auditEventId, stateTransitionId };
}
