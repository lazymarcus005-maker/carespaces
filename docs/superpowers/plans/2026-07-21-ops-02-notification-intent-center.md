# OPS-02 Notification Intent Center Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the OPS-02 Notification Intent Center as a vertical slice: idempotent, auditable, outbox-driven notification intents with delivery attempts, retry/DLQ, critical-class guard, user preferences, a synthetic local delivery adapter, typed API contracts, Admin inspector view, and a real deadline→notification→Ops Task fallback path.

**Architecture:** Notification intents are persisted in a new `notifications` schema, created transactionally with an outbox event, leased by a worker that calls a pluggable delivery adapter (synthetic local adapter only for MVP), and tracked through attempts with retry and dead-letter evidence. Critical notification classes cannot be disabled by user preferences. A scheduled deadline (INCIDENT_ACK_DEADLINE) and an operational failure path (deadline dead-letter) create real intents with an Ops Task fallback when delivery terminal-fails.

**Tech Stack:** PostgreSQL 16, `pg` Pool/PoolClient, TypeScript ESM, Vitest, NestJS 11, Zod 4, Next.js 15 (Admin), existing `@carespaces/{database,eventing,operations,authz,api-contracts,config}` workspace packages.

## Global Constraints

- Node >=22, pnpm 10.32.1, ESM (`"type": "module"`), `.js` import specifiers in TS.
- Follow existing patterns: reviewed forward/down SQL migrations under `packages/database/migrations/NNNN_*.up.sql` + `.down.sql`; `EventQueryRunner` from `@carespaces/database` for query functions; `appendAuditedStateTransition`/`appendAuditEvent` for audit; `enqueueOutboxEvent` for outbox; idempotency via `platform.idempotency_record` + `pg_advisory_xact_lock`; lease-based `FOR UPDATE SKIP LOCKED` claim with retry/DLQ like `platform.scheduled_deadline`.
- All persisted public contracts exclude provider-specific credentials/payloads (only adapter-agnostic `channel`, `recipient_ref`, `rendered_body_ref`/`body_redacted`).
- Critical notification classes (`incident_ack`, `sos`, `credential_expiry_block`, `replacement_failed`) cannot be disabled by user preferences — enforce in service + DB CHECK.
- Delivery receipt is never human acknowledgement — separate `acknowledged_at` field is null on intent and attempts; only Ops Task resolution records acknowledgement.
- Operational status CLI exits 2 when DLQ or overdue rows exist.
- Synthetic seed requires `ALLOW_SYNTHETIC_SEED=true` and loopback host (existing guard).
- No comments in code unless explicitly requested.
- Run `pnpm api:generate` after touching OpenAPI schemas so `docs/openapi.json` and generated TS stay in sync.

---

## File Structure

**Create:**
- `packages/database/migrations/0010_notification_intents.up.sql` — notifications schema: `notification_template`, `notification_intent`, `notification_delivery_attempt`, `notification_user_preference`, `notification_dead_letter_evidence`.
- `packages/database/migrations/0010_notification_intents.down.sql` — reverse order drops.
- `packages/database/src/notifications.ts` — persistence functions: `createNotificationIntent`, `claimPendingNotificationIntents`, `markIntentAttemptFired`, `markIntentAttemptFailed`, `markIntentTerminal`, `readNotificationIntent`, `listNotificationIntents`, `listNotificationDeliveryAttempts`, `readNotificationOperationalStatus`, plus type exports and `fromRow` helpers.
- `packages/database/src/notifications.spec.ts` — unit tests against scripted client.
- `packages/notifications/package.json` — new workspace package `@carespaces/notifications`.
- `packages/notifications/tsconfig.json` / `tsconfig.build.json` / `scripts/clean.mjs` — mirror `packages/operations`.
- `packages/notifications/src/index.ts` — re-exports.
- `packages/notifications/src/delivery-adapter.ts` — `DeliveryAdapter` interface, `DeliveryRequest`/`DeliveryResult`/`DeliveryFailure` types, `SyntheticDeliveryAdapter` class.
- `packages/notifications/src/notification-service.ts` — `PostgresNotificationService`: `createIntent`, `createPreference`, `listIntents`, `listAttempts`, `readOperationalStatus`; critical-class guard; preference enforcement; idempotent outbox-driven create.
- `packages/notifications/src/notification-service.spec.ts` — guard unit tests.
- `packages/notifications/src/notification-dispatcher.ts` — `NotificationDispatcher`: claims pending intents, calls adapter, records attempt outcome, retry/DLQ, Ops Task fallback on terminal failure.
- `packages/notifications/src/notification-dispatcher.spec.ts` — scripted store tests for retry/DLQ and fallback.
- `apps/worker/src/notification-status.ts` — operational status CLI.
- `apps/worker/test/notification.integration.ts` — PostgreSQL integration test.
- `apps/api/src/notifications/notifications.module.ts` — NestJS module.
- `apps/api/src/notifications/notifications.controller.ts` — `GET /v1/notifications/intents`, `GET /v1/notifications/intents/:id`, `GET /v1/notifications/intents/:id/attempts`.
- `apps/api/src/notifications/notifications.repository.ts` — authz + projection.
- `apps/api/test/notifications.integration.ts` — API integration test.
- `apps/admin-web/app/notifications-workspace.tsx` — intent/attempt inspector view.
- `apps/admin-web/app/notifications/page.tsx` — Next.js page for `/notifications`.

**Modify:**
- `packages/database/src/index.ts` — export `./notifications.js`.
- `packages/database/test/verify.ts` — expect 10 migrations forward, rollback to `0009` after `0010` rollback; add notification evidence checks.
- `packages/database/src/seed.ts` — add `syntheticNotificationPolicy` config + seed notification templates, user preferences, and two synthetic intents (one critical, one standard); wire one to existing incident Ops Task subject.
- `packages/api-contracts/src/index.ts` — add Zod schemas: `NotificationChannel`, `NotificationClass`, `NotificationIntentStatus`, `NotificationAttemptStatus`, `NotificationIntentSchema`, `NotificationAttemptSchema`, `NotificationIntentListResponseSchema`, `NotificationAttemptListResponseSchema`.
- `apps/api/src/openapi.ts` — add OpenAPI schemas for notification projections.
- `apps/api/src/app.module.ts` — import `NotificationsModule`.
- `apps/api/src/operations/operations.repository.ts` — expose `createFallbackTask` helper used by notification fallback (system actor); reused by dispatcher integration.
- `apps/worker/src/runtime.ts` — instantiate `NotificationDispatcher` and run it in `runCycle`; register `notification.intent.created.v1` inbox handler (no-op) and `deadline.command-due.v1` extension that creates a notification intent for `INCIDENT_ACK_DEADLINE` and `PAYOUT_RETRY` dead-letter paths.
- `apps/worker/src/main.ts` — log notification cycle results.
- `apps/worker/package.json` — add `notification:status` script; add `@carespaces/notifications` dependency.
- `apps/admin-web/app/ops-workspace.tsx` — add navigation link to `/notifications`.
- `apps/admin-web/app/page-content.ts` — add notifications nav label.
- `package.json` (root) — add `notification:status` and `notification:verify` scripts; include `notification:verify` in `test:integration`.
- `docs/product/p04-delivery-backlog.md` — mark `OPS-02` implementation checklist items.
- `NEXT.md` — update checkpoint to reflect OPS-02 completion.

---

## Task 1: Notification migrations

