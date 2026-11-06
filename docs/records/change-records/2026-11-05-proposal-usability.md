---
security_evidence:
  review_areas: [identity, secrets, runtime, delivery, ai]
  reviewed_artifacts:
    - src/model-operations/contracts.js
    - src/model-operations/service.js
    - contracts/governed-ai/effective-selection.schema.json
    - scripts/sync_model_operations_openapi.mjs
    - test/model-operations.test.js
    - contracts/model-profile-request
    - src/platform-operation/provider-client.js
    - test/model-profile-lifecycle.test.js
    - test/model-profile-request.test.js
    - src/model-profile-request/lifecycle.js
    - src/model-profile-request/decisions.js
    - src/model-profile-request/service.js
    - src/model-profile-request/store.js
    - scripts/sync_model_profile_request_openapi.mjs
    - src/model-profile-request/preparation.js
    - src/model-profile-request/runtime.js
    - src/model-operations/platform-client.js
    - src/app.js
    - src/config.js
    - src/runtime.js
    - contracts/proposal-workflow/register-result.schema.json
    - contracts/proposal-workflow/event.schema.json
    - src/proposal-workflow/register.js
    - src/proposal-workflow/service.js
    - src/openproject-client.js
    - test/proposal-register-http.test.js
    - test/proposal-register.test.js
    - test/proposal-scope.test.js
    - test/openproject-client.test.js
  findings: []
  risks: []
  workstreams: [WS-007]
  notes: Existing authenticated Proposal read and command boundary; bounded summaries are not write authority. Fresh source review distinguishes isolated conformance from later exact runtime acceptance.
---

# Proposal usability, original history and Model request preparation

## Summary

Replace the Console register's all-record snapshot/history fan-out with bounded
source summaries and selected-record reads. Preserve original disposition detail
in new journal events without rewriting old evidence. Reuse the native capture
lookup for uncertain responses and keep existing workflow authority intact.

## Profile lifecycle scope extension

The operator approved completion of the native profile lifecycle through the
Console, retaining this maintenance batch and its per-owner Landing Units.
Extend the existing OOS request/decision state, Platform operation store, native
lifecycle CLI, Gary maintenance publication and human exact-head merge. The
normal review now records an actual artifact atomically; explicit role-bound
Security acceptance is separate. The Console exposes impact, review, source
handoff, progress, running readback, original recovery and receipt-bound rollback.
The control does not require AI inference or available providers.

