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

# 2026-04-30 Review Packet Source Repo Detection

## Summary

Hardened local Review Packet draft generation so broker-local ART scratch files
cannot be misclassified as source landing-unit evidence, and added explicit
source repo roots for multi-repo or non-broker landing units.

## Classification

- area: delivery workflow
- type: evidence-integrity and operator-surface hardening
- runtime impact: local ART CLI and Review Packet draft artifact generation
- ART slice: `#483` Review Packet repo-detection defect under delivery `#420`

## Ownership

- owner repo: `operator-orchestration-service`
- related ART work:
  - `#420` control-fabric foundation Epic
  - `#483` Review Packet repo-detection defect
  - `#489` PI Objective for the defect fix

## Root Cause

- immediate failure: Review Packet draft generation selected local
  `.art/payloads` files from the broker repo as changed source surfaces while
  the real source work lived in other owner repos.
- actual root cause: the draft generator used Git untracked-file evidence from
  the current repo without excluding managed ART scratch directories, and the
  CLI had no way to pass the real owner repo roots.
- why it escaped earlier controls: `.art/payloads` was not ignored in this repo
  and Review Packet draft tests covered normal source changes but not local
  ART scratch residue.

## Source Changes

- changed workflow, adapter, or contract:
  - [src/art-workflow-artifacts.js](../../../src/art-workflow-artifacts.js)
    now excludes `.art` scratch directories, `.tmp`, and platform-drill scratch
    paths from Review Packet source evidence.
  - [src/art-cli.js](../../../src/art-cli.js) supports
    `--repo-root <path>` for Review Packet draft generation.
  - [.gitignore](../../../.gitignore) ignores `.art/payloads/`.
  - [docs/operations/delivery-workflow-operator-surface.md](../../operations/delivery-workflow-operator-surface.md),
    [docs/contracts/delivery-workflow-api-v1.md](../../contracts/delivery-workflow-api-v1.md),
    and [docs/api/README.md](../../api/README.md) document explicit source repo
    roots and scratch exclusion behavior.
- tests or validator added:
  - Review Packet draft regression coverage for `.art` scratch exclusion.
  - CLI coverage for `--repo-root` source repo selection.
- related change records:
  - [2026-04-29 ART Mutation Drafts And Review Packets](2026-04-29-art-mutation-drafts-and-review-packets.md)
  - [2026-04-30 ART Review Packet Readiness Gate](2026-04-30-art-review-packet-readiness-gate.md)

## Artifact And Deployment Evidence

- source-only change before merge:
  - Review Packet drafts now exclude broker-local ART scratch paths even when
    Git ignore state is incomplete.
  - Operators can pass one `--repo-root` per source repo in the landing unit.
- image tag or digest:
  - None
- runtime revision:
  - source change requires normal broker rollout before live devint uses the
    updated CLI from a deployed image.

## Live Verification

- local validation:
  - `npm test -- test/art-workflow-artifacts.test.js test/art-cli.test.js`
  - `npm test`
  - `npm run validate:api-docs`
  - `npm run validate:governance-docs`
  - `python3 scripts/validate_change_record_requirement.py --repo-root . --changed-file .gitignore --changed-file src/art-workflow-artifacts.js --changed-file src/art-cli.js --changed-file test/art-workflow-artifacts.test.js --changed-file test/art-cli.test.js --changed-file docs/operations/delivery-workflow-operator-surface.md --changed-file docs/contracts/delivery-workflow-api-v1.md --changed-file docs/api/README.md --changed-file docs/records/change-records/2026-04-30-review-packet-source-repo-detection.md`
- live or dev-integration verification:
  - pending after broker rollout
- residual risk:
  - The draft command still needs operators to pass explicit `--repo-root`
    values for non-broker source repos; the durable guard prevents local ART
    scratch from being treated as source evidence when they forget.

## Follow-Up

- required follow-up:
  - none for the source detection defect after #483 closure
- owner:
  - `operator-orchestration-service`
- due date or closure condition:
  - #483 done with finalized Review Packet evidence
