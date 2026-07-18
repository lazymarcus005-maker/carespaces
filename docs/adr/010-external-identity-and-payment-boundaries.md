# ADR-010: External identity and payment boundaries

- Status: Accepted engineering baseline
- Date: 2026-07-18
- Owners: Acting Engineering owner (`lazymarcus005-maker`); Product/Legal/Finance/Security approval remains tracked by VAL-02 and VAL-07

## Context

The MVP foundation must continue before an identity/KYC provider and PSP are selected. Hard-coding a
vendor now would mix domain policy with provider behavior and make sandbox evidence difficult to reuse.

## Decision

### Identity

- Use an OIDC/JWT boundary compatible with a managed provider such as Cognito, without selecting the
  final vendor in code.
- A provider-specific verifier owns signature, algorithm, JWKS rotation, and revocation checks.
- Application mapping accepts only verified claims and validates issuer, audience, expiry, issued/auth
  time, stable subject/session, verified contact, MFA evidence, and privileged-session assurance.
- Authentication never implies Provider approval.
- Important onboarding actions require a verified contact method.
- Privileged actions require MFA, an approved privileged claim, and fresh authentication.

### Payment

- Keep a provider-neutral PSP contract for authorize, capture, void, refund, payout, webhook verification,
  idempotency, and settlement export.
- The deterministic fake adapter is development/test only.
- Production remains blocked until a real adapter passes the shared contract plus provider-specific
  webhook, ordering, timeout, KYC, and reconciliation scenarios in VAL-02.

### Audit access

- Application credentials can append audit and transition evidence but cannot update/delete it.
- A separate audit-reader credential can select only the `platform.audit_timeline` view.
- Every privileged read/export writes actor, reason, correlation, and filter evidence before querying.
- Queries must be bounded by tenant, correlation, or subject and capped at 500 rows.
- CSV export excludes metadata; query metadata is recursively redacted.

## Consequences

- Engineering can build and test IAM/payment boundaries without provider credentials.
- Provider selection remains reversible and is isolated to adapter/verifier implementations.
- A separate `AUDIT_DATABASE_URL`/secret is required for privileged audit readers in deployed environments.
- VAL-02 and VAL-07 remain open until real sandbox evidence and functional approvals are complete.
