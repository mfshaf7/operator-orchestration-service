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

# 2026-04-24 ART Completion Evidence Preflight

## Summary

`operator-orchestration-service` now exposes a local completion-evidence
preflight so ART closeout evidence can fail before the broker write instead of
failing first at the live OpenProject-backed completion boundary.

## Classification

- owner repo: `operator-orchestration-service`
- related control planes:
  - `workspace-governance`
- trust-boundary areas:
  - runtime
  - delivery

## Ownership

- completion-evidence rule source, local preflight command, and broker write
  reuse: `operator-orchestration-service`
- future ART closeout routing guidance in skills or workspace doctrine:
  `workspace-governance`

## Root Cause

The strict completion-evidence rules already existed in broker runtime code,
but they were not surfaced as their own local preflight step. The API contract
showed a correct example, while the schema itself still treated the evidence
fields as generic strings. That left enough ambiguity for malformed evidence to
reach the broker write path and fail there instead of failing locally first.

## Source Changes

- added [src/completion-evidence.js](../../../src/completion-evidence.js) as
  the shared completion-evidence rule source
- updated [src/openproject-client.js](../../../src/openproject-client.js) to
  reuse the shared completion-evidence module during broker completion writes
- added the local preflight command in
  [scripts/validate_completion_evidence.mjs](../../../scripts/validate_completion_evidence.mjs)
- added `npm run validate:completion-evidence`
- added [test/completion-evidence.test.js](../../../test/completion-evidence.test.js)
- updated the operator-facing and contract surfaces in:
  - [README.md](../../../README.md)
  - [docs/api/README.md](../../api/README.md)
  - [docs/api/openapi.json](../../api/openapi.json)
  - [docs/contracts/delivery-workflow-api-v1.md](../../contracts/delivery-workflow-api-v1.md)
  - [docs/operations/delivery-workflow-operator-surface.md](../../operations/delivery-workflow-operator-surface.md)

## Artifact And Deployment Evidence

- artifact:
  - local completion-evidence preflight script
  - shared completion-evidence runtime module
- proof:
  - local CLI validation and broker-path unit coverage

## Live Verification

- `npm run validate:completion-evidence -- /tmp/.../valid.json`
- `npm test`
- `npm run validate:api-docs`
- `npm run validate:governance-docs`
- `python3 scripts/validate_change_record_requirement.py --repo-root . --against-ref origin/main`
- `git diff --check`

## Follow-Up

- update ART workflow guidance so future completion writes call the local
  completion-evidence preflight before the broker route
- if the complete-route contract becomes more structured later, encode the
  evidence prefix rules directly in the machine-readable schema as well
