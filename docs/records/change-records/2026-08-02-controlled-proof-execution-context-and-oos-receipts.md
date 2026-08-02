---
security_evidence:
  review_areas:
    - identity
    - secrets
    - delivery
    - runtime
  reviewed_artifacts:
    - src/app.js
    - src/config.js
    - src/orchestration-worker.js
    - src/orchestration/constants.js
    - src/orchestration/controlled-proof-contracts.js
    - src/orchestration/controlled-proof-evidence.js
    - src/orchestration/controlled-proof-run-projection.js
    - src/orchestration/service.js
    - src/orchestration/temporal-adapter.js
    - src/orchestration/worker.js
    - src/orchestration/workflows.js
    - contracts/orchestration/controlled-proof-activity-request.schema.json
    - contracts/orchestration/controlled-proof-control-request.schema.json
    - contracts/orchestration/controlled-proof-execution-context.schema.json
    - contracts/orchestration/controlled-proof-owner-receipt.schema.json
    - contracts/orchestration/controlled-proof-run-binding.schema.json
    - contracts/orchestration/controlled-proof-run-projection.schema.json
    - contracts/orchestration/controlled-proof-start-request.schema.json
    - contracts/orchestration/controlled-proof-workflow-input.schema.json
    - docs/api/openapi.json
    - docs/contracts/durable-orchestration-v1.md
    - docs/architecture/durable-orchestration-runtime.md
    - docs/operations/durable-orchestration-operator-surface.md
  findings: []
  risks: []
  workstreams:
    - WS-007
  notes: "This source-only change implements the OOS boundary approved by security-architecture/docs/reviews/components/2026-08-01-temporal-controlled-commissioning-proof-contract.md. It does not issue or consume a live permit, start a commissioning session, activate the Temporal profile, run a worker, or establish operating evidence. The Platform executor, WGCF owner implementation, exact authorization, and Security execution approval remain separate prerequisites."
---

# 2026-08-02 Controlled Proof Execution Context And OOS Receipts

## Summary

Add a separate permit-bound OOS commissioning path that binds every Temporal
execution and terminal owner receipt to one authorized session and scenario
without opening the normal durable-run activation path.

## Classification

- area: shared operator orchestration
- type: source implementation and controlled-proof trust-boundary hardening
- runtime impact: new internal API and worker source remain disabled until an
  exact Platform-issued controlled-proof context is mounted and enabled

## Ownership

- owner repo: `operator-orchestration-service`
- related ART slice: `#794` under delivery `#698`
- related products or components: OOS, Temporal, WGCF, Platform controlled
  commissioning

## Root Cause

- immediate failure: the approved controlled-commissioning contract had no
  OOS execution context, scenario-bound workflow path, or complete owner
  receipt implementation.
- actual root cause: the normal active-profile orchestration path cannot safely
  prove a still-`build-admitted` profile because its activation evidence and
  generation registry intentionally require the active lifecycle.
- why it escaped earlier controls: the original source admission correctly
  deferred live proof until a separate permit and commissioning-session model
  was defined.

## Source Changes

- changed workflow, adapter, or contract: added strict versioned context,
  start, control, workflow-input, memo-binding, activity, projection, and OOS
  owner-receipt contracts; a deterministic scenario workflow; a separate
  Platform-only API and worker path; authorization-expiry fencing; and retained
  receipt projection with the actual Temporal execution run id.
- tests or validator added: positive and negative context, identity, expiry,
  duplicate, control, worker-revocation, projection, receipt, HTTP, OpenAPI,
  and deterministic bundle checks.
- related change records:
  - `2026-07-31-oos-durable-orchestration-source-admission.md`

## Artifact And Deployment Evidence

- source-only change, or build/deployment evidence: source-only; no controlled
  proof was executed and no runtime profile was activated.
- image tag or digest: None.
- runtime revision: None.

## Live Verification

- local validation: `npm ci`; `npm test` with 447 passing tests;
  deterministic workflow bundle build; canonical OpenAPI schema synchronization;
  59 documented and implemented API routes matched; governance docs, structured
  record, change-record requirement, OpenProject mutation self-test and
  base-aware mutation checks passed against fetched `origin/main`; both API and
  orchestration-worker Docker targets built; dependency audit reported zero
  vulnerabilities. The built worker image reported the normal activation gates
  missing and independently reported the controlled-proof worker as disabled,
  context-not-ready, and not allowed to poll.
- live or dev-integration verification: None; operating proof belongs to the
  later Platform-controlled commissioning session.
- residual risk: the source cannot become operating evidence until the exact
  Platform executor, WGCF receipt owner, consumed authorization, runtime
  context, and Security execution approval are present together.

## Follow-Up

- required follow-up: land the WGCF controlled-proof owner boundary, then use
  the Platform executor to run the authorized scenario sequence and aggregate
  all required owner receipts under the parent commissioning work.
- owner: `workspace-governance-control-fabric`, Platform Engineering, Security
  Architecture, and OOS according to their existing boundaries.
- due date or closure condition: ART `#794` closes on merged source evidence;
  operating proof remains under the parent commissioning work after dependent
  owner implementations land.
