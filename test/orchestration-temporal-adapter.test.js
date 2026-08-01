import assert from "node:assert/strict";
import test from "node:test";
import {
  WorkflowExecutionAlreadyStartedError,
  WorkflowIdConflictPolicy,
  WorkflowIdReusePolicy,
  WorkflowNotFoundError,
} from "@temporalio/client";

import { normalizeValidationReadinessRequest } from "../src/orchestration/contracts.js";
import {
  GENERATION_START_REGISTRY_REGISTER_UPDATE,
  GENERATION_START_REGISTRY_UPDATE_ID_PREFIX,
  GENERATION_START_REGISTRY_WORKFLOW_TYPE,
  RUN_BINDING_MEMO_KEY,
} from "../src/orchestration/constants.js";
import {
  cancelRun,
  createRunProjection,
  projectWgcfResult,
  recordRunControl,
  startRunAttempt,
} from "../src/orchestration/run-projection.js";
import {
  OrchestrationControlIdempotencyConflictError,
  OrchestrationControlNotAppliedError,
  OrchestrationRunBindingUnverifiedError,
  OrchestrationRunNotFoundError,
  createTemporalAdapter,
} from "../src/orchestration/temporal-adapter.js";
import {
  TEST_ACTIVATION_EVIDENCE_DIGEST,
  TEST_GENERATION_START_REGISTRY_ID,
  TEST_GENERATION_START_REGISTRY_QUEUE,
  TEST_VALIDATION_READINESS_WORKFLOW_QUEUE,
  validGenerationStartRegistration,
  validGenerationStartRegistryInput,
  validOrchestrationRequest,
  validTemporalRunBindings,
  validTemporalStartOptions,
  validTemporalWorkflowInput,
  validWgcfResult,
} from "../test-fixtures/orchestration.js";

test("Temporal receives only the bounded workflow-history input", async () => {
  const calls = [];
  let registryOptions;
  let registryUpdateOptions;
  let startOptions;
  const adapter = createTemporalAdapter({
    config: {},
    clientFactory: async () => ({
      workflow: {
        async executeUpdateWithStart(updateName, options) {
          calls.push("registry");
          assert.equal(
            updateName,
            GENERATION_START_REGISTRY_REGISTER_UPDATE,
          );
          registryOptions = options.startWorkflowOperation.options;
          registryUpdateOptions = options;
          assert.deepEqual(options.args, [validGenerationStartRegistration()]);
          assert.equal(
            options.startWorkflowOperation.workflowTypeOrFunc,
            GENERATION_START_REGISTRY_WORKFLOW_TYPE,
          );
          return "registered";
        },
        async start(_workflowType, options) {
          calls.push("business");
          startOptions = options;
          return {};
        },
      },
    }),
  });

  const result = await startNormalizedRun(adapter);
  const [workflowInput] = startOptions.args;

  assert.deepEqual(calls, ["registry", "business"]);
  assert.deepEqual(registryOptions.args, [validGenerationStartRegistryInput()]);
  assert.equal(registryOptions.taskQueue, TEST_GENERATION_START_REGISTRY_QUEUE);
  assert.equal(registryOptions.workflowId, TEST_GENERATION_START_REGISTRY_ID);
  assert.equal(
    registryUpdateOptions.updateId,
    `${GENERATION_START_REGISTRY_UPDATE_ID_PREFIX}:` +
      "oos:validation-readiness-run:v1:validation-readiness-abc123",
  );
  assert.equal(
    registryOptions.workflowIdConflictPolicy,
    WorkflowIdConflictPolicy.USE_EXISTING,
  );
  assert.equal(
    registryOptions.workflowIdReusePolicy,
    WorkflowIdReusePolicy.REJECT_DUPLICATE,
  );
  assert.equal(result.duplicate, false);
  assert.equal(result.projection, null);
  assert.equal(
    result.runId,
    "oos:validation-readiness-run:v1:validation-readiness-abc123",
  );
  assert.deepEqual(startOptions.memo, {
    [RUN_BINDING_MEMO_KEY]: validTemporalRunBindings(normalizedRequest()),
  });
  assert.equal(workflowInput.source_ref, "art:delivery-698");
  assert.match(workflowInput.artifact_digest, /^sha256:[0-9a-f]{64}$/);
  assert.equal(Object.hasOwn(workflowInput, "intent_summary"), false);
  assert.equal(Object.hasOwn(workflowInput, "input_refs"), false);
  assert.equal(Object.hasOwn(workflowInput, "approval_refs"), false);
  assert.equal(workflowInput.caller_id, "governance-operations-console");
  assert.equal(
    workflowInput.activation_evidence_digest,
    TEST_ACTIVATION_EVIDENCE_DIGEST,
  );
  assert.equal(
    workflowInput.workflow_task_queue,
    TEST_VALIDATION_READINESS_WORKFLOW_QUEUE,
  );
  assert.equal(
    startOptions.taskQueue,
    TEST_VALIDATION_READINESS_WORKFLOW_QUEUE,
  );
  assert.equal(
    startOptions.workflowIdConflictPolicy,
    WorkflowIdConflictPolicy.FAIL,
  );
  assert.equal(
    startOptions.workflowIdReusePolicy,
    WorkflowIdReusePolicy.REJECT_DUPLICATE,
  );
});

