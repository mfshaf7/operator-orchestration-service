import assert from "node:assert/strict";
import test from "node:test";

import {
  loadConfig,
  ORCHESTRATION_WORKER_PROCESS_ROLE,
} from "../src/config.js";
import {
  assertControlledProofExecutionContext,
  controlledProofExecutionFor,
  controlledProofRunIdFor,
  controlledProofWorkflowInputFor,
  normalizeControlledProofControlRequest,
  normalizeControlledProofStartRequest,
  toControlledProofRunBindings,
} from "../src/orchestration/controlled-proof-contracts.js";
import {
  createControlledProofOwnerReceipt,
  resolveControlledProofContext,
} from "../src/orchestration/controlled-proof-evidence.js";
import {
  cancelControlledProofRun,
  createControlledProofRunProjection,
  projectControlledProofFailure,
  projectControlledProofWgcfResult,
  startControlledProofAttempt,
} from "../src/orchestration/controlled-proof-run-projection.js";
import {
  CONTROLLED_PROOF_IDENTITY_DENIED_FAILURE_TYPE,
  CONTROLLED_PROOF_PAYLOAD_REJECTED_FAILURE_TYPE,
  CONTROLLED_PROOF_REQUIRED_SCENARIOS,
} from "../src/orchestration/constants.js";
import {
  controlledProofEnvForContext,
  validControlledProofContext,
} from "../test-fixtures/orchestration.js";

const CONTEXT_DIGEST = `sha256:${"9".repeat(64)}`;
const STARTED_AT = "2026-08-01T00:03:00.000Z";
const RESULT_AT = "2026-08-01T00:04:00.000Z";

test("controlled proof context admits exactly one ordered commissioning scenario set", () => {
  const context = validControlledProofContext();
  const admitted = assertControlledProofExecutionContext(context, {
    now: new Date(STARTED_AT),
  });
  assert.deepEqual(
    admitted.commissioning_session.scenario_executions.map(
      (entry) => entry.scenario_id,
    ),
    CONTROLLED_PROOF_REQUIRED_SCENARIOS,
  );

  const reordered = structuredClone(context);
  [reordered.commissioning_session.scenario_executions[0], reordered.commissioning_session.scenario_executions[1]] =
    [reordered.commissioning_session.scenario_executions[1], reordered.commissioning_session.scenario_executions[0]];
  assert.throws(
    () =>
      assertControlledProofExecutionContext(reordered, {
        now: new Date(STARTED_AT),
      }),
    (error) => error.code === "invalid_controlled_proof_contract",
  );

  const activated = structuredClone(context);
  activated.runtime.profile_lifecycle = "active";
  assert.throws(
    () =>
      assertControlledProofExecutionContext(activated, {
        now: new Date(STARTED_AT),
      }),
    /cannot project an active profile lifecycle/,
  );

  const simultaneousConsumptionAndStart = validControlledProofContext({
    consumedAt: "2026-08-01T00:02:00.000Z",
    startedAt: "2026-08-01T00:02:00.000Z",
  });
  assert.throws(
    () =>
      assertControlledProofExecutionContext(simultaneousConsumptionAndStart, {
        now: new Date(STARTED_AT),
      }),
    /must start after permit consumption/,
  );
});

test("controlled proof start and control requests preserve a strict bounded surface", () => {
  assert.deepEqual(
    normalizeControlledProofStartRequest({
      schema_version: 1,
      scenario_execution_id: "scenario-execution-01",
    }),
    {
      schema_version: 1,
      scenario_execution_id: "scenario-execution-01",
    },
  );
  assert.throws(
    () =>
      normalizeControlledProofStartRequest({
        schema_version: 1,
        scenario_execution_id: "scenario-execution-01",
        profile_lifecycle: "active",
      }),
    /outside the admitted boundary/,
  );

  const control = validControlEnvelope();
  assert.deepEqual(normalizeControlledProofControlRequest(control), control);
  assert.throws(
    () =>
      normalizeControlledProofControlRequest({
        ...control,
        control: { ...control.control, unbounded_payload: "denied" },
      }),
    /outside the admitted boundary/,
  );
});

