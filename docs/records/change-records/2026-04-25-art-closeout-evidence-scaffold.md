---
security_evidence:
  review_areas:
    - runtime
    - delivery
  findings: []
  risks: []
  workstreams:
    - WS-007
---

# 2026-04-25 ART Closeout Evidence Scaffold

## Summary

Added local `art` CLI scaffold commands that generate editable item-completion
and initiative-closeout payloads from repo state, including changed-surface
assembly and cross-repo linkage bullets.

## Classification

- area: delivery workflow
- type: operator-surface hardening
- runtime impact: local CLI helper only; no new broker route required

## Ownership

- owner repo: `operator-orchestration-service`
- related ART slice:
  - `#312` `Automate evidence assembly and cross-repo linkage for ART closeout`

## Root Cause

Normal closeout was structurally governed, but operators still had to hand-build
the JSON payloads that those routes require. That kept closeout mechanically
correct while still making multi-repo evidence assembly noisy and easy to
under-document.

## Source Changes

- added local closeout scaffold generation:
  - `src/art-scaffold.js`
  - `src/art-cli.js`
- added regression coverage for scaffold parsing and payload rendering:
  - `test/art-scaffold.test.js`
  - `test/art-cli.test.js`
- updated the primary operator surfaces:
  - `README.md`
  - `docs/operations/delivery-workflow-operator-surface.md`

## Artifact And Deployment Evidence

- local operator-surface change only
- no broker API or governed runtime promotion required for this slice

## Live Verification

- local tests should prove the scaffold commands emit valid payload skeletons
- live proof should generate one multi-repo closeout scaffold from the active
  workspace state before feature `#312` closes

## Follow-Up

- use the scaffold against the real cross-repo state under epic `#304`
- close feature `#312` only after a generated scaffold is used as real closeout
  input material instead of one-off manual JSON assembly
