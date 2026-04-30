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

# 2026-04-30 ART Review Packet Readiness Gate

## Summary

Added a broker-owned pre-merge Review Packet readiness gate so source-backed
ART work cannot be merged as a landing unit before item-level evidence,
changed-surface explanation, tests, validations, open PR evidence, and rollback
boundary are present.

## Classification

- area: delivery workflow
- type: workflow control and operator-surface hardening
- runtime impact: caller-authenticated broker route under `/v1/delivery-art`
  plus local ART CLI command
- ART slice: `#471` pre-merge landing-unit readiness defect under delivery
  `#420`

## Ownership

- owner repo: `operator-orchestration-service`
- related ART work:
  - `#420` control-fabric foundation Epic
  - `#426` architecture and operating-model Feature
  - `#471` pre-merge landing-unit readiness defect

## Root Cause

- immediate failure: one source-backed ART landing unit could merge after repo
  tests passed but before Review Packet item-completeness evidence was checked.
- actual root cause: the Review Packet lifecycle only had draft validation and
  post-merge finalization; there was no executable pre-merge readiness gate.
- why it escaped earlier controls: the process relied on operator or agent
  memory to check item-level evidence before merge, so a late corrective PR was
  needed after the first PR had already landed.

## Source Changes

- changed workflow, adapter, or contract:
  - added `validateReviewPacketReadiness` in
    [src/art-workflow-artifacts.js](../../../src/art-workflow-artifacts.js)
  - added `POST /v1/delivery-art/review-packets/readiness` in
    [src/app.js](../../../src/app.js)
  - added `npm run art -- review-packet readiness <packet.json>` in
    [src/art-cli.js](../../../src/art-cli.js)
  - documented the pre-merge operator sequence in
    [docs/operations/delivery-workflow-operator-surface.md](../../operations/delivery-workflow-operator-surface.md)
    and
    [docs/contracts/delivery-workflow-api-v1.md](../../contracts/delivery-workflow-api-v1.md)
  - tightened
    [scripts/validate_openproject_mutation_contracts.py](../../../scripts/validate_openproject_mutation_contracts.py)
    so artifact-only `/v1/delivery-art/...` routes are not misclassified as
    OpenProject mutation-surface changes
- tests or validator added:
  - artifact validator coverage for incomplete and complete pre-merge packets
  - HTTP route coverage for fail-closed readiness behavior
  - CLI coverage for the new readiness command
  - OpenProject mutation-contract validator self-test coverage for the artifact
    readiness route false-positive
- related change records:
  - [2026-04-29 ART Mutation Drafts And Review Packets](2026-04-29-art-mutation-drafts-and-review-packets.md)

## Artifact And Deployment Evidence

- source-only change before merge:
  - the readiness gate rejects draft packets with placeholders, missing
    `open_pr` evidence, missing changed-surface explanations, missing tests or
    validations, missing item-level completion mapping, empty repo change
    evidence, or unclear rollback boundary
- image tag or digest:
  - None
- runtime revision:
  - source route change requires normal broker rollout before live devint uses
    the new endpoint

## Live Verification

- local validation:
  - `npm test -- test/art-workflow-artifacts.test.js test/art-cli.test.js test/http.test.js`
  - `npm test`
  - `npm run validate:api-docs`
  - `npm run validate:governance-docs`
  - `python3 scripts/validate_change_record_requirement.py --repo-root . --changed-file src/app.js --changed-file src/art-cli.js --changed-file src/art-workflow-artifacts.js --changed-file scripts/validate_openproject_mutation_contracts.py --changed-file docs/api/openapi.json --changed-file docs/contracts/delivery-workflow-api-v1.md --changed-file docs/operations/delivery-workflow-operator-surface.md --changed-file docs/records/change-records/2026-04-30-art-review-packet-readiness-gate.md`
  - `python3 scripts/validate_openproject_mutation_contracts.py --repo-root . --self-test`
- live or dev-integration verification:
  - pending after broker rollout
- residual risk:
  - current gate validates packet evidence completeness, not whether GitHub CI
    has passed; the operator still checks PR status through the normal PR flow.

## Follow-Up

- required follow-up:
  - update workspace-governance skill/operator guidance so future ART source
    landings run readiness before merge
- owner:
  - `workspace-governance`
- due date or closure condition:
  - before closing `#471`
