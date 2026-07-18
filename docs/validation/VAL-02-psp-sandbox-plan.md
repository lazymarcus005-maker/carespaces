# VAL-02 — PSP sandbox validation plan

Status: **Plan ready — provider selection and execution pending**

Functional owners: Legal + Finance + Engineering

Tracking: [GitHub issue #2](https://github.com/lazymarcus005-maker/carespaces/issues/2)

## Objective

Select a PSP whose sandbox and operating model support authorization/capture, void, refund, payout,
recipient KYC, signed webhooks, idempotency, and settlement reconciliation for the Thailand pilot.

## Candidate intake

For each candidate record legal entity support, Thailand availability, settlement currency, fees,
recipient onboarding/KYC, payout timing, reserve/hold behavior, API limits, support SLA, and data region.
Do not place sandbox credentials or webhook secrets in this document or GitHub issues.

## Contract matrix

| Scenario | Required evidence | Pass condition |
|---|---|---|
| Authorize then capture | API requests/responses with identifiers redacted | Amount/currency/reference match and retry returns one business effect |
| Void before capture | PSP event timeline | Authorization is released once and late webhook is explainable |
| Partial and full refund | API + webhook + settlement export | Cumulative refund never exceeds captured amount |
| Recipient onboarding/KYC | Sandbox recipient lifecycle | Pending/rejected/approved states map without treating auth as provider approval |
| Payout | Submission, late success, failure, retry | PSP confirmation and domain payout state remain separate; no duplicate payout |
| Webhook security | Raw-body signature tests | Valid accepted; forged/replayed event rejected or deduplicated |
| Event ordering | Duplicate/out-of-order/late fixtures | Final amounts and ledger side effects remain correct once |
| Settlement export | Sample export and mapping | Payment/refund/payout rows reconcile to provider references |
| Timeout after side effect | Forced client timeout | Retry resolves by idempotency/status lookup, not a second charge |

## Automated contract

- `PspAdapterContract` and `runPspAdapterContract` live in `@carespaces/testing`.
- The deterministic fake adapter must pass the shared contract in CI.
- A real sandbox adapter must run the same contract plus provider-specific webhook and settlement fixtures.

## Exit criteria

- [ ] Legal and Finance approve the commercial/recipient/KYC model.
- [ ] Engineering attaches redacted evidence for every contract-matrix row.
- [ ] Provider-specific adapter mapping and error taxonomy are documented.
- [ ] Fallback/manual reconciliation procedure and production kill switch are approved.
- [ ] No critical/high security or money-correctness finding remains open.

Until exit criteria pass, fake PSP use is limited to development and contract tests; PAY production remains blocked.
