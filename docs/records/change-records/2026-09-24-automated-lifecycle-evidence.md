---
security_evidence:
  review_areas:
    - delivery
    - runtime
  reviewed_artifacts:
    - contracts/delivery-art-work-session/evidence-profile.json
    - contracts/delivery-art-work-session/evidence-profile.schema.json
    - src/delivery-art/lifecycle-cli-adapters.js
    - src/delivery-art/lifecycle-controller.js
    - src/delivery-art/review-evidence-acquisition.js
    - src/delivery-art/source-executor.js
  workstreams:
    - WS-007
  findings: []
  risks: []
  notes: "The privileged executor reads the profile from the owner repository's exact recorded base commit rather than candidate-worktree policy and executes allowlisted binaries without a shell. Each repo's first profile landing uses the existing evidence path; activation fails closed until every admitted source-work owner has a base-owned profile or a recorded non-activation posture."
---

# Automated Lifecycle Evidence

## Summary

Delivery work sessions now acquire typed owner evidence for the exact pushed
source revision and assemble Review Packet v2 input without manual machine
evidence-file authoring.

## Classification

- area: Delivery ART work-session evidence and Review Packet assembly
- type: workflow contract and runtime control
- runtime impact: adds one authenticated finite source-executor action and an
  admitted OOS evidence profile; no platform, Security, or production authority
  is added

## Ownership

- owner repo: `operator-orchestration-service`
- related ART slice: Epic #1154, Feature #1161, work item #1172
- related products or components: Delivery ART work sessions, source executor,
  Review Packet v2, Governance Operations Console lifecycle projection

## Root Cause

- immediate failure: the evidence gate returned a local JSON file for an
  operator or agent to populate manually
- actual root cause: the lifecycle had evidence projection and Review Packet
  validation but no trusted owner-repository acquisition boundary between exact
  source inspection and projection
- why it escaped earlier controls: prior conformance proved manually supplied
  evidence shape, not provider identity, exact-source execution, deterministic
  replay, or the absence of handcrafted machine facts

## Source Changes

- changed workflow, adapter, or contract: adds a schema-backed owner evidence
  profile, base-revision command acquisition, typed receipt verification,
  deterministic evidence projection, conflicting-replay protection, and a
  `work continue` evidence action
- tests or validator added: profile/schema validation, typed receipt and digest
  validation, real-Git exact-source execution, failed-command and source-mutation
  behavior, executor transport, lifecycle projection, crash recovery, and
  next-action coverage
- related change records: `2026-09-24-configured-path-preflight.md`

## Artifact And Deployment Evidence

- source-only change, or build/deployment evidence: source-only until the OOS
  pull request is merged and the updated dev-integration runtime is activated
- image tag or digest: None
- runtime revision: pending merge

## Live Verification

- local validation: 1,115 tests completed with 1,113 passing, zero failures,
  and two intentional skips; deterministic orchestration and Refinement
  bundles, required OpenAPI projections, API docs, governance docs,
  base-aware change-record and OpenProject mutation controls, patch integrity,
  API and worker image builds, API health smoke, and fail-closed worker smoke
  passed
- live or dev-integration verification: this bootstrap Landing Unit continues
  through the currently active reviewed evidence path; automated acquisition
  remains pending exact-head merge, owner-profile inventory, and controlled
  activation
- residual risk: a repository's initial profile landing cannot consume a
  profile that is not yet present in its recorded base; the existing reviewed
  evidence path is retained for that one bootstrap landing

## Follow-Up

- required follow-up: publish and review the exact source head; verify every
  admitted source-work owner has a profile on its accepted base or remains
  explicitly non-activated; then activate the updated OOS dev-integration
  runtime and prove a later work session acquires evidence without manual
  machine-result authoring
- owner: Delivery ART operator and OOS runtime owner
- due date or closure condition: work item #1172 and Feature #1161 close with a
  finalized Review Packet and terminal cleanup receipt

## Rollback

Revert the evidence profile, acquisition module, finite source-executor action,
and lifecycle projection changes together. Existing finalized Review Packets
and terminal receipts remain authoritative and are not rewritten.
