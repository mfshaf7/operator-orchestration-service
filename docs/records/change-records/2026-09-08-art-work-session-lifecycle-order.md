---
security_evidence:
  review_areas:
    - delivery
    - runtime
  reviewed_artifacts:
    - contracts/delivery-art-lifecycle/capabilities.json
    - docs/contracts/delivery-workflow-api-v1.md
    - docs/operations/delivery-workflow-operator-surface.md
    - src/app.js
    - src/delivery-art/review-packet-completion.js
    - src/delivery-art/source-executor.js
    - src/delivery-art/work-session-controller.js
    - src/delivery-art/work-session-service.js
    - scripts/validate_openproject_mutation_contracts.py
  findings: []
  risks: []
  workstreams:
    - WS-007
  notes: "The explicit merge command extends the existing caller-bound Delivery source executor with one finite exact-head action; it adds no identity, credential, or automatic merge authority."
---

# ART Work-Session Lifecycle Order

## Summary

ART #1117 makes source merge an explicit OOS work-session command and validates
generated completion payloads before a Review Packet can become immutable.

## Classification

- area: Delivery ART work-session lifecycle
- type: workflow ordering and fail-closed validation
- runtime impact: adds one authenticated finite source-executor action and one
  broker route; existing activation and credential boundaries are unchanged

## Ownership

- owner repo: `operator-orchestration-service`
- related ART slice: Defect #1117 under Epic #892
- related components: Delivery ART work sessions, Review Packets, and the
  Governance Operations Console adapter contract

## Root Cause

- immediate failure: source merge remained an external shell instruction, and
  malformed generated completion payloads could be discovered only after
  Review Packet finalization
- actual root cause: the normal work-session state machine did not own the
  complete ordered path from merge approval through repairable completion
  evidence
- why it escaped earlier controls: exact source observation and Review Packet
  readiness were enforced independently, but their operator-approved merge and
  generated closeout payload boundaries were not composed into the same API

## Source Changes

- adds caller-bound, revision-bound, replay-safe `work merge` handling to the
  CLI, API, controller, and finite source executor
- requires the live PR URL, base, and head to match the durable merge-ready
  Review Packet immediately before squash merge
- preserves direct GitHub merge as a recovery path rather than the normal
  operator workflow
- centralizes Review Packet completion-payload generation and applies the same
  completion-evidence validator before finalization and before ART submission
- synchronizes the lifecycle capability declaration, OpenAPI contract, README,
  and primary Delivery operator surface
- keeps the OpenProject mutation gate focused on canonical backend writes by
  classifying the exact source-merge route as a GitHub-only action

## Artifact And Deployment Evidence

- source-only change: OOS pull request for ART #1117
- image tag or digest: None
- runtime revision: None

## Live Verification

- local validation: owner-repo unit, API, contract, governance, and base-aware
  checks must pass at the final pull-request head
- live or dev-integration verification: the #1117 landing unit will dogfood
  `work merge` against its own exact merge-ready pull request
- residual risk: direct GitHub merge can bypass the normal command receipt, so
  it remains documented as recovery and is reconciled from authoritative PR
  state on resume

## Follow-Up

- required follow-up: expose the same bounded merge action through the future
  Console Delivery adapter without recreating lifecycle logic in the browser
- owner: Governance Operations Console consumer work under its existing ART
  plan
- closure condition: #1117 has a finalized Review Packet and the generated
  security change-record index is current

## Rollback

Revert the merge action, early completion-payload preflight, and synchronized
operator contracts together. Existing sessions remain reconstructable and can
use the documented direct-merge recovery path.
