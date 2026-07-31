# Durable Orchestration Operator Surface

## Use This Surface For

- inspecting immutable OOS workflow definitions
- checking activation gates
- starting an admitted run
- reading aggregate run state
- applying an allowed run control
- classifying a blocked or failed run

Do not use it for ordinary CRUD, direct Temporal diagnostics, or direct WGCF
mutation.

The definition catalog is available to authenticated OOS callers. Durable run
list, read, start, and control routes admit only the authenticated
`governance-operations-console` caller. The generic development auth bypass is
rejected with `orchestration_caller_auth_not_configured`. A missing or
no-longer-retained run is reported as `orchestration_run_not_found`, not as an
internal server error.

A control request is successful only when the retained run projection contains
the complete immutable control binding: schema version, control id, action,
operator, reason, and idempotency key. If the run closes before that binding is
retained, the API returns `orchestration_control_not_applied` with the retained
state and `control_applied=false`. If either key already belongs to a different
immutable binding, it returns `orchestration_control_idempotency_conflict` with
only the mismatched field names. Review either conflict before retrying. Neither
response is a missing-run result or proof that the control executed.

A successful new start returns an admission receipt with a stable `run_id` and
`projection=null`; it does not wait for a workflow worker. Use
`GET /v1/orchestration/runs/{run_id}` to inspect state. An idempotent retry may
also return a null projection while that run remains active. OOS verifies the
retry against the immutable Temporal memo before accepting it. A missing or
malformed retained binding returns `orchestration_run_binding_unverified` and
must be treated as runtime unavailability, not as permission to start another
run.

## Current Safe Checks

Install exact dependencies and validate source:

```bash
npm ci
npm test
npm run validate:orchestration-bundle
npm run validate:api-docs
```

Inspect the worker posture without connecting to Temporal:

```bash
npm run orchestration:worker -- status
```

Before activation, the result must include:

```json
{
  "activation_ready": false,
  "run_allowed": false
}
```

Inspect the route contract:

```bash
npm run api:contract -- GET /v1/orchestration/definitions
npm run api:contract -- POST /v1/orchestration/runs
npm run api:contract -- POST /v1/orchestration/runs/{run_id}/controls
```

## Expected Pre-Activation Behavior

- definition reads return `admission-review`
- `admission.start_allowed` is `false`
- run list returns an empty bounded projection when the runtime is disabled
- start and control return a conflict response
- the rendered workflow worker remains at zero replicas

Do not work around this denial by setting placeholder refs, scaling the worker,
calling Temporal directly, or copying the API credential into the worker.

## Activation Procedure

Activation is allowed only after the separate Platform and Security work has
produced real references and operating evidence.

1. Confirm the Temporal profile is `active`, not `build-admitted`.
2. Confirm Platform accepts the OOS worker network and identity boundary.
3. Confirm WGCF activity worker admission and queue ownership.
4. Confirm fresh Security activation review accepts payload, retention,
   identity, backup, restart, and denial evidence.
5. Mount the Platform-issued activation evidence bundle read-only and
   configure the exact manifest digest.
6. Enable the runtime, worker, and execution authorization together.
7. Scale only the admitted worker workload.
8. Run the read-only validation-readiness proof.
9. Restart the worker during the run and prove replay from the same OOS run id.
10. Capture WGCF and aggregate OOS receipt refs.

The required environment keys are:

```text
CALLER_ALLOWED_IDS
CALLER_AUTH_SHARED_SECRET
OOS_ORCHESTRATION_ACTIVATION_EVIDENCE_PATH
OOS_ORCHESTRATION_ACTIVATION_EVIDENCE_DIGEST
OOS_ORCHESTRATION_RUNTIME_ENABLED
OOS_ORCHESTRATION_WORKER_ENABLED
OOS_ORCHESTRATION_EXECUTION_AUTHORIZED
OOS_TEMPORAL_ADDRESS
OOS_TEMPORAL_NAMESPACE
OOS_TEMPORAL_IDENTITY
```

The API deployment must include `governance-operations-console` in
`CALLER_ALLOWED_IDS` and obtain `CALLER_AUTH_SHARED_SECRET` from its existing
secret boundary. The workflow worker must not receive that API credential.

The two evidence keys bind one Platform-issued bundle manifest and its exact
SHA-256 digest. The bundle is the runtime activation decision, not a list of
operator assertions. Its manifest must bind this definition version to the
active `temporal` dev-integration profile and carry a current Platform decision
and expiry. It must also contain the exact admitted Temporal address and
namespace plus separate API and workflow-worker identities bound to those
process roles; those identities must be distinct. OOS compares the current
process target and role-specific identity to that manifest before activation.
Every
gate points to a fixed relative record inside the same read-only bundle; OOS
reads each record, verifies its digest, and checks its exact gate, owner,
accepted outcome, source version, and authority reference. Missing, expired,
altered, unknown, target-mismatched, identity-mismatched, or owner-mismatched
content is rejected without exposing bundle contents.

