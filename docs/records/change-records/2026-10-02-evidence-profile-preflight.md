---
security_evidence:
  review_areas:
    - delivery
    - runtime
  reviewed_artifacts:
    - src/delivery-art/review-evidence-acquisition.js
    - src/delivery-art/work-session-cli-adapters.js
    - src/delivery-art/work-session-controller.js
    - test/delivery-art-work-session-cli-adapters.test.js
    - test/delivery-art-work-session.test.js
    - docs/operations/delivery-workflow-operator-surface.md
  findings: []
  risks: []
  workstreams:
    - WS-007
  notes: "The change moves existing base-owned evidence-profile validation earlier in the same bounded work-session path. It creates no credential, source resource, command family, or new authority."
---

# 2026-10-02 Evidence profile preflight

## Summary

Validate the exact base-owned owner evidence profile during the existing
read-only Delivery ART work preflight instead of discovering missing evidence
kinds or architecture fidelities after source implementation.

## Classification

- area: Delivery ART configured-path preflight
- type: corrective workflow maintenance
- runtime impact: local OOS work-session behavior after the accepted delivery runtime is refreshed

## Ownership

- owner repo: `operator-orchestration-service`
- related ART slice: None; owner-repo maintenance linked to the accepted workspace improvement candidate
- related products or components: Delivery ART work sessions and owner evidence acquisition

## Root Cause

- immediate failure: several owner repositories reached post-implementation evidence acquisition before OOS reported that their accepted-base profiles did not cover a required filesystem fidelity.
- actual root cause: profile schema and coverage checks ran only inside evidence acquisition, after source implementation and publication.
- why it escaped earlier controls: configured-path preflight projected architecture conformance obligations but did not compare them with the exact base-owned evidence profile.

## Source Changes

- changed workflow, adapter, or contract: `work preflight` now reads the profile from the exact fetched base and reuses the existing evidence-kind and fidelity coverage validator before source identity preflight.
- tests or validator added: real-Git adapter coverage proves complete profiles pass and incomplete profiles stop before identity preflight; controller coverage proves the typed blocker creates no work-session resources.
- related change records: `2026-09-24-automated-lifecycle-evidence.md`

## Artifact And Deployment Evidence

- source-only change, or build/deployment evidence: source-only maintenance until merge and a later supported dev-integration refresh
- image tag or digest: None
- runtime revision: None

## Live Verification

- local validation: focused adapter, controller, and evidence-acquisition tests; full `npm test`; governance docs; base-aware change-record validation
- live or dev-integration verification: not required for this source-only maintenance Landing Unit; the currently suspended composition remains unchanged
- residual risk: a stale local base reports the existing base-refresh blocker first and validates the profile after the base is refreshed

## Follow-Up

- required follow-up: close the linked Workspace Governance improvement candidate after the exact source head is reviewed and merged
- owner: `workspace-governance`
- due date or closure condition: OOS merged-head evidence and candidate structured-record validation

## Rollback

Revert this change to restore late evidence-acquisition-only profile validation.
Existing profiles and evidence receipts remain unchanged.
