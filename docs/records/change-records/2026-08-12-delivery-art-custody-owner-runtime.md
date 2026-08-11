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

# 2026-08-12 Delivery ART Custody Owner Runtime

## Summary

Implemented the OOS-owned, WGCF-backed lifecycle for scoped Delivery ART
architecture packets, work-start records, and schema-v2 Review Packets without
using OpenProject attachments as evidence custody.

## Classification

- area: Delivery ART workflow and evidence custody
- type: broker runtime, API contract, backend adapter, and operator workflow
- runtime impact: source-complete and fail closed; the persistent shared
  dev-integration profile does not activate schema-v2 artifact mutation
- ART slice: `#802` under delivery `#698`

## Ownership

- owner repo: `operator-orchestration-service`
- related ART work:
  - `#698` durable governance orchestration Epic
  - `#800` ART work-start, evidence, and closeout hardening Feature
  - `#802` scoped ART work-start and durable Review Packet Defect
- dependency already landed:
  - `#810` and `#813` WGCF immutable registry and custody chronology
- downstream boundary:
  - `#803` readiness evaluation and trusted readiness-receipt resolution

## Root Cause

- immediate failure: ART continuation rebuilt broad relation context,
  work-start decisions were not durable, and local Review Packet digests were
  trusted without immutable source custody.
- actual root cause: OOS had no contract-bound owner runtime joining scoped
  OpenProject reads, canonical artifact validation, WGCF persistence, and safe
  reference projection in one ordered transition.
- why it escaped earlier controls: the schema-v1 local Review Packet path
  treated evidence files as operator-managed closeout inputs and predated the
  workspace artifact registry contract.

## Source Changes

- changed workflow, adapter, or contract:
  - [contracts/delivery-art](../../../contracts/delivery-art) pins the
    workspace-owned schemas and valid custody closure fixtures by source commit
    and SHA-256 digest.
  - [src/delivery-art](../../../src/delivery-art) implements canonical JSON,
    semantic and dependency validation, WGCF registry access, and the ordered
    artifact service.
  - [src/openproject-client.js](../../../src/openproject-client.js) adds bounded
    ART scope capture and safe reference-only projection. The projection reads
    the live work-package form for the current lock version and patches only
    when the form marks `description` writable; a read-only form fails before
    mutation.
  - [src/app.js](../../../src/app.js), [src/runtime.js](../../../src/runtime.js),
    and [src/art-cli.js](../../../src/art-cli.js) expose the authenticated HTTP,
    runtime, and operator command boundaries.
  - [Dockerfile](../../../Dockerfile) includes the pinned Delivery ART contract
    bundle in both runtime image targets.
  - [docs/api/openapi.json](../../api/openapi.json),
    [docs/contracts/delivery-workflow-api-v1.md](../../contracts/delivery-workflow-api-v1.md),
    and
    [docs/operations/delivery-workflow-operator-surface.md](../../operations/delivery-workflow-operator-surface.md)
    document the public broker contract and fail-closed operator sequence.
- tests or validator added:
  - pinned-schema and custody-closure validation
  - scoped OpenProject read and safe projection tests
  - live form-schema coverage for writable and read-only `description`
  - WGCF registry authentication, bounds, and response-binding tests
  - complete artifact lifecycle, replay, stale-source, registry failure,
    projection failure, and caller-authority tests
  - HTTP and CLI boundary tests, including explicit readiness-receipt binding
- related change records:
  - [2026-08-11-review-packet-source-binding.md](2026-08-11-review-packet-source-binding.md)

## Artifact And Deployment Evidence

- source-only change:
  - OOS computes canonical digests and registers content through WGCF before
    any OpenProject projection.
  - OpenProject receives only exact source-artifact and custody-receipt refs.
  - registry failure prevents projection; projection failure preserves durable
    evidence; replay reuses the same content digest.
- image tag or digest:
  - None
- runtime revision:
  - None. The shared persistent profile explicitly leaves v2 artifact mutation
    disabled pending caller credential, single-writer, and readiness-resolver
    admission.

## Live Verification

- local validation:
  - `npm test` (`494` passed, `0` failed)
  - `npm run validate:orchestration-bundle`
  - `npm run validate:orchestration-openapi-schemas`
  - `npm run validate:api-docs`
  - `npm run validate:delivery-art-contracts`
  - `npm run validate:governance-docs`
  - `python3 scripts/validate_openproject_mutation_contracts.py --self-test`
  - `docker build --target api -t oos-api:art-802-test .`
  - `docker build --target orchestration-worker -t oos-worker:art-802-test .`
  - API image `/healthz` returned `{"ok":true,"status":"live"}`
  - worker image status returned `"run_allowed": false`
- live or dev-integration verification:
  - not applicable to this source-only Landing Unit; mutation remains disabled
    in the shared persistent profile
- residual risk:
  - operating-ready finalization remains unavailable until #803 supplies and
    binds the trusted readiness-receipt resolver
  - stage activation still requires explicit Security and Platform admission

## Follow-Up

- required follow-up:
  - implement #803 without weakening the caller, custody, or fresh-snapshot
    boundaries established here
  - dogfood the complete hardened lifecycle under #806 after readiness exists
- owner:
  - `operator-orchestration-service`
- due date or closure condition:
  - before enabling schema-v2 artifact mutation outside focused source tests
