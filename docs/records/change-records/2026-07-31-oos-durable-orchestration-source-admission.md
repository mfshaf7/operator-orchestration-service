---
security_evidence:
  review_areas:
    - identity
    - secrets
    - delivery
    - runtime
  reviewed_artifacts:
    - src/app.js
    - src/config.js
    - src/orchestration/activation-evidence.js
    - src/orchestration/service.js
    - src/orchestration/temporal-adapter.js
    - src/orchestration/run-projection.js
    - src/orchestration/workflows.js
    - src/orchestration/worker.js
    - contracts/orchestration/run-control.schema.json
    - contracts/orchestration/run-request.schema.json
    - contracts/orchestration/workflow-input.schema.json
    - contracts/orchestration/run-projection.schema.json
    - contracts/orchestration/activation-evidence-manifest.schema.json
    - contracts/orchestration/activation-evidence-record.schema.json
    - docs/api/openapi.json
    - docs/contracts/durable-orchestration-v1.md
    - docs/architecture/durable-orchestration-runtime.md
  findings: []
  risks: []
  workstreams:
    - WS-007
  notes: "The implementation follows the 2026-07-31 Temporal build-admission review. It adds source, packages, and a zero-replica worker only; no Temporal runtime or workflow execution is activated. Platform payload admission and namespace, task-queue, workload-identity, and network operating proof remain mandatory activation gates."
---

# 2026-07-31 OOS Durable Orchestration Source Admission

## Summary

Implement the OOS-owned durable orchestration boundary for the
`validation-readiness-run` proof while keeping runtime execution fail closed.

## Classification

- area: shared operator orchestration
- type: source implementation and runtime-boundary hardening
- runtime impact: new API and worker artifacts; worker remains at zero replicas

## Ownership

- owner repo: `operator-orchestration-service`
- related ART slice: `#721`, covering `#722-#725` and `#727`
- related products or components: OOS, Temporal, WGCF

## Root Cause

- immediate gap: OOS had no durable workflow definition, worker, run-control,
  or aggregate projection implementation.
- architectural cause: the earlier synchronous broker correctly deferred
  persistence until a real restart-safe workflow requirement existed.
- control response: extend OOS behind a replaceable runtime adapter without
  moving business authority into Temporal.

## Design Decision

- OOS owns definition, request, run, control, aggregate projection, and final
  receipt behavior.
- Temporal owns only durable scheduling, replay, waits, and activity dispatch.
- WGCF owns the validation and readiness activity result.
- The rich OOS request is reduced to reference-only workflow input before it
  enters Temporal history.

## Source Changes

- strict request, control, projection, definition, and API contracts
- exact OpenAPI projection of every reviewed definition field, with unknown
  top-level fields rejected
- canonical intent digest and bounded approval freshness enforcement
- immutable duplicate-start binding across request, source version, source
  projection, intent, correlation, caller, operator, and approval refs
- exact approval scope binding and ordered decision/expiry enforcement
- deterministic Temporal workflow plus separate workflow-safe validators
- exact workflow-entry validation against the bounded history schema
- exact bounded WGCF result correlation to the dispatched activity request
- rejection of contradictory ready results unless validation, readiness, and
  receipt outcomes all prove success with no remaining readiness reasons
- aggregate run events, blockers, controls, retries, and receipts with strict
  nested field contracts and monotonic bounded event rollover
- caller, operator, and approval reference correlation in the durable
  projection and final aggregate receipt without retaining credentials
- digest-bound WGCF receipt references in both the aggregate projection and
  final receipt, with duplicate receipt ids rejected
- run-surface authorization restricted to the Governance Operations Console
- durable run rejection when broker caller authentication is not configured,
  even if a development-bypass request claims the admitted caller id
- fail-closed run listing when any aggregate projection cannot be validated
- stable not-found mapping for missing or expired Temporal run records
- retained completed-run reads from Temporal workflow results so audit access
  remains available after the workflow worker is scaled to zero
- complete ten-evidence-gate, caller-authentication, and three-runtime-switch
  activation projection
  backed by one Platform-issued, expiry-bound, digest-pinned evidence bundle
- exact resolution and digest verification of each gate-owned record inside
  that read-only bundle
- exact binding of the accepted bundle to the configured Temporal address and
  namespace plus separate, non-shared API and workflow-worker process
  identities
- API read denial before client creation when the digest-pinned Temporal target
  or API identity or any pinned authority record cannot be verified, while
  retaining audit reads after expiry on the previously admitted target without
  relaxing issuance or lifetime ordering
- periodic worker revalidation with shutdown when activation evidence is
  missing, expired, altered, target-mismatched, or otherwise revoked
- workflow-control cancellation of every running definition execution on
  activation revocation so outstanding owner activities and retries stop and
  each workflow records its terminal projection and aggregate receipt before
  the revoked worker process exits
- dedicated revocation-fence client connection with retry-until-confirmed
  behavior on both live revocation and denied worker startup
- seven consecutive empty Temporal visibility scans over 30 seconds before a
  revocation fence is accepted, with the drain reset by any execution, RPC
  error, or terminal-projection verification failure
- denied-startup refusal to connect or fence when the digest-pinned target or
  role-specific identity cannot be independently verified
- removal of loose per-gate environment references that could be satisfied by
  unverified placeholder strings
- projection-authorized controls with dequeue-time revalidation, one queued
  retry or resume, bounded attempts, and active cancellation
- separate API and workflow-worker image targets
- glibc-compatible Node runtime image required by Temporal's native bridge
- WGCF source-domain binding to ART `#698` and its immutable source revision
- zero-replica worker identity in the accepted-idea-delivery profile
- primary operator instructions and activation denial procedure

## Artifact And Deployment Evidence

- source-only change, or build/deployment evidence: local source and image-build
  proof only; no runtime activation
- local API image proof: `docker build --target api -t oos-api:698 .`
  completed and `/healthz` returned `{"ok":true,"status":"live"}`
- local worker image proof:
  `docker build --target orchestration-worker -t oos-orchestration-worker:698 .`
  completed and worker status returned `run_allowed: false`
- image tag or durable digest: deferred to the post-merge build workflow
- runtime revision: no active Temporal runtime or workflow worker

## Live Verification

- `npm test`: 363 tests passed
- `npm run validate:orchestration-bundle`: workflow bundle compiled
- `npm run validate:api-docs`: 56 documented and implemented routes matched
- `npm run validate:governance-docs`: passed
- `npm audit --omit=dev`: zero vulnerabilities
- base-aware change-record and OpenProject mutation validators against
  `origin/main`: passed
- API and workflow-worker Docker target builds: passed
- worker status proved `run_allowed: false` and reported the evidence manifest
  path, manifest digest, and three runtime switches as missing without
  attempting a Temporal connection

No live workflow execution is claimed. That proof belongs to ART `#726` after
runtime activation.

## Follow-Up

- required follow-up: Platform must admit the exact bounded history fields,
  including `schema_version`, `request_ref`, source-projection refs, and
  `caller_id`, plus the cross-namespace identity and network boundary. Fresh
  Security activation review and ART `#726` restart-safe dev-integration proof
  follow that acceptance.
- owner: Platform Engineering, Security Architecture, and OOS according to
  their existing boundaries.
- due date or closure condition: accepted operating evidence activates the
  profile and covers `#726`.
