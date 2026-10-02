---
security_evidence:
  review_areas:
    - delivery
    - runtime
  reviewed_artifacts:
    - contracts/delivery-art-work-session/decision.schema.json
    - contracts/delivery-art-work-session/work-session.schema.json
    - src/delivery-art/work-session.js
    - src/delivery-art/work-session-controller.js
    - src/delivery-art/work-session-store.js
    - test/delivery-art-work-session.test.js
    - docs/api/openapi.json
    - docs/contracts/delivery-workflow-api-v1.md
    - docs/operations/delivery-workflow-operator-surface.md
  workstreams:
    - WS-007
  findings: []
  risks: []
  notes: "The change narrows source-evidence rebinding after recovery and introduces no identity, credential, approval, merge, or runtime privilege. Existing Security source-provenance controls remain authoritative."
---

# Review Packet Source Rebinding Control

## Summary

Recovered Delivery ART source sessions now terminate their Landing Unit
identity. Any later source intent for the same ART scope must use a new Landing
Unit ID and branch and bind the exact unsuperseded recovery receipt chain.

## Classification

- area: Delivery ART source lifecycle and Review Packet evidence fidelity
- type: source-behavior control correction
- runtime impact: local and broker-hosted Delivery ART work-session coordination

## Ownership

- owner repo: `operator-orchestration-service`
- related ART slice: Epic #1203 historical evidence correction for work item #1206
- related products or components: Workspace Delivery ART source lifecycle

## Root Cause

- immediate failure: a recovered Landing Unit ID could be started again on a different branch and later bind a different pull request
- actual root cause: recovery archived the old session and released its aliases, while start treated the same Landing Unit identity as a reusable generation slot
- why it escaped earlier controls: recovery tests required a new branch but explicitly expected reuse of the old Landing Unit ID as session generation `:r1`

## Source Changes

- changed workflow, adapter, or contract: makes recovered Landing Unit identities and branches terminal, records exact recovery supersession bindings on successor decisions and sessions, and rechecks the boundary before finalization or closeout
- tests or validator added: reproduces merged recovery, same-ID PR rebinding, missing supersession, exact successor admission, and pre-fix active-session blocking
- related change records: [Delivery ART Evidence Fidelity Coverage](2026-10-01-delivery-art-evidence-fidelity-coverage.md)

## Artifact And Deployment Evidence

- source-only change, or build/deployment evidence: source-only OOS control; normal deployment remains Platform-owned
- image tag or digest: None
- runtime revision: None

## Live Verification

- local validation: focused work-session tests, full Node test suite, generated API contract check, governance docs, and diff-aware change-record validation
- live or dev-integration verification: not required; deterministic state-store regression covers the historical sequence without mutating ART
- residual risk: historical ART evidence still requires a separate governed correction after this prevention control lands

## Follow-Up

- required follow-up: regenerate and land the Security change-record index, then close the linked Workspace Governance improvement candidate and correct #1206 historical evidence through the existing governed ART surface
- owner: `workspace-governance`
- due date or closure condition: merged OOS control, current Security index, closed candidate, and authoritative #1206 evidence correction

## Security Evidence

Existing Delivery ART evidence custody and source-provenance review remains the
security authority. This change reduces accepted source bindings and does not
add a caller, secret, privilege, merge authority, or deployment path.

## Rollback

Revert the OOS source pull request. Existing recovery receipts and archived
sessions remain immutable; rollback would restore the prior unsafe ability to
reuse recovered Landing Unit identities and therefore must not be used while a
successor source intent is active.
