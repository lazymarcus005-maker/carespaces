# Team roles and environment access model

Status: **Proposed — approval required**

This model is the minimum-access baseline for development, staging, and production. Named people,
backups, and approval dates must be added before the P04 checklist item is complete.

Acting triage owner: `lazymarcus005-maker` for every pending decision until a functional primary and
backup accept ownership. This assumption enables implementation but does not substitute for Clinical,
Finance, Operations, DPO/Legal, or Security approval.

## Access principles

- Every person uses an individual identity; shared accounts and shared credentials are prohibited.
- Administrative and production access requires MFA and a short-lived privileged session.
- CI/CD uses OIDC and environment-scoped roles; no long-lived cloud key is stored in GitHub.
- Development contains synthetic data only. Production data must never be copied into lower environments.
- Direct production database access is denied by default and requires a time-bound, audited break-glass path.
- Clinical, identity-document, and finance access are separate capabilities with least-privilege projections.
- Role grants have an owner, reason, effective time, expiry/review date, and revocation evidence.

## Proposed role matrix

| Function | Development | Staging | Production | Required controls |
|---|---|---|---|---|
| Engineering | Build/test and synthetic DB admin | Deploy and diagnose with masked fixtures | No standing data access; on-call operational access only | MFA, OIDC deploy, reviewed migration, break-glass for exceptional data access |
| Product | Synthetic product flows | Acceptance testing with synthetic/masked data | Aggregated metrics only | MFA for admin surfaces; no clinical or financial detail |
| Care Operations | Synthetic queue scenarios | Operational rehearsal | Assigned queues and minimum case projection | MFA, privileged session, case/queue scope, sensitive-read audit |
| Clinical reviewer | Synthetic clinical fixtures | Clinical policy acceptance | Assigned clinical cases only | MFA, privileged session, patient/case scope; no ledger mutation |
| Finance | Synthetic PSP/ledger fixtures | Sandbox settlement rehearsal | Payment/refund/payout/reconciliation projections | MFA, privileged session, maker-checker; no full clinical note |
| DPO/Legal | Governance fixtures and documents | Privacy/retention review | Approved audit/export workflow only | MFA, purpose/reason, export approval, immutable audit |
| Security/Platform admin | Local policy tests | Identity/policy administration | Time-bound platform administration | Phishing-resistant MFA target, privileged session, action audit, no self-approval |
| CI/CD workload | Test/build only | Approved environment deployment | Approved promotion only | GitHub OIDC, immutable artifact, environment approval, no human credentials |

## Environment boundaries

| Environment | Data | Deployment | Secrets | Network/database |
|---|---|---|---|---|
| Development | Synthetic only | Engineer-controlled | Local secrets excluded from Git | Local container; no production connectivity |
| Staging | Synthetic or approved masked fixtures | CI/CD after checks | Environment-scoped secret store | Private services; no production database trust |
| Production | Live minimum-required data | Promoted immutable artifact with approval | Production secret store and separate KMS keys | Private data services; application role only; break-glass admin path |

## Approval record

| Decision | Primary | Backup | Approver | Review cadence | Status |
|---|---|---|---|---|---|
| Engineering/deployment owner | TBD | TBD | Founder/Engineering lead | Quarterly | Pending |
| Care Ops queue owner | TBD | TBD | Operations lead | Monthly during pilot | Pending |
| Clinical access owner | TBD | TBD | Clinical lead | Monthly during pilot | Pending |
| Finance access owner | TBD | TBD | Finance lead | Monthly during pilot | Pending |
| DPO/privacy access owner | TBD | TBD | DPO | Quarterly | Pending |
| Security/break-glass reviewer | TBD | TBD | Security/Founder | After every use + quarterly | Pending |

## Approval checklist

- [ ] Named primary and backup users are recorded for every production-capable function.
- [ ] Each user is mapped to GitHub/cloud/IdP groups without shared accounts.
- [ ] Staging and production approval paths are tested.
- [ ] Joiner/mover/leaver revocation SLA is approved and rehearsed.
- [ ] Break-glass duration, notification targets, and post-access review owner are approved.
- [ ] Product, Clinical, Operations, Finance, DPO, and Engineering sign off this model.
