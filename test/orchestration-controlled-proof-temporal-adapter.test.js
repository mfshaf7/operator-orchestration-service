import assert from "node:assert/strict";
import test from "node:test";
import {
  WorkflowExecutionAlreadyStartedError,
  WorkflowIdConflictPolicy,
  WorkflowIdReusePolicy,
} from "@temporalio/client";

import {
  controlledProofExecutionFor,
  controlledProofRunIdFor,
  controlledProofWorkflowInputFor,
  toControlledProofRunBindings,
} from "../src/orchestration/controlled-proof-contracts.js";
import {
  createControlledProofRunProjection,
  projectControlledProofWgcfResult,
  startControlledProofAttempt,
} from "../src/orchestration/controlled-proof-run-projection.js";
import {
  CONTROLLED_PROOF_RUN_BINDING_MEMO_KEY,
  CONTROLLED_PROOF_WORKFLOW_TYPE,
} from "../src/orchestration/constants.js";
import {
  ControlledProofRunBindingUnverifiedError,
  createTemporalAdapter,
} from "../src/orchestration/temporal-adapter.js";
import { validControlledProofContext } from "../test-fixtures/orchestration.js";

const CONTEXT_DIGEST = `sha256:${"9".repeat(64)}`;

test("controlled proof start uses its pinned queue and memo without the active generation registry", async () => {
  let startCall;
  let updateWithStartCalled = false;
  const adapter = createTemporalAdapter({
    config: {},
    clientFactory: async () => ({
      workflow: {
        async executeUpdateWithStart() {
          updateWithStartCalled = true;
        },
        async start(workflowType, options) {
          startCall = { workflowType, options };
          return {};
        },
      },
    }),
  });
  const fixture = proofFixture(0);

  const result = await adapter.startControlledProofRun(
    fixture.contextRecord,
    fixture.execution,
  );

  assert.equal(updateWithStartCalled, false);
  assert.equal(startCall.workflowType, CONTROLLED_PROOF_WORKFLOW_TYPE);
  assert.equal(startCall.options.taskQueue, fixture.context.runtime.workflow_task_queue);
  assert.equal(startCall.options.workflowId, fixture.runId);
  assert.equal(
    startCall.options.workflowIdConflictPolicy,
    WorkflowIdConflictPolicy.FAIL,
  );
  assert.equal(
    startCall.options.workflowIdReusePolicy,
    WorkflowIdReusePolicy.REJECT_DUPLICATE,
  );
  assert.deepEqual(startCall.options.args, [fixture.input]);
  assert.deepEqual(startCall.options.memo, {
    [CONTROLLED_PROOF_RUN_BINDING_MEMO_KEY]:
      toControlledProofRunBindings(fixture.input),
  });
  assert.equal(result.duplicate, false);
  assert.equal(result.runId, fixture.runId);
  assert.equal(result.projection, null);
  assert.equal(result.ownerReceipt, null);
});

test("controlled proof duplicate suppression verifies the retained proof memo", async () => {
  const fixture = proofFixture(3);
  const bindings = toControlledProofRunBindings(fixture.input);
  const adapter = createTemporalAdapter({
    config: {},
    clientFactory: async () => ({
      workflow: {
        async start(workflowType, options) {
          throw new WorkflowExecutionAlreadyStartedError(
            "already started",
            options.workflowId,
            workflowType,
          );
        },
        getHandle(workflowId) {
          assert.equal(workflowId, fixture.runId);
          return {
            async describe() {
              return {
                memo: { [CONTROLLED_PROOF_RUN_BINDING_MEMO_KEY]: bindings },
                status: { name: "RUNNING" },
              };
            },
          };
        },
      },
    }),
  });

  const result = await adapter.startControlledProofRun(
    fixture.contextRecord,
    fixture.execution,
  );
  assert.equal(result.duplicate, true);
  assert.deepEqual(result.bindings, bindings);
  assert.equal(result.projection, null);
});

