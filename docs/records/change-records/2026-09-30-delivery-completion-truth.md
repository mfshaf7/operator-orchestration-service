---
security_evidence:
  review_areas:
    - delivery
    - runtime
  reviewed_artifacts:
    - contracts/delivery-art/delivery-art-architecture-packet.schema.json
    - src/delivery-art/contracts.js
    - src/delivery-art/review-evidence-acquisition.js
    - src/delivery-art/landing-unit-completion.js
    - src/delivery-art/work-session-runtime.js
    - src/delivery-art/work-session-controller.js
  workstreams:
    - WS-007
  findings: []
  risks:
    - "Closeout now fails closed when authoritative initiative follow-up cannot be read."
  notes: "The change tightens existing delivery evidence and completion projection. It adds no credential, privilege, backend mutation, approval, or merge authority."
---

# Delivery Completion Truth

## Summary

Delivery ART architecture handoffs, owner evidence acquisition, and Landing
Unit closeout now preserve the concrete dependencies and remaining initiative
state needed for truthful completion decisions.

## Classification

- area: Delivery ART architecture, evidence, and work-session closeout
- type: workflow contract and runtime control correction
- runtime impact: existing Delivery ART work sessions only; no new mutation
  route or authority

## Ownership

- owner repo: `operator-orchestration-service`
- related improvement: `2026-09-27-cross-repo-acceptance-and-evidence-profile-completeness`
- related components: Delivery ART architecture packets, owner evidence
  acquisition, Landing Unit completion, Console work-session projection

## Root Cause

- architecture handoffs named producer and consumer repos without binding the
  exact Landing Units, work items, integration point, or source landing order
- an owner evidence profile could omit a workflow-required evidence kind while
  still passing its own profile validation
- successful Landing Unit cleanup projected generic work completion without
  preserving ancestor and initiative closeout disposition

## Source Changes

- schema-v3 handoffs now bind exact producer and consumer Landing Units and
  work items, name the integration point, and follow the source landing graph
- evidence acquisition rejects profiles that omit a workflow-required evidence
  kind
- closeout returns ancestor dispositions, authoritative initiative readiness,
  and the exact next action after terminal resource cleanup
- tests cover malformed handoff topology, incomplete evidence profiles, and
  retained initiative work after a Landing Unit completes

## Artifact And Deployment Evidence

- source-only Landing Unit: `maintenance-delivery-completion-runtime`
- deployment: none; this record does not claim activation or live operating
  evidence
- rollback unit: the contract, runtime projection, generated OpenAPI update,
  tests, and this record revert together

## Live Verification

- local validation: full OOS test suite, Delivery ART contract synchronization,
  generated OpenAPI checks, API documentation validation, governance
  documentation validation, and diff integrity
- live verification: not required for this source-only control correction
- residual risk: downstream WGCF and Console consumers must adopt the new
  handoff and closeout fields before the improvement candidate can close

## Follow-Up

- update WGCF semantic validation for the schema-v3 handoff bindings
- update the Console work-session client contract for ancestor and initiative
  closeout projection
- close the linked improvement candidate only after all consumer changes land

## Rollback

Revert the handoff schema and semantic checks, evidence-kind enforcement,
closeout projection, generated OpenAPI changes, tests, and this record as one
Landing Unit. Existing finalized Review Packets and ART records are not
rewritten.
