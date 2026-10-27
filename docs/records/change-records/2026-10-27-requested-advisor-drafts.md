---
security_evidence:
  review_areas: [runtime, delivery, ai]
  reviewed_artifacts:
    - contracts/work-design/assist-request.schema.json
    - src/work-design/service.js
    - src/refinement/service.js
  findings: []
  risks: []
  workstreams: [WS-007]
---

# Preserve governed profiles for operator-requested local advisor drafts

## Summary

- Date: 2026-10-27
- Short title: Admit actual Work Design draft context and allow answer-only Refinement advice.

## Classification

Operator-directed maintenance outside Epic1332. Feature1336 was retired as
reclassified scope, not delivered capability. Landing Unit Decision:
feature_single_landing_unit, maintenance-advisor-drafts-oos. No ART planning
gate, final-decision authority or source custody boundary changes.

## Ownership

OOS owns the existing Work Design and Refinement contracts and governed assist
calls. Console owns local proposals and draft setters; CGG owns context
admission; Platform owns profiles and runtime; Security owns acceptance.

## Root Cause

Existing Work Design advice did not carry the actual local diagram. Refinement
enforced a review/value response even for questions, despite its result schema
already admitting none/null. A model upgrade alone could not add local editing.
Manual Work Design is valid without advisor evidence; planned backlog stories
are allowed and the normal decomposition gate is preserved.

## Source Changes

Optional Work Design draft scope is bounded and bound to the same task, package,
source and revision. It enters the canonical digest and CGG context. Existing
unscoped clients remain compatible. Refinement instructions distinguish explicit
drafting from questions/clarification; none with a non-null value is rejected.
The existing task/profile routes, operator/caller bindings and final apply path
remain authoritative. Generated Work Design OpenAPI schemas match source.

## Artifact And Deployment Evidence

Exact source and fetched-base validation are retained in the Gary pull request.
The paired [Security review](https://github.com/mfshaf7/security-architecture/blob/main/docs/reviews/components/2026-10-27-requested-advisor-drafts.md)
and exact composed source decision precede normal Platform commissioning. This
source record does not assert deployment or native operating completion.

## Live Verification

Focused contract/service tests28/28 and full broker suite1662 tests with1660
passes/two intentional skips passed. Native Console model-authored diagram,
tree, field, no-edit, cancellation, undo and persistence proof follows exact
acceptance/activation; the model never performs final decisions.

## Follow-Up

### Native canvas geometry correction

The commissioned transport reached OOS with a real fractional custom-item y
coordinate. The new advice scope was passed through the integer-only ART
canonical serializer, returning500 before CGG/model dispatch. Integer-only
fixtures had missed this ordinary canvas data. Preserve the retained failed
invocation and all geometry; do not round the draft or relax ART artifacts.

Landing Unit Decision: feature_single_landing_unit,
maintenance-advisor-context-json-oos. The optional local scope now enters the
canonical advice context and request binding as exact JSON text, reusing the
existing generic advisor pattern. Role/source/revision validation precedes that
encoding; CGG still admits digest-bound content before the configured Work Design
profile is invoked. Legacy unscoped advice, source authority and apply remain
unchanged. No direct model route or canonical mutation is added.

A faithful service regression reproduces the failure before the correction and
passes afterward with fractional custom cards, positions and sketch geometry
retained through context and gateway handoff. It separately proves ART canonical
numbers remain restricted. Full owner validation and exact-source Security
acceptance precede another normal commissioning/native diagram witness. Source
tests do not assert operating completion.
The corrected owner suite passed1663tests with1661passes and two intentional
skips; focused Work Design service tests passed21/21. API/bundle/image and
fetched-base checks remain part of the exact source landing evidence.

The paired Console/Platform source has landed. Accept the exact corrected OOS
source through the existing Security review/index check, commission normally,
verify actual native workflows, then revoke credentials and retire source
branches/worktrees. Owner: OOS with Console, Platform and Security.
