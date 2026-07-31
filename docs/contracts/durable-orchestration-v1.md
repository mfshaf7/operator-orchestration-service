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

## Request Boundary

`POST /v1/orchestration/runs` accepts only the strict
`run-request.schema.json` contract.

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
this read-only proof.

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
- one bounded approval decision
- an admitted status code

Intent prose, input arrays, caller credentials, raw context, logs, command
output, and duplicated business records remain outside Temporal history.

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

An idempotent duplicate is accepted only when the existing projection has the
same immutable request, definition, source/version, source-projection, intent,
correlation, caller, operator, and approval bindings. Reusing the key for a
different binding fails with `orchestration_idempotency_conflict`; OOS reports
only the mismatched field names and does not disclose retained values.
Temporal is configured to fail on a concurrently running workflow id and to
reject reuse after closure, so duplicate detection applies across the full
retained lifecycle rather than only while a run is active.

An owner activity result can complete the run only when `status_code=ready`,
the validation receipt and bounded validation outcome are both `success`, the
readiness outcome is `ready`, and no readiness reasons remain. Contradictory
owner payloads are rejected at the OOS contract boundary rather than projected
as verified completion.

The Temporal execution run id is runtime diagnostics, not the operator-facing
aggregate identity.

## Retry And Controls

Automatic activity retry is bounded to three attempts with exponential
backoff. Manual execution attempts are also bounded to three. The aggregate
projection is the authority for control availability:

- `retry` is available after a retryable activity failure while an attempt
  remains.
- `resume` is available from a blocked or deferred wait while an attempt
  remains.
- `defer` is available from a non-terminal blocked or failed state.
- `cancel` is available for any non-terminal run and interrupts an active
  activity before recording the cancelled receipt.

`signal` is reserved by the common control contract but is not a business
action in this first definition.

OOS rejects an unavailable control before signaling Temporal, and the workflow
rechecks the same projected availability both when the signal arrives and when
the queued control is consumed. Only one retry or resume may wait for the next
attempt, and the workflow checks remaining attempt capacity immediately before
starting work. Concurrent controls cannot bypass the attempt limit or revive a
terminal run.

Cancellation stops future work. It does not erase activity evidence or claim
rollback of completed effects. This proof has no canonical write and therefore
requires no compensation action.

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
receive the API caller credential; it continuously revalidates the mounted
activation evidence and runtime switches and shuts down if that posture is
revoked. Before the revoked process exits, it sends the workflow's admitted
`cancel` control to every running `validationReadinessRunV1` execution. The
workflow interrupts its owner activity, records the terminal cancellation
event and aggregate receipt in its durable projection, and then closes. The
worker keeps workflow polling available only for that drain and does not stop
until every observed result validates as terminal. Already-written WGCF
evidence remains retained. The revocation fence uses a dedicated Temporal
client connection and retries until cancellation is confirmed. It then
requires seven consecutive empty visibility scans over 30 seconds; finding a
running execution or encountering an RPC or projection-verification error
resets confirmation. A worker started under a denied posture stages cancel
signals through the same stable visibility window, runs a workflow-only drain,
and verifies terminal projections before returning activation denial, so a
restart or start racing with revocation cannot bypass cleanup or leave a stale
active projection. Denied startup does not connect to or fence a target whose
address, namespace, or role-specific identity cannot still be verified from
the digest-pinned manifest.

## Source Files

- request schema:
  [../../contracts/orchestration/run-request.schema.json](../../contracts/orchestration/run-request.schema.json)
- control schema:
  [../../contracts/orchestration/run-control.schema.json](../../contracts/orchestration/run-control.schema.json)
- bounded workflow-history input schema:
  [../../contracts/orchestration/workflow-input.schema.json](../../contracts/orchestration/workflow-input.schema.json)
- projection schema:
  [../../contracts/orchestration/run-projection.schema.json](../../contracts/orchestration/run-projection.schema.json)
- definition:
  [../../contracts/orchestration/definitions/validation-readiness-run.v1.json](../../contracts/orchestration/definitions/validation-readiness-run.v1.json)
- operator procedure:
  [../operations/durable-orchestration-operator-surface.md](../operations/durable-orchestration-operator-surface.md)
