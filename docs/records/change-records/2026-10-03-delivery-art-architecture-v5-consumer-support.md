---
security_evidence:
  review_areas:
    - delivery
    - runtime
  reviewed_artifacts:
    - contracts/delivery-art/delivery-art-architecture-packet.schema.json
    - contracts/delivery-art/fixtures/architecture-packet-v5-parity-vectors.valid.json
    - docs/contracts/delivery-workflow-api-v1.md
    - docs/operations/delivery-workflow-operator-surface.md
    - scripts/sync_delivery_work_session_openapi.mjs
    - src/delivery-art/contracts.js
    - src/delivery-art/lifecycle-controller.js
    - src/delivery-art/review-evidence.js
    - src/delivery-art/work-session-controller.js
  findings: []
  risks: []
  workstreams:
    - WS-007
  notes: "The change adds dormant fail-closed v5 consumer support without activating v5 authoring, adding authority, or changing v1-v4 evidence selection. A separate Security delta review remains an activation prerequisite."
---

# Delivery ART Architecture V5 Consumer Support

## Summary

OOS now understands the staged Architecture Packet v5 separation between
outcome applicability and one exact evidence-owner Landing Unit. V4 remains
the only current authoring version until the independent consumer, Security,
and session-inventory gates complete.

## Classification

- area: Delivery ART architecture, work-session, and evidence lifecycle
- type: corrective workflow and evidence-integrity maintenance
- runtime impact: dormant v5 read and projection support; no v5 work start or
  architecture persistence activation

## Ownership

- owner repo: `operator-orchestration-service`
- related ART slice: Epic #1203 recovery maintenance after work item #1228
- related improvement candidate:
  `workspace-governance/reviews/improvement-candidates/2026-10-03-post-merge-review-packet-architecture-recovery-regression.yaml`
- related products or components: Workspace Delivery ART work sessions,
  Review Packets, and owner evidence acquisition

## Root Cause

- immediate failure: OOS selected conformance evidence by overlap with
  `applies_to_work_item_ids`, so a work item could inherit proof obligations
  owned by another Landing Unit
- actual root cause: architecture v1-v4 had no independent evidence-owner
  field, and the work contract exposed only one overloaded case collection
- why it escaped earlier controls: OOS and WGCF lacked one shared parity vector
  proving exact owner-and-phase selection, and the lifecycle had no first-class
  post-merge acquisition transition

## Source Changes

- the pinned Workspace Governance bundle accepts schema v5 and includes the
  canonical owner-and-phase parity vector while v4 remains current
- semantic validation enforces v5 evidence-owner existence and causal closure
- causal parent closure terminates and returns the declared cycle error for a
  malformed cyclic descendant map
- work-contract schema v2 separates `outcome_cases` from
  `evidence_owner_cases` and preflight checks every eventual owned fidelity
- review-evidence projection schema v2 selects one exact owner and readiness
  phase while preserving immutable earlier-phase evidence
- merged v5 work acquires owned operating-ready evidence before finalization
- v1 through v4 keep their prior selection and projection behavior
- focused tests cover staged admission, causal rejection, shared parity,
  work-contract separation, phase-specific projection, and post-merge ordering

## Artifact And Deployment Evidence

- source-only change, or build/deployment evidence: source-only dormant
  consumer support pending review and merge
- image tag or digest: None
- runtime revision: None; activation is a separate governed Landing Unit

## Live Verification

- local validation: focused Delivery ART suites, generated contract sync,
  OpenAPI validation, full Node suite, governance docs, and base-aware
  change-record validation
- live or dev-integration verification: not claimed by this dormant support
  Landing Unit
- residual risk: v5 cannot authorize persistence or a new session until the
  explicit activation sequence completes

## Follow-Up

- required follow-up: land matching WGCF owner-and-phase readiness support,
  complete the Security delta review and generated security change-record
  index, inventory non-pristine sessions, then activate v5 separately
- owner: `workspace-governance`
- due date or closure condition: all Architecture Packet v5 activation gates
  are evidenced and the Epic #1203 packet is superseded under the current
  contract

## Security Evidence

The change narrows evidence attribution to one declared Landing Unit and
readiness phase. It keeps v5 staged read-only, preserves immutable merge-ready
evidence during post-merge acquisition, and grants no caller, credential,
approval, source-merge, readiness, deployment, or ART-close authority.

## Rollback

Revert the v5 consumer logic, copied contract bundle, generated OpenAPI,
tests, operator documentation, and this record together. Existing v1-v4
artifacts and sessions retain their historical behavior.
