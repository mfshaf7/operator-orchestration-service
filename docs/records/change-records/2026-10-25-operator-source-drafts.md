---
security_evidence:
  review_areas: [identity, secrets, delivery, runtime, ai]
  reviewed_artifacts:
    - src/source-authoring/operator-drafts.js
    - src/source-authoring/prototype-realization.js
    - src/source-authoring/prototype-source-adapter.js
    - src/delivery-art/source-realization.js
    - src/delivery-art/source-executor.js
    - src/delivery-art/work-session-cli-adapters.js
    - src/delivery-art/work-session-service.js
    - src/app.js
    - contracts/delivery-art-work-session/operator-source-draft.schema.json
    - docs/operations/operator-source-editing.md
  findings: []
  risks: []
  workstreams: [WS-003, WS-005, WS-007]
  notes: Source implementation under1325 only. Existing source authorization and Gary/human authority are reused. Exact composed editor/import Security acceptance belongs to1327 after merged OOS/Console source; this record does not grant activation or claim operating readiness.
---

# Operator source drafts

## Summary

Retain operator-authored/imported text and amendments of generated source through
one bounded OOS draft kernel, used by both Prototype and ordinary Delivery.
Expose caller-bound selected-file and exact draft reads while preserving the
existing separate acceptance, Gary apply and review/merge/recovery path.

## Classification

- area: existing bounded source authoring and private draft custody
- type: accepted capability extension, source-backed ART1325
- runtime impact: source/API preparation; coordinated Console1326, exact
  Security1327 and existing Platform commissioning1328 precede operating proof

## Ownership

- owner repo: operator-orchestration-service
- ART: Epic1323 / Feature1324 / User story1325
- Landing Unit: `delivery-1323-source-editor-operator-drafts`, isolated because
  Console, Security and application source have separate owner/rollback paths
- architecture: `architecture-packet:delivery-1323-v1`, schema6,
  `sha256:f6a94576b59f2ad775263ca738127a5295537cae94206731c03623c61e329009`
- primary procedure: [Operator source editing](../../operations/operator-source-editing.md)

## Root Cause

This is new capability, not a newly invented Defect. Existing Prototype tooling
inspected generated text read-only; Delivery projected draft metadata. Neither
exposed manual/import save. Accepted-base inspection selected extension of the
existing owner workflow rather than a remote IDE, new service, host mount,
credential class or independent source ledger.

## Source Changes

- Shared closed operator command, private retained revisions, explicit amendment
  provenance, original acknowledgement replay, expected revision/digest and
  original execution/objective binding. Model evidence does not attest amended
  bytes; manual input neither invokes a model nor mutates Git.
- Existing isolated source reader adds a tree-only selector and scoped batches.
  Existing apply preparation is reused as an effect-free draft preflight,
  including actual clean base, paths, symlinks and baseline digests. Strict
  UTF-8/BOM handling prevents silent replacement of invalid existing bytes.
- Existing64KiB/file,64-operation/512KiB changed-text and1MiB executor wire bounds
  remain enforced before save, including escaped JSON and future command size.
- Prototype canonical app/design scope is distinct from ordinary Delivery;
  trusted owner preparations stay read-only. Existing control ownership,
  source leases and Gary/human separation remain unchanged.
- Delivery resolves the actual requested work item through canonical covered
  work-item IDs, rather than an undeclared field on Work Session records. Its
  API proof uses the real persisted session schema.
- Both authenticated API facades expose selected files, exact private draft
  content and inert saves. Current source envelopes and OpenAPI generation
  include the new reads without a raw-context or credential fallback.

## Artifact And Deployment Evidence

Local proof against owner base4105930 passes1633 tests, with two existing optional
Studio checks skipped by their normal test preconditions. Thirteen owner
bundle/schema/API/governance/whitespace checks pass. No new runtime or acceptance
is asserted by this source record. Merged source, native
Review Packet and PR/check evidence will identify the final owner revision.
The all-owner planning check found compatible existing evidence commands before
source start; ordinary LittleList app proof retains unconditional app checks.

## Live Verification

Focused tests exercise actual private Prototype storage, native authenticated
API DTOs/source envelopes, shared manual/import/amend/replay and uncertainty
semantics, actual Git read/validation/apply, unsafe source and serialized-wire
bounds. Test fixtures are explicitly source proof. Actual Console editor/import
and real application delivery qualification belong to1328/1329 after exact
composed acceptance; neither is replaced by mocked success.

## Follow-Up

- Finish source CI-equivalent checks and native exact-head review/merge.
- Refresh the existing generated Security change-record index from owner main
  before final source closure; do not treat it as composed runtime acceptance.
- Land Console1326, accept exact composed sources in1327, then recommission the
  existing runtime and prove real source workflows in1328/1329.
- Retire only this Landing Unit's credentials, worktree and local/remote branch
  through its original source authorization and completion path.
