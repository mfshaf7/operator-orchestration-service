---
security_evidence:
  review_areas:
    - identity
    - delivery
  reviewed_artifacts:
    - src/delivery-art/review-evidence.js
    - src/delivery-art/lifecycle.js
    - src/delivery-art/lifecycle-controller.js
    - src/delivery-art/service.js
    - src/app.js
    - docs/api/openapi.json
  findings: []
  risks: []
  workstreams:
    - WS-007
---

# 2026-08-26 Authoritative Review Evidence Projection

## 2026-10-28 Maintenance: Local Corrections Before Merge

During1332, PR347 retained its earlier head after the same session's corrected
Gary worktree passed validation. The merge-ready inspector checked local source
only after the remote PR changed, hiding publication and approved renewal.
Earlier tests started with an already-pushed correction and missed that first
step. This is owner-repo maintenance of the existing lifecycle, with no new ART
scope, workflow, permission or Architecture Packet.

The inspector now observes the current checkout while the same merge-ready PR
remains open/draft. The evaluator routes dirty, wrong-branch, unpublished or
diverged source back to its existing source gate before review or merge.
The normal Gary publisher and approved renewal retain their original scope;
published corrections require exact-head evidence, CI and human review.
Earlier durable packets remain immutable. Merged/finalized history still does
not require a cleaned local worktree.

Four faithful regression cases fail against the accepted base, then pass with
the correction. They include actual work-session publication/renewal action
mapping and preservation of the earlier packet. Existing remote-head revision,
same-head evidence, and terminal source cleanup cases remain required. The
primary operator surface now describes this pre-merge continuation.

The observed session was recovered by moving only its reconstructable local
packet cache after resolving original WGCF custody; normal Gary publication
then sent the corrected head. That recovery does not prove repaired runtime.
Exact Security reacceptance, local commissioning and source-resource retirement
remain required before subsequent1332 native operating work. This maintenance
rolls back by reverting the lifecycle change and paired source acceptance while
preserving packets, intents, Git history and owner evidence. Existing security
metadata above continues to identify this control's implementation files.

## Summary

Added one authenticated, adapter-independent OOS projection that compiles
Review Packet evidence requirements from durable work-start, architecture, and
exact source truth before operator-authored results are evaluated.

## Classification

- area: Workspace Delivery ART Review Packet lifecycle
- type: workflow contract, read-only evidence projection, and lifecycle
  reconciliation
- runtime impact: source change in the active OOS dev-integration service;
  no stage or production change

## Ownership

- owner repo: `operator-orchestration-service`
- related ART slice: Defect `#988` under delivery `#884`
- related products or components:
  - Governance Operations Console
  - Workspace Delivery ART
  - Workspace Governance Control Fabric

## Root Cause

- immediate failure: a new work session started with blank Review Packet
  evidence and required the operator or AI to reconstruct changed surfaces,
  acceptance mappings, architecture conformance cases, and exact source refs.
- actual root cause: the lifecycle validated evidence only after local
  authoring and did not own a deterministic projection from authoritative
  work-session truth.
- why it escaped earlier controls: lifecycle tests proved artifact validation
  and custody, but did not prove that evidence requirements were generated
  before the human evidence gate or shared across CLI and future Console
  adapters.

## Source Changes

- changed workflow, adapter, or contract:
  - added `POST /v1/delivery-art/review-evidence/project`
  - resolved durable work-start and architecture truth server-side
  - derived changed surfaces, acceptance mappings, and applicable conformance
    cases from the exact Landing Unit source revision
  - preserved operator-authored results while rebinding them to the current
    source head
  - made evidence projection a required lifecycle action before evidence
    evaluation or Review Packet authoring
  - recorded the Governance Operations Console as the future primary normal
    operator workplace while keeping workflow semantics in OOS
- tests or validator added:
  - deterministic projection, stale source, missing evidence, conformance,
    service authority, HTTP authentication, and lifecycle ordering coverage
- related change records:
  - [2026-08-23-delivery-art-work-session-lifecycle.md](2026-08-23-delivery-art-work-session-lifecycle.md)

## Artifact And Deployment Evidence

- source-only change, or build/deployment evidence: source-only pending local
  validation, pull-request review, merge, and dev-integration dogfood
- image tag or digest: None
- runtime revision: None

## Live Verification

- local validation: pending full repository and base-aware validation
- live or dev-integration verification: pending exact-head work-session dogfood
- residual risk: the Console does not yet expose the full work-session UI; it
  will consume this API in its separately governed integration slice

## Follow-Up

- required follow-up: wire the Governance Operations Console ART work-session
  surface to this and the other OOS lifecycle APIs without duplicating state
- owner: `governance-operations-console`
- due date or closure condition: before Console replaces the local CLI as the
  normal Workspace Delivery ART operator surface
