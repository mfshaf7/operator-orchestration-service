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
import {
  createRunProjection,
  projectWgcfResult,
  startRunAttempt,
} from "../src/orchestration/run-projection.js";
import {
  OrchestrationRunNotFoundError,
  createTemporalAdapter,
} from "../src/orchestration/temporal-adapter.js";
import {
  validOrchestrationRequest,
  validWgcfResult,
} from "../test-fixtures/orchestration.js";

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
            async describe() {
              return { status: { name: "RUNNING" } };
            },
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

test("duplicate starts return a completed result without a workflow poller", async () => {
  const projection = completedProjection();
  let queryCalled = false;
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
        getHandle() {
          return {
            async describe() {
              return { status: { name: "COMPLETED" } };
            },
            async query() {
              queryCalled = true;
              throw new Error("closed workflow must not be queried");
            },
            async result() {
              return projection;
            },
          };
        },
      },
    }),
  });

  const result = await adapter.startRun(normalizedRequest());

  assert.equal(result.duplicate, true);
  assert.equal(result.projection, projection);
  assert.equal(queryCalled, false);
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
            status: { name: "RUNNING" },
          };
        },
        getHandle() {
          return {
            async query() {
              throw projectionFailure;
            },
            async describe() {
              return { status: { name: "RUNNING" } };
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
            async describe() {
              return { status: { name: "RUNNING" } };
            },
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
            async describe() {
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

test("completed runs are read from retained workflow results without a worker", async () => {
  const projection = completedProjection();
  let queryCalled = false;
  const adapter = createTemporalAdapter({
    config: {},
    clientFactory: async () => ({
      workflow: {
        getHandle() {
          return {
            async describe() {
              return { status: { name: "COMPLETED" } };
            },
            async query() {
              queryCalled = true;
              throw new Error("closed workflow must not be queried");
            },
            async result() {
              return projection;
            },
          };
        },
      },
    }),
  });

  const retained = await adapter.getRun(projection.run_id);

  assert.equal(retained, projection);
  assert.equal(queryCalled, false);
});

test("run reads recover when a running execution completes during query", async () => {
  const projection = completedProjection();
  let describeCalls = 0;
  const adapter = createTemporalAdapter({
    config: {},
    clientFactory: async () => ({
      workflow: {
        getHandle() {
          return {
            async describe() {
              describeCalls += 1;
              return {
                status: {
                  name: describeCalls === 1 ? "RUNNING" : "COMPLETED",
                },
              };
            },
            async query() {
              throw new Error("workflow closed before query was processed");
            },
            async result() {
              return projection;
            },
          };
        },
      },
    }),
  });

  assert.equal(await adapter.getRun(projection.run_id), projection);
  assert.equal(describeCalls, 2);
});

test("run listing reads completed projections without a workflow poller", async () => {
  const projection = completedProjection();
  let queryCalled = false;
  const adapter = createTemporalAdapter({
    config: {},
    clientFactory: async () => ({
      workflow: {
        async *list() {
          yield {
            workflowId: projection.workflow_id,
            runId: "temporal-run:1",
            status: { name: "COMPLETED" },
          };
        },
        getHandle() {
          return {
            async query() {
              queryCalled = true;
              throw new Error("closed workflow must not be queried");
            },
            async result() {
              return projection;
            },
          };
        },
      },
    }),
  });

  assert.deepEqual(await adapter.listRuns(), [projection]);
  assert.equal(queryCalled, false);
});

test("post-control reads return terminal workflow history without a poller", async () => {
  const projection = completedProjection();
  let queryCalled = false;
  let signalCalled = false;
  const adapter = createTemporalAdapter({
    config: {},
    clientFactory: async () => ({
      workflow: {
        getHandle() {
          return {
            async signal() {
              signalCalled = true;
            },
            async describe() {
              return { status: { name: "COMPLETED" } };
            },
            async query() {
              queryCalled = true;
              throw new Error("closed workflow must not be queried");
            },
            async result() {
              return projection;
            },
          };
        },
      },
    }),
  });

  const retained = await adapter.controlRun(projection.run_id, {
    action: "cancel",
  });

  assert.equal(retained, projection);
  assert.equal(signalCalled, true);
  assert.equal(queryCalled, false);
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

function completedProjection() {
  let projection = startRunAttempt(
    validProjection(),
    "2026-07-31T11:00:01.000Z",
  );
  projection = projectWgcfResult(
    projection,
    validWgcfResult(),
    "2026-07-31T11:00:02.000Z",
  );
  return projection;
}

function normalizedRequest() {
  return normalizeValidationReadinessRequest(validOrchestrationRequest(), {
    callerId: "governance-operations-console",
  });
}