The Platform whole-tree acceptance check previously would invalidate itself on
profile changes. The same exact-source admission is extended only for a complete
native receipt/readback chain through the three policy files. Other source and
unreviewed policy still fail closed; no generic source trust bypass is added.
The operator-approved publication selects the existing preparation/lifecycle flags
in Platform policy; OOS defaults remain off and exact composition acceptance still
gates activation. Native original request/command/fulfillment/
receipt/projection schema bytes and the existing source lock remain compatible.
Source/controlled conformance and preview are separate from later commissioned
operating proof. See the
[fresh lifecycle assessment](https://github.com/mfshaf7/security-architecture/blob/main/docs/reviews/components/2026-11-06-model-profile-lifecycle.md).

## Classification

- Owner: Operator Orchestration Service
- Work home: operator-approved Console maintenance; no new ART repair item
- Landing Unit: `maintenance-proposal-usability-oos`
- Landing Unit Decision: `child_isolated_landing_unit`
- Split reason: distinct producer, consumer and Security owner/rollback boundaries
- Branch: `maintenance/proposal-usability`
- Base: `c0e66ca2333e7c239809930ca390018cf7623b50`
- Date: 2026-11-06

## Root Cause

The register enumerated every Proposal and opened every snapshot/history during
polling. History rendered only selected event kinds, ignored continuation, and
could use current projection detail for an older decision. Several submission
paths lacked pending/result feedback. These are source-proven boundaries;
there is no new hardware or corruption diagnosis in this change.

## Ownership

OOS owns the bounded register and canonical selected snapshot/history contracts.
Console owns their operator presentation; Security owns review, and Platform owns
runtime activation. No owner authority moves between them.

## Source Changes
A response returns at most 25 matching summaries after at most four native 25-row
pages, exact candidate-ID Delivery metadata, selector-bound continuation and
explicit whole-source counts. It never expands all Proposal journals or Delivery
child trees. Sparse search is a bounded scan with continuation, not indexed search.
Summary empty history is explicitly unloaded and does not authorize submission.

Exact Idea reads prove configured Workspace Proposals project and Idea type
before opening activities or reaching mutation logic. Foreign work packages
return not found. New disposition events optionally retain their exact accepted
decision command; historical comments remain unchanged. Selected snapshots
expose actual creation time when available. Console owns original-event
presentation, pending/error/result feedback and native source-lookup recovery.
No new workflow state, source permission or provider operation is introduced.

## OpenProject Contract Evidence

This is a read-only adapter scope/filter extension. No writable field,
allowedValues, form schema, status ID, machine-state persistence shape or
mutation payload changes. Existing mutation-form regression coverage remains in
`test/openproject-client.test.js`. New native scope tests use faithful project,
type and source metadata to prove foreign records are rejected before journals.
The only additional journal content is the optional original disposition
command under the already structured event; no historical event is rewritten.

## Artifact And Deployment Evidence

`test/proposal-register.test.js`, `test/proposal-register-http.test.js` and
`test/proposal-scope.test.js` exercise bounded global continuation, empty sparse
pages, selector/source changes, exact IDs, native HTTP auth/envelopes and
project/type guards. Proposal workflow tests cover immutable decisions alongside
existing source-version, replay, repository and target gates. OpenAPI schemas
and source-authority route catalog are generated from the same contracts.
The full broker suite passes locally, including existing mutation-form tests.
Isolated Console browser proof does not count as live OpenProject writes.

## Security, Sequence And Rollback

[Fresh source delta review](https://github.com/mfshaf7/security-architecture/blob/main/docs/reviews/components/2026-11-06-proposal-usability.md)
covers the read boundary, retained original evidence and unchanged command
controls. Its generated Security owner-record index must land with this evidence
before final closure. Publish after operator preview review, OOS producer before
dependent Console consumer, then use normal exact composed-source acceptance and
Platform activation. Existing accepted main/runtime remains unchanged meanwhile.
Rollback selects the prior paired sources; no canonical proposal or journal
migration is needed. No full-product readiness claim is made.

## Live Verification

Not deployed by this maintenance preview. Authenticated live readback follows
publication and normal activation; no real Proposal, repository or target
record has been created for this preview.

## Follow-Up

Keep this batch in isolated preview for operator review. Before publication,
finish owner base-aware checks on committed source, land Security index evidence
in dependency order and use normal exact runtime acceptance. Afterwards verify
live authenticated Proposal reads and retire source credentials/branches/worktrees.
Preview-only proof does not close that later deployment gate.


## Model request usability extension in this batch

The same unpublished OOS Landing Unit additionally repairs the existing profile
request's manual backend-coordinate burden. New authenticated setup and prepared
submission routes reuse the native profile service/store, the Platform
management client and existing CGG text admission. No model invocation,
security approval or activation is added. Strict operator input cannot supply
caller identity, output contract, context reference or an alternate endpoint.
The source digest binds only workflow-relevant setup, avoiding invalidation from
unrelated provider changes. Existing full-reference routes remain available.

Thirteen focused profile/preparation tests pass, including HTTP identity,
pre-create checks, genuine context-reference shape, native rule limits, replay,
concurrent original identity and failure-before-create. The full broker suite
passes1915 tests with2 existing skips. OpenAPI documents all248 implemented
routes; repeated generation is stable. These are source/isolated conformance
results, not live CGG, provider or profile activation qualification.

The [Model preparation source delta](https://github.com/mfshaf7/security-architecture/blob/main/docs/reviews/components/2026-11-06-model-profile-request-usability.md)
supplements the Proposal assessment for this batch. Land the Platform metadata
producer before this consumer, regenerate/land the Security owner-record index
from merged owner sources, then land the Console consumer. Exact composed
acceptance and explicit preparation commissioning follow operator preview
approval. The unchanged native-v1 schemas keep the existing Platform fulfillment
source lock valid; no blind source-lock or worker repinning is required.

## Model history and outcome repair extension

The same maintenance batch extends the existing profile list with optional
summary pages, keeping the original full response and all native mutation
schemas unchanged. Caller scoping, cursor ordering and full selected evidence
remain required. Summary projection omits context/receipts/event bodies and
avoids cloning historical events. The native JSON state is still loaded once
per requested page; no indexed-storage or global snapshot claim is made.
Console profile polling no longer enumerates history, and lazy25-row pages
cannot turn a history read failure into a failed profile registry. Dirty review
record/reference switches require discard. Confirmed connection receipts remain
confirmed if a later current-state/register read fails. Existing lifecycle
coverage and live session renewal are outside this repair Landing Unit.

Validation includes native full/summary cursor compatibility, caller scope and
metadata-only output,101-request Console traversal without per-row fan-out,
selected source-envelope freshness/conflict rejection, history failure isolation,
record/reference discard guards, retained original-command recovery, and separate
connection result/read errors for both metadata and credential operations.
These are isolated source checks, not live publication or provider qualification.


## Lifecycle Validation And Release Boundary

The final owner suite, native schema compatibility and all257 documented/runtime
routes pass. New controlled cases prove atomic persisted decisions, legacy
record compatibility, separate acceptance roles, source/candidate binding,
all-intent submission, original identity recovery and no-change rejection before
context effects. The five pinned native protocol schemas remain byte-identical.
The paired Console passes architecture, semantics, types and production build;
Platform tests exercise real native source apply/readback/rollback in disposable
repositories. These are source/controlled proofs, not live activation.

The existing preview batch remains unpublished. Preparation and lifecycle flags
are off. Source review, exact composed commissioning, normal session renewal if
stale, and the real disposable-profile Console witness remain release conditions.
Do not close the live lifecycle gap from source tests alone. No ART, improvement
candidate, provider grant or production write was created during this inspection.

## Explicit capability-profile selection and revision recovery

The operator approved multiple named permission profiles for each installed AI
capability with explicit selection. A capability is implemented integration code,
not an ART Feature or an authored business workflow. Existing model-management
configuration now accepts `profile.assign` with only capability/profile IDs.
It retains revision, operator, original-command, receipt, historical readback and
reconciliation checks. The catalog exposes registered compatible profile choices;
current configuration determines the selected choice. There is no default model
ranking, new service, storage subsystem or AI approval authority.

The base capability still authorizes its caller, context and output contract.
A selected permission preset adds restrictions; it cannot grant a different task
implementation or broader context access. Data-scope prose is reviewed policy
information, not an executable filter. Native source validation crosses the real
runtime resolver, including compatible variants and base-activation dependency.
Model routes keep stable capability/task identities. The optional selection
`policy_profile_id` identifies the effective preset under the same captured
configuration revision. Replaying an original invocation after selection changes
or process restart cannot trigger another inference.

`POST /v1/model-profile-requests/lifecycle/revise` refreshes source/context and
replaces the candidate only in a draft or changes-required request at its exact
revision. A stable command replays its saved result without readmitting context.
Acceptance clears on revision. Review-description edits remain metadata and
cannot silently remove prepared integration evidence. Direct technical setup is
explicitly a maintainer request, with automatic implementation unavailable until
actual preparation exists. Request text is not capability code or AI instructions.
The normal form supplies source-backed behavior guidance and allows operating
limits to be requested together with creation. Lifecycle/preparation deployment
flags remain off pending exact composition acceptance and an operating witness.


## Native context-admission commissioning correction

The real CGG admission for the disposable Console profile witness returned
`raw_projection: not_requested` with `redaction_safe: true`. This is CGG's normal
safe response when no raw data was requested and no sensitive finding requires
an explicit denial. The new profile adapter incorrectly accepted only `denied`.
Align it with the existing Agent Console, Work Design and Refinement consumers:
accept exactly `not_requested` or `denied`, still requiring a valid owned
artifact identity/digest and `redaction_safe: true`. Raw-allowed, unknown and
unsafe decisions remain rejected before any profile request is created.

The existing preparation fixture now models the native clean admission rather
than always forcing denial. Regression checks cover both valid states and
unsafe/unknown decisions. The original failed live admission is retained
privately; no real profile was created by that failed attempt.

Required owner maintenance Landing Unit decision `child_isolated_landing_unit`,
`maintenance-profile-context-admission-oos`, branch
`maintenance/profile-context-admission`, base
`972cf6150f10d9d29521d53b3368a7c1e62346dc`. The prior batch source has merged;
this is its bounded commissioning repair, with no new ART item, subsystem,
AI permission or context export. Exact composed Security acceptance and normal
runtime activation must precede the resumed actual Console operating witness.
