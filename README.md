# Carespaces

Backend and web foundation for the Carespaces MVP.

## Applications

- `apps/api` — NestJS REST API under `/v1`
- `apps/customer-web` — customer-facing Next.js application
- `apps/admin-web` — admin and Care Ops Next.js application

The provider mobile application is intentionally excluded from this foundation.

## Shared packages

- `packages/api-contracts` — generated OpenAPI types plus shared response schemas/client helpers
- `packages/authz` — deny-by-default authorization policy helpers
- `packages/database` — migration runner, schema ownership conventions and database verification
- `packages/testing` — deterministic fixtures, fake adapters, clock and UUID helpers

## Requirements

- Node.js 22 or newer
- pnpm 10.32.1

## Commands

```bash
pnpm install
pnpm dev
pnpm api:generate
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm build
```

The API starts on port `4000`, customer web on `3000`, and admin web on `3001`.
Swagger UI is available at `http://localhost:4000/docs`. `pnpm api:generate` writes the committed
OpenAPI document and regenerates the typed `@carespaces/api-contracts` client used by web clients.

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
and exercise the IAM walking skeleton against PostgreSQL. CI runs both suites.
