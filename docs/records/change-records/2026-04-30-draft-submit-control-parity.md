---
security_evidence:
  review_areas:
    - delivery
    - runtime
  workstreams:
    - WS-007
  reviewed_artifacts:
    - src/art-cli.js
    - src/app.js
    - src/art-workflow-artifacts.js
    - docs/contracts/delivery-workflow-api-v1.md
    - docs/operations/delivery-workflow-operator-surface.md
    - docs/api/openapi.json
    - test/art-cli.test.js
    - test/art-workflow-artifacts.test.js
    - test/delivery-service.test.js
    - test/http.test.js
  notes: "Delivery broker control fix for managed draft submit projection checkpoints and PI-review request-shape parity."
---
# 2026-04-30 draft submit control parity

## Summary

This change closes two delivery-control gaps found during #435 and #476 closeout:
managed ART draft submits now mark the roadmap projection checkpoint dirty when
the broker reports external reconciliation, and PI-review draft/API validation
now accepts the documented raw OpenProject work-package id shape before submit.

## Classification

- area: delivery workflow broker
- type: defect remediation
- runtime impact: source change requiring dev-integration broker restart after merge

## Ownership

- owner repo: `operator-orchestration-service`
- related ART slice: `#479 Defect: Align draft-submit projection and PI-review draft contracts`
- related products or components: `Workspace Delivery ART`, OpenProject adapter, managed ART CLI

## Root Cause

- immediate failure: draft-submitted ART mutations returned
  `roadmap_version_projection.status = external_reconciler_required` but did
  not update `.art/projection-state.json`.
- immediate failure: the documented PI-review payload used an integer
  `target_work_package_id`, while the live HTTP route required a non-empty
  string and rejected the documented shape.
- actual root cause: direct broker mutations and managed draft submits used
  different post-submit projection handling, and PI-review request validation
  lacked draft/API/schema parity coverage.
- why it escaped earlier controls: existing checks covered direct mutation
  responses and completion evidence, but not the managed draft-submit return
  path or PI-review draft target-id semantics.

## Source Changes

- changed workflow, adapter, or contract: `draft submit` now invokes the same
  projection dirty-state checkpoint used by direct broker mutation commands.
- changed workflow, adapter, or contract: PI-review route validation accepts a
  positive integer or numeric string raw OpenProject work-package id and rejects
  broker-shaped ids at the managed draft layer.
- changed workflow, adapter, or contract: API and operator docs now state the
  PI-review target-id contract explicitly.
- tests or validator added: CLI projection checkpoint test, PI-review draft
  validation tests, delivery-service boundary assertion, and HTTP route
  request-shape test.
- related change records: `2026-04-30-art-projection-checkpoint.md`,
  `2026-04-30-parent-closeout-metadata-repair.md`

## Artifact And Deployment Evidence

- source-only change, or build/deployment evidence: source-backed ART defect
  remediation; merge and dev-integration restart evidence will be recorded in
  the #479 Review Packet and completion evidence.
- image tag or digest: None.
- runtime revision: pending merge.

## Live Verification

- local validation: `npm test`, `npm run validate:api-docs`,
  `npm run validate:governance-docs`, and `git diff --check` passed locally.
- live or dev-integration verification: pending post-merge broker restart and
  ART completion flow.
- residual risk: none known after focused tests; the residual operational risk
  is stale dev-integration runtime until the merged broker is restarted.

## OpenProject Mutation Contract Evidence

PI-review still uses the existing OpenProject work-package form schema for
`Actual Business Value` and `PI Objective Review Outcome`; this change does not
add a new writable field, allowedValues dependency, or read-only field override.
The broker route and managed mutation-draft validation now align with that
existing downstream form schema contract by accepting the raw OpenProject target
work-package id shape before the OpenProject adapter performs writable
field/form validation.

## Follow-Up

- required follow-up: restart dev-integration broker after merge and complete
  #479 through the managed draft/completion path with finalized Review Packet
  evidence.
- owner: `operator-orchestration-service`
- due date or closure condition: before resuming the next #420 ART front.