test("generation registration retries reuse one deterministic Temporal update", async () => {
  const updateIds = [];
  const adapter = createTemporalAdapter({
    config: {},
    clientFactory: async () => ({
      workflow: {
        async executeUpdateWithStart(_updateName, options) {
          updateIds.push(options.updateId);
          return "registered";
        },
        async start() {
          return {};
        },
      },
    }),
  });

  await startNormalizedRun(adapter);
  await startNormalizedRun(adapter);

  assert.equal(updateIds.length, 2);
  assert.equal(updateIds[0], updateIds[1]);
  assert.equal(
    updateIds[0],
    `${GENERATION_START_REGISTRY_UPDATE_ID_PREFIX}:` +
      "oos:validation-readiness-run:v1:validation-readiness-abc123",
  );
});

test("activation evidence creates an isolated workflow polling generation", async () => {
  const taskQueues = [];
  const adapter = createTemporalAdapter({
    config: {},
    clientFactory: async () => ({
      workflow: {
        async executeUpdateWithStart() {
          return "registered";
        },
        async start(_workflowType, options) {
          taskQueues.push(options.taskQueue);
          return {};
        },
      },
    }),
  });
  const nextActivationDigest = `sha256:${"c".repeat(64)}`;

  await startNormalizedRun(adapter);
  await adapter.startRun(normalizedRequest(), {
    activationEvidenceDigest: nextActivationDigest,
  });

  assert.equal(taskQueues[0], TEST_VALIDATION_READINESS_WORKFLOW_QUEUE);
  assert.notEqual(taskQueues[0], taskQueues[1]);
  assert.match(taskQueues[1], new RegExp(`${"c".repeat(64)}$`));
});

test("new starts return an immediate admission receipt without a workflow poller", async () => {
  let describeCalled = false;
  let queryCalled = false;
  let resultCalled = false;
  const adapter = createTemporalAdapter({
    config: {},
    clientFactory: async () => ({
      workflow: {
        async executeUpdateWithStart() {
          return "registered";
        },
        async start() {
          return {
            async query() {
              queryCalled = true;
            },
            async describe() {
              describeCalled = true;
            },
            async result() {
              resultCalled = true;
            },
          };
        },
      },
    }),
  });

  const result = await startNormalizedRun(adapter);

  assert.equal(result.duplicate, false);
  assert.equal(result.projection, null);
  assert.equal(describeCalled, false);
  assert.equal(queryCalled, false);
  assert.equal(resultCalled, false);
});

test("Temporal duplicate rejection resolves the existing stable workflow", async () => {
  const bindings = validTemporalRunBindings(normalizedRequest());
  const handleCalls = [];
  const adapter = createTemporalAdapter({
    config: {},
    clientFactory: async () => ({
      workflow: {
        async executeUpdateWithStart() {
          return "registered";
        },
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
              return {
                memo: { [RUN_BINDING_MEMO_KEY]: bindings },
                status: { name: "RUNNING" },
              };
            },
            async query() {
              throw new Error("duplicate admission must not query a worker");
            },
          };
        },
      },
    }),
  });

  const result = await startNormalizedRun(adapter);

  assert.equal(result.duplicate, true);
  assert.deepEqual(handleCalls, [
    ["oos:validation-readiness-run:v1:validation-readiness-abc123"],
  ]);
  assert.equal(result.projection, null);
  assert.deepEqual(result.bindings, bindings);
});

