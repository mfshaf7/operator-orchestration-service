import assert from "node:assert/strict";
import test from "node:test";
import {
  WorkflowExecutionAlreadyStartedError,
  WorkflowIdConflictPolicy,
  WorkflowIdReusePolicy,
} from "@temporalio/client";

import {
  refinementRunBinding,
  refinementRunId,
} from "../src/refinement/run-model.js";
import {
  REFINEMENT_RUN_BINDING_MEMO_KEY,
  REFINEMENT_WORKFLOW_TASK_QUEUE,
  REFINEMENT_WORKFLOW_TYPE,
} from "../src/refinement/runtime-constants.js";
import {
  createRefinementTemporalAdapter,
  RefinementRuntimeError,
} from "../src/refinement/temporal-adapter.js";

const timestamp = "2026-08-26T01:00:00.000Z";

function request() {
  return {
    request_id: "refinement-apply-1",
    correlation_id: "correlation-1",
    idempotency_key: "refinement-key-1",
    package_ref: "delivery-package:909",
    accepted_draft: { draft_digest: `sha256:${"a".repeat(64)}` },
  };
}

function acceptedProjection(value = request()) {
  return {
    schema_version: 1,
    request_id: value.request_id,
    correlation_id: value.correlation_id,
    run_id: refinementRunId(value),
    state: "running",
    replayed: false,
    submitted_at: timestamp,
    updated_at: timestamp,
    poll_ref: `/v1/delivery-refinement/${value.package_ref}/runs/${refinementRunId(value)}`,
    events: [{
      event_id: "refinement-event-1",
      sequence: 1,
      event_type: "accepted",
      recorded_at: timestamp,
      message: "Accepted.",
      status: "completed",
    }],
    receipt: null,
    failure: null,
  };
}

function config() {
  return {
    refinement: { runtimeEnabled: true },
    orchestration: {
      temporal: {
        address: "temporal.test:7233",
        identity: "oos-refinement-api",
        namespace: "default",
      },
    },
  };
}

test("Refinement Temporal start freezes one packet and accepted request", async () => {
  let captured;
  const adapter = createRefinementTemporalAdapter({
    config: config(),
    clientFactory: async () => ({
      workflow: {
        async start(workflowType, options) {
          captured = { workflowType, options };
          return {};
        },
      },
    }),
  });
  const value = request();
  const packet = { packet_id: "refinement-packet:909" };
  const result = await adapter.startRun({
    callerId: "governance-operations-console",
    packet,
    request: value,
  });
  assert.equal(captured.workflowType, REFINEMENT_WORKFLOW_TYPE);
  assert.equal(captured.options.taskQueue, REFINEMENT_WORKFLOW_TASK_QUEUE);
  assert.equal(captured.options.workflowId, refinementRunId(value));
  assert.equal(captured.options.workflowIdConflictPolicy, WorkflowIdConflictPolicy.FAIL);
  assert.equal(captured.options.workflowIdReusePolicy, WorkflowIdReusePolicy.REJECT_DUPLICATE);
  assert.deepEqual(captured.options.memo, {
    [REFINEMENT_RUN_BINDING_MEMO_KEY]: refinementRunBinding(value),
  });
  assert.equal(captured.options.args[0].caller_id, "governance-operations-console");
  assert.equal(captured.options.args[0].packet, packet);
  assert.equal(result.state, "accepted");
});

test("Refinement duplicate start replays only an identical durable binding", async () => {
  const value = request();
  const projection = acceptedProjection(value);
  const adapter = createRefinementTemporalAdapter({
    config: config(),
    clientFactory: async () => ({
      workflow: {
        async start(workflowType, options) {
          throw new WorkflowExecutionAlreadyStartedError(
            "already started",
            options.workflowId,
            workflowType,
          );
        },
        getHandle() {
          return {
            async describe() {
              return {
                memo: {
                  [REFINEMENT_RUN_BINDING_MEMO_KEY]: refinementRunBinding(value),
                },
                status: { name: "RUNNING" },
              };
            },
            async query() { return projection; },
          };
        },
      },
    }),
  });
  const result = await adapter.startRun({ callerId: "console", packet: {}, request: value });
  assert.equal(result.replayed, true);
  assert.equal(result.run_id, projection.run_id);
});

test("Refinement duplicate start rejects conflicting request custody", async () => {
  const value = request();
  const adapter = createRefinementTemporalAdapter({
    config: config(),
    clientFactory: async () => ({
      workflow: {
        async start(workflowType, options) {
          throw new WorkflowExecutionAlreadyStartedError(
            "already started",
            options.workflowId,
            workflowType,
          );
        },
        getHandle() {
          return {
            async describe() {
              return {
                memo: {
                  [REFINEMENT_RUN_BINDING_MEMO_KEY]: {
                    ...refinementRunBinding(value),
                    request_digest: `sha256:${"f".repeat(64)}`,
                  },
                },
                status: { name: "RUNNING" },
              };
            },
          };
        },
      },
    }),
  });
  await assert.rejects(
    adapter.startRun({ callerId: "console", packet: {}, request: value }),
    (error) => error instanceof RefinementRuntimeError && error.code === "apply_conflict",
  );
});

test("Refinement runtime cannot start before activation", async () => {
  let connected = false;
  const adapter = createRefinementTemporalAdapter({
    config: { ...config(), refinement: { runtimeEnabled: false } },
    clientFactory: async () => {
      connected = true;
      return {};
    },
  });
  await assert.rejects(
    adapter.startRun({ callerId: "console", packet: {}, request: request() }),
    (error) =>
      error instanceof RefinementRuntimeError && error.code === "apply_execution_failed",
  );
  assert.equal(connected, false);
});
