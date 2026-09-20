---
security_evidence:
  review_areas:
    - delivery
    - runtime
  reviewed_artifacts:
    - contracts/delivery-art-work-session/recovery-receipt.schema.json
    - docs/contracts/delivery-workflow-api-v1.md
    - docs/operations/delivery-workflow-operator-surface.md
    - scripts/validate_openproject_mutation_contracts.py
    - src/app.js
    - src/art-cli.js
    - src/delivery-art/work-session-controller.js
    - src/delivery-art/work-session-service.js
    - src/delivery-art/work-session-store.js
  findings: []
  risks: []
  workstreams:
    - WS-007
  notes: "Recovery archives only an exact merged session missing pre-merge proof; it grants no merge, approval, or ART close authority."
---

# Merged Work-Session Recovery

## Summary

Epic #892 has source-backed children with merged PRs but no pre-merge Review
Packet or readiness receipt. Ordinary reconstruction correctly rejects their
non-pristine sessions. Re-running the old merge or declaring them done would
misstate the evidence. This change adds a bounded archive action, not a
completion path.

## Classification

- area: Delivery ART work-session recovery
- type: explicit exception handling for incomplete historical source work
- runtime impact: one authenticated broker route and a retained local archive

## Ownership

- owner repo: `operator-orchestration-service`
- related ART slice: Epic #892 merged-session blockers
- related components: Delivery ART work sessions, source authority, Review Packets

## Root Cause

- immediate failure: merged source exists without the pre-merge Review Packet
  and readiness receipt required by the normal session
- actual root cause: the earlier merged sessions cannot be reconstructed as
  pristine and have no bounded archive path
- why it escaped earlier controls: source merge and evidence finalization were
  not yet composed in one ordered work-session lifecycle

## Source Changes

The authenticated, revision-bound `work recover` action verifies the live ART
item and exact merged PR, rejects any local Review Packet or readiness receipt,
and moves the full session directory to a retained archive. It records an
integrity-checked receipt outside that archive, including the missing-proof
flags. A retry returns the same receipt. The action neither clears the ART
blocker nor closes work, and it does not certify the historical merge.

The old session and artifacts remain available for audit. A new Landing Unit
must use the normal pre-merge path. The CLI and HTTP adapter call the same
controller; neither receives arbitrary shell or source mutation authority.
The OpenProject mutation validator classifies this source-only route separately
from direct OpenProject writes.

## Artifact And Deployment Evidence

- source-only change: the OOS pull request carrying this record
- image tag or digest: None
- runtime revision: None

## Live Verification

Controller, service, HTTP, CLI, schema, and OpenAPI checks must pass at the
final source head. No live recovery is claimed by this source change. Residual
risk: historical merged work remains incomplete until fresh reviewed work and
ART evidence resolve its blocker.

## Follow-Up

- required follow-up: review each affected ART blocker, then create a fresh
  Landing Unit under the normal pre-merge review path
- owner: the Delivery ART operator for Epic #892
- closure condition: each affected child has finalized evidence without
  claiming that the historical merge had pre-merge proof

## Rollback

Revert the API, command, schema, and controller together. Already archived
sessions and recovery receipts must remain retained for audit.
