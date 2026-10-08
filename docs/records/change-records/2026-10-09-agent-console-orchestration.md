---
security_evidence:
  review_areas:
    - runtime
    - delivery
    - identity
    - ai
  reviewed_artifacts:
    - contracts/agent-console
    - src/agent-console
    - src/agent-action
    - src/app.js
    - src/config.js
    - src/runtime.js
    - docs/api/openapi.json
  findings: []
  risks: []
  workstreams:
    - WS-007
  notes: Source-complete Agent Console orchestration remains disabled by default and admitted only for the reviewed dev-integration profile.
---

# Governed Agent Console Orchestration

## Summary

ART #1245 adds the OOS-owned Agent Console session, invocation, action
enforcement, and receipt path between the merged CGG #1244 projection contract
and the future Platform #1246 runtime composition.

## Classification

- area: governed Agent Console orchestration
- type: source-backed workflow and trust-boundary implementation
- runtime impact: disabled by default; no live activation in this change

## Ownership

- owner repo: `operator-orchestration-service`
- related ART slice: #1245 under Feature #1215 and Epic #1203
- related products or components: Context Governance Gateway, Platform governed AI access plane, Workspace Governance Control Fabric, Governance Operations Console

## Root Cause

- immediate failure: the Console had a browser-local provider path but no
  durable OOS session protocol joining governed context, model access, action
  enforcement, and receipts.
- actual root cause: the cross-owner sequence was intentionally deferred until
  CGG #1244 supplied an authoritative model-safe projection contract.
- why it escaped earlier controls: the prototype baseline explicitly prohibited
  fabricating CGG admission or treating local model access as governed.

## Source Changes

- changed workflow, adapter, or contract: added closed session, invocation,
  projection, and model-response schemas; pinned the exact merged CGG request
  and result schemas; added atomic state custody, deterministic replay,
  one-active-invocation ordering, bounded cancellation/failure settlement,
  governed AI response enforcement, session-bound Agent Action enforcement,
  HTTP routes, configuration, and generated OpenAPI.
- tests or validator added: positive ordered CGG-to-model completion and
  replay; negative caller/operator, candidate digest, CGG binding, model
  binding, active-invocation, cancellation, transport, revision, timeline,
  runtime activation, HTTP, and API parity coverage.
- related change records: [CGG Agent Console context projection](https://github.com/mfshaf7/context-governance-gateway/pull/23)

## Artifact And Deployment Evidence

- source-only change, or build/deployment evidence: source-only Landing Unit `delivery-1203-agent-console-oos`
- image tag or digest: None
- runtime revision: None

## Live Verification

- local validation: focused protocol tests, full repository tests, generated OpenAPI parity, governance validation, base-aware source validation, and source lifecycle evidence
- live or dev-integration verification: assigned to Platform #1246 after this exact source revision lands
- residual risk: Console #1247 and Security #1248 must consume and accept the exact landed revisions; no operator should enable the runtime before then

## Follow-Up

- required follow-up: Platform #1246 commissions caller/profile/credential bindings and proves the planned live positive and negative cases; Console #1247 adopts the OOS routes; Security #1248 reviews the composed trust boundary and activation decision
- owner: the owner repos assigned by the Epic #1203 architecture packet
- due date or closure condition: before Feature #1215 and Epic #1203 close