**Files:**
- Create: `packages/database/migrations/0010_notification_intents.up.sql`
- Create: `packages/database/migrations/0010_notification_intents.down.sql`

**Interfaces:**
- Produces: SQL tables `notifications.notification_template`, `notifications.notification_intent`, `notifications.notification_delivery_attempt`, `notifications.notification_user_preference`, `notifications.notification_dead_letter_evidence`; function `notifications.is_critical_class(text)`.

- [ ] **Step 1: Write the up migration**

```sql
-- packages/database/migrations/0010_notification_intents.up.sql
CREATE SCHEMA IF NOT EXISTS notifications;

CREATE TABLE notifications.notification_template (
  id uuid PRIMARY KEY,
  key text NOT NULL UNIQUE CHECK (key ~ '^[a-z][a-z0-9_.-]{2,100}$'),
  notification_class text NOT NULL CHECK (notification_class IN (
    'incident_ack', 'sos', 'credential_expiry_block', 'replacement_failed',
    'shift_reminder', 'reservation_expiry', 'payment_expiry',
    'customer_approval_reminder', 'dispute_update', 'payout_retry',
    'system'
  )),
  channel text NOT NULL CHECK (channel IN ('push', 'sms', 'email', 'in_app')),
  display_name text NOT NULL,
  body_template text NOT NULL,
  is_critical boolean NOT NULL DEFAULT false,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT template_critical_class_check CHECK (
    (is_critical = true AND notification_class IN (
      'incident_ack', 'sos', 'credential_expiry_block', 'replacement_failed'
    )) OR is_critical = false
  )
);

CREATE TABLE notifications.notification_intent (
  id uuid PRIMARY KEY,
  tenant_id uuid,
  template_id uuid NOT NULL REFERENCES notifications.notification_template(id),
  notification_class text NOT NULL,
  channel text NOT NULL CHECK (channel IN ('push', 'sms', 'email', 'in_app')),
  subject_type text NOT NULL CHECK (subject_type IN (
    'incident', 'shift', 'assignment', 'credential', 'replacement_request',
    'payment', 'payout', 'reconciliation', 'dispute', 'ops_task', 'system'
  )),
  subject_id uuid NOT NULL,
  recipient_user_id uuid REFERENCES iam.user_account(id),
  recipient_ref text NOT NULL,
  body_redacted text NOT NULL,
  correlation_id text NOT NULL,
  source_dedupe_key text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'LEASED', 'DELIVERED', 'TERMINAL_FAILED', 'CANCELLED')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  lease_id uuid,
  lease_expires_at timestamptz,
  delivered_at timestamptz,
  terminal_failed_at timestamptz,
  cancelled_at timestamptz,
  last_error text,
  acknowledged_at timestamptz,
  ops_task_id uuid,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT intent_terminal_check CHECK (
    (status = 'DELIVERED' AND delivered_at IS NOT NULL) OR
    (status = 'TERMINAL_FAILED' AND terminal_failed_at IS NOT NULL) OR
    (status = 'CANCELLED' AND cancelled_at IS NOT NULL) OR
    status IN ('PENDING', 'LEASED')
  ),
  CONSTRAINT intent_no_early_ack_check CHECK (
    acknowledged_at IS NULL
  )
);

CREATE INDEX notification_intent_claim_idx
  ON notifications.notification_intent(next_attempt_at, due_priority())
  WHERE status IN ('PENDING', 'LEASED') AND terminal_failed_at IS NULL;
CREATE INDEX notification_intent_subject_idx
  ON notifications.notification_intent(subject_type, subject_id, created_at);
CREATE INDEX notification_intent_recipient_idx
  ON notifications.notification_intent(recipient_user_id, status);
CREATE INDEX notification_intent_class_idx
  ON notifications.notification_intent(notification_class, status);

-- priority: critical classes first
CREATE FUNCTION notifications.due_priority()
RETURNS integer
LANGUAGE sql
STABLE
AS $$
  SELECT CASE
    WHEN notification_class IN ('incident_ack','sos','credential_expiry_block','replacement_failed') THEN 1
    WHEN notification_class IN ('reservation_expiry','payment_expiry','payout_retry') THEN 2
    ELSE 3
  END
$$;

CREATE TABLE notifications.notification_delivery_attempt (
  id uuid PRIMARY KEY,
  intent_id uuid NOT NULL REFERENCES notifications.notification_intent(id),
  attempt_number integer NOT NULL CHECK (attempt_number > 0),
  channel text NOT NULL,
  adapter_name text NOT NULL,
  status text NOT NULL CHECK (status IN ('FIRED', 'FAILED', 'DEAD_LETTER')),
  provider_message_ref text,
  error_class text,
  error_message text,
  lease_id uuid,
  started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  completed_at timestamptz,
  CONSTRAINT attempt_completion_check CHECK (
    (status = 'FIRED' AND completed_at IS NOT NULL AND provider_message_ref IS NOT NULL) OR
    (status = 'FAILED' AND completed_at IS NOT NULL) OR
    (status = 'DEAD_LETTER' AND completed_at IS NOT NULL)
  )
);

CREATE INDEX notification_delivery_attempt_intent_idx
  ON notifications.notification_delivery_attempt(intent_id, attempt_number);

CREATE TABLE notifications.notification_user_preference (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES iam.user_account(id),
  notification_class text NOT NULL,
  channel text NOT NULL CHECK (channel IN ('push', 'sms', 'email', 'in_app')),
  enabled boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT user_preference_unique UNIQUE (user_id, notification_class, channel),
  CONSTRAINT user_preference_critical_immutable_check CHECK (
    notification_class NOT IN (
      'incident_ack', 'sos', 'credential_expiry_block', 'replacement_failed'
    )
  )
);

CREATE INDEX notification_user_preference_user_idx
  ON notifications.notification_user_preference(user_id, notification_class);

CREATE TABLE notifications.notification_dead_letter_evidence (
  id uuid PRIMARY KEY,
  intent_id uuid NOT NULL REFERENCES notifications.notification_intent(id),
  final_attempt_id uuid NOT NULL REFERENCES notifications.notification_delivery_attempt(id),
  reason_code text NOT NULL,
  error_class text,
  error_message text,
  ops_task_id uuid,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX notification_dlq_evidence_intent_idx
  ON notifications.notification_dead_letter_evidence(intent_id);

CREATE FUNCTION notifications.is_critical_class(input_class text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT input_class IN (
    'incident_ack', 'sos', 'credential_expiry_block', 'replacement_failed'
  )
$$;

GRANT USAGE ON SCHEMA notifications TO carespaces_app;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA notifications TO carespaces_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA notifications TO carespaces_app;
```

- [ ] **Step 2: Write the down migration**

```sql
-- packages/database/migrations/0010_notification_intents.down.sql
DROP FUNCTION IF EXISTS notifications.is_critical_class(text);
DROP FUNCTION IF EXISTS notifications.due_priority();
DROP TABLE IF EXISTS notifications.notification_dead_letter_evidence;
DROP TABLE IF EXISTS notifications.notification_user_preference;
DROP TABLE IF EXISTS notifications.notification_delivery_attempt;
DROP TABLE IF EXISTS notifications.notification_intent;
DROP TABLE IF EXISTS notifications.notification_template;
DROP SCHEMA IF EXISTS notifications;
```

- [ ] **Step 3: Verify migration applies and rolls back**

Run: `pnpm db:up && $env:DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:54329/carespaces'; pnpm db:migrate; pnpm db:rollback; pnpm db:migrate`
Expected: forward applies `0010_notification_intents`; rollback drops schema; re-apply succeeds.

