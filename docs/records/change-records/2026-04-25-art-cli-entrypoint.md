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

# 2026-04-25 ART CLI Entrypoint

## Summary

Added one local `art` CLI that wraps broker bootstrap, bounded initiative and
work-item reads, and closeout writes for the active devint ART lane.

## Classification

- area: delivery workflow
- type: operator-surface hardening
- runtime impact: local operator entrypoint over existing broker routes

## Ownership

- owner repo: `operator-orchestration-service`
- related ART slice:
  - `#309` `Establish one canonical ART CLI and operator entrypoint`
  - `#330` `Add one local art CLI that wraps broker bootstrap, bounded reads, and closeout writes for the active devint ART lane`

## Root Cause

The broker routes had become good enough to use, but the normal local operator
path still depended on raw `kubectl exec ... node -e ...` one-liners. That left
routine ART work technically possible but operationally noisy and easy to mistype.

## Source Changes

- added the CLI request-spec builder and runner:
  - `src/art-cli.js`
  - `scripts/art_cli.mjs`
- added the npm entrypoint and regression coverage:
  - `package.json`
  - `test/art-cli.test.js`
- updated the primary operator guidance and repo README:
  - `docs/operations/delivery-workflow-operator-surface.md`
  - `README.md`

## Artifact And Deployment Evidence

- local CLI-only change over existing broker routes
- no governed runtime promotion in this slice yet

## Live Verification

- local regression coverage proves:
  - command parsing resolves the supported read and write command matrix
  - the CLI builds the bounded `k3s kubectl exec ... node --input-type=module`
    invocation and prints the broker JSON body cleanly
- live devint proof should confirm:
  - one bootstrap read and one broker write succeed through the CLI

## Follow-Up

- use the CLI against the live devint broker before closing ART story `#330`
- extend the command set when planning-repair and additional quality surfaces
  land under the same epic
