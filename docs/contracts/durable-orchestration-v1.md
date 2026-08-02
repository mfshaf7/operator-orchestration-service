# Durable Orchestration Contract v1

## Purpose

This contract defines the OOS-owned boundary for durable workflows that must
survive process restarts, wait for external decisions, apply controlled retry,
or coordinate bounded activity owners.

The first definition is `validation-readiness-run` version `1`. It is a
read-only runtime proof that delegates one validation and readiness activity to
Workspace Governance Control Fabric (WGCF).

## Authority

OOS owns:

- immutable workflow definition versions
- request admission and approval validation
- stable run ids and idempotent start behavior
- aggregate run projection and controls
- correlation, causation, events, and final orchestration receipts

Temporal owns only durable scheduling, replay, waits, and activity retry
dispatch. WGCF owns the validation and readiness decision and its receipt.
Governance Operations Console calls OOS and never receives Temporal
credentials.

## Current Lifecycle

The implementation is source-admitted and execution-disabled:

- the definition catalog is readable
- the workflow bundle is buildable
- the worker deployment is declared with zero replicas
- run starts and controls fail closed
- no source merge or ART status change activates execution

The definition remains `admission-review` until every runtime activation gate
is satisfied.

Activation evidence is admitted only through one Platform-issued, read-only
bundle whose manifest bytes are SHA-256 pinned by deployment configuration.
The manifest binds this immutable definition version to an `active` Temporal
profile, the admitted Temporal address and namespace, the admitted API and
workflow-worker identities bound to those exact process roles, and a current
Platform activation decision. OOS rejects the bundle if the configured
Temporal target or role-specific process identity differs, or if the two roles
share one identity. It then
resolves every fixed bundle record and verifies its digest, exact gate, owner,
accepted outcome, source version, and authority reference. Loose per-gate
environment strings are not evidence and are ignored.

The authenticated run API caller is restricted to
`governance-operations-console`, must be present in `CALLER_ALLOWED_IDS`, and
must authenticate with the configured shared caller credential. The generic
development bypass is never accepted by the durable run service. Other
authenticated OOS callers may inspect the definition catalog but cannot list,
read, start, or control durable runs.

Run reads require the runtime switch and a digest-pinned Temporal address,
namespace, and API identity match before the API creates a Temporal client.
Audit reads remain available after time-sensitive activation evidence expires
only when that immutable target binding and every digest-pinned evidence record
still verify. Expiry is the only activation check relaxed for retained audit
reads; missing, altered, owner-mismatched, or target-mismatched evidence never
causes the API to contact the configured runtime.

### Controlled Commissioning Boundary

The controlled commissioning proof is intentionally separate from normal
durable-run activation. It exists only to execute the exact scenario set in a
consumed workspace controlled-proof authorization while the Temporal profile
remains `build-admitted`.

OOS accepts this path only when all of the following agree:

- authenticated caller `platform-controlled-proof-executor`
- one digest-pinned controlled-proof execution context
- one authorization and commissioning session
- one scenario execution already enumerated by that session
- exact Temporal address, namespace, API identity, worker identity, workflow
  queue, and WGCF activity queue
- exact OOS and WGCF source revisions
- exact operator and bounded-decision authority

The proof surface does not read the normal activation-evidence bundle, does not
register the run in the normal activation-generation registry, does not admit a
business definition, and cannot change the profile lifecycle. Its API,
workflow, memo binding, projection, queue, and owner receipt use separate
contracts from the normal durable-run path.

The API routes are:

- `POST /v1/orchestration/controlled-proof/executions`
- `GET /v1/orchestration/controlled-proof/executions/{run_id}`
- `POST /v1/orchestration/controlled-proof/executions/{run_id}/controls`

A start request contains only the already-authorized scenario execution id.
OOS derives the deterministic workflow id, workflow input, memo binding, and
task queue from the pinned context. Duplicate suppression verifies the retained
memo against those exact bindings. Missing or changed bindings fail closed as
`controlled_proof_run_binding_unverified`.

Each scenario declares a non-empty subset of the three recognized receipt
owners. OOS starts a scenario only when that execution explicitly requires an
`operator-orchestration-service` receipt. `exact-baseline-restore` is retained
in the complete commissioning context but is not an OOS execution because the
final no-runtime baseline can be attested only after OOS has been removed.

