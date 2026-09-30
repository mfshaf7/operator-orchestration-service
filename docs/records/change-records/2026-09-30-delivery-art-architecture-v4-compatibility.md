---
security_evidence:
  review_areas:
    - delivery
    - runtime
  reviewed_artifacts:
    - contracts/delivery-art/delivery-art-architecture-packet.schema.json
    - src/delivery-art/contracts.js
    - src/delivery-art/service.js
    - src/delivery-art/work-session-controller.js
    - src/delivery-art/work-session-runtime.js
    - src/delivery-art/work-session-store.js
  workstreams:
    - WS-007
  findings: []
  risks: []
  notes: "The change preserves immutable historical evidence while limiting new work and pointer cutover to the current v4 contract. It adds no credential, approval, merge, or deployment authority."
---

# Delivery ART Architecture V4 Compatibility

## Summary

Delivery ART architecture packets now have an explicit current-versus-historical
posture: v4 is required for persistence and new work, while v1-v3 remain
readable for sessions already bound to their immutable evidence.

## Classification

- area: Delivery ART architecture custody and work-session admission
- type: contract compatibility and runtime control correction
- runtime impact: new architecture persistence, work start, and historical
  architecture pointer cutover

## Ownership

- owner repo: `operator-orchestration-service`
- related ART slice: None; accepted workspace improvement candidate
- related products or components: Delivery ART artifact service and work-session
  coordinator

## Root Cause

- immediate failure: historical v3 packets with prose runtime boundaries failed
  validation after capability-id boundaries became mandatory
- actual root cause: two incompatible architecture shapes shared schema version
  3, and consumers had no explicit current-versus-historical policy
- why it escaped earlier controls: the boundary-shape migration changed the
  validator without a schema-version cutover or retained-session proof

## Source Changes

- copied Workspace Governance authority now accepts immutable v1-v3 evidence
  and requires capability boundaries for v4
- OOS reports architecture contract posture, rejects historical persistence and
  new work, and retains exact historical reads
- v4 pointer cutover requires an exact historical supersedes reference and is
  blocked while active sessions remain bound to that packet
- focused tests cover historical reads, rejected starts, retained continuation,
  explicit supersession, active-session inventory, and current v4 behavior
- OpenProject form schema and `allowedValues` are unchanged: the existing
  writable description projection remains the only pointer mutation surface,
  and its read-only lookup still selects the latest structured reference

## Artifact And Deployment Evidence

- source-only change: pending pull request
- image tag or digest: None
- runtime revision: None

## Live Verification

- local validation: focused and full OOS tests, copied-contract validation,
  generated OpenAPI checks, API documentation validation, and governance
  documentation validation
- live or dev-integration verification: not claimed by this source correction
- residual risk: WGCF must adopt the same current-versus-historical boundary
  before the workspace improvement candidate closes

## Follow-Up

- required follow-up: land matching WGCF custody and readiness enforcement,
  then close the workspace improvement candidate with all merge evidence
- owner: `workspace-governance-control-fabric`
- closure condition: WGCF and Workspace Governance closure landing units merge

## Rollback

Revert the v4 consumer rules, cutover inventory, generated API contract, tests,
and this record as one OOS Landing Unit. Immutable historical artifacts are not
rewritten during rollback.