test("duplicate starts return a completed result without a workflow poller", async () => {
  const projection = completedProjection();
  const bindings = validTemporalRunBindings(normalizedRequest());
  let queryCalled = false;
  const adapter = createTemporalAdapter({
    config: {},
    clientFactory: async () => ({
      workflow: {
        async executeUpdateWithStart() {
          return "registered";
        },
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
              return {
                memo: { [RUN_BINDING_MEMO_KEY]: bindings },
                status: { name: "COMPLETED" },
              };
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

  const result = await startNormalizedRun(adapter);

  assert.equal(result.duplicate, true);
  assert.equal(result.projection, projection);
  assert.equal(queryCalled, false);
});

test("duplicate starts fail closed when retained run bindings are missing", async () => {
  const adapter = createTemporalAdapter({
    config: {},
    clientFactory: async () => ({
      workflow: {
        async executeUpdateWithStart() {
          return "registered";
        },
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
              return { status: { name: "RUNNING" } };
            },
          };
        },
      },
    }),
  });

  await assert.rejects(
    startNormalizedRun(adapter),
    (error) =>
      error instanceof OrchestrationRunBindingUnverifiedError &&
      error.runId ===
        "oos:validation-readiness-run:v1:validation-readiness-abc123",
  );
});

test("a rejected Temporal client connection is not retained", async () => {
  let attempts = 0;
  const adapter = createTemporalAdapter({
    config: {},
    clientFactory: async () => {
      attempts += 1;
      if (attempts === 1) {
        throw new Error("transient Temporal connection failure");
      }
      return {
        workflow: {
          async executeUpdateWithStart() {
            return "registered";
          },
          async start() {
            return {};
          },
        },
      };
    },
  });

  await assert.rejects(
    startNormalizedRun(adapter),
    /transient Temporal connection failure/,
  );
  const result = await startNormalizedRun(adapter);

  assert.equal(attempts, 2);
  assert.equal(result.duplicate, false);
  assert.equal(result.projection, null);
});

test("a failed generation registration prevents the business workflow start", async () => {
  const registrationFailure = new Error("generation registry unavailable");
  let businessStartCalled = false;
  const adapter = createTemporalAdapter({
    config: {},
    clientFactory: async () => ({
      workflow: {
        async executeUpdateWithStart() {
          throw registrationFailure;
        },
        async start() {
          businessStartCalled = true;
        },
      },
    }),
  });

  await assert.rejects(startNormalizedRun(adapter), registrationFailure);
  assert.equal(businessStartCalled, false);
});

test("a capacity-rejected generation registration prevents the business workflow start", async () => {
  let businessStartCalled = false;
  let updateCall;
  const adapter = createTemporalAdapter({
    config: {},
    clientFactory: async () => ({
      workflow: {
        async executeUpdateWithStart(updateName, options) {
          updateCall = { updateName, options };
          throw new Error("The activation generation is at capacity.");
        },
        async start() {
          businessStartCalled = true;
        },
      },
    }),
  });

  await assert.rejects(
    startNormalizedRun(adapter),
    /at capacity/,
  );
  assert.equal(businessStartCalled, false);
  assert.equal(
    updateCall.updateName,
    GENERATION_START_REGISTRY_REGISTER_UPDATE,
  );
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
  const control = validControl("cancel");
  const projection = cancelledProjection(control);
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

  const retained = await adapter.controlRun(projection.run_id, control);

  assert.equal(retained, projection);
  assert.equal(signalCalled, true);
  assert.equal(queryCalled, false);
});

test("control response loss returns a retained projection when the control was recorded", async () => {
  const control = validControl("cancel");
  const projection = cancelledProjection(control);
  const adapter = createTemporalAdapter({
    config: {},
    clientFactory: async () => ({
      workflow: {
        getHandle() {
          return {
            async signal() {
              throw new WorkflowNotFoundError(
                "Workflow closed during signal response",
                projection.workflow_id,
                undefined,
              );
            },
            async describe() {
              return { status: { name: "COMPLETED" } };
            },
            async result() {
              return projection;
            },
          };
        },
      },
    }),
  });

  assert.equal(await adapter.controlRun(projection.run_id, control), projection);
});

test("closed-run control races report that the control was not applied", async () => {
  const control = validControl("cancel");
  const projection = completedProjection();
  const adapter = createTemporalAdapter({
    config: {},
    clientFactory: async () => ({
      workflow: {
        getHandle() {
          return {
            async signal() {
              throw new WorkflowNotFoundError(
                "Workflow closed before signal",
                projection.workflow_id,
                undefined,
              );
            },
            async describe() {
              return { status: { name: "COMPLETED" } };
            },
            async result() {
              return projection;
            },
          };
        },
      },
    }),
  });

  await assert.rejects(
    adapter.controlRun(projection.run_id, control),
    (error) =>
      error instanceof OrchestrationControlNotAppliedError &&
      error.runId === projection.run_id &&
      error.action === "cancel" &&
      error.projection === projection,
  );
});

test("accepted signals are not reported as applied without retained control evidence", async () => {
  const control = validControl("cancel");
  const projection = completedProjection();
  const adapter = createTemporalAdapter({
    config: {},
    clientFactory: async () => ({
      workflow: {
        getHandle() {
          return {
            async signal() {},
            async describe() {
              return { status: { name: "COMPLETED" } };
            },
            async result() {
              return projection;
            },
          };
        },
      },
    }),
  });

  await assert.rejects(
    adapter.controlRun(projection.run_id, control),
    (error) =>
      error instanceof OrchestrationControlNotAppliedError &&
      error.projection === projection,
  );
});

test("control key reuse cannot authenticate a different immutable control", async () => {
  const retainedControl = validControl("defer");
  const requestedControl = {
    ...validControl("cancel"),
    idempotency_key: retainedControl.idempotency_key,
  };
  const projection = recordRunControl(
    validProjection(),
    retainedControl,
    "2026-07-31T11:00:01.000Z",
  );
  const adapter = createTemporalAdapter({
    config: {},
    clientFactory: async () => ({
      workflow: {
        getHandle() {
          return {
            async signal() {},
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

  await assert.rejects(
    adapter.controlRun(projection.run_id, requestedControl),
    (error) =>
      error instanceof OrchestrationControlIdempotencyConflictError &&
      error.runId === projection.run_id &&
      error.action === "cancel" &&
      error.mismatchedFields.includes("control_id") &&
      error.mismatchedFields.includes("action") &&
      !error.mismatchedFields.includes("idempotency_key"),
  );
});

test("control races still distinguish a genuinely missing run", async () => {
  const control = validControl("cancel");
  const runId = "oos:validation-readiness-run:v1:missing";
  const adapter = createTemporalAdapter({
    config: {},
    clientFactory: async () => ({
      workflow: {
        getHandle() {
          return {
            async signal() {
              throw new WorkflowNotFoundError(
                "Workflow not found",
                runId,
                undefined,
              );
            },
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
    adapter.controlRun(runId, control),
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
  const request = validTemporalWorkflowInput(normalizedRequest());
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

function cancelledProjection(control) {
  let projection = recordRunControl(
    validProjection(),
    control,
    "2026-07-31T11:00:01.000Z",
  );
  projection = cancelRun(
    projection,
    control,
    "2026-07-31T11:00:02.000Z",
  );
  return projection;
}

function validControl(action) {
  return {
    schema_version: 1,
    control_id: `control:${action}:1`,
    action,
    operator_id: "operator:mfshaf7",
    reason_ref: `decision:${action}:1`,
    idempotency_key: `control-${action}-1`,
  };
}

function startNormalizedRun(adapter) {
  return adapter.startRun(normalizedRequest(), validTemporalStartOptions());
}

function normalizedRequest() {
  return normalizeValidationReadinessRequest(validOrchestrationRequest(), {
    callerId: "governance-operations-console",
  });
}
