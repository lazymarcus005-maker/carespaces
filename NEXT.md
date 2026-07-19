# Work Session Checkpoint

Updated: 2026-07-19

## Resume instruction

When the user says `ทำต่อไป`, `go`, `continue`, or an equivalent short instruction, continue with
`OPS-02` below. Do not ask what to work on unless repository state conflicts with this checkpoint.

## Current state

- `OPS-01` unified Ops Task workflow is implemented.
- Queue membership and role-to-queue authorization protect list and mutation operations.
- The authenticated API supports list/filter, claim, reassign, escalate, and resolve.
- The Admin workspace uses the API and has responsive queue, task list, and task detail views.
- Synthetic ingestion currently creates three representative Ops Tasks.
- `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:integration`, and `pnpm build` passed.
- Live smoke passed with Admin on port `3001` and CareSpaces API on port `4001`.
- Port `4000` was occupied by the unrelated `ollama-litellm` container. Admin supports `API_URL` so
  it can proxy to port `4001` without stopping that container.
- Browser screenshot QA was unavailable because the browser runtime had no browser instance.
- The OPS-01 worktree changes are not committed. Preserve them and work with them; do not reset or
  restore the worktree.

## Next objective

Implement `OPS-02` Notification Intent Center as the next vertical slice.

Start by reading:

1. `docs/product/p04-delivery-backlog.md`, especially `OPS-02`, `RT-02`, and `RT-03`.
2. Existing eventing, deadline, configuration, Ops Task, API contract, and Admin workspace patterns.
3. The current git diff so OPS-02 extends OPS-01 without discarding it.

## OPS-02 scope

1. Add reviewed forward/down migrations for notification intents, templates or template versions,
   channel delivery attempts, and user preferences where policy permits.
2. Make intent creation and delivery scheduling idempotent, auditable, and outbox-driven.
3. Define a delivery adapter boundary with a synthetic local adapter. Keep provider-specific
   credentials and payloads out of persisted public contracts.
4. Add worker handling for attempt leasing, retry, terminal failure, and dead-letter evidence.
5. Enforce that critical notification classes cannot be disabled and never treat delivery receipt as
   human acknowledgement.
6. Add typed API contracts, OpenAPI generation, authenticated API projections, and focused Admin
   workflow for inspecting intent and attempt status.
7. Connect at least one scheduled deadline or operational failure to a real notification intent and
   an Ops Task fallback/escalation path.
8. Extend synthetic ingestion, unit tests, PostgreSQL integration tests, operational status output,
   and product documentation.

## Completion gate

Before marking `OPS-02` complete:

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

After `OPS-02`, continue with `OPS-03` manual override framework unless a newer checkpoint replaces
this file.
