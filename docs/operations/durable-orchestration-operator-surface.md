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
`governance-operations-console` caller. A missing or no-longer-retained run is
reported as `orchestration_run_not_found`, not as an internal server error.

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
5. Configure the real Platform and Security references.
6. Enable the runtime, worker, and execution authorization together.
7. Scale only the admitted worker workload.
8. Run the read-only validation-readiness proof.
9. Restart the worker during the run and prove replay from the same OOS run id.
10. Capture WGCF and aggregate OOS receipt refs.

The required environment keys are:

```text
OOS_ORCHESTRATION_IMPLEMENTATION_REVIEW_REF
OOS_ORCHESTRATION_DETERMINISTIC_REPLAY_TEST_REF
OOS_ORCHESTRATION_ACTIVITY_IDEMPOTENCY_TEST_REF
OOS_ORCHESTRATION_FAILURE_AND_CONTROL_TEST_REF
OOS_ORCHESTRATION_DEVINT_PROFILE_REF
OOS_ORCHESTRATION_PLATFORM_ACCEPTANCE_REF
OOS_ORCHESTRATION_SECURITY_ACTIVATION_REVIEW_REF
OOS_ORCHESTRATION_SOURCE_PROJECTION_VERIFICATION_REF
OOS_ORCHESTRATION_ROLLBACK_AND_SUSPENSION_PROOF_REF
OOS_ORCHESTRATION_RUNTIME_ENABLED
OOS_ORCHESTRATION_WORKER_ENABLED
OOS_ORCHESTRATION_EXECUTION_AUTHORIZED
OOS_TEMPORAL_ADDRESS
OOS_TEMPORAL_NAMESPACE
OOS_TEMPORAL_IDENTITY
```

The nine reference keys bind the workspace admission evidence. The three
boolean keys are runtime enablement controls. Evidence values must be bounded
reference identifiers; malformed values are denied and are not echoed through
the catalog. Non-empty strings are not evidence by themselves; their values
must point to the accepted records.

## Run Triage

- `waiting`: an explicit defer or admitted external wait; inspect the wait
  owner and available controls.
- `blocked`: the activity produced a terminal governance finding or rejected
  the execution boundary; resolve or explicitly defer it.
- `failed`: automatic retry exhausted without a bounded result; retry only when
  the underlying runtime or activity condition changed.
- `cancelled`: future execution stopped; retain existing evidence.

Allowed blocker decisions are recorded as `remove`, `workaround`,
`accept-risk`, or `defer` where the definition and authority permit them. The
first read-only proof exposes only `remove` and `defer`.

## Incident Containment

1. Disable new run starts.
2. Scale the OOS worker to zero.
3. Preserve Temporal and WGCF evidence.
4. Record the affected run, source version, activity attempt, and receipt refs.
5. Do not reset persistence during diagnosis.
6. Resume or retry only through OOS after the owner condition is corrected.

## Dev-Integration Profile

The accepted-idea-delivery profile renders the source-admitted worker at zero
replicas and proves the definition catalog remains readable while execution is
denied:

```bash
make devint-smoke PROFILE=accepted-idea-delivery
```

The Temporal profile remains separately owned by Platform Engineering.
