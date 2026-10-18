---
security_evidence:
  review_areas: [identity, secrets, delivery, runtime, ai]
  findings: []
  risks: []
  workstreams: [WS-003, WS-005, WS-007]
  notes: Source preparation only. Fresh exact-source Security delta acceptance, dependent Console consumers and coherent Platform commissioning remain required. Existing source-identity review is background authority, not acceptance of these new source-purpose consumers.
---

# 2026-10-18 Console source authorization and Prototype authoring

## Summary

Extend the existing Platform operation and source-execution workflow with
canonical pre-session source authorization, expiry/renewal/revocation guards,
and explicitly Prototype-bound authoring preparation. Reuse bounded source
acceptance/recovery mechanics and private per-file persistence. This is an
in-progress source Landing Unit, not a completed Console capability.

## Classification

- area: Console-only source workflows and bounded Prototype authoring
- type: operator-approved cross-owner maintenance under the existing qualification path
- runtime impact: staged credential and source-purpose consumer changes; no service restart, deployment, permission grant, or model activation

## Ownership

- owner repo: `operator-orchestration-service`
- related ART slice: existing Epic #1275 and non-source qualification #1298; no fabricated work session or repair child
- related products or components: Console adapter, Platform source issuer/executor composition, Studio canonical records, CGG context admission and Security acceptance
- Landing Unit: `maintenance-1275-prototype-authoring-oos`, isolated for the real owner-repository/review/rollback boundary
- architecture decision: [Platform ADR-029](https://github.com/mfshaf7/platform-engineering/blob/main/docs/decisions/adr/ADR-029-source-intent-credential-effects.md), staged in Platform PR #320; not runtime authority before merge and final acceptance

## Root Cause

- immediate failure: new Console source work relies on engineering credential delivery, and Delivery-only authoring cannot legitimately operate on a Prototype registry identity
- actual root cause: previous reuse conflated existing source mechanics with an end-to-end commissioned Console workflow
- why it escaped earlier controls: producer/consumer and expiry-reapproval behavior were not exercised together through the normal business path
- pre-activation correction: fresh explicit reauthorization of unchanged work must not require invented branch/session churn; exact revoked-predecessor and canonical-scope checks remain mandatory

## Source Changes

- changed workflow, adapter, or contract: closed source-intent commands/receipts, server-derived preparations, before-journal authorization, deterministic within-scope renewal, terminal stop/revoke and historical acknowledgement recovery
- source enforcement: normal executor checks its private lease before each actual Agent write; token custody and human review/merge authority remain unchanged
- Prototype preparation: real registry/source request identity and separate executor namespace, trusted committed-source inspection, caller-owned durable metadata and private payload artifacts; no fake ART identifier
- Prototype workflow: scoped CGG projection with exact retained requests and no raw fallback; separately typed suspended model purpose; bounded draft, inert inspection, explicit digest acceptance, native Git apply/recovery, owner validation, Gary publication, human exact-head review/merge, terminal revoke and proven owned retirement
- operator/API surface: [Prototype Source Authoring](../../operations/prototype-source-authoring-operator-surface.md), caller-bound create/list/read/draft and finite workflow controls; reuse the existing composed source-work configuration/custody and Platform's native suspended Prototype-purpose profile, not a duplicate OOS activation manifest or flag
- shared implementation: existing bounded acceptance/apply/cancel/recovery code and private per-file transaction code are reused, not replaced by another service or control plane
- cold readback: detail retains the original source/generation requests; canonical ordering advances on every visible intermediate write, including same-clock writes; invalid generation/retry requests are rejected before credential effects; an explicitly verified authorization successor preserves interrupted generation identity
- source authorization recovery: public preparation exposes the original issue/revoke operation references through the existing operation-id contract; a local-only terminal stop acquires its first actual revoke-command reference without overwriting its original tombstone or subsequent replay identity
- Delivery integration: canonical prospective start decision survives reload before session creation; an optional source-effect envelope reference can adopt a verified explicit successor during accepted-source apply/recovery without changing model input; native source-binding revision advances canonical read ordering separately from the existing Work Session command revision
- trusted Preview preparation: a finite immutable owner intent is included before source authorization; the existing source draft/accept/apply/recovery/review path consumes Studio's deterministic plan without context or model invocation; executor-side re-rendering and exact file/content comparison prevent caller/model substitution and preserve ordinary model scope
- native Delivery-packet preparation: reuse admitted work/custody definitions and Studio's existing emitter/validator on an isolated exact-source snapshot; reject absent or changed canonical Baseline, derive real Git provenance, and admit only its emitted packet/registry backlink through the same exact acceptance/review path; no caller Baseline/Git evidence, new packet producer, target admission or Delivery application is implied
- tests or validator added: strict protocol, canonical prospective start, actual session binding, expired/stopped scope, fresh explicit successor, lost acknowledgement, uncertainty boundary, cross-subject/context denial, cold metadata/payload recovery and real owner-inspector compatibility
- related change records: Platform's corresponding staged authoring record; existing CGG and Studio producer records

## Artifact And Deployment Evidence

- source-only change, or build/deployment evidence: branch `fix/1275-prototype-authoring`, base `4c74d35b09864c12b4a63beb4fa8a23416381e70`; source is being prepared under Agent Gary, with exact-head human review and merge still required
- image tag or digest: None
- runtime revision: None

## Live Verification

- local validation: full authoring snapshot 1,444 run / 1,442 passed / 0 failed / 2 existing opt-in Studio-retirement skips; subsequent replay/ordering/source-authority suites 42 passed with no skips; all 195 implemented/documented API routes match; final committed CI-equivalent proof remains required
- host-native validation limitation: two newer full-suite attempts suffered native Node process SIGSEGV in different files; affected tests passed in isolation. These are not full validation passes and their cause remains unproven. Independent source work continues; source validation in the documented pinned runtime is recorded separately below, without claiming host crash resolution.
- bounded validation recovery: exact committed source `3802f0cd453fb9f0a9926b3b0a74db145466e545` passes full `npm test` in the existing repository-pinned Node 22.22.0 runtime with the native test prerequisites (`make` and executable disposable temporary files): 1,455 tests / 1,453 passed / no failures / two existing opt-in skips. The read-only-root, network-disabled test container is limited to 2 GiB RAM and two CPUs, and receives only the committed source archive, no host credentials or mounts. This proves that source in the documented runtime; it does not diagnose or repair the earlier host-native crashes. The first incomplete harness run failed its missing prerequisites and is not counted as a pass.
- committed CI-equivalent checks: fetched `origin/main` base-aware change-record and OpenProject mutation checks, orchestration/Refinement bundles, all documented schema/API checks, governance docs and validator self-test pass. Both native product images build, API health reports live and the unconfigured worker reports `run_allowed: false` in disposable network-isolated smoke containers. No accepted service, deployment or product Dockerfile was changed by the test harness.
- provider CI qualification: PR #350 passed tests and builds but failed its fixed-two-second API smoke wait. Local paired image probing observed accepted-source readiness at 1.79 seconds and staged-source readiness at 2.15 seconds with the same correct live response. The bounded readiness-retry correction handles connection refusal/reset, limits the wait and emits bounded failure diagnostics. On October19 the operator separately enabled Gary App Workflows write. Native maintenance opts in to an exact purpose/approval-bound Platform projection; ordinary runtime/source-intent credentials retain their original shape and permissions and reject this projection. No human publication fallback, new repair story or runtime activation is authorized. Updated provider CI still requires exact-head proof; preserve the merge/activation hold.
- trusted preparation evidence: focused workflow tests cover immutable approval scope, no model/context invocation, exact acceptance, cold lost-ack recovery and normal review/merge/revocation/cleanup; temporary real-Git tests prove executor re-rendering and deny substituted bytes/control paths. Native Studio planner/runtime-schema output also passes the actual OOS adapter and Console Preview consumer in a disposable clone, with no provider effects, live business mutation or operating-readiness claim.
- live or dev-integration verification: no deployment or business mutation performed; actual Platform sandbox issuer/loopback-provider receipts pass the OOS strict parser, and the real Studio producer/adapter reads the retained to-do Prototype without changing source
- residual risk: Prototype consumer source is still uncommitted and API/Console integration proof remains in progress; existing accepted runtime stays unchanged; no to-do app, private-client qualification, all-route readiness or Epic completion is claimed

## Follow-Up

- required follow-up: finish the existing eight-owner plan, including actual Prototype authoring, selected owner bootstrap/source transfer, Console controls, exact merged-source Security acceptance and coherent commissioning; then perform the preserved Console-only to-do witness and route/denial/cold-recovery proofs
- owner: `operator-orchestration-service`, with each long-lived authority retained by its existing owner
- due date or closure condition: before #1298 operating qualification and Epic #1275 completion; preserve Studio/WG merge holds until dependent sources and review inputs are ready