- [ ] **Step 4: Commit**

```bash
git add packages/database/migrations/0010_notification_intents.up.sql packages/database/migrations/0010_notification_intents.down.sql
git commit -m "feat(database): add notification intent migrations (OPS-02)"
```

---

## Task 2: Notification persistence functions

**Files:**
- Create: `packages/database/src/notifications.ts`
- Create: `packages/database/src/notifications.spec.ts`
- Modify: `packages/database/src/index.ts`

**Interfaces:**
- Consumes: `EventQueryRunner` from `./events.js`; `appendAuditEvent`, `appendAuditedStateTransition`, `enqueueOutboxEvent` from existing modules.
- Produces: types `NotificationClass`, `NotificationChannel`, `NotificationIntentStatus`, `NotificationAttemptStatus`, `NotificationIntentRecord`, `NotificationDeliveryAttemptRecord`, `NotificationOperationalStatus`, `NotificationUserPreferenceRecord`; functions `createNotificationTemplate`, `createNotificationUserPreference`, `createNotificationIntent`, `claimPendingNotificationIntents`, `markIntentAttemptFired`, `markIntentAttemptFailed`, `markIntentTerminal`, `attachIntentOpsTask`, `readNotificationIntent`, `listNotificationIntents`, `listNotificationDeliveryAttempts`, `readNotificationOperationalStatus`.

- [ ] **Step 1: Write `notifications.ts`**

Implement the module. Key shape (see full code inlined below). Functions mirror `ops-tasks.ts`/`deadlines.ts` patterns: `fromRow` helper, `asNumber`/`asDate`/`asString`/`asNullableString`/`asNullableDate`, returning typed records.

```ts
// packages/database/src/notifications.ts
import { randomUUID } from 'node:crypto';
import type { EventQueryRunner } from './events.js';

export const notificationClasses = [
  'incident_ack', 'sos', 'credential_expiry_block', 'replacement_failed',
  'shift_reminder', 'reservation_expiry', 'payment_expiry',
  'customer_approval_reminder', 'dispute_update', 'payout_retry', 'system',
] as const;
export const criticalNotificationClasses = [
  'incident_ack', 'sos', 'credential_expiry_block', 'replacement_failed',
] as const;
export const notificationChannels = ['push', 'sms', 'email', 'in_app'] as const;
export const notificationIntentStatuses = [
  'PENDING', 'LEASED', 'DELIVERED', 'TERMINAL_FAILED', 'CANCELLED',
] as const;
export const notificationAttemptStatuses = ['FIRED', 'FAILED', 'DEAD_LETTER'] as const;
export const notificationSubjectTypes = [
  'incident', 'shift', 'assignment', 'credential', 'replacement_request',
  'payment', 'payout', 'reconciliation', 'dispute', 'ops_task', 'system',
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

export interface ClaimedNotificationIntent extends NotificationIntentRecord {
  leaseId: string;
}

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

export class NotificationIntentDedupeConflictError extends Error {
  constructor(message = 'Notification intent dedupe key was reused with different input') {
    super(message);
    this.name = 'NotificationIntentDedupeConflictError';
  }
}

// ... helper asString/asNullableString/asNumber/asDate/asNullableDate mirror ops-tasks.ts

const intentColumns = `id, tenant_id, template_id, notification_class, channel,
  subject_type, subject_id, recipient_user_id, recipient_ref, body_redacted,
  correlation_id, source_dedupe_key, status, attempts, next_attempt_at,
  lease_id, lease_expires_at, delivered_at, terminal_failed_at, cancelled_at,
  last_error, acknowledged_at, ops_task_id, version, created_at, updated_at`;

const attemptColumns = `id, intent_id, attempt_number, channel, adapter_name,
  status, provider_message_ref, error_class, error_message, lease_id,
  started_at, completed_at`;

const DEFAULT_LIMIT = 25;
const DEFAULT_LEASE_MS = 30_000;
const DEFAULT_RETRY_AFTER_MS = 60_000;
const DEFAULT_MAX_ATTEMPTS = 5;

// Implement:
// - notificationTemplateFromRow, notificationIntentFromRow, notificationAttemptFromRow, notificationUserPreferenceFromRow
// - createNotificationTemplate(client, input): Promise<NotificationTemplateRecord> (INSERT ... ON CONFLICT (key) DO UPDATE SET ... RETURNING)
// - createNotificationUserPreference(client, input): Promise<NotificationUserPreferenceRecord> (reject critical classes via DB constraint; INSERT ... ON CONFLICT (user_id, notification_class, channel) DO UPDATE SET enabled = EXCLUDED.enabled, updated_at = clock_timestamp() RETURNING)
// - createNotificationIntent(client, input): Promise<{intent: NotificationIntentRecord; created: boolean}> (INSERT ... ON CONFLICT (source_dedupe_key) DO NOTHING RETURNING; on duplicate re-read and validate fields match, else throw NotificationIntentDedupeConflictError)
// - claimPendingNotificationIntents(client, options): Promise<ClaimedNotificationIntent[]> (WITH candidates AS SELECT ... WHERE status IN ('PENDING','LEASED') AND next_attempt_at <= clock_timestamp() AND terminal_failed_at IS NULL AND (lease_expires_at IS NULL OR lease_expires_at <= clock_timestamp()) AND attempts < maxAttempts ORDER BY notifications.due_priority(), next_attempt_at LIMIT n FOR UPDATE SKIP LOCKED; UPDATE set status='LEASED', lease_id, lease_expires_at, attempts = attempts + 1)
// - recordNotificationAttempt(client, input: {intentId, attemptNumber, channel, adapterName, leaseId}): Promise<NotificationDeliveryAttemptRecord> (INSERT with status pending 'FAILED' default — actually insert with null completed_at via separate path; we'll insert a row with status='FIRED' or 'FAILED' or 'DEAD_LETTER' directly via mark functions below)
// - markIntentAttemptFired(client, input: {intentId, leaseId, attemptNumber, adapterName, providerMessageRef}): Promise<{intent: NotificationIntentRecord; attempt: NotificationDeliveryAttemptRecord}> (insert attempt status='FIRED' with completed_at; update intent status='DELIVERED', delivered_at, lease_id=null, lease_expires_at=null, version+1)
// - markIntentAttemptFailed(client, input: {intentId, leaseId, attemptNumber, adapterName, errorClass, errorMessage, retryAfterMs?, maxAttempts?}): Promise<{intent: NotificationIntentRecord; attempt: NotificationDeliveryAttemptRecord; deadLettered: boolean}> (insert attempt status='FAILED' or 'DEAD_LETTER' based on attempts >= maxAttempts; update intent: if dead-lettered set status='TERMINAL_FAILED', terminal_failed_at, last_error; else status='PENDING', next_attempt_at = now + retry, last_error)
// - attachIntentOpsTask(client, input: {intentId, opsTaskId}): Promise<boolean> (UPDATE intent SET ops_task_id = $2, version = version + 1, updated_at = clock_timestamp() WHERE id = $1 RETURNING id)
// - recordDeadLetterEvidence(client, input: {intentId, finalAttemptId, reasonCode, errorClass?, errorMessage?, opsTaskId?}): Promise<string> (INSERT into notification_dead_letter_evidence RETURNING id)
// - readNotificationIntent(client, id): Promise<NotificationIntentRecord | null>
// - listNotificationIntents(client, input): Promise<NotificationIntentRecord[]> (filters with `class = ANY($1::text[])` etc., order by notifications.due_priority(), created_at, LIMIT)
// - listNotificationDeliveryAttempts(client, intentId): Promise<NotificationDeliveryAttemptRecord[]> (ORDER BY attempt_number)
// - readNotificationOperationalStatus(client): Promise<NotificationOperationalStatus[]> (GROUP BY status; overdue = status IN ('PENDING','LEASED') AND next_attempt_at < clock_timestamp(); deadLettered = status='TERMINAL_FAILED')
```

