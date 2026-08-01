import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { ActivityCancellationType } from "@temporalio/workflow";

import {
  assertProjection,
  cancelRun,
  createRunProjection,
  deferRun,
  finishExhaustedRun,
  projectActivityFailure,
  projectWgcfResult,
  recordRunControl,
  rejectExpiredApproval,
  startRunAttempt,
} from "../src/orchestration/run-projection.js";
import {
  validOrchestrationRequest,
  validTemporalWorkflowInput,
  validWgcfResult,
} from "../test-fixtures/orchestration.js";
import { normalizeValidationReadinessRequest } from "../src/orchestration/contracts.js";
import {
  enqueueRunControl,
  VALIDATION_READINESS_ACTIVITY_OPTIONS,
  takeAvailableRunControl,
  temporalFailureType,
} from "../src/orchestration/workflows.js";

const startedAt = "2026-07-31T11:00:00.000Z";
const runId = "oos:validation-readiness-run:v1:key";

test("activity retry cannot outrun the bounded WGCF owner", () => {
  assert.equal(
    VALIDATION_READINESS_ACTIVITY_OPTIONS.startToCloseTimeout,
    "5m",
  );
  assert.equal(
    VALIDATION_READINESS_ACTIVITY_OPTIONS.cancellationType,
    ActivityCancellationType.WAIT_CANCELLATION_COMPLETED,
  );
  assert.equal(
    Object.hasOwn(VALIDATION_READINESS_ACTIVITY_OPTIONS, "heartbeatTimeout"),
    false,
  );
});

test("ready WGCF evidence completes an aggregate OOS run", () => {
  let projection = initialProjection();
  projection = startRunAttempt(projection, "2026-07-31T11:00:01.000Z");
  projection = projectWgcfResult(
    projection,
    validWgcfResult(),
    "2026-07-31T11:00:02.000Z",
  );

  assert.equal(projection.state, "completed");
  assert.equal(projection.progress.completed, 1);
  assert.equal(projection.effect_posture, "verified");
  assert.equal(projection.aggregate_receipt.outcome, "completed");
  assert.equal(projection.caller_ref, "governance-operations-console");
  assert.equal(projection.operator_ref, "operator:mfshaf7");
  assert.equal(
    projection.source_version_ref,
    "git:workspace-governance-control-fabric:abc123",
  );
  assert.match(projection.intent_digest, /^sha256:[0-9a-f]{64}$/);
  assert.equal(
    projection.aggregate_receipt.approval_ref,
    "decision:validation-readiness:1",
  );
  assert.equal(
    projection.aggregate_receipt.source_version_ref,
    projection.source_version_ref,
  );
  assert.equal(
    projection.aggregate_receipt.intent_digest,
    projection.intent_digest,
  );
  assert.equal(
    projection.control_availability.find(
      (entry) => entry.action === "cancel",
    ).available,
    false,
  );
  assert.equal(projection.events.at(-1).state, "completed");
  assert.deepEqual(projection.receipt_refs, [
    {
      receipt_id: "receipt:wgcf:1",
      digest: `sha256:${"a".repeat(64)}`,
    },
  ]);
  assert.deepEqual(
    projection.aggregate_receipt.receipt_refs,
    projection.receipt_refs,
  );
});

test("blocked owner evidence exposes remediation and bounded controls", () => {
  let projection = startRunAttempt(
    initialProjection(),
    "2026-07-31T11:00:01.000Z",
  );
  projection = projectWgcfResult(
    projection,
    validWgcfResult("blocked"),
    "2026-07-31T11:00:02.000Z",
  );

  assert.equal(projection.state, "blocked");
  assert.equal(projection.blocker.owner, "workspace-governance-control-fabric");
  assert.equal(
    projection.control_availability.find(
      (entry) => entry.action === "resume",
    ).available,
    true,
  );
  assert.equal(projection.aggregate_receipt, null);
});

test("retry exhaustion produces a terminal failed receipt", () => {
  let projection = initialProjection();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    projection = startRunAttempt(
      projection,
      `2026-07-31T11:00:0${attempt + 1}.000Z`,
    );
    projection = projectActivityFailure(
      projection,
      { failureType: "WGCF_ACTIVITY_UNAVAILABLE" },
      `2026-07-31T11:00:1${attempt + 1}.000Z`,
    );
  }
  projection = finishExhaustedRun(
    projection,
    "2026-07-31T11:01:00.000Z",
  );

  assert.equal(projection.state, "failed");
  assert.equal(projection.retry_status.retry_available, false);
  assert.equal(projection.failure.retry_exhausted, true);
  assert.equal(projection.aggregate_receipt.outcome, "failed-no-effect");
  assert.equal(
    projection.control_availability.every((entry) => !entry.available),
    true,
  );
});

