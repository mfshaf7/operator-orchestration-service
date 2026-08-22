---
security_evidence:
  review_areas:
    - identity
    - secrets
    - delivery
    - runtime
  reviewed_artifacts:
    - contracts/delivery-art-lifecycle/capabilities.json
    - contracts/delivery-art-work-session/decision.schema.json
    - contracts/delivery-art-work-session/work-session.schema.json
    - src/art-cli.js
    - src/delivery-art/lifecycle.js
    - src/delivery-art/service.js
    - src/delivery-art/work-session-cli-adapters.js
    - src/delivery-art/work-session-controller.js
    - src/delivery-art/work-session-store.js
    - src/delivery-art/work-session.js
  findings: []
  risks: []
  workstreams:
    - WS-007
---

# 2026-08-23 Delivery ART Work-Session Lifecycle

## Summary

Added one reconstructable operator path for starting, inspecting, continuing,
and closing source-backed Delivery ART work without making operators rebuild the
lifecycle procedure from scattered commands after a restart or worktree move.

## Classification

- area: Workspace Delivery ART source lifecycle
- type: operator workflow, external coordination state, lifecycle projection,
  and source-worktree reconstruction
- runtime impact: source change only until merge and the separate
  workspace-governance activation item complete; no stage or production change

## Ownership

- owner repo: `operator-orchestration-service`
- related ART slice: User story `#963` under delivery `#958`
- related products or components:
  - `operator-orchestration-service`
  - Workspace Delivery ART
  - `workspace-governance-control-fabric`
  - `workspace-governance`

## Root Cause

- immediate failure: operators had to reconstruct lifecycle plans, artifact
  paths, source-worktree state, and the next valid command after process or
  machine interruption.
- actual root cause: the lifecycle controller implemented durable transitions,
  but its normal operator path still depended on a caller-managed plan file and
  treated every ART snapshot change as historical-artifact staleness.
- why it escaped earlier controls: transition tests proved exact candidate
  freshness and lifecycle mechanics, but did not distinguish immutable material
  decision truth from ordinary ART progress or dogfood restart and relocation.

## Source Changes

- changed workflow, adapter, or contract:
  - added `work start`, `work status`, `work continue`, and `work close` as the
    normal Delivery ART operator commands with scoped help
  - added schema-validated, atomic, secret-free coordination state outside Git
    worktrees with private directories, collision-free work-item and Landing
    Unit aliases, and serialized creation across overlapping scopes
  - added exact base resolution and source-worktree reconstruction without
    persisting absolute worktree paths
  - retained lifecycle-plan commands as compatibility and recovery surfaces
  - separated exact candidate freshness from material historical-decision
    freshness so ordinary ART progress does not invalidate approved architecture
    or durable work-start evidence
  - preserved explicit human gates for architecture, Landing Unit decisions,
    exceptions, pull-request review, merge, Security acceptance, and ART closeout
- tests or validator added:
  - process restart, worktree relocation, cleanup, and multi-item Landing Unit
    reconstruction
  - corrupt state, missing artifact, ambiguous alias, concurrent lock,
    unauthorized closeout, and material architecture-drift failures
  - bounded CLI failure output with exactly one repair action
  - real Git branch-worktree reconstruction
  - capability, contract-bundle, API-documentation, and historical-freshness
    regression coverage
- related change records:
  - [2026-08-12-delivery-art-lifecycle-reconciliation.md](2026-08-12-delivery-art-lifecycle-reconciliation.md)
  - [2026-08-14-delivery-art-terminal-lifecycle-custody.md](2026-08-14-delivery-art-terminal-lifecycle-custody.md)
- governing architecture evidence:
  - durable architecture packet
    `wgcf://artifacts/delivery-art/sha256/879527d9905bfd4a9108c51dec5d1d875118c1fd7e5d82f4deaabdf0cb87814a`
  - workspace-governance contract PR `#154`, merged as
    `fa8df763333990bb84256184cfd050e7c5c099ee`

## Artifact And Deployment Evidence

- source-only change, or build/deployment evidence: source-only pending OOS
  pull-request review, exact-head Security acceptance, merge, and separate
  workspace-governance activation
- image tag or digest: None
- runtime revision: None

## Live Verification

- local validation:
  - focused work-session and CLI-adapter suite (`15` passed)
  - full repository suite (`614` passed)
  - API documentation, governance documentation, orchestration bundle,
    OpenAPI-schema synchronization, Delivery ART contract synchronization, and
    base-aware change-record and OpenProject-mutation checks passed against
    fetched `origin/main`
  - API and orchestration-worker images built; the API health probe and
    fail-closed worker-status smoke checks passed
- live or dev-integration verification: pending exact-head dogfood after the
  changed OOS service is available in the dev-integration lane
- residual risk: the workspace-governance capability projection remains on its
  pre-activation version until ART item `#964` lands after this source change;
  the normal work-session path must not be represented as workspace-active
  before that sequence completes

## Follow-Up

- required follow-up:
  - obtain exact-head Security acceptance through ART item `#962`
  - merge the OOS Landing Unit for `#963`
  - activate workspace-governance capability parity through ART item `#964`
  - dogfood restart, relocation, cleanup, and closeout through the activated path
- owner: `security-architecture`, `operator-orchestration-service`, then
  `workspace-governance`
- due date or closure condition: before delivery `#958` is closed or this path
  is described as the normal workspace operator lifecycle