The manifest digest is also the one-way execution generation. OOS derives the
workflow queue as
`oos.validation-readiness-run.v1.<activation-manifest-digest-hex>` and retains
the digest in the workflow input, immutable memo, projection, and aggregate
receipt. Platform must issue a new manifest and digest for every reactivation;
a digest that has been revoked must not be reused. Ordinary worker restarts
under the same still-active manifest continue polling the same queue.

The three boolean keys are deployment controls. They cannot activate execution
without a verified bundle. The manifest and record contracts are
`contracts/orchestration/activation-evidence-manifest.schema.json` and
`contracts/orchestration/activation-evidence-record.schema.json`. Platform
owns assembling and mounting the accepted bundle during the separate
activation phase.

Run inspection requires the runtime switch plus a verified digest-pinned
address, namespace, API identity, and complete authority-record set. Expired
gate evidence may deny starts while retained audit reads remain available on
that same admitted target. Missing, altered, owner-mismatched, or
target-mismatched evidence denies the read before a Temporal client connection
is created.

After startup, the worker rechecks the bundle and its runtime switches every
30 seconds. Missing, expired, altered, or target-mismatched evidence denies new
starts and makes the ordinary worker fail-stop immediately with
`orchestration_worker_activation_revoked_unfenced`. This exit is an incomplete
fence, not proof that the generation retired. A denied startup never polls or
controls the old queue.

Use the explicit retirement path for planned suspension or rollback:

1. Platform quiesces the OOS start ingress and proves zero active ingress
   replicas and zero in-flight starts.
2. Platform scales ordinary OOS workflow pollers to zero and proves that state.
3. Platform issues a short-lived retirement manifest bound to the old activation
   manifest digest, generated queue, Temporal target, and both drain evidence
   refs.
4. Mount that manifest read-only and configure its exact digest through the two
   retirement evidence keys.
5. Run `node src/orchestration-worker.js retire` as a one-shot worker job.
6. Retain the emitted generation-retirement receipt with the Platform evidence.
7. Issue a fresh activation only after that receipt is accepted, using a new
   activation manifest digest and therefore a new queue.

The one-shot job stages cancellation signals before polling, waits for terminal
projections and aggregate receipts, stops polling, and checks for residual runs.
A residual starts another one-shot drain cycle. Temporal listing, signaling, or
projection errors reset confirmation and are retried; no receipt is emitted
until post-stop scans are stably empty. The receipt records both the authorized
one-shot start and final completion; Platform must verify the start fell inside
the retirement manifest lifetime and no more than five minutes after either
drain observation.

The retirement-only evidence keys are:

```text
OOS_ORCHESTRATION_RETIREMENT_EVIDENCE_PATH
OOS_ORCHESTRATION_RETIREMENT_EVIDENCE_DIGEST
```

OOS uses Temporal's wait-for-cancellation-completion activity policy. The paired
WGCF activity adapter heartbeats every two seconds for cancellation delivery,
runs synchronous validation in an isolated process group, and starts its
four-minute owner budget before process spawn. Shutdown allows five seconds for
graceful termination, five seconds to confirm complete group exit, and one
second for bounded communication drain. There is no heartbeat timeout because a
lost heartbeat does not prove that owner work has stopped. Owner output remains
in an attempt staging root until group exit is confirmed, then becomes canonical
local evidence through an idempotent atomic commit. Artifact references already
name the future committed root while bytes remain staged, and cancellation is
reported only after the bounded stop-and-confirm fence returns. Failed,
cancelled, timed-out, or unfenced attempts remain non-canonical. The five-minute
start-to-close limit therefore cannot release an automatic retry while the
prior attempt can write canonical evidence.

## Run Triage

- `waiting`: an explicit defer or admitted external wait; inspect the wait
  owner and available controls.
- `blocked`: the activity produced a terminal governance finding or rejected
  the execution boundary; resolve or explicitly defer it.
- `failed`: automatic retry exhausted without a bounded result, or the approval
  expired before the durable start was recorded. An approval-expiry run is
  terminal and requires a new approved request and idempotency key; retry other
  failures only when the underlying runtime or activity condition changed.
- `cancelled`: future execution stopped; retain existing evidence.

Allowed blocker decisions are recorded as `remove`, `workaround`,
`accept-risk`, or `defer` where the definition and authority permit them. The
first read-only proof exposes only `remove` and `defer`.

## Incident Containment

1. Quiesce OOS start ingress and prove no start request remains in flight.
2. Scale ordinary workflow pollers to zero and prove that state.
3. Issue the Platform retirement manifest for the old digest and queue.
4. Run the one-shot OOS retirement command and retain its receipt.
5. Preserve Temporal and WGCF evidence.
6. Record the affected run, source version, activity attempt, and digest-bound
   receipt refs.
7. Do not reset persistence during diagnosis.
8. Resume only through a fresh Platform activation after the retirement receipt
   is accepted.

## Dev-Integration Profile

The accepted-idea-delivery profile renders the source-admitted worker at zero
replicas and proves the definition catalog remains readable while execution is
denied:

```bash
make devint-smoke PROFILE=accepted-idea-delivery
```

The Temporal profile remains separately owned by Platform Engineering.