test("approval expiry at durable start produces a terminal no-effect receipt", () => {
  const projection = rejectExpiredApproval(
    initialProjection(),
    "2026-07-31T11:00:00.000Z",
  );

  assert.equal(projection.state, "failed");
  assert.equal(projection.current_node.state, "failed");
  assert.equal(projection.retry_status.attempts, 0);
  assert.equal(projection.failure.failure_type, "approval-expired-before-start");
  assert.equal(projection.aggregate_receipt.outcome, "failed-no-effect");
  assert.equal(projection.completed_at, "2026-07-31T11:00:00.000Z");
  assert.equal(
    projection.control_availability.every((entry) => !entry.available),
    true,
  );
});

test("queued retry controls are revalidated against attempt capacity", () => {
  let projection = initialProjection();
  for (let attempt = 0; attempt < 2; attempt += 1) {
    projection = startRunAttempt(
      projection,
      `2026-07-31T11:02:0${attempt + 1}.000Z`,
    );
    projection = projectActivityFailure(
      projection,
      { failureType: "WGCF_ACTIVITY_UNAVAILABLE" },
      `2026-07-31T11:02:1${attempt + 1}.000Z`,
    );
  }
  const pendingControls = [retryControl(1), retryControl(2)];

  const first = takeAvailableRunControl(pendingControls, projection);
  assert.equal(first.control_id, "control:retry:1");
  projection = recordRunControl(
    projection,
    first,
    "2026-07-31T11:02:21.000Z",
  );
  projection = startRunAttempt(projection, "2026-07-31T11:02:22.000Z");
  projection = projectActivityFailure(
    projection,
    { failureType: "WGCF_ACTIVITY_UNAVAILABLE" },
    "2026-07-31T11:02:23.000Z",
  );

  assert.equal(takeAvailableRunControl(pendingControls, projection), null);
  assert.equal(pendingControls.length, 0);
  projection = finishExhaustedRun(
    projection,
    "2026-07-31T11:02:24.000Z",
  );
  assert.equal(projection.retry_status.attempts, 3);
  assert.equal(projection.aggregate_receipt.outcome, "failed-no-effect");
});

test("generation retirement cancellation bypasses ordinary control-key deduplication", () => {
  const key = "a".repeat(32);
  const control = {
    schema_version: 1,
    control_id: `control:generation-retirement:${key}`,
    action: "cancel",
    operator_id: "system:operator-orchestration-service",
    reason_ref: "policy:orchestration-generation-retirement",
    idempotency_key: `idempotency:generation-retirement:${key}`,
  };
  const pendingControls = [];
  const queuedControlKeys = new Set([
    control.control_id,
    control.idempotency_key,
  ]);

  const first = enqueueRunControl({
    control,
    projection: initialProjection(),
    pendingControls,
    queuedControlKeys,
    generationRetirementControlQueued: false,
  });
  assert.deepEqual(first, {
    cancelActiveActivity: true,
    generationRetirementControlQueued: true,
  });
  assert.deepEqual(pendingControls, [control]);

  const duplicate = enqueueRunControl({
    control,
    projection: initialProjection(),
    pendingControls,
    queuedControlKeys,
    generationRetirementControlQueued: true,
  });
  assert.deepEqual(duplicate, {
    cancelActiveActivity: false,
    generationRetirementControlQueued: true,
  });
  assert.deepEqual(pendingControls, [control]);
});

test("Temporal activity failures project only admitted failure types", () => {
  assert.equal(
    temporalFailureType({
      type: "ActivityFailure",
      cause: { type: "WGCF_ACTIVITY_UNAVAILABLE" },
    }),
    "WGCF_ACTIVITY_UNAVAILABLE",
  );
  assert.equal(
    temporalFailureType({
      type: "arbitrary failure with raw detail",
      cause: { type: "also-not-admitted" },
    }),
    "WGCF_ACTIVITY_RETRYABLE",
  );
});

test("non-retryable contract rejection cannot be resumed with the same request", () => {
  let projection = startRunAttempt(
    initialProjection(),
    "2026-07-31T11:00:01.000Z",
  );
  projection = projectActivityFailure(
    projection,
    { failureType: "WGCF_CONTRACT_REJECTED" },
    "2026-07-31T11:00:02.000Z",
  );

  assert.equal(projection.state, "blocked");
  assert.equal(
    projection.control_availability.find(
      (entry) => entry.action === "resume",
    ).available,
    false,
  );
  assert.equal(
    projection.control_availability.find(
      (entry) => entry.action === "defer",
    ).available,
    true,
  );
});