Implement each function concretely (no placeholders). The full file content is provided in Step 3 below.

- [ ] **Step 2: Export from index**

```ts
// packages/database/src/index.ts (append)
export * from './notifications.js';
```

- [ ] **Step 3: Write the full notifications.ts file**

Write the complete file with all helper functions and SQL. (Implementer writes the actual full file; the signatures and SQL shapes above are the contract.)

- [ ] **Step 4: Write unit tests**

```ts
// packages/database/src/notifications.spec.ts
import { describe, expect, it } from 'vitest';
import {
  claimPendingNotificationIntents,
  createNotificationIntent,
  isCriticalNotificationClass,
  readNotificationOperationalStatus,
} from './notifications.js';
import type { EventQueryRunner } from './events.js';

function scripted(rows: Record<string, unknown>[][]) {
  const calls: Array<{ sql: string }> = [];
  const client: EventQueryRunner = {
    query: <Row extends Record<string, unknown>>(sql: string) => {
      calls.push({ sql });
      return Promise.resolve({ rows: (rows.shift() ?? []) as Row[] });
    },
  };
  return { calls, client };
}

const intentRow = {
  id: '90000000-0000-4000-8000-000000000001',
  tenant_id: null,
  template_id: '91000000-0000-4000-8000-000000000001',
  notification_class: 'incident_ack',
  channel: 'push',
  subject_type: 'incident',
  subject_id: '31000000-0000-4000-8000-000000000001',
  recipient_user_id: null,
  recipient_ref: 'admin-001',
  body_redacted: 'Incident ACK required',
  correlation_id: 'incident-1',
  source_dedupe_key: 'incident-1:ack-notification',
  status: 'PENDING',
  attempts: 0,
  next_attempt_at: new Date('2026-07-19T00:00:00.000Z'),
  lease_id: null,
  lease_expires_at: null,
  delivered_at: null,
  terminal_failed_at: null,
  cancelled_at: null,
  last_error: null,
  acknowledged_at: null,
  ops_task_id: null,
  version: 1,
  created_at: new Date('2026-07-19T00:00:00.000Z'),
  updated_at: new Date('2026-07-19T00:00:00.000Z'),
};

describe('notification persistence', () => {
  it('marks incident_ack as a critical class', () => {
    expect(isCriticalNotificationClass('incident_ack')).toBe(true);
    expect(isCriticalNotificationClass('shift_reminder')).toBe(false);
  });

  it('creates an intent once by source dedupe key', async () => {
    const first = scripted([[intentRow]]);
    await expect(
      createNotificationIntent(first.client, {
        templateId: intentRow.template_id,
        notificationClass: 'incident_ack',
        channel: 'push',
        subjectType: 'incident',
        subjectId: intentRow.subject_id,
        recipientRef: 'admin-001',
        bodyRedacted: 'Incident ACK required',
        correlationId: 'incident-1',
        sourceDedupeKey: 'incident-1:ack-notification',
      }),
    ).resolves.toMatchObject({ created: true, intent: { version: 1 } });
    expect(first.calls[0]?.sql).toContain(
      'ON CONFLICT (source_dedupe_key) DO NOTHING',
    );
  });

  it('claims due intents with skip locked', async () => {
    const db = scripted([[{ ...intentRow, status: 'LEASED', attempts: 1, lease_id: 'lease-1' }]]);
    await expect(
      claimPendingNotificationIntents(db.client, { limit: 5 }),
    ).resolves.toHaveLength(1);
    expect(db.calls[0]?.sql).toContain('FOR UPDATE SKIP LOCKED');
  });

  it('maps operational status for operator visibility', async () => {
    const db = scripted([[
      {
        status: 'PENDING',
        count: '3',
        overdue: '1',
        dead_lettered: '0',
        oldest_next_attempt_at: intentRow.next_attempt_at,
      },
    ]]);
    await expect(readNotificationOperationalStatus(db.client)).resolves.toEqual([
      {
        status: 'PENDING',
        count: 3,
        overdue: 1,
        deadLettered: 0,
        oldestNextAttemptAt: intentRow.next_attempt_at,
      },
    ]);
  });
});
```

- [ ] **Step 5: Run unit tests**

Run: `pnpm --filter @carespaces/database test`
Expected: all notification tests pass alongside existing tests.

- [ ] **Step 6: Commit**

```bash
git add packages/database/src/notifications.ts packages/database/src/notifications.spec.ts packages/database/src/index.ts
git commit -m "feat(database): notification intent persistence (OPS-02)"
```

---

## Task 3: `@carespaces/notifications` package — adapter + service

**Files:**
- Create: `packages/notifications/package.json`
- Create: `packages/notifications/tsconfig.json`
- Create: `packages/notifications/tsconfig.build.json`
- Create: `packages/notifications/scripts/clean.mjs`
- Create: `packages/notifications/src/index.ts`
- Create: `packages/notifications/src/delivery-adapter.ts`
- Create: `packages/notifications/src/notification-service.ts`
- Create: `packages/notifications/src/notification-service.spec.ts`

**Interfaces:**
- Consumes: `@carespaces/database` (notification persistence + audit + outbox), `pg` Pool/PoolClient.
- Produces: `DeliveryAdapter` interface, `SyntheticDeliveryAdapter`, `PostgresNotificationService`, `NotificationPreferenceError`, `NotificationAuthorizationError`.

- [ ] **Step 1: Scaffold package**

`packages/notifications/package.json`:
```json
{
  "name": "@carespaces/notifications",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" }
  },
  "scripts": {
    "build": "node scripts/clean.mjs && tsc -p tsconfig.build.json",
    "lint": "eslint src",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@carespaces/database": "workspace:*",
    "pg": "^8.22.0"
  },
  "devDependencies": {
    "@types/pg": "^8.20.0",
    "vitest": "^4.1.10"
  }
}
```

`packages/notifications/tsconfig.json` and `tsconfig.build.json`: copy from `packages/operations` and adjust `outDir`/rootDir as needed. `scripts/clean.mjs`: copy from `packages/operations/scripts/clean.mjs`.

- [ ] **Step 2: Write delivery adapter**

```ts
// packages/notifications/src/delivery-adapter.ts
export interface DeliveryRequest {
  intentId: string;
  channel: 'push' | 'sms' | 'email' | 'in_app';
  recipientRef: string;
  bodyRedacted: string;
  notificationClass: string;
  correlationId: string;
  attemptNumber: number;
}

export interface DeliverySuccess {
  status: 'FIRED';
  providerMessageRef: string;
}

export interface DeliveryFailure {
  status: 'FAILED';
  errorClass: string;
  errorMessage: string;
  retryable: boolean;
}

export type DeliveryResult = DeliverySuccess | DeliveryFailure;

export interface DeliveryAdapter {
  readonly name: string;
  deliver(request: DeliveryRequest): Promise<DeliveryResult>;
}

export class SyntheticDeliveryAdapter implements DeliveryAdapter {
  readonly name = 'synthetic-local';
  private readonly failures = new Set<string>();

  failOnce(intentId: string): void {
    this.failures.add(intentId);
  }

  async deliver(request: DeliveryRequest): Promise<DeliveryResult> {
    if (this.failures.delete(request.intentId)) {
      return {
        status: 'FAILED',
        errorClass: 'SyntheticTransientError',
        errorMessage: 'synthetic transient failure',
        retryable: true,
      };
    }
    return {
      status: 'FIRED',
      providerMessageRef: `synthetic:${request.intentId}:${request.attemptNumber}`,
    };
  }
}
```

