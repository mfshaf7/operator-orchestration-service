---
security_evidence:
  review_areas:
    - runtime
    - delivery
  reviewed_artifacts:
    - src/delivery-art/agent-source-identity.js
    - src/delivery-art/work-session-cli-adapters.js
    - src/delivery-art/work-session-controller.js
    - src/delivery-art/work-session.js
    - dev-integration/profiles/accepted-idea-delivery/profile.yaml
    - dev-integration/profiles/accepted-idea-delivery/scripts/common.sh
    - dev-integration/profiles/accepted-idea-delivery/scripts/up.sh
    - dev-integration/profiles/accepted-idea-delivery/scripts/status.sh
    - dev-integration/profiles/accepted-idea-delivery/scripts/smoke.sh
  findings: []
  risks: []
  workstreams:
    - WS-007
  notes: Repairs false completion without adding a new authority, command family, credential type, or ART work item; live activation stays blocked until dependent maintenance and refreshed exact-revision Security acceptance land.
---

# Runtime Activation And Review Recovery

## Summary

OOS now enforces the existing human-review contract from live GitHub review
truth and configures the accepted-idea delivery profile for the already-built
Workspace Intake and Inventory workflows. The repair keeps the existing
`pull-request-review-required` gate and `refinement-catalog` composition; it
does not introduce a review mutation or a replacement runtime lane.

## Classification

- area: Delivery source review and Workspace Intake/Inventory dev-integration
- type: owner-repo maintenance and runtime-control repair
- runtime impact: changes local dev-integration composition; no stage or production authority

## Ownership

- owner repo: `operator-orchestration-service`
- related ART slice: existing blocked operating proof `openproject://work_packages/1210`; this maintenance work is not a replacement ART child
- related products or components: Workspace Governance, WGCF, Platform Engineering

## Root Cause

- immediate failure: merge eligibility did not read exact-head human approval, and the active profile never projected or mounted the implemented Intake/Inventory dependencies.
- actual root cause: source-complete controls were mistaken for composed operating controls, while merge authority was checked without independently proving that the designated human had approved the current head.
- why it escaped earlier controls: commissioning checked generic broker and Console activity rather than the exact workflow routes, identity projection, selected source revisions, and review state.

## Source Changes

- changed workflow, adapter, or contract: read-only GitHub review inspection; pre-merge recheck; Intake/Inventory endpoint, state, authority, identity, and exact-WGCF-source bindings in the existing profile.
- tests or validator added: exact approval, stale approval, superseded review, missing identity, secret-safe binding, source-mount, and profile-readiness cases.
- related change records: [Workspace Intake and Inventory orchestration](2026-10-01-workspace-intake-inventory-orchestration.md).

## Artifact And Deployment Evidence

- source-only change, or build/deployment evidence: source-only until dependent composition contracts land.
- image tag or digest: None.
- runtime revision: None.

## Live Verification

- local validation: focused delivery-session and refinement-catalog tests plus repository-wide validation before publication.
- live or dev-integration verification: required after Workspace Governance and Platform maintenance land; broker health alone is explicitly insufficient.
- residual risk: the current Security decision binds the pre-repair OOS revision and must be refreshed before live activation.

## Follow-Up

- required follow-up: land the Workspace Governance composition correction, repair Platform commissioning to deliver/revoke the dedicated identity and probe real workflow routes, refresh exact-revision Security acceptance, then run composed proof.
- owner: Workspace Governance, Platform Engineering, and Security Architecture in dependency order.
- due date or closure condition: before clearing the existing `#1210` blocker or claiming routine operation.
