# Carespaces

Backend and web foundation for the Carespaces MVP.

## Applications

- `apps/api` — NestJS REST API under `/v1`
- `apps/customer-web` — customer-facing Next.js application
- `apps/admin-web` — admin and Care Ops Next.js application
- `apps/worker` — inbox/outbox publisher and consumer runtime

The provider mobile application is intentionally excluded from this foundation.

## Shared packages

- `packages/api-contracts` — generated OpenAPI types plus shared response schemas/client helpers
- `packages/authz` — deny-by-default authorization policy helpers
- `packages/database` — migration runner, schema ownership conventions and database verification
- `packages/eventing` — event envelope, queue boundary and reliable worker orchestration
- `packages/testing` — deterministic fixtures, fake adapters, clock and UUID helpers

## Requirements

- Node.js 22 or newer
- pnpm 10.32.1

## Commands

```bash
pnpm install
pnpm dev:all
pnpm api:generate
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm build
```

The API starts on port `4000`, customer web on `3000`, and admin web on `3001`.
Swagger UI is available at `http://127.0.0.1:4000/docs`. `pnpm api:generate` writes the committed
OpenAPI document and regenerates the typed `@carespaces/api-contracts` client used by web clients.

`pnpm dev:all` starts PostgreSQL, applies migrations, ingests idempotent synthetic fixtures, and then
starts every application against the isolated `carespaces_development` database. Use
`pnpm data:ingest` when only the local database fixtures need a refresh. Existing databases and Docker
volumes are not reset. The local fake identities are `fake:customer-001`, `fake:provider-001`, and
`fake:admin-001`. The customer fixture belongs to tenant
`02000000-0000-4000-8000-000000000001` as `FAMILY_OWNER`.

## Local event worker

The local worker publishes outbox rows to an in-memory queue, persists deliveries to the inbox before
acknowledging them, and applies registered handlers after inbox deduplication. Retry exhaustion and
manual replay are audited without event payloads. Verify the complete PostgreSQL flow with:

```bash
pnpm event:verify
pnpm event:replay inbox <event-uuid> <reason-code> <correlation-id>
```

The in-memory queue is a development adapter. A durable queue adapter and provider failure drills are
required before production deployment.

## Scheduled deadlines

The deadline scheduler creates and cancels records idempotently, claims due work with leases, and
atomically emits `deadline.command-due.v1` through the outbox. Domain handlers receive the deadline ID
as their idempotency key and must reload current state/version before applying a side effect. Stale
deadlines complete as an audited no-op.

```bash
pnpm deadline:verify
pnpm deadline:status
```

`deadline:status` displays counts, overdue work, oldest due time, and dead-letter state. It exits with
code `2` when operator action is required.

## Versioned configuration

Service configuration is stored as immutable versioned snapshots with canonical hashes, audited
draft/approval/activation transitions, four-eyes approval for staging and production, and rollback to
a retired version. Deadline creation resolves its command and duration from the active
`platform.deadlines` snapshot for the current environment.

```bash
pnpm config:verify
pnpm config:status
```

`config:status` shows configuration versions for `CONFIGURATION_ENVIRONMENT` (development by
default) and exits with code `2` when no active deadline policy exists. Configuration values must not
contain secrets; deployed secrets remain the responsibility of the platform secret store.

## Ops Task core

Feature modules create deduplicated Ops Tasks without depending on an Admin UI. Human claim,
reassignment, escalation, and resolution use expected versions and command IDs; applied changes write
the task, audit/state transition, and `ops_task.*.v1` outbox event atomically. Human actions require
`ops_task.manage` plus the existing privileged-session and MFA checks.

```bash
pnpm ops-task:verify
pnpm ops-task:status
```

`ops-task:status` displays queue/status counts, overdue and unowned work, escalation level, and oldest
due time. It exits with code `2` when operator action is required.

## Product documentation

- [`docs/product/idea.md`](docs/product/idea.md) — product concept
- [`docs/product/p01-design.md`](docs/product/p01-design.md) — technology and architecture design
- [`docs/product/p02-mvp-spec.md`](docs/product/p02-mvp-spec.md) — MVP product and functional specification
- [`docs/product/p03-domain-model.md`](docs/product/p03-domain-model.md) — domain model, state machines and permissions
- [`docs/product/p04-delivery-backlog.md`](docs/product/p04-delivery-backlog.md) — delivery backlog and vertical slices
- [`docs/adr`](docs/adr) — architecture decision records
- [`docs/validation`](docs/validation) — validation gates and GitHub tracking
- [`docs/openapi.json`](docs/openapi.json) — generated OpenAPI document

## Local database

```bash
pnpm db:up
pnpm db:migrate
$env:ALLOW_SYNTHETIC_SEED='true'; pnpm db:seed
pnpm db:status
pnpm db:verify
pnpm iam:verify
pnpm db:down
```

Database migrations and schemas live in `packages/database`. Seed data is synthetic and is blocked
for production or non-loopback database hosts.

`pnpm test` runs the fast package test suites without requiring PostgreSQL. Start the local database
with `pnpm db:up`, then run `pnpm test:integration` to rehearse migrations and rollback, verify RLS,
exercise the IAM walking skeleton and event worker against PostgreSQL. CI runs both suites.