`nominal-completion` may complete from the exact WGCF ready result. The
workflow-worker restart, Temporal runtime restart, deterministic replay,
duplicate suppression, and backup-restore scenarios require two independent
facts: WGCF readiness and a bounded Platform evidence signal. A signal carries
one scenario-specific evidence kind, one to eight immutable artifact
reference/digest pairs, and an observation timestamp inside the authorized
session. OOS retains that evidence in the projection and owner receipt before
the scenario can pass. Other controls must carry `scenario_evidence: null`.

The consumed permit must precede commissioning-session start, and both must
precede authorization expiry. New starts and non-cancellation controls are
denied at expiry. Retained reads and cancellation cleanup may continue against
the same verified context, but an outcome recorded at or after expiry cannot
become passing commissioning evidence.

Each terminal projection yields one OOS owner receipt containing the actual
Temporal execution run id and the exact owner-receipt fields required by the
workspace controlled-proof result contract. Expected negative scenarios are
reported as passed only when the scenario-specific boundary is observed; an
unexpected denial, failure, or unavailable result remains non-passing.
The cancellation scenario passes only when the authorized cancel control
targets an active WGCF activity and Temporal confirms cancellation completion;
queued, post-result, synthetic, or expired cancellation remains non-passing.

## Request Boundary

`POST /v1/orchestration/runs` accepts only the strict
`run-request.schema.json` contract.

A newly accepted request returns `202` with a stable `run_id`,
`duplicate=false`, and `projection=null`. This admission receipt depends only
on Temporal accepting the workflow start; it does not wait for a workflow task,
query handler, or activity worker. The caller reads the evolving aggregate from
`GET /v1/orchestration/runs/{run_id}`. A transient Temporal client-creation
failure is not cached, so a later request can reconnect without an API restart.

The request binds:

- immutable definition id and version
- source record and source version
- source projection and version
- canonical intent digest
- one explicit operator approval
- approval source version, intent digest, decision ref, and expiry
- idempotency, correlation, and causation refs
- expected receipt and return projection

The approval lifetime is at most 24 hours and expiry must follow the recorded
decision time. The approval scope must equal the durable source record. OOS
rejects expired approval, future-dated approval, changed source version,
changed authority, changed scope, changed intent, unknown fields, and locks for
this read-only proof. RFC 3339 timestamps with a real calendar date, valid time,
and explicit UTC offset are accepted at the API boundary and normalized to
canonical UTC before the bounded workflow input is created. Values that only
JavaScript date normalization would make valid are rejected.

If an approval expires after API admission but before Temporal records the
durable workflow start, the workflow emits a terminal `failed-no-effect`
projection and aggregate receipt before closing. It does not dispatch the WGCF
activity, and the idempotency key remains reviewable rather than identifying an
unprojectable execution.

For this definition, the source model is deliberately split:

- source domain: `workspace-governance-control-fabric`
- durable source record: `art:delivery-698`
- immutable source version: the WGCF Git revision under evaluation
- validation scope: `component:workspace-governance`
- readiness target: `repo:workspace-governance-control-fabric`

This keeps the workflow owner, delivery record, validated control plane, and
readiness target explicit instead of collapsing them into one ambiguous repo
reference.

## Temporal History Boundary

OOS does not send the rich API request into Temporal history. The adapter
projects a bounded workflow input containing only:

- request, definition, source, projection, correlation, causation, caller,
  operator, and approval refs
- source and definition versions
- canonical intent digest
- verified activation-evidence digest and its derived workflow task queue
- one bounded approval decision
- an admitted status code

Temporal memo retains a separate bounded immutable run binding containing only
the request, definition, source/version, source-projection, intent-digest,
activation-evidence digest, correlation, causation, caller, operator, and
approval references. OOS uses that server-readable binding to authenticate
idempotent duplicates without waiting for a workflow worker. Missing,
malformed, cross-generation, or changed retained bindings fail closed; retained
values are not disclosed in an error response.

Intent prose, input arrays, caller credentials, raw context, logs, command
output, and duplicated business records remain outside Temporal history and
memo.

## Run Projection

The OOS aggregate projection uses these states:

- `queued`
- `running`
- `waiting`
- `blocked`
- `failed`
- `completed`
- `cancelled`

