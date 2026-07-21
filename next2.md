# Work Session Checkpoint — OPS-03

Updated: 2026-07-21

## Resume instruction

When the user says `ทำต่อไป`, `go`, `continue`, or an equivalent short instruction, continue with
`OPS-03` below. Do not ask what to work on unless repository state conflicts with this checkpoint.

## Current state (OPS-02 complete and committed)

- `OPS-01` unified Ops Task workflow is implemented and committed.
- `OPS-02` Notification Intent Center is implemented and committed:
  - Migration `0010_notification_intents` (reviewed forward/down) adds `notifications` schema with
    `notification_template`, `notification_intent`, `notification_delivery_attempt`,
    `notification_user_preference`, and `notification_dead_letter_evidence`, plus
    `notifications.due_priority(text)` and `notifications.is_critical_class(text)` helpers.
  - Intent creation is idempotent (source dedupe key), auditable (`platform.audit_event`), and
    outbox-driven (`notification.intent.created.v1`).
  - `@carespaces/notifications` package defines a `DeliveryAdapter` boundary with a
    `SyntheticDeliveryAdapter`; provider-specific credentials/payloads are excluded from persisted
    contracts (only `recipient_ref`, `body_redacted`, `provider_message_ref`).
  - `NotificationDispatcher` implements lease-based claiming (`FOR UPDATE SKIP LOCKED`), retry,
    terminal failure, and dead-letter evidence. Terminal failures create an Ops Task fallback via
    `attachIntentOpsTask` + `notification_dead_letter_evidence`.
  - Critical notification classes (`incident_ack`, `sos`, `credential_expiry_block`,
    `replacement_failed`) cannot be disabled — enforced in DB CHECK and in
    `NotificationPreferenceError`. `acknowledged_at` is null on every intent and attempt
    (delivery receipt never equals acknowledgement).
  - Typed API contracts and OpenAPI schemas are generated for `/v1/notifications/intents`,
    `/v1/notifications/intents/{id}`, and `/v1/notifications/intents/{id}/attempts`.
  - Admin workspace exposes `/notifications` (intent list + attempt timeline + Ops Task fallback
    link) with critical-class badges and overdue/terminal-failure states.
  - Scheduled deadline `EscalateIncident` and deadline dead-letter path are connected to real
    notification intents with an Ops Task fallback (`incident.ack_overdue`).
  - Synthetic ingestion seeds two notification templates, a non-critical user preference,
    two notification intents, and a `platform.notifications` configuration version.
  - Operational status CLI: `pnpm notification:status` (exits 2 when overdue or terminal-failed).
- `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build` passed.
- `pnpm data:ingest` and `pnpm test:integration` were NOT run in the OPS-02 session because Docker
  Desktop / PostgreSQL was unavailable (daemon not running; could not start without an interactive
  desktop launch). Integration tests are written and wired into `test:integration`
  (`notification:verify`, `notifications-api:verify`, and updated `db:verify` migration count +
  notification evidence checks). Run them once Postgres is available before marking OPS-02 fully
  verified. Live API/Admin proxy smoke and browser screenshot QA were not run for the same reason;
  limitation recorded.

## Pre-flight for tomorrow

Before starting `OPS-03`:

1. Start Docker Desktop and verify Postgres is reachable:
   ```bash
   docker compose -f infrastructure/database/compose.yaml up -d --wait
   ```
2. Run the deferred OPS-02 integration gate and fix any failures before opening OPS-03 work:
   ```bash
   pnpm data:ingest
   pnpm test:integration
   ```
   Specifically: `pnpm db:verify` (now expects 10 migrations + notification evidence),
   `pnpm notification:verify`, and `pnpm notifications-api:verify`.
3. If the integration gate passes, optionally run a live smoke: API on `4001`, Admin on `3001`
   with `API_URL=http://127.0.0.1:4001`, then `curl /v1/notifications/intents` and open
   `/notifications` in Admin. Use browser screenshot QA when a browser instance is available;
   otherwise record the limitation explicitly.

## Next objective

Implement `OPS-03` Manual Override Framework as the next vertical slice.

Start by reading:

1. `docs/product/p04-delivery-backlog.md`, especially `OPS-03` and `IAM-07`.
2. Existing audit (`packages/database/src/audit.ts`), state-transition
   (`appendAuditedStateTransition`), idempotency (`platform.idempotency_record` +
   `pg_advisory_xact_lock`), Ops Task (`packages/operations`), and Ops API
   (`apps/api/src/operations`) patterns.
3. The current git diff so `OPS-03` extends `OPS-02` without discarding it.

## OPS-03 scope

1. Add reviewed forward/down migrations for manual override actions: capability allowlist per
   role + resource, expected state/version, reason/ticket/expiry, step-up and maker-checker where
   required.
2. Make override execution idempotent, auditable (`appendAuditedStateTransition`), and
   outbox-driven (new `manual_override.*.v1` event types).
3. Enforce a capability allowlist per role + resource; deny by default; record
   actor/reason/ticket/correlation id.
4. Require step-up MFA / privileged session for sensitive overrides and maker-checker for
   financial/clinical state changes (reuse `privilegedSession` + `mfaVerified` from
   `IdentityPrincipal`; add a second approver for maker-checker).
5. Connect at least one real operational override (e.g. force-resolve an Ops Task, reopen a
   dispute, manually trigger a payout retry) to the framework with audit and notification
   evidence — reuse `@carespaces/notifications` to notify the affected party / on-call admin.
6. Add typed API contracts, OpenAPI generation, authenticated API projections, and a focused
   Admin override workflow (request / approve / execute / audit trail view).
7. Extend synthetic ingestion, unit tests, PostgreSQL integration tests, operational status
   output, and product documentation.

## Completion gate

Before marking `OPS-03` complete:

```bash
pnpm data:ingest
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm build
```

Also run live API/Admin proxy smoke checks. Use browser screenshot QA when a browser instance is
available; otherwise record that limitation explicitly.

After `OPS-03`, continue with `OPS-04` Operations dashboards/alerts unless a newer checkpoint
replaces this file.