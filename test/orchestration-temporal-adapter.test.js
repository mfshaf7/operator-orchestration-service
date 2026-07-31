import assert from "node:assert/strict";
import test from "node:test";
import {
  WorkflowExecutionAlreadyStartedError,
  WorkflowIdConflictPolicy,
  WorkflowIdReusePolicy,
  WorkflowNotFoundError,
} from "@temporalio/client";

import {
  normalizeValidationReadinessRequest,
  toTemporalWorkflowInput,
} from "../src/orchestration/contracts.js";
import { createRunProjection } from "../src/orchestration/run-projection.js";
import {
  OrchestrationRunNotFoundError,
  createTemporalAdapter,
} from "../src/orchestration/temporal-adapter.js";
import { validOrchestrationRequest } from "../test-fixtures/orchestration.js";

test("Temporal receives only the bounded workflow-history input", async () => {
  let startOptions;
  const projection = validProjection();
  const adapter = createTemporalAdapter({
    config: {},
    clientFactory: async () => ({
      workflow: {
        async start(_workflowType, options) {
          startOptions = options;
          return {
            async query() {
              return projection;
            },
          };
        },
      },
    }),
  });

  const result = await adapter.startRun(normalizedRequest());
  const [workflowInput] = startOptions.args;

  assert.equal(result.duplicate, false);
  assert.equal(result.projection, projection);
  assert.equal(workflowInput.source_ref, "art:delivery-698");
  assert.match(workflowInput.artifact_digest, /^sha256:[0-9a-f]{64}$/);
  assert.equal(Object.hasOwn(workflowInput, "intent_summary"), false);
  assert.equal(Object.hasOwn(workflowInput, "input_refs"), false);
  assert.equal(Object.hasOwn(workflowInput, "approval_refs"), false);
  assert.equal(workflowInput.caller_id, "governance-operations-console");
  assert.equal(
    startOptions.workflowIdConflictPolicy,
    WorkflowIdConflictPolicy.FAIL,
  );
  assert.equal(
    startOptions.workflowIdReusePolicy,
    WorkflowIdReusePolicy.REJECT_DUPLICATE,
  );
});

test("Temporal duplicate rejection resolves the existing stable workflow", async () => {
  const projection = validProjection();
  const handleCalls = [];
  const adapter = createTemporalAdapter({
    config: {},
    clientFactory: async () => ({
      workflow: {
        async start(workflowType, options) {
          throw new WorkflowExecutionAlreadyStartedError(
            "Workflow execution already started",
            options.workflowId,
            workflowType,
          );
        },
        getHandle(...args) {
          handleCalls.push(args);
          return {
            async query() {
              return projection;
            },
          };
        },
      },
    }),
  });

  const result = await adapter.startRun(normalizedRequest());

  assert.equal(result.duplicate, true);
  assert.deepEqual(handleCalls, [
    ["oos:validation-readiness-run:v1:validation-readiness-abc123"],
  ]);
  assert.equal(result.projection, projection);
});

test("run listing fails closed when a retained execution cannot be projected", async () => {
  const projectionFailure = new Error("projection unavailable");
  const adapter = createTemporalAdapter({
    config: {},
    clientFactory: async () => ({
      workflow: {
        async *list() {
          yield {
            workflowId: "oos:validation-readiness-run:v1:key",
            runId: "temporal-run:1",
          };
        },
        getHandle() {
          return {
            async query() {
              throw projectionFailure;
            },
          };
        },
      },
    }),
  });

  await assert.rejects(adapter.listRuns({ limit: 10 }), projectionFailure);
});

test("runtime reads reject projections outside the aggregate contract", async () => {
  const projection = validProjection();
  const adapter = createTemporalAdapter({
    config: {},
    clientFactory: async () => ({
      workflow: {
        getHandle() {
          return {
            async query() {
              return {
                ...projection,
                runtime: {
                  ...projection.runtime,
                  raw_runtime_output: "forbidden",
                },
              };
            },
          };
        },
      },
    }),
  });

  await assert.rejects(
    adapter.getRun(
      "oos:validation-readiness-run:v1:validation-readiness-abc123",
    ),
    /runtime contains fields outside the admitted boundary/,
  );
});

test("runtime reads map missing Temporal executions to the adapter boundary", async () => {
  const runId =
    "oos:validation-readiness-run:v1:validation-readiness-abc123";
  const adapter = createTemporalAdapter({
    config: {},
    clientFactory: async () => ({
      workflow: {
        getHandle() {
          return {
            async query() {
              throw new WorkflowNotFoundError(
                "Workflow not found",
                runId,
                undefined,
              );
            },
          };
        },
      },
    }),
  });

  await assert.rejects(
    adapter.getRun(runId),
    (error) =>
      error instanceof OrchestrationRunNotFoundError &&
      error.runId === runId,
  );
});

test("invalid run references fail before a Temporal client is created", async () => {
  let clientCreated = false;
  const adapter = createTemporalAdapter({
    config: {},
    clientFactory: async () => {
      clientCreated = true;
      throw new Error("client must not be created");
    },
  });

  await assert.rejects(
    adapter.getRun("oos:another-definition:v1:key"),
    /does not identify an admitted validation-readiness run/,
  );
  assert.equal(clientCreated, false);
});

function validProjection() {
  const request = toTemporalWorkflowInput(normalizedRequest());
  const runId =
    "oos:validation-readiness-run:v1:validation-readiness-abc123";
  return createRunProjection({
    request,
    runId,
    temporalExecutionRunId: "temporal-run:1",
    workflowId: runId,
    timestamp: "2026-07-31T11:00:00.000Z",
  });
}

function normalizedRequest() {
  return normalizeValidationReadinessRequest(validOrchestrationRequest(), {
    callerId: "governance-operations-console",
  });
}
