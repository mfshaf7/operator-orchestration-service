---
security_evidence:
  review_areas:
    - runtime
    - delivery
  reviewed_artifacts:
    - contracts/workflow-activity/
    - src/workflow-activity/
    - src/app.js
    - docs/api/openapi.json
  workstreams:
    - WS-007
  findings: []
  risks: []
  notes: "The additive read surface requires caller-bound authentication, exposes only allowlisted owner projection fields and references, and adds no mutation, persistence, approval, secret, or release authority."
---

# Bounded Workflow Activity Projection

## Summary

OOS now composes Lifecycle Transition and durable orchestration chronology into
one bounded read for the Governance Operations Console. The projection uses
stable cursor ordering, exact source revisions, correlation and causation,
receipt references, and explicit partial-source status.

## Classification

- area: cross-workflow Console activity
- type: additive owner-backed read contract
- runtime impact: authenticated Console callers may read canonical activity;
  existing workflow mutations and owner reads are unchanged

## Ownership

- owner repo: `operator-orchestration-service`
- related ART slice: Epic #900, Feature #933, Enabler #1197
- consumers: Governance Operations Console #1199 and WGCF source-readiness
  integration #1198

## Root Cause

OOS workflows retained structured events and histories, but the Console had no
bounded cross-workflow read. It therefore had to compose prototype-local events
and browser receipts, which could not prove canonical source freshness or
failure posture.

## Source Changes

- added the `workflow-activity` contract, service, owner adapters, and route
- registered Lifecycle Transition and durable orchestration without adding a
  duplicate activity store
- added deterministic pagination, strict filtering, identity conflict checks,
  explicit partial-source status, and safe error projection
- synchronized OpenAPI, interface inventory, tests, and operator guidance

## Evidence

- focused service and HTTP tests cover ordering, replay stability, filtering,
  authorization, source loss, malformed/conflicting identity, receipt binding,
  and schema validity
- API and governance validation bind the route to the reviewed source contract
- CI-equivalent base-aware proof is recorded in the finalized Review Packet

## Artifact And Deployment Evidence

- source-only change: the reviewed OOS image and dev-integration activation are
  produced after merge through the existing OOS delivery path
- image or runtime revision: pending reviewed merge

## Live Verification

- local validation: focused workflow-activity tests, schema proof, synchronized
  OpenAPI, governance-doc checks, full OOS tests, and base-aware validation
- dev-integration proof: owned by the post-merge OOS activation path before the
  Console consumer in #1199 relies on the route

## Residual Boundary

The activity endpoint exposes a bounded recent owner window. When an owner
reports truncation, the aggregate page is explicitly partial rather than
claiming complete history. Console adoption and richer presentation remain
owned by #1199.

## Follow-Up

- #1198 proves WGCF readiness and source acceptance against the merged route
- #1199 adopts the owner-backed activity page in the Console without retaining
  browser-local authority

## Rollback

Revert this landing unit. Existing Lifecycle Transition and orchestration read
surfaces continue unchanged because the aggregate has no persistence or
mutation authority.