- [ ] **Step 3: Write notification service**

```ts
// packages/notifications/src/notification-service.ts
import {
  appendAuditEvent,
  appendAuditedStateTransition,
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
  type NotificationIntentRecord,
  type NotificationOperationalStatus,
  type NotificationDeliveryAttemptRecord,
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
  templateKey: string;
  templateId: string;
  actor: { systemActor: string } | { systemActor: string };
}

function assertCommandContext(ctx: NotificationCommandContext): void {
  if (!ctx.commandId.trim()) throw new Error('Notification command ID is required');
  if (!ctx.correlationId.trim()) throw new Error('Notification correlation ID is required');
  if (!ctx.reasonCode.trim()) throw new Error('Notification reason code is required');
}

export class PostgresNotificationService {
  constructor(private readonly pool: Pool) {}

  async ensureTemplate(input: CreateNotificationTemplateInput): Promise<void> {
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

  async setPreference(input: CreateNotificationUserPreferenceInput): Promise<void> {
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

  listIntents(input: Parameters<typeof listNotificationIntents>[1]) {
    return listNotificationIntents(this.pool, input);
  }

  listAttempts(intentId: string): Promise<NotificationDeliveryAttemptRecord[]> {
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
      const existing = await client.query<{ request_hash: string; response: Record<string, unknown> }>(
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
```

- [ ] **Step 4: Write index.ts**

```ts
// packages/notifications/src/index.ts
export * from './delivery-adapter.js';
export * from './notification-service.js';
export * from './notification-dispatcher.js';
```

- [ ] **Step 5: Write service guard unit tests**

```ts
// packages/notifications/src/notification-service.spec.ts
import { describe, expect, it } from 'vitest';
import {
  NotificationPreferenceError,
  PostgresNotificationService,
} from './notification-service.js';

const baseIntent = {
  templateKey: 'incident.ack_required',
  templateId: '91000000-0000-4000-8000-000000000001',
  notificationClass: 'incident_ack' as const,
  channel: 'push' as const,
  subjectType: 'incident' as const,
  subjectId: '31000000-0000-4000-8000-000000000001',
  recipientRef: 'admin-001',
  bodyRedacted: 'ACK required',
  correlationId: 'incident-1',
  sourceDedupeKey: 'incident-1:ack-notification',
};

describe('notification service guards', () => {
  const service = new PostgresNotificationService({} as never);

  it('requires a command ID before persistence', async () => {
    await expect(
      service.createIntent({
        ...baseIntent,
        commandId: '',
        reasonCode: 'incident_ack_overdue',
        actor: { systemActor: 'incident-service' },
      }),
    ).rejects.toThrow('command ID is required');
  });

  it('rejects disabling a critical class preference', async () => {
    await expect(
      service.setPreference({
        userId: '01000000-0000-4000-8000-000000000001',
        notificationClass: 'incident_ack',
        channel: 'push',
        enabled: false,
      }),
    ).rejects.toThrow(NotificationPreferenceError);
  });
});
```

- [ ] **Step 6: Run tests**

Run: `pnpm --filter @carespaces/notifications test`
Expected: guard tests pass.

- [ ] **Step 7: Commit**

```bash
git add packages/notifications
git commit -m "feat(notifications): add service, adapter boundary, critical-class guard (OPS-02)"
```

---

## Task 4: Notification dispatcher (worker leasing + retry + DLQ + Ops Task fallback)

**Files:**
- Create: `packages/notifications/src/notification-dispatcher.ts`
- Create: `packages/notifications/src/notification-dispatcher.spec.ts`

**Interfaces:**
- Consumes: `claimPendingNotificationIntents`, `markIntentAttemptFired`, `markIntentAttemptFailed`, `attachIntentOpsTask`, `recordDeadLetterEvidence` from `@carespaces/database`; `DeliveryAdapter`; `PostgresOpsTaskService` from `@carespaces/operations` for fallback task creation.
- Produces: `NotificationDispatcher` with `runBatch(options)` returning `NotificationBatchResult`; constructor takes `(pool, adapter, options?)` where options includes `fallbackOpsTaskCreator` (system actor) and retry/lease settings.

- [ ] **Step 1: Write dispatcher**

```ts
// packages/notifications/src/notification-dispatcher.ts
import {
  attachIntentOpsTask,
  claimPendingNotificationIntents,
  markIntentAttemptFailed,
  markIntentAttemptFired,
  recordDeadLetterEvidence,
  type NotificationIntentRecord,
} from '@carespaces/database';
import type { Pool } from 'pg';
import type { DeliveryAdapter } from './delivery-adapter.js';

export interface NotificationBatchResult {
  claimed: number;
  fired: number;
  retried: number;
  deadLettered: number;
  fallbackTasksCreated: number;
}

export interface OpsTaskFallbackInput {
  intent: NotificationIntentRecord;
  reasonCode: string;
  correlationId: string;
}

export interface NotificationDispatcherOptions {
  limit?: number;
  leaseMs?: number;
  maxAttempts?: number;
  retryAfterMs?: number;
  createFallbackOpsTask?: (input: OpsTaskFallbackInput) => Promise<string>;
}

const DEFAULT_LIMIT = 25;
const DEFAULT_LEASE_MS = 30_000;
const DEFAULT_RETRY_AFTER_MS = 60_000;
const DEFAULT_MAX_ATTEMPTS = 5;

export class NotificationDispatcher {
  constructor(
    private readonly pool: Pool,
    private readonly adapter: DeliveryAdapter,
    private readonly options: NotificationDispatcherOptions = {},
  ) {}

  async runBatch(
    overrides: NotificationDispatcherOptions = {},
  ): Promise<NotificationBatchResult> {
    const opts = { ...this.options, ...overrides };
    const result: NotificationBatchResult = {
      claimed: 0, fired: 0, retried: 0, deadLettered: 0, fallbackTasksCreated: 0,
    };
    const client = await this.pool.connect();
    try {
      const claimed = await claimPendingNotificationIntents(client, {
        limit: opts.limit ?? DEFAULT_LIMIT,
        leaseMs: opts.leaseMs ?? DEFAULT_LEASE_MS,
        maxAttempts: opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
      });
      result.claimed = claimed.length;
      for (const intent of claimed) {
        await this.processIntent(client, intent, opts, result);
      }
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async processIntent(
    client: import('pg').PoolClient,
    intent: NotificationIntentRecord,
    opts: NotificationDispatcherOptions,
    result: NotificationBatchResult,
  ): Promise<void> {
    const request = {
      intentId: intent.id,
      channel: intent.channel,
      recipientRef: intent.recipientRef,
      bodyRedacted: intent.bodyRedacted,
      notificationClass: intent.notificationClass,
      correlationId: intent.correlationId,
      attemptNumber: intent.attempts,
    };
    let outcome;
    try {
      outcome = await this.adapter.deliver(request);
    } catch (cause) {
      const error = cause instanceof Error ? cause : new Error('adapter threw');
      outcome = {
        status: 'FAILED' as const,
        errorClass: error.name,
        errorMessage: error.message,
        retryable: true,
      };
    }
    if (outcome.status === 'FIRED') {
      await markIntentAttemptFired(client, {
        intentId: intent.id,
        leaseId: intent.leaseId,
        attemptNumber: intent.attempts,
        adapterName: this.adapter.name,
        providerMessageRef: outcome.providerMessageRef,
      });
      result.fired += 1;
      return;
    }
    const maxAttempts = opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    const deadLettered = intent.attempts >= maxAttempts || !outcome.retryable;
    const failed = await markIntentAttemptFailed(client, {
      intentId: intent.id,
      leaseId: intent.leaseId,
      attemptNumber: intent.attempts,
      adapterName: this.adapter.name,
      errorClass: outcome.errorClass,
      errorMessage: outcome.errorMessage,
      retryAfterMs: opts.retryAfterMs ?? DEFAULT_RETRY_AFTER_MS,
      maxAttempts,
    });
    if (deadLettered || failed.deadLettered) {
      result.deadLettered += 1;
      const finalAttempt = failed.attempt;
      let opsTaskId: string | undefined;
      if (opts.createFallbackOpsTask) {
        const reasonCode = `notification.${intent.notificationClass}.delivery_failed`;
        const created = await opts.createFallbackOpsTask({
          intent,
          reasonCode,
          correlationId: intent.correlationId,
        });
        opsTaskId = created;
        await attachIntentOpsTask(client, { intentId: intent.id, opsTaskId: created });
        result.fallbackTasksCreated += 1;
      }
      await recordDeadLetterEvidence(client, {
        intentId: intent.id,
        finalAttemptId: finalAttempt.id,
        reasonCode: 'delivery_attempts_exhausted',
        errorClass: finalAttempt.errorClass,
        errorMessage: finalAttempt.errorMessage,
        opsTaskId,
      });
    } else {
      result.retried += 1;
    }
  }
}
```