test("workflow input and memo bind the authorization, session, scenario, and WGCF revision", () => {
  const context = validControlledProofContext();
  const execution = controlledProofExecutionFor(
    context,
    "scenario-execution-01",
    { contextDigest: CONTEXT_DIGEST },
  );
  const input = controlledProofWorkflowInputFor(context, execution);
  const bindings = toControlledProofRunBindings(input);

  assert.equal(input.status_code, "controlled-proof-admitted");
  assert.equal(input.controlled_proof_execution.profile_lifecycle, "build-admitted");
  assert.equal(bindings.authorization_digest, context.authorization.authorization_digest);
  assert.equal(bindings.commissioning_session_id, "commissioning-session-698-1");
  assert.equal(bindings.scenario_execution_id, "scenario-execution-01");
  assert.match(controlledProofRunIdFor(execution), /^oos:controlled-proof:/);
  assert.equal(bindings.workflow_task_queue, context.runtime.workflow_task_queue);
});

test("controlled proof context resolver verifies digest, target identity, and exact OOS revision", () => {
  const context = validControlledProofContext();
  const env = controlledProofEnvForContext(context);
  const apiConfig = loadConfig(env);
  const admitted = resolveControlledProofContext(apiConfig, {
    now: new Date(STARTED_AT),
  });
  assert.equal(admitted.valid, true);
  assert.equal(admitted.context.runtime.profile_lifecycle, "build-admitted");

  const workerConfig = loadConfig(env, {
    orchestrationProcessRole: ORCHESTRATION_WORKER_PROCESS_ROLE,
  });
  assert.equal(
    resolveControlledProofContext(workerConfig, {
      now: new Date(STARTED_AT),
    }).valid,
    true,
  );

  const wrongRevision = loadConfig({ ...env, GIT_COMMIT: "e".repeat(40) });
  assert.deepEqual(
    resolveControlledProofContext(wrongRevision, {
      now: new Date(STARTED_AT),
    }).reason,
    "invalid-context",
  );

  const wrongDigest = loadConfig({
    ...env,
    OOS_ORCHESTRATION_CONTROLLED_PROOF_CONTEXT_DIGEST:
      `sha256:${"0".repeat(64)}`,
  });
  assert.equal(resolveControlledProofContext(wrongDigest).reason, "digest-mismatch");
});

test("nominal completion produces a passed receipt with the actual Temporal execution id", () => {
  const { context, execution, input, projection } = startedProjection(0);
  const completed = projectControlledProofWgcfResult(
    projection,
    wgcfResultFor(input, projection, "ready"),
    RESULT_AT,
  );
  const receipt = createControlledProofOwnerReceipt({
    context,
    contextDigest: CONTEXT_DIGEST,
    projection: completed,
  });

  assert.equal(completed.scenario_assertion.status, "passed");
  assert.equal(receipt.owner_result, "passed");
  assert.equal(receipt.owner_execution.execution_type, "workflow");
  assert.equal(receipt.owner_execution.execution_id, "temporal-execution-run-01");
  assert.equal(receipt.scenario_execution_id, execution.scenario_execution_id);
  assert.match(receipt.receipt_digest, /^sha256:[0-9a-f]{64}$/);
  assert.ok(receipt.evidence_refs.length >= 5);
  assert.deepEqual(Object.keys(receipt).sort(), [
    "authorization_digest",
    "authorization_id",
    "commissioning_session_id",
    "evidence_refs",
    "owner_execution",
    "owner_repo",
    "owner_result",
    "receipt_digest",
    "receipt_ref",
    "recorded_at",
    "scenario_execution_id",
    "scenario_id",
  ]);
});

test("authorized cancellation, unavailable dependency, and identity denial are passed scenario assertions", () => {
  const cancellation = startedProjection(5);
  const cancelled = cancelControlledProofRun(
    cancellation.projection,
    cancellationControl(),
    RESULT_AT,
  );
  assert.equal(cancelled.state, "cancelled");
  assert.equal(cancelled.scenario_assertion.status, "passed");
  assert.equal(
    createControlledProofOwnerReceipt({
      context: cancellation.context,
      contextDigest: CONTEXT_DIGEST,
      projection: cancelled,
    }).owner_result,
    "passed",
  );

  const unavailable = startedProjection(6);
  const unavailableResult = projectControlledProofWgcfResult(
    unavailable.projection,
    wgcfResultFor(unavailable.input, unavailable.projection, "unavailable"),
    RESULT_AT,
  );
  assert.equal(unavailableResult.scenario_assertion.status, "passed");

  const identity = startedProjection(7);
  const denied = projectControlledProofFailure(
    identity.projection,
    { failureType: CONTROLLED_PROOF_IDENTITY_DENIED_FAILURE_TYPE },
    RESULT_AT,
  );
  assert.equal(denied.state, "completed");
  assert.equal(denied.scenario_assertion.status, "passed");
});

