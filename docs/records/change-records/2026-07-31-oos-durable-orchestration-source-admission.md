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
    - src/orchestration/constants.js
    - src/orchestration/contracts.js
    - src/orchestration/service.js
    - src/orchestration/temporal-adapter.js
    - src/orchestration/run-projection.js
    - src/orchestration/workflows.js
    - src/orchestration/worker.js
    - contracts/orchestration/run-control.schema.json
    - contracts/orchestration/run-binding.schema.json
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
  notes: "The implementation follows the 2026-07-31 Temporal build-admission review and is paired with merged WGCF PR #39 source head c59f34b6893a763df82184fc54c6c6dc1982c38e for bounded owner-process termination, cancellation-shielded cleanup, committed artifact-reference custody, and staging-to-atomic-commit evidence fencing. Platform PR #195, merge f3855b15afaaa570ab2643d08821961eff9ea5af, admits the matching generated queue contract and revoked-digest non-reuse rule. This change adds source, packages, and a zero-replica worker only; no Temporal runtime or workflow execution is activated. Every Platform activation manifest digest derives a one-way workflow task-queue generation so a late pre-revocation start cannot execute after reactivation. Platform payload admission and namespace, generated task-queue, workload-identity, and network operating proof remain mandatory activation gates."
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
  projection, intent, activation generation, correlation, caller, operator,
  and approval refs
- worker-independent `202` admission receipts carrying the stable run id and a
  nullable projection, with aggregate state read from the run resource
- bounded immutable Temporal memo bindings used to verify duplicate starts
  without a workflow query, with missing or malformed bindings denied as
  unverified runtime state
- recoverable Temporal client creation so a transient failed connection is not
  cached until the API restarts
- exact approval scope binding and ordered decision/expiry enforcement
- strict RFC 3339 approval timestamp acceptance with calendar and time
  validation before canonical UTC normalization
- terminal no-effect projection and aggregate receipt when approval expires
  between API admission and the Temporal durable-start event
- deterministic Temporal workflow plus separate workflow-safe validators
- exact workflow-entry validation against the bounded history schema
- exact bounded WGCF result correlation to the dispatched activity request
- rejection of contradictory ready results unless validation, readiness, and
  receipt outcomes all prove success with no remaining readiness reasons
- rejection of non-ready results unless readiness is blocked with at least one
  retained reason
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
- retained immediate-terminal-start, completed-run, duplicate-start, and
  post-control reads from Temporal workflow results so audit access remains
  available after the workflow worker is scaled to zero
- retained control reconciliation that requires every immutable control field
  for success, distinguishes a missing run from a closed run where the control
  was not applied, and rejects control-id or idempotency-key reuse against a
  different immutable binding
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
- activation-manifest-digest workflow queue generations retained in the
  bounded input, immutable memo, aggregate projection, and final receipt;
  ordinary same-manifest restarts retain their queue, while every fresh
  activation must issue a new digest and therefore cannot poll a retired queue
- generation-scoped revocation visibility and cancellation so an old worker
  cannot cancel fresh-generation requests during a rollout, and an API request
  accepted before revocation but durably started after the old worker exits
  remains non-executable on the retired queue
- target-only lifecycle-control verification that still fences a
  digest-pinned Temporal target after an authority record is revoked, while
  starts and ordinary reads continue to require the complete authority set
- workflow-control cancellation of every running execution in the pinned
  activation generation so outstanding owner activities and retries stop and
  each workflow records its terminal projection and aggregate receipt before
  the revoked worker process exits
- explicit wait-for-cancellation-completion activity semantics paired with
  WGCF process-group isolation, two-second cancellation heartbeats, a
  four-minute owner budget beginning before spawn, five-second termination
  grace, five-second group-exit confirmation, one-second communication drain,
  no heartbeat-based server completion, and a five-minute start-to-close retry
  fence
- WGCF attempt-local staging with an idempotent atomic canonical-evidence
  commit only after process-group exit is confirmed; failed, cancelled,
  timed-out, or unfenced attempts remain non-canonical
