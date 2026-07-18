# Validation register

This register links the V0 validation gates in P04 to their GitHub tracking issues. The repository
owner is assigned for triage; functional owners remain responsible for review and approval evidence.

| Gate | Status | Functional owners | Tracking |
|---|---|---|---|
| VAL-01 — Managed marketplace legal model | Open | Founder + Legal | [#1](https://github.com/lazymarcus005-maker/carespaces/issues/1) |
| VAL-02 — PSP capability decision | Sandbox plan ready | Legal + Finance + Engineering | [#2](https://github.com/lazymarcus005-maker/carespaces/issues/2) |
| VAL-03 — Clinical activity policy v1 | Open | Clinical | [#3](https://github.com/lazymarcus005-maker/carespaces/issues/3) |
| VAL-04 — Pilot service area | Open | Product + Operations | [#4](https://github.com/lazymarcus005-maker/carespaces/issues/4) |
| VAL-05 — Care Ops SLA/roster | Open | Operations | [#5](https://github.com/lazymarcus005-maker/carespaces/issues/5) |
| VAL-06 — AWS region decision | Open | Engineering + DPO | [#6](https://github.com/lazymarcus005-maker/carespaces/issues/6) |
| VAL-07 — Identity/KYC provider selection | Sandbox plan ready | Product + Legal + Engineering | [#7](https://github.com/lazymarcus005-maker/carespaces/issues/7) |
| VAL-08 — Data governance pack | Open | DPO + Legal | [#8](https://github.com/lazymarcus005-maker/carespaces/issues/8) |
| VAL-09 — Pricing/financial policy v1 | Open | Product + Finance | [#9](https://github.com/lazymarcus005-maker/carespaces/issues/9) |
| VAL-10 — ORM/database spike | Completed | Engineering | [#10](https://github.com/lazymarcus005-maker/carespaces/issues/10) |

## Current engineering boundary

- IAM uses a fake local identity adapter until VAL-07 selects and validates the real IdP/KYC path.
- Payment tests use a deterministic fake PSP until VAL-02 supplies a sandbox contract.
- Feature-domain work that depends on clinical, service-area, data-governance, or pricing policy must
  remain behind the corresponding open gate.

## Working documents

- [Team roles and environment access model](environment-access-model.md) — proposed; named approvals pending
- [VAL-02 PSP sandbox plan](VAL-02-psp-sandbox-plan.md) — plan ready; provider execution pending
- [VAL-07 identity/KYC sandbox plan](VAL-07-idp-sandbox-plan.md) — plan ready; provider execution pending
- [P02/P03/P04 stakeholder review checklist](stakeholder-review-checklist.md) — ready to schedule