test("terminal controlled proof reads issue an OOS receipt from retained Temporal history", async () => {
  const fixture = proofFixture(0);
  const terminal = completedProjection(fixture);
  const adapter = createTemporalAdapter({
    config: {},
    clientFactory: async () => ({
      workflow: {
        getHandle(workflowId) {
          assert.equal(workflowId, fixture.runId);
          return {
            async describe() {
              return {
                memo: {
                  [CONTROLLED_PROOF_RUN_BINDING_MEMO_KEY]:
                    toControlledProofRunBindings(fixture.input),
                },
                status: { name: "COMPLETED" },
              };
            },
            async result() {
              return terminal;
            },
          };
        },
      },
    }),
  });

  const result = await adapter.getControlledProofRun(
    fixture.runId,
    fixture.contextRecord,
    fixture.execution,
  );
  assert.equal(result.projection.state, "completed");
  assert.equal(result.ownerReceipt.owner_result, "passed");
  assert.equal(
    result.ownerReceipt.owner_execution.execution_id,
    "temporal-execution-run-01",
  );
  assert.equal(
    result.ownerReceipt.authorization_digest,
    fixture.context.authorization.authorization_digest,
  );
});

test("running controlled proof reads reject a retained memo from a replaced context", async () => {
  const retained = proofFixture(0);
  const replacementContext = validControlledProofContext();
  replacementContext.commissioning_session.commissioning_session_id =
    "commissioning-session-698-2";
  const replacementRecord = {
    context: replacementContext,
    contextDigest: `sha256:${"8".repeat(64)}`,
  };
  const replacementExecution = controlledProofExecutionFor(
    replacementContext,
    retained.execution.scenario_execution_id,
    { contextDigest: replacementRecord.contextDigest },
  );
  let queried = false;
  const adapter = createTemporalAdapter({
    config: {},
    clientFactory: async () => ({
      workflow: {
        getHandle(workflowId) {
          assert.equal(workflowId, retained.runId);
          return {
            async describe() {
              return {
                memo: {
                  [CONTROLLED_PROOF_RUN_BINDING_MEMO_KEY]:
                    toControlledProofRunBindings(retained.input),
                },
                status: { name: "RUNNING" },
              };
            },
            async query() {
              queried = true;
              return startedProjection(retained);
            },
          };
        },
      },
    }),
  });

  await assert.rejects(
    adapter.getControlledProofRun(
      retained.runId,
      replacementRecord,
      replacementExecution,
    ),
    ControlledProofRunBindingUnverifiedError,
  );
  assert.equal(queried, false);
});

function proofFixture(index) {
  const context = validControlledProofContext();
  const contextRecord = { context, contextDigest: CONTEXT_DIGEST };
  const scenario = context.commissioning_session.scenario_executions[index];
  const execution = controlledProofExecutionFor(
    context,
    scenario.scenario_execution_id,
    { contextDigest: CONTEXT_DIGEST },
  );
  const input = controlledProofWorkflowInputFor(context, execution);
  return {
    context,
    contextRecord,
    execution,
    input,
    runId: controlledProofRunIdFor(execution),
  };
}

function completedProjection(fixture) {
  let projection = createControlledProofRunProjection({
    request: fixture.input,
    runId: fixture.runId,
    temporalExecutionRunId: "temporal-execution-run-01",
    timestamp: "2026-08-01T00:03:00.000Z",
  });
  projection = startControlledProofAttempt(
    projection,
    "2026-08-01T00:03:01.000Z",
  );
  return projectControlledProofWgcfResult(
    projection,
    {
      status_code: "ready",
      artifact_digest: `sha256:${"a".repeat(64)}`,
      receipt_ref: {
        receipt_id: "receipt:wgcf:controlled-proof:1",
        digest: `sha256:${"b".repeat(64)}`,
      },
    },
    "2026-08-01T00:04:00.000Z",
  );
}

function startedProjection(fixture) {
  const queued = createControlledProofRunProjection({
    request: fixture.input,
    runId: fixture.runId,
    temporalExecutionRunId: "temporal-execution-run-01",
    timestamp: "2026-08-01T00:03:00.000Z",
  });
  return startControlledProofAttempt(
    queued,
    "2026-08-01T00:03:01.000Z",
  );
}