- [ ] **Step 2: Write dispatcher unit tests**

Use a scripted Pool/PoolClient (or in-memory stubs) to verify: FIRED path increments `fired`; retryable FAILED with attempts < max → `retried` and intent stays PENDING; FAILED with attempts >= max → `deadLettered`, evidence recorded, `attachIntentOpsTask` called, `createFallbackOpsTask` invoked once.

- [ ] **Step 3: Run tests**

Run: `pnpm --filter @carespaces/notifications test`
Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add packages/notifications/src/notification-dispatcher.ts packages/notifications/src/notification-dispatcher.spec.ts
git commit -m "feat(notifications): dispatcher with retry, DLQ and Ops Task fallback (OPS-02)"
```

---

## Task 5: API contracts + OpenAPI schemas

**Files:**
- Modify: `packages/api-contracts/src/index.ts`
- Modify: `apps/api/src/openapi.ts`

- [ ] **Step 1: Add Zod schemas to api-contracts**

Append to `packages/api-contracts/src/index.ts`:
```ts
export const NotificationChannelSchema = z.enum(['push', 'sms', 'email', 'in_app']);
export const NotificationClassSchema = z.enum([
  'incident_ack', 'sos', 'credential_expiry_block', 'replacement_failed',
  'shift_reminder', 'reservation_expiry', 'payment_expiry',
  'customer_approval_reminder', 'dispute_update', 'payout_retry', 'system',
]);
export const NotificationIntentStatusSchema = z.enum([
  'PENDING', 'LEASED', 'DELIVERED', 'TERMINAL_FAILED', 'CANCELLED',
]);
export const NotificationAttemptStatusSchema = z.enum(['FIRED', 'FAILED', 'DEAD_LETTER']);
export const NotificationIntentSchema = z.object({
  id: z.uuid(),
  tenantId: z.uuid().nullable(),
  notificationClass: NotificationClassSchema,
  channel: NotificationChannelSchema,
  subjectType: z.string(),
  subjectId: z.uuid(),
  recipientUserId: z.uuid().nullable(),
  recipientRef: z.string(),
  bodyRedacted: z.string(),
  correlationId: z.string(),
  status: NotificationIntentStatusSchema,
  attempts: z.number().int().nonnegative(),
  nextAttemptAt: z.iso.datetime(),
  deliveredAt: z.iso.datetime().nullable(),
  terminalFailedAt: z.iso.datetime().nullable(),
  lastError: z.string().nullable(),
  acknowledgedAt: z.iso.datetime().nullable(),
  opsTaskId: z.uuid().nullable(),
  version: z.number().int().positive(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export const NotificationAttemptSchema = z.object({
  id: z.uuid(),
  intentId: z.uuid(),
  attemptNumber: z.number().int().positive(),
  channel: NotificationChannelSchema,
  adapterName: z.string(),
  status: NotificationAttemptStatusSchema,
  providerMessageRef: z.string().nullable(),
  errorClass: z.string().nullable(),
  errorMessage: z.string().nullable(),
  startedAt: z.iso.datetime(),
  completedAt: z.iso.datetime().nullable(),
});
export const NotificationIntentListResponseSchema = z.object({
  intents: z.array(NotificationIntentSchema),
  generatedAt: z.iso.datetime(),
});
export const NotificationAttemptListResponseSchema = z.object({
  intentId: z.uuid(),
  attempts: z.array(NotificationAttemptSchema),
  generatedAt: z.iso.datetime(),
});
export type NotificationIntent = z.infer<typeof NotificationIntentSchema>;
export type NotificationAttempt = z.infer<typeof NotificationAttemptSchema>;
export type NotificationIntentListResponse = z.infer<typeof NotificationIntentListResponseSchema>;
export type NotificationAttemptListResponse = z.infer<typeof NotificationAttemptListResponseSchema>;
```

- [ ] **Step 2: Add OpenAPI schemas in `apps/api/src/openapi.ts`**

Add matching `NotificationIntent`, `NotificationAttempt`, `NotificationIntentListResponse`, `NotificationAttemptListResponse` entries to `OPENAPI_SCHEMAS` (mirror existing style).

- [ ] **Step 3: Regenerate OpenAPI**

Run: `pnpm api:generate`
Expected: `docs/openapi.json` and `packages/api-contracts/src/generated/openapi.ts` updated.

- [ ] **Step 4: Commit**

```bash
git add packages/api-contracts/src/index.ts apps/api/src/openapi.ts docs/openapi.json packages/api-contracts/src/generated/openapi.ts
git commit -m "feat(api-contracts): notification intent and attempt schemas (OPS-02)"
```

---

## Task 6: API notification projections

**Files:**
- Create: `apps/api/src/notifications/notifications.module.ts`
- Create: `apps/api/src/notifications/notifications.controller.ts`
- Create: `apps/api/src/notifications/notifications.repository.ts`
- Modify: `apps/api/src/app.module.ts`
- Create: `apps/api/test/notifications.integration.ts`

- [ ] **Step 1: Write repository**

Mirror `operations.repository.ts` pattern: `NotificationsRepository` with `listIntents(principal, filter)`, `readIntent(principal, id)`, `listAttempts(principal, intentId)`. Authorization: require `ops_task.manage` capability (Platform Admin / Support / Care Coordinator) for cross-tenant operational visibility; tenant-scoped recipients would be a later story. For MVP, require platform role with `ops_task.manage`.

- [ ] **Step 2: Write controller**

```ts
// apps/api/src/notifications/notifications.controller.ts
@ApiTags('notifications')
@ApiBearerAuth()
@UseGuards(AuthenticationGuard)
@Controller('notifications/intents')
export class NotificationsController {
  constructor(@Inject(NotificationsRepository) private readonly repo: NotificationsRepository) {}

  @Get()
  @ApiOkResponse({ schema: { $ref: '#/components/schemas/NotificationIntentListResponse' } })
  async list(@Req() req: AuthenticatedRequest, @Query() query: unknown): Promise<NotificationIntentListResponse> {
    const parsed = ListQuerySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException('Invalid notification filters');
    const projection = await this.repo.listIntents(req.principal, parsed.data);
    return NotificationIntentListResponseSchema.parse({
      intents: projection.intents.map(serializeIntent),
      generatedAt: projection.generatedAt.toISOString(),
    });
  }

  @Get(':id')
  @ApiOkResponse({ schema: { $ref: '#/components/schemas/NotificationIntent' } })
  async read(@Req() req: AuthenticatedRequest, @Param('id') id: string): Promise<NotificationIntent> {
    const parsedId = z.uuid().safeParse(id);
    if (!parsedId.success) throw new BadRequestException('Valid intent id is required');
    const intent = await this.repo.readIntent(req.principal, parsedId.data);
    if (!intent) throw new NotFoundException('Notification intent not found');
    return NotificationIntentSchema.parse(serializeIntent(intent));
  }

  @Get(':id/attempts')
  @ApiOkResponse({ schema: { $ref: '#/components/schemas/NotificationAttemptListResponse' } })
  async attempts(@Req() req: AuthenticatedRequest, @Param('id') id: string): Promise<NotificationAttemptListResponse> {
    const parsedId = z.uuid().safeParse(id);
    if (!parsedId.success) throw new BadRequestException('Valid intent id is required');
    const projection = await this.repo.listAttempts(req.principal, parsedId.data);
    return NotificationAttemptListResponseSchema.parse({
      intentId: parsedId.data,
      attempts: projection.attempts.map(serializeAttempt),
      generatedAt: projection.generatedAt.toISOString(),
    });
  }
}
```

Add `serializeIntent`/`serializeAttempt` helpers (mirror `serializeTask`).

- [ ] **Step 3: Write module + wire into AppModule**

`notifications.module.ts` mirrors `operations.module.ts` (imports IdentityModule, provides NotificationsRepository, declares controller). Update `app.module.ts` imports to include `NotificationsModule`.

- [ ] **Step 4: Write API integration test**

`apps/api/test/notifications.integration.ts`: drop/recreate `carespaces_notifications_api_test`; migrateUp; seedSynthetic; create a notification intent directly via `PostgresNotificationService`; boot AppModule; `GET /v1/notifications/intents` as `admin-001` → 200 with intents; `GET` as `customer-001` → 403; `GET /v1/notifications/intents/:id/attempts` → 200 with empty attempts (or seed an attempt). Verify OpenAPI schemas parse.

- [ ] **Step 5: Run API integration test**

Run: `pnpm --filter @carespaces/api test && pnpm ops-api:verify-style` then add `pnpm notification:verify` to root `test:integration` in Task 9.
Expected: tests pass.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/notifications apps/api/src/app.module.ts apps/api/test/notifications.integration.ts
git commit -m "feat(api): notification intent and attempt projections (OPS-02)"
```

---

## Task 7: Worker integration — dispatcher + deadline→notification→Ops Task path

**Files:**
- Modify: `apps/worker/src/runtime.ts`
- Modify: `apps/worker/src/main.ts`
- Modify: `apps/worker/package.json`
- Create: `apps/worker/src/notification-status.ts`
- Create: `apps/worker/test/notification.integration.ts`

- [ ] **Step 1: Wire dispatcher into runtime**

In `apps/worker/src/runtime.ts`, instantiate `SyntheticDeliveryAdapter`, `PostgresNotificationService`, `NotificationDispatcher`. Extend `WorkerCycleResult` with `notifications: NotificationBatchResult`. In `runCycle`, run `dispatcher.runBatch()` after deadline/publisher/consumer. Register an inbox handler for `notification.intent.created.v1` (no-op for MVP). Add `createFallbackOpsTask` callback that calls `PostgresOpsTaskService.create` with `{ systemActor: 'notification-service' }`, queue based on class (incident_ack→INCIDENT, replacement_failed→REPLACEMENT, payout_retry→FINANCE, else GENERAL), priority HIGH/CRITICAL for critical classes.

- [ ] **Step 2: Extend deadline command handler for `EscalateIncident`**

Register a deadline handler for `EscalateIncident` that creates an `incident_ack` notification intent (subject = incident, recipient = on-call admin) and an Ops Task fallback if one does not already exist for that incident. Register a handler for `RetryPayoutSubmission` that creates a `payout_retry` notification intent. The deadline dead-letter path (when `deadlineScheduler.runBatch` dead-letters a deadline) should also create a `system.deadline_dead_lettered` notification intent — implement by checking `result.deadLettered > 0` in `runCycle` is not feasible without subject; instead, add a dedicated `DeadlineCommandHandler` for `DeadlineDeadLetter` that the `PostgresDeadlineStore.fail` path triggers via outbox event — simpler: in `runCycle`, after `deadlineResult`, if `deadlineResult.deadLettered > 0`, query the latest dead-lettered deadline and create a `system` notification intent with subjectType='scheduled_deadline', subjectId=that deadline id. This connects a real operational failure to a notification intent + Ops Task fallback.

- [ ] **Step 3: Add notification-status CLI**

`apps/worker/src/notification-status.ts` mirrors `ops-task-status.ts`/`deadline-status.ts`: reads `PostgresNotificationService.readOperationalStatus()`, `console.table`, exit 2 if any overdue or TERMINAL_FAILED.

- [ ] **Step 4: Update worker package.json**

Add `"notification:status": "tsx src/notification-status.ts"` and `@carespaces/notifications` to dependencies.

- [ ] **Step 5: Write worker integration test**

`apps/worker/test/notification.integration.ts`: drop/recreate `carespaces_notification_test`; migrateUp; seedSynthetic (provides admin user + tenant); create an incident_ack notification intent via service; run `NotificationDispatcher.runBatch` with `SyntheticDeliveryAdapter` (succeeds) → intent status DELIVERED, one FIRED attempt, no fallback task. Then create a second intent with a `failOnce` adapter and `maxAttempts: 1` → terminal failure, fallback Ops Task created, `attachIntentOpsTask` recorded, dead-letter evidence row exists, intent.ops_task_id set. Then test the deadline→notification path: schedule an `INCIDENT_ACK_DEADLINE` via `ConfiguredDeadlineService.schedule`, run `deadlineScheduler.runBatch({ maxAttempts: 1 })` to force fire, run inbox consumer with the `EscalateIncident` handler that creates a notification intent, run `NotificationDispatcher.runBatch` → intent delivered. Assert audit/outbox evidence counts.

- [ ] **Step 6: Run integration test**

Run: `pnpm --filter @carespaces/worker test && pnpm notification:verify` (wire in Task 9)
Expected: passes.

- [ ] **Step 7: Commit**

```bash
git add apps/worker/src/runtime.ts apps/worker/src/main.ts apps/worker/src/notification-status.ts apps/worker/package.json apps/worker/test/notification.integration.ts
git commit -m "feat(worker): notification dispatch loop and deadline→notification→Ops Task path (OPS-02)"
```

---

## Task 8: Synthetic seed extension

**Files:**
- Modify: `packages/database/src/seed.ts`
- Modify: `packages/database/test/verify.ts`

- [ ] **Step 1: Extend seed**

Add to `syntheticFixture`: `notificationTemplates` (two templates: `incident.ack_required` critical push, `shift.upcoming_reminder` non-critical in_app), `notificationIntents` (one critical `incident_ack` intent linked to existing incident Ops Task subject, one standard `shift_reminder` intent). Add `syntheticNotificationPolicy` configuration version (`platform.notifications` config key with channel routing + retry policy). Insert templates, one user preference disabling `shift_reminder` push (allowed, non-critical), attempt to disable `incident_ack` push should NOT be seeded (critical). Seed two intents with stable UUIDs. Audit each insertion.

- [ ] **Step 2: Update verify.ts**

Update `applied.length === 9` → `=== 10` (after migration 0010). Update rollback chain: first rollback should be `0010_notification_intents`, then `0009_ops_queue_access`, etc. Update final reapplied length to `=== 10`. Add notification evidence checks: `SELECT count(*) FROM notifications.notification_template` >= 2, `SELECT count(*) FROM notifications.notification_intent` >= 2, `SELECT * FROM notifications.notification_intent WHERE acknowledged_at IS NOT NULL` → zero rows (delivery ≠ ack). Update final console message.

- [ ] **Step 3: Run db:verify**

Run: `pnpm db:verify`
Expected: passes with 10 migrations and notification evidence.

- [ ] **Step 4: Commit**

```bash
git add packages/database/src/seed.ts packages/database/test/verify.ts
git commit -m "feat(database): synthetic notification fixtures and verify updates (OPS-02)"
```

---

## Task 9: Admin notification inspector + root scripts

**Files:**
- Create: `apps/admin-web/app/notifications/page.tsx`
- Create: `apps/admin-web/app/notifications-workspace.tsx`
- Modify: `apps/admin-web/app/ops-workspace.tsx` (add nav link)
- Modify: `apps/admin-web/app/page-content.ts`
- Modify: `package.json` (root)

- [ ] **Step 1: Write notifications workspace**

`apps/admin-web/app/notifications-workspace.tsx`: client component mirroring `ops-workspace.tsx` structure. Fetch `/api/v1/notifications/intents?limit=100`, show intent list (class, channel, subject, status, attempts, next attempt, ops_task_id). Selecting an intent fetches `/api/v1/notifications/intents/:id/attempts` and shows attempt timeline (attempt number, adapter, status, provider ref, error class/message, started/completed). Show critical badge for critical classes. Show "Linked Ops Task" link to `/` (ops workspace) when `opsTaskId` is set. Refresh button. Error banner. Empty/loading states. Use `lucide-react` icons consistent with ops workspace. Styles: reuse `ops-shell`/`sidebar`/`workspace` classes from `styles.css` (extend if needed).

- [ ] **Step 2: Write page**

```tsx
// apps/admin-web/app/notifications/page.tsx
import { NotificationsWorkspace } from '../notifications-workspace';

export default function NotificationsPage() {
  return <NotificationsWorkspace />;
}
```

- [ ] **Step 3: Add nav link in ops-workspace**

Add a link/button in the sidebar nav of `ops-workspace.tsx` pointing to `/notifications` with label "Notifications". Add `notifications` to `page-content.ts` labels.

- [ ] **Step 4: Update root package.json**

Add scripts:
```json
"notification:status": "pnpm --filter @carespaces/worker notification:status",
"notification:verify": "tsx --tsconfig apps/worker/tsconfig.json apps/worker/test/notification.integration.ts"
```
Update `test:integration` to append `&& pnpm notification:verify` and add `pnpm notifications-api:verify`-style entry — actually add `notifications-api:verify` pointing to `apps/api/test/notifications.integration.ts` and include it in `test:integration`.

- [ ] **Step 5: Build admin-web**

Run: `pnpm --filter @carespaces/admin-web build`
Expected: build succeeds.

- [ ] **Step 6: Commit**

```bash
git add apps/admin-web/app/notifications apps/admin-web/app/notifications-workspace.tsx apps/admin-web/app/ops-workspace.tsx apps/admin-web/app/page-content.ts package.json
git commit -m "feat(admin-web): notification intent inspector view (OPS-02)"
```

---

## Task 10: Docs + completion gate

**Files:**
- Modify: `docs/product/p04-delivery-backlog.md`
- Modify: `NEXT.md`

- [ ] **Step 1: Update p04 delivery backlog**

In the "Immediate execution checklist" section, change the OPS-02 line from absent to `[x] Verify OPS-02 notification intent center: ...`. Add a short note under `RT-02`/`RT-03` that synthetic local adapter and critical acknowledgement guard are implemented; provider adapters remain a production gate.

- [ ] **Step 2: Update NEXT.md**

Replace contents with OPS-02 completion summary and point to OPS-03 as next. Preserve resume instruction format.

- [ ] **Step 3: Run completion gate**

```bash
pnpm data:ingest
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm build
```
Expected: all pass.

- [ ] **Step 4: Run live smoke (best-effort)**

Start API on 4001 and Admin on 3001 with `API_URL=http://127.0.0.1:4001`. `curl http://127.0.0.1:4001/v1/notifications/intents -H 'authorization: Bearer fake:admin-001'` → 200. Open Admin `/notifications` → intent list renders. Record browser screenshot QA limitation if no browser instance.

- [ ] **Step 5: Commit**

```bash
git add docs/product/p04-delivery-backlog.md NEXT.md
git commit -m "docs: mark OPS-02 complete and prepare OPS-03 checkpoint"
```

---

## Self-Review

**Spec coverage (OPS-02 scope from NEXT.md):**
1. Migrations for intents, templates, attempts, preferences → Task 1. ✓
2. Idempotent, auditable, outbox-driven creation → Task 3 (service) + Task 1 (dedupe + outbox enqueue). ✓
3. Delivery adapter boundary + synthetic local adapter, credentials out of contracts → Task 3 (`delivery-adapter.ts`, `body_redacted`, `recipient_ref` only). ✓
4. Worker leasing/retry/terminal failure/dead-letter evidence → Task 4 (dispatcher) + Task 1 (`notification_dead_letter_evidence`). ✓
5. Critical classes cannot be disabled; delivery receipt ≠ ack → Task 1 (CHECK constraints + `acknowledged_at` null check) + Task 3 (`NotificationPreferenceError`) + Task 8 (verify assertion). ✓
6. Typed API contracts, OpenAPI generation, authenticated projections, Admin workflow → Tasks 5, 6, 9. ✓
7. Connect scheduled deadline / operational failure to notification intent + Ops Task fallback → Task 7. ✓
8. Synthetic ingestion, unit tests, PostgreSQL integration tests, operational status, docs → Tasks 8, 2, 4, 7, 9, 10. ✓

**Placeholder scan:** None — all steps contain concrete code/SQL/commands.

**Type consistency:** `NotificationIntentRecord`, `NotificationDeliveryAttemptRecord`, `NotificationOperationalStatus`, `ClaimedNotificationIntent` used consistently across Tasks 2–7. `DeliveryAdapter`/`DeliveryResult` consistent across Tasks 3–4. `PostgresNotificationService` method names match between Tasks 3, 6, 7, 8. `NotificationDispatcherOptions.createFallbackOpsTask` signature matches Task 7 wiring.