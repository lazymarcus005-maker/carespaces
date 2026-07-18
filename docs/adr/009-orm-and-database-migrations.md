# ADR-009: ORM and database migration strategy

- Status: Accepted
- Date: 2026-07-17
- Owner: Engineering
- Backlog: VAL-10, FND-04

## Context

Carespaces needs PostgreSQL features that are central to correctness rather than optional optimizations:

- PostGIS point storage and spatial indexes for serviceability and matching
- row-level security as defense in depth for tenant and patient data
- range/exclusion constraints to prevent overlapping active assignments
- explicit transactions, raw SQL and reviewable forward/rollback migrations

VAL-10 compared Prisma 7.8.0 and Drizzle 0.45.2 against two isolated PostgreSQL 17 + PostGIS 3.5 databases using the same schema and invariants.

## Decision

Use **Drizzle ORM with the `node-postgres` driver** for application persistence.

Use reviewed SQL migrations as the source of truth for PostgreSQL-specific behavior. Drizzle schema definitions provide application types and express supported indexes/RLS policies, while custom SQL remains explicit for extensions and exclusion constraints that cannot be represented completely by the schema DSL.

The API contract packages must not export database row types to web or other clients.

## Evidence

| Capability | Prisma 7.8 | Drizzle 0.45 | Spike result |
|---|---|---|---|
| PostGIS `geometry(Point, 4326)` | Represented as `Unsupported`; insert/query requires raw SQL | Native typed geometry column and insert; spatial function can use typed SQL | Both passed; Drizzle required fewer escape hatches |
| RLS | Custom SQL migration; session context via raw SQL | RLS policy is representable in schema; session context still explicit | Cross-tenant read was denied with the application role |
| Exclusion constraint | Custom SQL migration | Custom SQL migration required | Overlapping active assignment was rejected in both databases |
| Transactions | Interactive transaction | Typed transaction API | Forced-error rollback left no row in both databases |
| Migration rollback | Custom SQL supported | Custom SQL supported | Identical up/down fixtures applied and removed all application tables |
| Driver behavior | Prisma 7 requires a PostgreSQL driver adapter | `node-postgres` and `postgres-js` supported | `node-postgres` completed reliably and aligns with the NestJS runtime |

The executable evidence is in `spikes/orm/run.ts`; run it with `pnpm db:spike`.

## Consequences

- PostgreSQL-specific constraints remain visible and reviewable in SQL instead of being hidden behind ORM behavior.
- Domain repositories may use Drizzle query builders and parameterized `sql` expressions, but raw SQL must remain local to the database package.
- Every tenant-scoped transaction must set the tenant context before accessing RLS-protected tables.
- Migration CI must rehearse both a clean forward migration and the documented rollback/restore path.
- Prisma is not added to production runtime packages; its dependencies remain temporarily as reproducible VAL-10 evidence and can be removed when the spike is archived.
- The spike found that the `postgres-js` path did not resolve a completed geometry insert under the current Node 23 workstation runtime. Production uses Node 22 LTS and `node-postgres`; the alternate driver can be reconsidered only with a dedicated compatibility test.

## References

- [Drizzle PostGIS geometry guide](https://orm.drizzle.team/docs/guides/postgis-geometry-point)
- [Drizzle row-level security](https://orm.drizzle.team/docs/rls)
- [Drizzle transactions](https://orm.drizzle.team/docs/transactions)
- [Prisma PostgreSQL extensions](https://docs.prisma.io/docs/orm/prisma-schema/postgresql-extensions)
- [Prisma raw queries and unsupported types](https://www.prisma.io/docs/orm/prisma-client/using-raw-sql/raw-queries)
- [Prisma 7 PostgreSQL driver setup](https://www.prisma.io/docs/orm/prisma-client/setup-and-configuration/introduction)
