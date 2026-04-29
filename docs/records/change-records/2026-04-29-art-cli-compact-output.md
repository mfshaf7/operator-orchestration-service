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

# 2026-04-29 ART CLI Compact Output

## Summary

Changed the ART CLI to reduce token-heavy operator output. Read-heavy broker
commands and Review Packet `validate` and `finalize` now print compact
operator summaries by default while keeping complete durable responses available
through `--json` or local `.art/outputs/` files.

## Classification

- area: delivery workflow
- type: operator-surface usability improvement
- runtime impact: none; local CLI output shape changes only
- ART slice: owner-repo maintenance for the ART operator workflow

## Ownership

- owner repo: `operator-orchestration-service`
- workflow owner: `operator-orchestration-service`
- related operator surfaces:
  - `npm run art -- bootstrap`
  - `npm run art -- workflow-health`
  - `npm run art -- initiative review-pack <delivery-id>`
  - `npm run art -- initiative execution-summary <delivery-id>`
  - `npm run art -- initiative planning <delivery-id>`
  - `npm run art -- initiative closeout-readiness <delivery-id>`
  - `npm run art -- item continuation <work-item-id>`
  - `npm run art -- review-packet validate <packet.json>`
  - `npm run art -- review-packet finalize <packet.json>`

## Root Cause

The ART broker responses are useful as complete evidence records, but the CLI
was printing full JSON during routine reads and Review Packet validation. That
made normal closeout and continuation sessions carry more JSON than the
operator needs, even when durable evidence already exists on disk.

## Source Changes

- updated [src/art-cli.js](../../../src/art-cli.js) so read-heavy commands
  print compact summaries by default and support `--json` for the full broker
  response
- added `.art/outputs/` as the managed local spillover directory for full
  broker responses that are too large for default compact output
- added CLI regression coverage in [test/art-cli.test.js](../../../test/art-cli.test.js)
- updated [.art/README.md](../../../.art/README.md), [README.md](../../../README.md),
  and [docs/operations/delivery-workflow-operator-surface.md](../../operations/delivery-workflow-operator-surface.md)
  with the compact-output behavior

## Artifact And Deployment Evidence

- artifact:
  - full broker responses remain available with `--json`
  - oversized compacted responses are written under `.art/outputs/`
  - Review Packets remain durable under `.art/review-packets/`
  - default summaries keep packet id, digest, covered ART items, PR/SHA,
    evidence counts, validation status, and warnings/errors instead of
    pasting full evidence JSON
- deployment:
  - no runtime deployment is required for this local CLI behavior

## Live Verification

- `node --test test/art-cli.test.js`
- `node --test test/art-cli.test.js test/art-workflow-artifacts.test.js`
- `npm run validate:governance-docs`
- `npm run validate:api-docs`
- `npm run validate:change-record-requirement`
- `npm test`
- `git diff --check`

## Follow-Up

- If operators still need less closeout text after this change, add dedicated
  `show --summary` commands for managed artifacts instead of weakening the
  durable packet schema.