- WGCF receipt and ledger artifact references authored against the future
  committed root while bytes remain staged, with cancellation propagated only
  after the bounded stop-and-confirm fence returns
- exact paired owner-boundary revision:
  `workspace-governance-control-fabric` PR #39 at
  `c59f34b6893a763df82184fc54c6c6dc1982c38e`, whose tests prove bounded
  process-group exit confirmation, cancellation-shielded cleanup,
  staged-output isolation, committed artifact-reference custody, atomic
  commit, quarantine, and idempotent committed replay across normal
  completion, owner failure, timeout, or cancellation
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
- bounded projection of only admitted WGCF activity failure types, with unknown
  Temporal or owner exception types normalized to the retryable activity class
- separate API and workflow-worker image targets
- glibc-compatible Node runtime image required by Temporal's native bridge
- WGCF source-domain binding to ART `#698` and its immutable source revision
- zero-replica worker identity in the accepted-idea-delivery profile
- primary operator instructions and activation denial procedure

## Artifact And Deployment Evidence

- source-only change, or build/deployment evidence: local source and image-build
  proof only; no runtime activation
- local API image proof: exact-source image `oos-api:698-61f87e6`, digest
  `sha256:0997a52b81b70f205bb620bcf1e46613bee94837e4416ab7e7bccecbe59f9fcf`,
  built from `61f87e6b729cd89cb9b2dbd84072a20b3932d375`; `/healthz`
  returned `{"ok":true,"status":"live"}`
- local worker image proof:
  exact-source image `oos-orchestration-worker:698-61f87e6`, digest
  `sha256:3c9d226ccff5986835844eb14e1c63a106c47d8c33d8ff88d7ea4ac89f669499`,
  built from `61f87e6b729cd89cb9b2dbd84072a20b3932d375`; worker status
  returned `run_allowed: false` with no activation generation or task queue
- paired WGCF image proof: `wgcf-worker:698-c59f34b`, digest
  `sha256:625f0bc3e3c5546bea6badd2b86de80997d6f225bfd549ae1eac89f3057f5cd8`,
  reported `build-admitted-disabled`; its bounded child protocol returned only
  `WGCF_CONTRACT_REJECTED` for the invalid smoke envelope
- image tag or durable digest: deferred to the post-merge build workflow
- runtime revision: no active Temporal runtime or workflow worker

## Live Verification

- `npm test`: 390 tests passed, including activation-generation isolation,
  cross-generation duplicate rejection, old-generation worker retirement, and
  generation-scoped revocation scans
- paired WGCF exact-head proof: 198 tests passed, including bounded descendant
  cleanup, cancellation during cleanup, pre-spawn deadline enforcement,
  unconfirmed-group rejection, staged-output isolation, committed
  artifact-reference custody, quarantine, atomic commit, and committed-result
  replay without rerunning the owner
- paired WGCF container proof: one canonical committed root with no remaining
  staging root, six resolving artifact references with no staging paths,
  followed by an idempotent replay that returned the same blocked readiness
  result without rerunning the owner
- paired Platform source-contract proof: PR #195 merged as
  `f3855b15afaaa570ab2643d08821961eff9ea5af`; its exact CI validation proves
  the activation-manifest-digest queue pattern, same-active-manifest restart
  reuse, and revoked-digest non-reuse while the profile remains non-active
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

- required follow-up: Platform must admit the exact bounded history and memo
  fields, including `schema_version`, `request_ref`, source-projection refs,
  `caller_id`, activation-evidence digest, generated workflow queue, and the
  immutable duplicate-binding references, plus the cross-namespace identity
  and network boundary. Platform must never reuse a revoked activation
  manifest digest. Fresh Security activation review and ART `#726`
  restart-safe dev-integration proof follow that acceptance.
- owner: Platform Engineering, Security Architecture, and OOS according to
  their existing boundaries.
- due date or closure condition: accepted operating evidence activates the
  profile and covers `#726`.
