# Database package

Backend-only Drizzle schemas, PostgreSQL migration tooling and synthetic development fixtures.

## Schema ownership

- `iam` — user identity mapping, tenants, memberships and role assignments
- `platform` — migration ledger, append-only audit events and transactional outbox
- `platform.scheduled_deadline` — idempotent durable timers with lease, retry and dead-letter state
- `platform.configuration_version` — hashed environment-scoped configuration snapshots and lifecycle state
- `operations.ops_task` — deduplicated queue work with optimistic ownership, escalation and resolution
- Future domain modules own their own PostgreSQL schemas and may reference another schema only through reviewed foreign keys or stable IDs.

Client applications must consume API contracts and must not import this package or inferred database row types.

## Migration rules

- Add matching `NNNN_name.up.sql` and `NNNN_name.down.sql` files.
- Never edit an applied migration; the runner validates SHA-256 checksums.
- Migrations run inside transactions while holding a PostgreSQL advisory lock.
- Production rollback is a reviewed operational decision. Rehearse down/reapply or restore in a disposable database before release.
- Infrastructure provisions database roles and credentials. The Compose init script only provisions the local `carespaces_app` role.

## Privileged audit access

Local Compose also provisions `carespaces_audit_reader`. It can select the unified
`platform.audit_timeline` view but cannot mutate audit/transition tables. Deployed environments must
provision the equivalent role and a separate `AUDIT_DATABASE_URL` secret through infrastructure.

Use `readAuditTimeline` or `exportAuditTimelineCsv` with separate reader/writer pools. Both operations
require a bounded filter and append actor/reason/correlation evidence before the privileged read. CSV
exports omit metadata; returned metadata is recursively redacted.