It includes the current node, bounded progress, wait or blocker state,
retry posture, effect posture, available controls, artifact and receipt refs,
bounded events, source projection refs, caller/operator/approval correlation,
and completion timestamps. Every nested record uses an exact field contract;
raw worker or owner output is rejected rather than copied into the operator
projection.

Every retained WGCF receipt reference binds both the receipt id and its SHA-256
digest. OOS rejects duplicate receipt ids and never reduces a verified owner
receipt to an unbound identifier.

The stable OOS run id is also the Temporal workflow id:

`oos:<definition-id>:v<definition-version>:<idempotency-key>`

An idempotent duplicate is accepted only when the existing Temporal memo has
the same immutable request, definition, source/version, source-projection,
intent, correlation, caller, operator, and approval bindings. Reusing the key
for a different binding fails with `orchestration_idempotency_conflict`; OOS
reports only the mismatched field names and does not disclose retained values.
Temporal is configured to fail on a concurrently running workflow id and to
reject reuse after closure, so duplicate detection applies across the full
retained lifecycle rather than only while a run is active.

New starts never query the workflow. Running duplicate starts return the same
stable `run_id` with `projection=null` after memo verification. Closed-run
duplicates, completed run reads, and post-control reads resolve the validated
workflow result from Temporal history. Ordinary `GET` reads use the workflow
projection query only while an execution is running, and a running-to-completed
race falls back to the retained result so audit access does not depend on a live
worker poller.

A control response succeeds only when the retained projection contains the
complete immutable binding for `schema_version`, `control_id`, `action`,
`operator_id`, `reason_ref`, and `idempotency_key`. If the run closes before
Temporal retains that binding, OOS returns
`orchestration_control_not_applied` with the retained run state and
`control_applied=false`. If the control id or idempotency key already identifies
a different immutable binding, OOS returns
`orchestration_control_idempotency_conflict` and only the mismatched field
names. The operator may review the retained state and retry the same idempotent
control when it is still available. A run that genuinely does not exist remains
`orchestration_run_not_found`.

An owner activity result can complete the run only when `status_code=ready`,
the validation receipt and bounded validation outcome are both `success`, the
readiness outcome is `ready`, and no readiness reasons remain. Contradictory
owner payloads are rejected at the OOS contract boundary rather than projected
as verified completion. Every non-ready status must instead carry a `blocked`
readiness outcome and at least one readiness reason.

The Temporal execution run id is runtime diagnostics, not the operator-facing
aggregate identity.

## Retry And Controls

Automatic activity retry is bounded to three attempts with exponential
backoff. WGCF heartbeats every two seconds for cancellation delivery, but OOS
does not use missed heartbeats as an attempt-completion signal. WGCF stops its
isolated owner process after a four-minute budget that begins before process
spawn, allows at most five seconds for graceful termination, confirms complete
process-group exit for at most another five seconds, and bounds communication
drain to one second. Each attempt writes only to a staging root. WGCF grants
canonical local-evidence authority through an idempotent atomic commit after
process-group exit is confirmed. Receipt and ledger artifact references are
authored against the future committed root while their bytes remain staged, so
the atomic rename preserves evidence custody. Cancellation cannot interrupt the
bounded stop-and-confirm fence; it is propagated only after that fence returns.
Failed, cancelled, timed-out, or unfenced attempts remain quarantined or
otherwise non-canonical. Temporal's five-minute
start-to-close timeout therefore cannot release an automatic retry while a
prior attempt can write canonical evidence. A normally returned owner result
passes through the same exit-confirmation and evidence-commit fence. Manual
execution attempts are also bounded to three. The aggregate projection is the
authority for control availability:

- `retry` is available after a retryable activity failure while an attempt
  remains.
- `resume` is available from a blocked or deferred wait while an attempt
  remains.
- `defer` is available from a non-terminal blocked or failed state.
- `cancel` is available for any non-terminal run and interrupts an active
  activity before recording the cancelled receipt. OOS explicitly waits for
  Temporal cancellation completion, and the WGCF adapter does not acknowledge
  that cancellation until its synchronous owner execution has stopped.

`signal` is reserved by the common control contract but is not a business
action in this first definition.

OOS rejects an unavailable control before signaling Temporal, and the workflow
rechecks the same projected availability both when the signal arrives and when
the queued control is consumed. Only one retry or resume may wait for the next
attempt, and the workflow checks remaining attempt capacity immediately before
starting work. Concurrent controls cannot bypass the attempt limit or revive a
terminal run.

