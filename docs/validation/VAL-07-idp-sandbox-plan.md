# VAL-07 — Identity/KYC sandbox validation plan

Status: **Plan ready — provider selection and execution pending**

Functional owners: Product + Legal + Engineering

Tracking: [GitHub issue #7](https://github.com/lazymarcus005-maker/carespaces/issues/7)

## Objective

Select an identity/KYC approach that supports customer and provider authentication, verified contact,
recovery, logout/revocation, admin MFA/step-up, auditable privileged sessions, and appropriate Thailand
identity/legal review. Authentication must never imply Provider approval.

## Candidate intake

Record supported login/contact methods, MFA factors, step-up claims, session/revocation semantics,
recovery controls, tenant/organization model, token/JWKS behavior, audit export, rate limits, SLA,
data region, processor terms, and migration/export options. Keep all client secrets outside Git/GitHub.

## Contract matrix

| Scenario | Required evidence | Pass condition |
|---|---|---|
| Customer registration/login | Sandbox user and token claims | Stable subject; verified-contact claim is explicit |
| Provider authentication | Applicant account fixture | Account remains separate from verification/approval status |
| Contact verification | Valid, expired, and reused challenge | Only verified challenge changes contact state; replay is rejected |
| Recovery | Start/complete/replay fixtures | Enumeration-resistant start; prior sessions revoked after recovery |
| Logout/revocation | Access and refresh token checks | Revoked session cannot start a new privileged application request |
| Admin MFA | Token/claim evidence | Platform role denied without MFA and privileged-session claims |
| Step-up | Expired and insufficient-assurance sessions | Sensitive action requires fresh approved assurance level |
| Key rotation | Old/new JWKS overlap | Valid rotation window works; unknown/expired key is rejected |
| Tenant isolation | Same subject across tenant fixtures | Application membership/ABAC remains authoritative |
| Audit/minimization | Redacted auth event sample | No password, OTP, token, or unnecessary identity evidence enters logs/events |

## Automated contract

- `IdentityAdapterContract` and `runIdentityAdapterContract` live in `@carespaces/testing`.
- The deterministic fake sandbox adapter passes registration, contact verification, MFA claim, recovery,
  revocation, and non-approval separation scenarios.
- The selected provider adapter must pass the same contract plus provider-specific JWKS/token tests.

## Exit criteria

- [ ] Product approves customer/provider authentication and recovery UX.
- [ ] Legal/Security approve identity sources, factors, processor terms, and data handling.
- [ ] Engineering attaches redacted evidence for every contract-matrix row.
- [ ] MFA/step-up/session/revocation policy values are versioned.
- [ ] Migration/fallback and provider outage runbooks are approved.

Until exit criteria pass, the fake identity adapter remains development-only and full IAM integration remains blocked.
