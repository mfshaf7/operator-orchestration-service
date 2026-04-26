---
security_evidence:
  review_areas:
    - delivery
  findings: []
  risks: []
  workstreams:
    - WS-007
---

# 2026-04-26 Continuation Context Lineage And Classification

## Summary

Extended the broker-owned ART continuation-context packet so it keeps the
machine metadata that the current ART model now depends on for truthful resume.

## Classification

- area: delivery workflow
- type: contract and resume-surface hardening
- runtime impact: continuation-context now exposes current machine metadata for
  initiative lineage and work-item execution classification

## Ownership

- owner repo: `operator-orchestration-service`
- related ART slice:
  - `#38` `Establish the governed enterprise AI agent control plane and runtime foundation`
  - `#251` `Activate the first bounded governed AI assist path after parity and audit gates`

## Root Cause

The continuation-context route was intentionally bounded, but it still mirrored
an older compact node shape.

After the ART architecture and taxonomy hardening work, two important truths
moved out of subject-text lore and into machine fields:

- initiative lineage on top-level `Epic` work
- `execution_classification` on `Feature` and `User story` work

The old continuation packet therefore made resume logic drift back toward:

- inferring architecture context from chat memory
- inferring `Enabler` or `Improvement` posture from the subject prefix alone

That no longer matched the governed ART model.

## Source Changes

- extended continuation nodes to expose:
  - `execution_classification`
  - `initiative_family`
  - `lineage_role`
  - `architecture_anchor_ref`
  - `required_upstream_ref`
  - `pm2_phase`
- updated the route contract examples and operator documentation
- extended service, HTTP, and API-contract tests to cover the new fields

## Artifact And Deployment Evidence

- local broker runtime change only
- no platform-admin or OpenProject schema change required
- no live ART mutation required for this contract fix

## Live Verification

- `npm test`
- `npm run validate:api-docs`
- `npm run validate:governance-docs`
- `python3 scripts/validate_change_record_requirement.py --repo-root . --against-ref origin/main`

## Follow-Up

- keep continuation-context bounded; do not turn it into a second initiative
  review surface
- if future ART resume work needs more guidance, prefer explanatory reason
  signals over imperative next-action commands
