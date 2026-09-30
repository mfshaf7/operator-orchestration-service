---
security_evidence:
  review_areas:
    - runtime
    - delivery
  reviewed_artifacts:
    - contracts/repository-custody-workflow/README.md
    - docs/operations/repository-custody-workflow.md
    - docs/operations/README.md
  findings: []
  risks: []
  workstreams:
    - WS-007
---

# 2026-10-01 Operator Guidance Truth

## Summary

OOS now exposes one primary operator index and describes workflow availability
from synchronized manifests and composed dependencies instead of completed ART
item numbers.

## Classification

- area: operator workflow guidance and repository custody activation
- type: documentation and control-truth correction
- runtime impact: none; no feature flag, credential, route, or deployment changes

## Ownership

- owner repo: `operator-orchestration-service`
- related ART slice: None; tracked through the Workspace Governance improvement system
- related products or components: Governance Operations Console, Workspace Intake, Prototype, Repository Custody

## Root Cause

- immediate failure: active guidance referenced completed work items as if they were current activation gates and omitted a single workflow index.
- actual root cause: synchronization checks proved source bytes and skill installation but did not prove operator-document discoverability or dependency-level activation truth.
- why it escaped earlier controls: documentation validation checked required sections and links without comparing current posture wording to synchronized manifests and composed dependencies.

## Source Changes

- changed workflow, adapter, or contract: documentation only; add the OOS operator index and replace stale numbered-gate wording with manifest and dependency truth.
- tests or validator added: existing governance-doc, API-doc, full unit-test, and diff-aware change-record validators cover the correction.
- related change records: Workspace Governance candidate `2026-10-01-new-session-operator-guidance-regression`

## Artifact And Deployment Evidence

- source-only change, or build/deployment evidence: documentation-only source change
- image tag or digest: None
- runtime revision: None

## Live Verification

- local validation: full OOS tests, generated bundle checks, API documentation checks, governance documentation checks, and base-aware change controls
- live or dev-integration verification: not applicable; runtime behavior is unchanged
- residual risk: Workspace Intake remains unavailable end to end until WGCF readiness activation and accepted-profile composition are explicitly completed

## Follow-Up

- required follow-up: keep Workspace Intake unavailable in operator guidance until the owning activation work changes both dependency truth and composition
- owner: `workspace-governance-control-fabric` and `platform-engineering`
- due date or closure condition: explicit reviewed Workspace Intake end-to-end activation
