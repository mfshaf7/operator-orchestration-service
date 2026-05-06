---
security_evidence:
  review_areas:
    - delivery
    - runtime
  findings: []
  risks: []
  workstreams:
    - WS-007
---

# 2026-05-06 ART Landing-Unit Generated Payload Preflight

## Summary

Added local generated-payload preflight to the landing-unit command family so
`status`, `dry-run`, and `submit` use the same completion-evidence formatter
contract before any broker completion or stale-open closeout mutation can run.

## Classification

- area: Workspace Delivery ART operator workflow
- type: defect fix and contract guard
- runtime impact: local ART CLI now blocks landing-unit submit before broker
  mutation when generated completion evidence would fail broker validation

## Ownership

- owner repo: `operator-orchestration-service`
- related ART slice: `#662` under delivery `#650`
- related products or components: Workspace Delivery ART, OpenProject delivery
  broker, WGCF ART readiness path

## Root Cause

- immediate failure: `landing-unit submit` failed before mutating #661 because
  generated `Changed Surfaces` evidence still failed broker completion-evidence
  validation even after path code-formatting was added.
- actual root cause: `landing-unit status` and `landing-unit dry-run` proved
  Review Packet coverage and parent eligibility, but did not locally validate
  the generated child-completion and parent-closeout payloads against the same
  completion-evidence contract enforced by the broker.
- why it escaped earlier controls: unit coverage asserted sequencing and one
  code-formatted path, but did not run the generated payload through
  `validateCompletionSections` before the live broker mutation path.

## Source Changes

- changed workflow, adapter, or contract: landing-unit planning now builds the
  generated completion and stale-open closeout payloads and validates them with
  the completion-evidence contract before returning `ready_to_submit=true`.
- OpenProject form contract evidence: no OpenProject `allowedValues`, `form
  schema`, `PropertyIsReadOnly`, writable fields, read-only fields,
  `version_field_read_only`, or `roadmap_version_projection` semantics changed.
- tests or validator added: added ART CLI coverage proving `landing-unit dry-run`
  fails closed when generated completion evidence contains an undecorated
  path-like description that the broker would reject.
- related change records:
  - `2026-05-06-art-landing-unit-closeout-automation.md`
  - `2026-05-06-art-landing-unit-formatting-fix.md`

## Artifact And Deployment Evidence

- source-only change, or build/deployment evidence: source-only pending PR and
  ART Review Packet evidence for delivery `#650`.
- image tag or digest: None.
- runtime revision: None.

## Live Verification

- local validation: pending in the #650 generated-payload-preflight landing
  unit.
- live or dev-integration verification: retry `landing-unit dry-run` first; it
  must fail closed on invalid generated evidence and pass after packet evidence
  text is corrected.
- residual risk: broker completion-evidence validation remains the final
  fail-closed guard.

## Follow-Up

- required follow-up: update the #650 landing-unit closeout Review Packet,
  retry `landing-unit dry-run`, then retry `landing-unit submit` to close
  #661/#662/#663/#660.
- owner: `operator-orchestration-service`
- due date or closure condition: before continuing the remaining #650 slices.