Only the admitted WGCF retryable, non-retryable, and cancelled failure types
may enter the aggregate projection. An arbitrary Temporal or owner exception
type is normalized to the bounded retryable activity failure instead of
becoming uncontracted projection data.

Cancellation stops future work. It does not erase activity evidence or claim
rollback of completed effects. This proof has no canonical write and therefore
requires no compensation action. A cancelled aggregate cannot close while the
WGCF owner execution is still running in a background thread.

## Completion

The run completes only when WGCF returns a terminal `ready` decision with:

- bounded decision semantics
- source and correlation refs
- a SHA-256 artifact digest
- a WGCF receipt ref and digest

OOS then emits one aggregate orchestration receipt. Raw WGCF output is not
embedded in the aggregate projection or Temporal history. The WGCF result must
bind back to the exact run, workflow, source version, correlation, causation,
and idempotency values sent by the OOS activity. The aggregate receipt must in
turn bind to the OOS request, run, source version, intent digest, source
projection, caller, operator, approval, and retained evidence refs.

## Activation Gates

Run start, control, and worker execution require all of:

- valid workspace contract binding
- finalized implementation review
- deterministic replay proof
- owner-activity idempotency proof
- failure and control proof
- active dev-integration profile evidence
- Platform runtime acceptance
- fresh Security activation review
- verified source projection
- rollback and suspension proof
- authenticated admission of the Governance Operations Console caller
- runtime enabled, workflow worker enabled, and activity execution explicitly
  authorized

Missing gates are an expected denied posture, not a runtime outage.
The API verifies its caller-authentication gate locally. The worker does not
receive the API caller credential; it revalidates the mounted activation
evidence and runtime switches after connection and worker construction,
immediately before either ordinary poller starts, and continuously while they
run. It shuts down if that posture is revoked. Starts and ordinary reads
require the complete authority-record set.
Unexpected activation-evidence loss or generation change makes an ordinary
worker stop polling immediately and exit with
`orchestration_worker_activation_revoked_unfenced`. It does not claim clean
retirement and a denied worker startup never revives an old poller.

Planned retirement is a separate Platform-ordered operation. Platform first
quiesces OOS start ingress, proves zero active start-ingress replicas and zero
in-flight starts, scales ordinary workflow pollers to zero, and proves that
poller state. Platform then issues a short-lived, digest-pinned retirement
manifest bound to the old activation manifest, digest-derived business and
registry queues, exact Temporal target, both drain evidence refs, and the OOS
receipt verifier key id and public-key digest. The ordinary worker serves both
generated queues continuously. Every business start first uses Temporal
Update-with-Start to persist its exact workflow ID through the generation
registry, and the registry admits at most 512 IDs in one activation generation.
The Update ID is exactly
`oos:generation-start-registration:v1:{business-workflow-id}`. The registry
workflow validates that ID before accepting the Update. A retry therefore
resolves the original Update instead of adding another accepted history event;
rejected Updates also do not enter workflow history. A full generation returns
the stable `409 orchestration_generation_capacity_exhausted` broker response
and requires retirement followed by fresh activation. Only the explicit OOS
`retire` command accepts the manifest. It verifies the configured receipt key
pair before mutation and carries the exact manifest issuance and expiry in an
acknowledged seal Update-with-Start. Its Update ID is exactly
`oos:generation-start-registry-seal:v1:{retirement-evidence-digest-hex}` and the
registry independently validates that ID and handler time before mutation. An
expired Update is rejected without accepted history, returns the bounded
`seal-not-authorized` outcome, and leaves the registry open for fresh
authorization. After an authorized seal, OOS reconciles the exact registered
workflow IDs, stages the admitted
`cancel` control before starting a one-shot worker on the retired business
queue, and waits for every committed run to record a terminal projection and
aggregate receipt. Registrations whose business start did not commit are
counted separately. Visibility scans are diagnostic only and never establish
retirement authority. The public run-control contract reserves the
`control:generation-retirement:` and
`idempotency:generation-retirement:` namespaces for OOS lifecycle control.
The workflow accepts only the exact OOS system identity, policy reference,
matching 32-character lowercase hexadecimal suffixes, and `cancel` action in
that namespace. A valid retirement cancellation is queued independently of
ordinary operator-control deduplication, so a colliding or previously retained
operator key cannot suppress retirement. Platform must retain the
generation-retirement receipt and verify its Ed25519 attestation before issuing
a fresh activation. If the
short-lived manifest expires after the registry was sealed, a refreshed
manifest may resume only the exact authorization that sealed the registry,
its lifetime, retirement id, and activation generation. The new activation
must use a new manifest digest and queues; a retired digest is never reused.
The manifest pins `oos-canonical-json-v1` and
`receipt-without-attestation`. That encoding recursively sorts object keys in
ascending ASCII order, preserves array order, accepts only printable-ASCII
strings and JavaScript-safe integers, emits compact JSON without whitespace,
and signs its UTF-8 bytes. `payload_digest` is SHA-256 over those same bytes;
the Ed25519 signature is standard base64. The published
`generation-retirement-canonicalization-v1.vector.json` is the cross-language
conformance vector. The receipt records the authorization-bound registry seal
and the one-shot worker start separately from completion, proving that
retirement began while the current manifest was valid and the seal occurred
inside its original authorization,
even when a legitimate drain completes later. Already-written WGCF evidence
remains retained.