test("defer and cancel controls preserve a reviewable control history", () => {
  let projection = startRunAttempt(
    initialProjection(),
    "2026-07-31T11:00:01.000Z",
  );
  projection = projectWgcfResult(
    projection,
    validWgcfResult("blocked"),
    "2026-07-31T11:00:02.000Z",
  );
  const control = {
    schema_version: 1,
    control_id: "control:defer:1",
    action: "defer",
    operator_id: "operator:mfshaf7",
    reason_ref: "decision:defer:1",
    idempotency_key: "control-defer-1",
  };
  projection = recordRunControl(
    projection,
    control,
    "2026-07-31T11:00:03.000Z",
  );
  projection = deferRun(
    projection,
    control,
    "2026-07-31T11:00:04.000Z",
  );

  assert.equal(projection.state, "waiting");
  assert.equal(projection.controls.length, 1);
  assert.equal(projection.wait.kind, "authority-decision");

  projection = cancelRun(
    projection,
    {
      control_id: "control:cancel:1",
      operator_id: "operator:mfshaf7",
      reason_ref: "decision:cancel:1",
    },
    "2026-07-31T11:00:05.000Z",
  );
  assert.equal(projection.state, "cancelled");
  assert.match(projection.aggregate_receipt.outcome, /^cancelled-/);
});

test("bounded event history retains monotonic sequence values after rollover", () => {
  let projection = initialProjection();

  for (let index = 1; index <= 40; index += 1) {
    projection = recordRunControl(
      projection,
      {
        schema_version: 1,
        control_id: `control:signal:${index}`,
        action: "signal",
        operator_id: "operator:mfshaf7",
        reason_ref: `decision:signal:${index}`,
        idempotency_key: `control-signal-${index}`,
      },
      `2026-07-31T11:01:${String(index).padStart(2, "0")}.000Z`,
    );
  }

  assert.equal(projection.events.length, 32);
  assert.equal(projection.events[0].sequence, 10);
  assert.equal(projection.events.at(-1).sequence, 41);
  assert.equal(
    new Set(projection.events.map((event) => event.event_id)).size,
    projection.events.length,
  );
});

test("runtime projection fields match the published top-level schema", () => {
  const projection = initialProjection();
  const schema = JSON.parse(
    readFileSync(
      new URL(
        "../contracts/orchestration/run-projection.schema.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );

  assert.deepEqual(
    Object.keys(projection).sort(),
    [...schema.required].sort(),
  );
  assert.deepEqual(
    Object.keys(schema.properties).sort(),
    [...schema.required].sort(),
  );
  assert.throws(
    () => assertProjection({ ...projection, raw_validator_output: "forbidden" }),
    /outside the admitted boundary/,
  );
});

test("nested projection fields reject raw output and broken receipt binding", () => {
  const projection = initialProjection();

  assert.throws(
    () =>
      assertProjection({
        ...projection,
        current_node: {
          ...projection.current_node,
          raw_worker_output: "forbidden",
        },
      }),
    /outside the admitted boundary/,
  );
  assert.throws(
    () =>
      assertProjection({
        ...projection,
        runtime: {
          ...projection.runtime,
          workflow_task_queue: "unadmitted.queue",
        },
      }),
    /runtime.workflow_task_queue is unsupported/,
  );

  let completed = startRunAttempt(
    projection,
    "2026-07-31T11:00:01.000Z",
  );
  completed = projectWgcfResult(
    completed,
    validWgcfResult(),
    "2026-07-31T11:00:02.000Z",
  );
  assert.throws(
    () =>
      assertProjection({
        ...completed,
        aggregate_receipt: {
          ...completed.aggregate_receipt,
          source_projection_version: "projection:other",
        },
      }),
    /source_projection_version must match the aggregate run/,
  );
  assert.throws(
    () =>
      assertProjection({
        ...completed,
        aggregate_receipt: {
          ...completed.aggregate_receipt,
          source_version_ref: "git:workspace-governance-control-fabric:older",
        },
      }),
    /source_version_ref must match the aggregate run/,
  );
  assert.throws(
    () =>
      assertProjection({
        ...completed,
        aggregate_receipt: {
          ...completed.aggregate_receipt,
          intent_digest: `sha256:${"b".repeat(64)}`,
        },
      }),
    /intent_digest must match the aggregate run/,
  );
  assert.throws(
    () =>
      assertProjection({
        ...completed,
        receipt_refs: [
          ...completed.receipt_refs,
          {
            receipt_id: completed.receipt_refs[0].receipt_id,
            digest: `sha256:${"b".repeat(64)}`,
          },
        ],
      }),
    /cannot contain duplicate receipt ids/,
  );
});

function initialProjection() {
  const request = normalizeValidationReadinessRequest(
    validOrchestrationRequest(),
    { callerId: "governance-operations-console" },
  );
  return createRunProjection({
    request: validTemporalWorkflowInput(request),
    runId,
    temporalExecutionRunId: "temporal-run:1",
    workflowId: runId,
    timestamp: startedAt,
  });
}

function retryControl(index) {
  return {
    schema_version: 1,
    control_id: `control:retry:${index}`,
    action: "retry",
    operator_id: "operator:mfshaf7",
    reason_ref: `decision:retry:${index}`,
    idempotency_key: `control-retry-${index}`,
  };
}
