import assert from "node:assert/strict";
import test from "node:test";

import { loadConfig } from "../src/config.js";
import {
  controlledProofExecutionFor,
  controlledProofRunIdFor,
  controlledProofWorkflowInputFor,
  toControlledProofRunBindings,
} from "../src/orchestration/controlled-proof-contracts.js";
import {
  createOrchestrationService,
  OrchestrationServiceError,
} from "../src/orchestration/service.js";
import {
  controlledProofEnvForContext,
  validControlledProofContext,
} from "../test-fixtures/orchestration.js";

test("controlled proof execution accepts only the explicitly authenticated Platform executor", async () => {
  const fixture = serviceFixture();
  const service = createOrchestrationService({
    config: fixture.config,
    temporalAdapter: fixture.adapter,
  });

  await assert.rejects(
    service.startControlledProofExecution(fixture.startRequest, {
      callerId: "governance-operations-console",
    }),
    (error) =>
      error instanceof OrchestrationServiceError &&
      error.code === "controlled_proof_caller_forbidden" &&
      error.statusCode === 403,
  );

  const bypassConfig = loadConfig(
    controlledProofEnvForContext(fixture.context, {
      CALLER_AUTH_SHARED_SECRET: "",
    }),
  );
  const bypassService = createOrchestrationService({
    config: bypassConfig,
    temporalAdapter: fixture.adapter,
  });
  await assert.rejects(
    bypassService.startControlledProofExecution(fixture.startRequest, {
      callerId: "platform-controlled-proof-executor",
    }),
    (error) =>
      error.code === "controlled_proof_caller_auth_not_configured" &&
      error.statusCode === 503,
  );
});

test("controlled proof start derives the immutable workflow input from the pinned context", async () => {
  const fixture = serviceFixture();
  const service = createOrchestrationService({
    config: fixture.config,
    temporalAdapter: fixture.adapter,
  });

  const result = await service.startControlledProofExecution(
    fixture.startRequest,
    { callerId: "platform-controlled-proof-executor" },
  );

  assert.equal(fixture.calls.start, 1);
  assert.equal(result.run_id, fixture.runId);
  assert.equal(result.scenario_id, "nominal-completion");
  assert.equal(result.scenario_execution_id, "scenario-execution-01");
  assert.equal(result.projection, null);
  assert.equal(result.owner_receipt, null);
});

test("controlled proof duplicate memo drift is an idempotency conflict", async () => {
  const fixture = serviceFixture({ duplicate: true, driftBinding: true });
  const service = createOrchestrationService({
    config: fixture.config,
    temporalAdapter: fixture.adapter,
  });

  await assert.rejects(
    service.startControlledProofExecution(fixture.startRequest, {
      callerId: "platform-controlled-proof-executor",
    }),
    (error) =>
      error.code === "controlled_proof_idempotency_conflict" &&
      error.statusCode === 409 &&
      error.details.mismatched_fields.includes("scenario_execution_id"),
  );
});

test("controlled proof controls must match the pinned session, scenario, run, and operator", async () => {
  const fixture = serviceFixture();
  const service = createOrchestrationService({
    config: fixture.config,
    temporalAdapter: fixture.adapter,
  });
  const envelope = validControlEnvelope();

  await assert.rejects(
    service.controlControlledProofExecution(
      fixture.runId,
      { ...envelope, commissioning_session_id: "another-session" },
      { callerId: "platform-controlled-proof-executor" },
    ),
    (error) => error.code === "controlled_proof_control_binding_mismatch",
  );
  assert.equal(fixture.calls.control, 0);

  const result = await service.controlControlledProofExecution(
    fixture.runId,
    envelope,
    { callerId: "platform-controlled-proof-executor" },
  );
  assert.equal(fixture.calls.control, 1);
  assert.equal(result.run_id, fixture.runId);
});

test("expired contexts remain readable but deny new starts and non-cleanup controls", async () => {
  const context = validControlledProofContext({
    expiresAt: "2026-08-01T00:05:00.000Z",
  });
  const fixture = serviceFixture({ context });
  const service = createOrchestrationService({
    config: fixture.config,
    temporalAdapter: fixture.adapter,
  });

  await assert.rejects(
    service.startControlledProofExecution(fixture.startRequest, {
      callerId: "platform-controlled-proof-executor",
    }),
    (error) => error.code === "controlled_proof_not_admitted",
  );
  const retained = await service.getControlledProofExecution(fixture.runId, {
    callerId: "platform-controlled-proof-executor",
  });
  assert.equal(retained.run_id, fixture.runId);

  const retry = validControlEnvelope();
  retry.control.action = "retry";
  await assert.rejects(
    service.controlControlledProofExecution(fixture.runId, retry, {
      callerId: "platform-controlled-proof-executor",
    }),
    (error) => error.code === "controlled_proof_not_admitted",
  );
});

function serviceFixture({
  context = validControlledProofContext(),
  duplicate = false,
  driftBinding = false,
} = {}) {
  const config = loadConfig(controlledProofEnvForContext(context));
  const contextDigest = config.orchestration.controlledProof.contextDigest;
  const execution = controlledProofExecutionFor(
    context,
    "scenario-execution-01",
    { contextDigest },
  );
  const input = controlledProofWorkflowInputFor(context, execution);
  const runId = controlledProofRunIdFor(execution);
  const calls = { control: 0, get: 0, start: 0 };
  const projection = {
    state: "blocked",
    control_availability: [
      { action: "retry", available: true },
      { action: "resume", available: true },
      { action: "signal", available: false },
      { action: "cancel", available: true },
      { action: "defer", available: true },
    ],
  };
  const adapter = {
    async startControlledProofRun(contextRecord, selectedExecution) {
      calls.start += 1;
      assert.equal(contextRecord.contextDigest, contextDigest);
      assert.deepEqual(selectedExecution, execution);
      const bindings = structuredClone(toControlledProofRunBindings(input));
      if (driftBinding) bindings.scenario_execution_id = "scenario-execution-02";
      return {
        bindings,
        duplicate,
        ownerReceipt: null,
        projection: null,
        runId,
      };
    },
    async getControlledProofRun(selectedRunId) {
      calls.get += 1;
      assert.equal(selectedRunId, runId);
      return { ownerReceipt: null, projection, runId };
    },
    async controlControlledProofRun(selectedRunId, envelope) {
      calls.control += 1;
      assert.equal(selectedRunId, runId);
      assert.equal(envelope.scenario_execution_id, "scenario-execution-01");
      return { ownerReceipt: null, projection, runId };
    },
  };
  return {
    adapter,
    calls,
    config,
    context,
    execution,
    input,
    runId,
    startRequest: {
      schema_version: 1,
      scenario_execution_id: "scenario-execution-01",
    },
  };
}

function validControlEnvelope() {
  return {
    schema_version: 1,
    commissioning_session_id: "commissioning-session-698-1",
    scenario_execution_id: "scenario-execution-01",
    scenario_evidence: null,
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