## Source Files

- request schema:
  [../../contracts/orchestration/run-request.schema.json](../../contracts/orchestration/run-request.schema.json)
- immutable run binding memo schema:
  [../../contracts/orchestration/run-binding.schema.json](../../contracts/orchestration/run-binding.schema.json)
- control schema:
  [../../contracts/orchestration/run-control.schema.json](../../contracts/orchestration/run-control.schema.json)
- bounded workflow-history input schema:
  [../../contracts/orchestration/workflow-input.schema.json](../../contracts/orchestration/workflow-input.schema.json)
- projection schema:
  [../../contracts/orchestration/run-projection.schema.json](../../contracts/orchestration/run-projection.schema.json)
- controlled-proof execution context schema:
  [../../contracts/orchestration/controlled-proof-execution-context.schema.json](../../contracts/orchestration/controlled-proof-execution-context.schema.json)
- controlled-proof start request schema:
  [../../contracts/orchestration/controlled-proof-start-request.schema.json](../../contracts/orchestration/controlled-proof-start-request.schema.json)
- controlled-proof control request schema:
  [../../contracts/orchestration/controlled-proof-control-request.schema.json](../../contracts/orchestration/controlled-proof-control-request.schema.json)
- controlled-proof workflow input schema:
  [../../contracts/orchestration/controlled-proof-workflow-input.schema.json](../../contracts/orchestration/controlled-proof-workflow-input.schema.json)
- controlled-proof memo binding schema:
  [../../contracts/orchestration/controlled-proof-run-binding.schema.json](../../contracts/orchestration/controlled-proof-run-binding.schema.json)
- controlled-proof run projection schema:
  [../../contracts/orchestration/controlled-proof-run-projection.schema.json](../../contracts/orchestration/controlled-proof-run-projection.schema.json)
- controlled-proof WGCF activity request schema:
  [../../contracts/orchestration/controlled-proof-activity-request.schema.json](../../contracts/orchestration/controlled-proof-activity-request.schema.json)
- controlled-proof OOS owner receipt schema:
  [../../contracts/orchestration/controlled-proof-owner-receipt.schema.json](../../contracts/orchestration/controlled-proof-owner-receipt.schema.json)
- generation-retirement manifest schema:
  [../../contracts/orchestration/generation-retirement-manifest.schema.json](../../contracts/orchestration/generation-retirement-manifest.schema.json)
- generation-retirement receipt schema:
  [../../contracts/orchestration/generation-retirement-receipt.schema.json](../../contracts/orchestration/generation-retirement-receipt.schema.json)
- generation-retirement receipt canonicalization vector:
  [../../contracts/orchestration/generation-retirement-canonicalization-v1.vector.json](../../contracts/orchestration/generation-retirement-canonicalization-v1.vector.json)
- definition:
  [../../contracts/orchestration/definitions/validation-readiness-run.v1.json](../../contracts/orchestration/definitions/validation-readiness-run.v1.json)
- operator procedure:
  [../operations/durable-orchestration-operator-surface.md](../operations/durable-orchestration-operator-surface.md)
