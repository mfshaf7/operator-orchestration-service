---
security_evidence:
  review_areas:
    - identity
    - runtime
    - delivery
    - ai
  reviewed_artifacts:
    - contracts/agent-action/manifest.json
    - contracts/agent-action/schemas/agent-action-request.schema.json
    - contracts/agent-action/schemas/agent-action-policy-decision.schema.json
    - contracts/agent-action/schemas/agent-action-receipt.schema.json
    - contracts/agent-action/schemas/agent-action-owner-receipt.schema.json
    - src/agent-action/contracts.js
    - src/agent-action/enforcement.js
    - src/agent-action/wgcf-client.js
    - src/wgcf-transport.js
  findings: []
  risks: []
  workstreams:
    - WS-007
---

# 2026-08-23 Agent Action Decision Enforcement

## Summary

Added the shared OOS enforcement boundary that validates canonical agent-action
requests, obtains and revalidates WGCF policy decisions, refreshes current
authority immediately before dispatch, and records terminal OOS receipts
without granting runtime activation.

## Classification

- area: shared agent-action workflow enforcement
- type: runtime contract, authorization enforcement, and receipt custody
- runtime impact: source-complete only; no live agent-originated action path is
  activated by this landing unit

## Ownership

- owner repo: `operator-orchestration-service`
- related ART slice: Enabler `#953` under delivery `#882`
- compatibility correction: Defect `#974` under conformance item `#954`
- related products or components:
  - `operator-orchestration-service`
  - Workspace Governance Control Fabric
  - Workspace Governance agent-action authority

## Root Cause

- immediate failure: admitted shared workflows had no reusable OOS boundary for
  enforcing WGCF agent-action decisions before owner dispatch.
- actual root cause: canonical action semantics and WGCF evaluation existed,
  but OOS did not yet bind fresh source, approval, caller, context, delegation,
  idempotency, and owner-receipt truth into one execution path.
- why it escaped earlier controls: the governing contract and evaluator were
  intentionally sequenced before the shared workflow enforcer, integrated
  conformance, and Security activation decision.

## Source Changes

- changed workflow, adapter, or contract:
  - pinned the exact Workspace Governance request, decision, action-receipt,
    and owner-receipt schemas with source revision and byte digests
  - added authenticated bounded WGCF evaluation transport
  - added fresh-current revalidation, expiry, approval, source-version,
    workflow-command, and replay enforcement before dispatch
  - required exact owner receipts for every mutation outcome and terminal OOS
    receipts for admitted execution results
  - kept the enforcer internal; no generic client-controlled dispatch endpoint
    or client-supplied current-authority surface was introduced
- tests or validator added:
  - positive execution coverage for `read`, `advise`, `draft`, and `mutate`
  - negative policy, expiry, source drift, approval, idempotency, obligation,
    pre-invocation failure, and owner-receipt cases
  - runtime image inclusion and authenticated bounded WGCF transport coverage
  - cross-owner digest-projection compatibility for WGCF-sealed requests and
    policy decisions; `integrity.content_digest` is omitted from canonical
    content rather than replaced by an empty string
- related change records: None

## Artifact And Deployment Evidence

- source-only change, or build/deployment evidence: API and orchestration-worker
  images build successfully from the exact source head; proof tags were removed
  after validation
- image tag or digest: None
- runtime revision: None

## Live Verification

- local validation:
  - focused agent-action and WGCF client suite passed (`33` tests)
  - full repository suite passed (`646` tests)
  - API, governance, orchestration, Proposal, Delivery ART, and base-aware owner
    validators passed
  - API and orchestration-worker Docker targets built successfully
- live or dev-integration verification: not performed because this landing unit
  does not activate an agent-originated workflow
- residual risk: integrated cross-owner conformance and Security activation
  acceptance remain outstanding and explicitly block live dispatch

## Follow-Up

- required follow-up:
  - execute integrated positive and negative conformance through ART item `#954`
  - complete Security acceptance through ART item `#955`
  - activate only the exact admitted workflow set after both gates pass
- owner: `operator-orchestration-service`, Workspace Governance Control Fabric,
  and `security-architecture`
- due date or closure condition: before any agent-originated action invokes a
  live owner workflow