test("a negative outcome in the wrong scenario remains blocked instead of being reported as passed", () => {
  const nominal = startedProjection(0);
  const blocked = projectControlledProofWgcfResult(
    nominal.projection,
    wgcfResultFor(nominal.input, nominal.projection, "unavailable"),
    RESULT_AT,
  );
  assert.equal(blocked.state, "blocked");
  assert.equal(blocked.scenario_assertion.status, "pending");
  assert.equal(blocked.retry_available, true);
  assert.equal(blocked.completed_at, null);
});

test("ready results cannot satisfy scenarios that require a negative boundary", () => {
  for (const scenarioIndex of [5, 7, 8]) {
    const candidate = startedProjection(scenarioIndex);
    const result = projectControlledProofWgcfResult(
      candidate.projection,
      wgcfResultFor(candidate.input, candidate.projection, "ready"),
      RESULT_AT,
    );
    assert.equal(result.state, "blocked");
    assert.equal(result.scenario_assertion.status, "pending");
    assert.equal(result.completed_at, null);
  }
});

test("payload-boundary passes only for the explicit WGCF payload rejection", () => {
  const expected = startedProjection(8);
  const passed = projectControlledProofFailure(
    expected.projection,
    { failureType: CONTROLLED_PROOF_PAYLOAD_REJECTED_FAILURE_TYPE },
    RESULT_AT,
  );
  assert.equal(passed.state, "completed");
  assert.equal(passed.scenario_assertion.status, "passed");

  const unrelated = startedProjection(8);
  const failed = projectControlledProofFailure(
    unrelated.projection,
    { failureType: "WGCF_CONTRACT_REJECTED" },
    RESULT_AT,
  );
  assert.equal(failed.state, "failed");
  assert.equal(failed.scenario_assertion.status, "failed");
});

test("proof outcomes that complete at authorization expiry cannot become passing evidence", () => {
  const nominal = startedProjection(0);
  const expiredReady = projectControlledProofWgcfResult(
    nominal.projection,
    wgcfResultFor(nominal.input, nominal.projection, "ready"),
    nominal.execution.authorization_expires_at,
  );
  assert.equal(expiredReady.state, "failed");
  assert.equal(expiredReady.scenario_assertion.status, "failed");
  assert.equal(expiredReady.retry_available, false);

  const identity = startedProjection(7);
  const expiredDenial = projectControlledProofFailure(
    identity.projection,
    { failureType: CONTROLLED_PROOF_IDENTITY_DENIED_FAILURE_TYPE },
    identity.execution.authorization_expires_at,
  );
  assert.equal(expiredDenial.state, "failed");
  assert.equal(expiredDenial.scenario_assertion.status, "failed");

  const cancellation = startedProjection(5);
  const expiredCancellation = cancelControlledProofRun(
    cancellation.projection,
    cancellationControl(),
    cancellation.execution.authorization_expires_at,
  );
  assert.equal(expiredCancellation.state, "cancelled");
  assert.equal(expiredCancellation.scenario_assertion.status, "failed");
});

function startedProjection(scenarioIndex) {
  const context = validControlledProofContext();
  const scenario = context.commissioning_session.scenario_executions[scenarioIndex];
  const execution = controlledProofExecutionFor(
    context,
    scenario.scenario_execution_id,
    { contextDigest: CONTEXT_DIGEST },
  );
  const input = controlledProofWorkflowInputFor(context, execution);
  const queued = createControlledProofRunProjection({
    request: input,
    runId: controlledProofRunIdFor(execution),
    temporalExecutionRunId: `temporal-execution-run-${String(
      scenarioIndex + 1,
    ).padStart(2, "0")}`,
    timestamp: STARTED_AT,
  });
  return {
    context,
    execution,
    input,
    projection: startControlledProofAttempt(queued, STARTED_AT),
  };
}

function wgcfResultFor(input, projection, statusCode) {
  return {
    status_code: statusCode,
    artifact_digest: `sha256:${"a".repeat(64)}`,
    receipt_ref: {
      receipt_id: `receipt:wgcf:${projection.controlled_proof_execution.scenario_execution_id}`,
      digest: `sha256:${"b".repeat(64)}`,
    },
    input,
  };
}

function validControlEnvelope() {
  return {
    schema_version: 1,
    commissioning_session_id: "commissioning-session-698-1",
    scenario_execution_id: "scenario-execution-01",
    control: {
      schema_version: 1,
      control_id: "control:controlled-proof:1",
      action: "cancel",
      operator_id: "operator:mfshaf7",
      reason_ref: "reason:controlled-proof-test",
      idempotency_key: "control-idempotency:controlled-proof:1",
    },
  };
}

function cancellationControl() {
  return validControlEnvelope().control;
}
