import assert from "node:assert/strict";
import test from "node:test";

import { loadConfig } from "../src/config.js";
import { toTemporalRunBindings } from "../src/orchestration/contracts.js";
import {
  OrchestrationServiceError,
  createOrchestrationService,
} from "../src/orchestration/service.js";
import {
  OrchestrationControlIdempotencyConflictError,
  OrchestrationControlNotAppliedError,
  OrchestrationRunBindingUnverifiedError,
  OrchestrationRunNotFoundError,
} from "../src/orchestration/temporal-adapter.js";
import {
  orchestrationActivationEnvForManifest,
  validOrchestrationActivationEvidenceRecords,
  validOrchestrationActivationEnv,
  validOrchestrationActivationManifest,
  validOrchestrationRequest,
} from "../test-fixtures/orchestration.js";

test("definition catalog remains readable while execution is disabled", async () => {
  const service = createOrchestrationService({
    config: inactiveConfig(),
    temporalAdapter: unreachableAdapter(),
  });
  const [definition] = service.listDefinitions();

  assert.equal(definition.definition_id, "validation-readiness-run");
  assert.equal(definition.lifecycle, "admission-review");
  assert.equal(
    definition.retry_and_timeout_contract.activity_heartbeat_timeout,
    null,
  );
  assert.equal(
    definition.retry_and_timeout_contract
      .owner_process_group_exit_confirmation,
    "5s",
  );
  assert.equal(
    definition.retry_and_timeout_contract.owner_communication_drain,
    "1s",
  );
  assert.equal(
    definition.retry_and_timeout_contract.owner_evidence_commit_fence,
    "atomic-after-process-group-exit-confirmed",
  );
  assert.equal(
    definition.retry_and_timeout_contract.automatic_retry_fence,
    "start-to-close-outlives-owner-bound",
  );
  assert.equal(definition.admission.start_allowed, false);
  assert.equal(definition.admission.gates.length, 14);
  assert.deepEqual(
    definition.admission.gates.slice(0, 10).map((entry) => entry.gate_id),
    [
      "contract-valid",
      "implementation-reviewed",
      "deterministic-replay-tested",
      "activity-idempotency-tested",
      "failure-and-control-tested",
      "dev-integration-profile-active",
      "platform-runtime-accepted",
      "security-review-accepted",
      "source-projection-verified",
      "rollback-and-suspension-proven",
    ],
  );
  assert.equal(
    await service
      .listRuns({
        limit: 10,
        callerId: "governance-operations-console",
      })
      .then((runs) => runs.length),
    0,
  );
});

test("durable run APIs reject authenticated callers outside the operator cockpit", async () => {
  const service = createOrchestrationService({
    config: inactiveConfig(),
    temporalAdapter: unreachableAdapter(),
  });
  const forbidden = (error) =>
    error instanceof OrchestrationServiceError &&
    error.code === "orchestration_caller_forbidden" &&
    error.statusCode === 403;

  await assert.rejects(
    service.startRun(validOrchestrationRequest(), {
      callerId: "openclaw-telegram-enhanced",
    }),
    forbidden,
  );
  await assert.rejects(
    service.getRun("oos:validation-readiness-run:v1:key", {
      callerId: "openclaw-telegram-enhanced",
    }),
    forbidden,
  );
  await assert.rejects(
    service.listRuns({
      limit: 10,
      callerId: "openclaw-telegram-enhanced",
    }),
    forbidden,
  );
  await assert.rejects(
    service.controlRun(
      "oos:validation-readiness-run:v1:key",
      runControl("cancel"),
      { callerId: "openclaw-telegram-enhanced" },
    ),
    forbidden,
  );
});

test("run starts fail closed until every activation gate is satisfied", async () => {
  const service = createOrchestrationService({
    config: inactiveConfig(),
    temporalAdapter: unreachableAdapter(),
  });

  await assert.rejects(
    service.startRun(validOrchestrationRequest(), {
      callerId: "governance-operations-console",
    }),
    (error) =>
      error instanceof OrchestrationServiceError &&
      error.code === "orchestration_not_admitted" &&
      error.statusCode === 409,
  );
});

test("durable run APIs reject the caller development bypass", async () => {
  const config = loadConfig(
    validOrchestrationActivationEnv({
      CALLER_AUTH_SHARED_SECRET: "",
    }),
  );
  const service = createOrchestrationService({
    config,
    temporalAdapter: unreachableAdapter(),
  });

  await assert.rejects(
    service.startRun(validOrchestrationRequest(), {
      callerId: "governance-operations-console",
    }),
    (error) =>
      error instanceof OrchestrationServiceError &&
      error.code === "orchestration_caller_auth_not_configured" &&
      error.statusCode === 503,
  );
});

test("activation gates reject and redact malformed evidence manifests", () => {
  const manifest = validOrchestrationActivationManifest();
  const records = validOrchestrationActivationEvidenceRecords();
  records["security-review-accepted"].record_ref =
    "secret value with spaces";
  const config = loadConfig(
    orchestrationActivationEnvForManifest(manifest, {}, records),
  );
  const service = createOrchestrationService({
    config,
    temporalAdapter: unreachableAdapter(),
  });
  const securityGate = service
    .listDefinitions()[0]
    .admission.gates.find(
      (entry) => entry.gate_id === "security-review-accepted",
    );

  assert.equal(securityGate.satisfied, false);
  assert.equal(
    securityGate.detail,
    "The activation evidence manifest is invalid.",
  );
  assert.equal(securityGate.detail.includes("secret value"), false);
});

test("run reads refuse an unverified Temporal target", async () => {
  let adapterCalls = 0;
  const config = loadConfig({
    CALLER_ALLOWED_IDS: "governance-operations-console",
    CALLER_AUTH_SHARED_SECRET: "test-secret",
    OOS_ORCHESTRATION_RUNTIME_ENABLED: "true",
  });
  const service = createOrchestrationService({
    config,
    temporalAdapter: {
      async getRun() {
        adapterCalls += 1;
      },
      async listRuns() {
        adapterCalls += 1;
      },
    },
  });
  const targetDenied = (error) =>
    error instanceof OrchestrationServiceError &&
    error.code === "orchestration_runtime_target_unverified" &&
    error.statusCode === 503;

  await assert.rejects(
    service.getRun("oos:validation-readiness-run:v1:key", {
      callerId: "governance-operations-console",
    }),
    targetDenied,
  );
  await assert.rejects(
    service.listRuns({
      limit: 10,
      callerId: "governance-operations-console",
    }),
    targetDenied,
  );
  assert.equal(adapterCalls, 0);
});

test("run reads remain available after evidence expiry on the admitted target", async () => {
  const manifest = validOrchestrationActivationManifest();
  manifest.issued_at = "2026-01-01T00:00:00.000Z";
  manifest.expires_at = "2026-01-02T00:00:00.000Z";
  const config = loadConfig(orchestrationActivationEnvForManifest(manifest));
  const service = createOrchestrationService({
    config,
    temporalAdapter: {
      async getRun() {
        return { run_id: "oos:validation-readiness-run:v1:key" };
      },
      async listRuns() {
        return [{ run_id: "oos:validation-readiness-run:v1:key" }];
      },
    },
  });

  const run = await service.getRun(
    "oos:validation-readiness-run:v1:key",
    { callerId: "governance-operations-console" },
  );
  const runs = await service.listRuns({
    limit: 10,
    callerId: "governance-operations-console",
  });

  assert.equal(run.run_id, "oos:validation-readiness-run:v1:key");
  assert.equal(runs.length, 1);
});

test("an admitted run delegates to the replaceable runtime adapter", async () => {
  const calls = [];
  const temporalAdapter = {
    async startRun(request, { activationEvidenceDigest }) {
      calls.push({ activationEvidenceDigest, request });
      return {
        duplicate: false,
        runId: "oos:validation-readiness-run:v1:key",
        bindings: toTemporalRunBindings(request, activationEvidenceDigest),
        projection: null,
      };
    },
  };
  const service = createOrchestrationService({
    config: activeConfig(),
    temporalAdapter,
  });
  const result = await service.startRun(validOrchestrationRequest(), {
    callerId: "governance-operations-console",
  });

  assert.equal(result.run_id, "oos:validation-readiness-run:v1:key");
  assert.equal(result.projection, null);
  assert.equal(calls.length, 1);
  assert.match(calls[0].activationEvidenceDigest, /^sha256:[0-9a-f]{64}$/);
  assert.equal(
    calls[0].request.caller_id,
    "governance-operations-console",
  );
});

test("an idempotent duplicate returns the run with identical immutable bindings", async () => {
  const service = createOrchestrationService({
    config: activeConfig(),
    temporalAdapter: {
      async startRun(request, { activationEvidenceDigest }) {
        return {
          duplicate: true,
          runId: "oos:validation-readiness-run:v1:key",
          bindings: toTemporalRunBindings(request, activationEvidenceDigest),
          projection: null,
        };
      },
    },
  });

  const result = await service.startRun(validOrchestrationRequest(), {
    callerId: "governance-operations-console",
  });

  assert.equal(result.duplicate, true);
  assert.equal(result.run_id, "oos:validation-readiness-run:v1:key");
  assert.equal(result.projection, null);
});

test("an idempotency key cannot resolve to different source or intent bindings", async () => {
  const service = createOrchestrationService({
    config: activeConfig(),
    temporalAdapter: {
      async startRun(request, { activationEvidenceDigest }) {
        return {
          duplicate: true,
          runId: "oos:validation-readiness-run:v1:key",
          bindings: {
            ...toTemporalRunBindings(request, activationEvidenceDigest),
            source_version_ref: "git:workspace-governance-control-fabric:older",
            intent_digest: `sha256:${"b".repeat(64)}`,
          },
          projection: null,
        };
      },
    },
  });

  await assert.rejects(
    service.startRun(validOrchestrationRequest(), {
      callerId: "governance-operations-console",
    }),
    (error) =>
      error instanceof OrchestrationServiceError &&
      error.code === "orchestration_idempotency_conflict" &&
      error.statusCode === 409 &&
      JSON.stringify(error.details) ===
        JSON.stringify({
          mismatched_fields: ["source_version_ref", "intent_digest"],
        }),
  );
});

test("a retained run from another activation generation is not a duplicate", async () => {
  const retainedActivationDigest = `sha256:${"d".repeat(64)}`;
  const service = createOrchestrationService({
    config: activeConfig(),
    temporalAdapter: {
      async startRun(request) {
        return {
          duplicate: true,
          runId: "oos:validation-readiness-run:v1:key",
          bindings: toTemporalRunBindings(
            request,
            retainedActivationDigest,
          ),
          projection: null,
        };
      },
    },
  });

  await assert.rejects(
    service.startRun(validOrchestrationRequest(), {
      callerId: "governance-operations-console",
    }),
    (error) =>
      error instanceof OrchestrationServiceError &&
      error.code === "orchestration_idempotency_conflict" &&
      error.details.mismatched_fields.length === 1 &&
      error.details.mismatched_fields[0] ===
        "activation_evidence_digest",
  );
});

test("an unverified retained run binding is unavailable, not a client error", async () => {
  const runId = "oos:validation-readiness-run:v1:key";
  const service = createOrchestrationService({
    config: activeConfig(),
    temporalAdapter: {
      async startRun() {
        throw new OrchestrationRunBindingUnverifiedError(runId);
      },
    },
  });

  await assert.rejects(
    service.startRun(validOrchestrationRequest(), {
      callerId: "governance-operations-console",
    }),
    (error) =>
      error instanceof OrchestrationServiceError &&
      error.code === "orchestration_run_binding_unverified" &&
      error.statusCode === 503 &&
      error.details.run_id === runId,
  );
});

test("run controls fail before signaling when the projected action is unavailable", async () => {
  let signalCount = 0;
  const service = createOrchestrationService({
    config: activeConfig(),
    temporalAdapter: {
      async getRun() {
        return controlProjection("running", "retry", false);
      },
      async controlRun() {
        signalCount += 1;
      },
    },
  });

  await assert.rejects(
    service.controlRun(
      "oos:validation-readiness-run:v1:key",
      runControl("retry"),
      { callerId: "governance-operations-console" },
    ),
    (error) =>
      error instanceof OrchestrationServiceError &&
      error.code === "orchestration_control_unavailable" &&
      error.statusCode === 409,
  );
  assert.equal(signalCount, 0);
});

test("missing runtime executions map to an operator-facing not-found response", async () => {
  const runId = "oos:validation-readiness-run:v1:missing";
  const service = createOrchestrationService({
    config: activeConfig(),
    temporalAdapter: {
      async getRun() {
        throw new OrchestrationRunNotFoundError(runId);
      },
    },
  });

  await assert.rejects(
    service.getRun(runId, {
      callerId: "governance-operations-console",
    }),
    (error) =>
      error instanceof OrchestrationServiceError &&
      error.code === "orchestration_run_not_found" &&
      error.statusCode === 404,
  );
});

test("run controls signal only when the aggregate projection allows the action", async () => {
  const calls = [];
  const service = createOrchestrationService({
    config: activeConfig(),
    temporalAdapter: {
      async getRun(runId) {
        calls.push(["get", runId]);
        return controlProjection("running", "cancel", true);
      },
      async controlRun(runId, control) {
        calls.push(["control", runId, control.action]);
        return controlProjection("cancelled", "cancel", false);
      },
    },
  });

  const result = await service.controlRun(
    "oos:validation-readiness-run:v1:key",
    runControl("cancel"),
    { callerId: "governance-operations-console" },
  );

  assert.equal(result.state, "cancelled");
  assert.deepEqual(calls.map((entry) => entry[0]), ["get", "control"]);
});

test("run control close races return retained state without claiming application", async () => {
  const runId = "oos:validation-readiness-run:v1:key";
  const control = runControl("cancel");
  const retained = { state: "completed" };
  const service = createOrchestrationService({
    config: activeConfig(),
    temporalAdapter: {
      async getRun() {
        return controlProjection("running", "cancel", true);
      },
      async controlRun() {
        throw new OrchestrationControlNotAppliedError(
          runId,
          control,
          retained,
        );
      },
    },
  });

  await assert.rejects(
    service.controlRun(runId, control, {
      callerId: "governance-operations-console",
    }),
    (error) =>
      error instanceof OrchestrationServiceError &&
      error.code === "orchestration_control_not_applied" &&
      error.statusCode === 409 &&
      JSON.stringify(error.details) ===
        JSON.stringify({
          action: "cancel",
          run_id: runId,
          state: "completed",
          control_applied: false,
        }),
  );
});

test("run control key conflicts expose only mismatched immutable fields", async () => {
  const runId = "oos:validation-readiness-run:v1:key";
  const control = runControl("cancel");
  const retained = { state: "waiting" };
  const service = createOrchestrationService({
    config: activeConfig(),
    temporalAdapter: {
      async getRun() {
        return controlProjection("waiting", "cancel", true);
      },
      async controlRun() {
        throw new OrchestrationControlIdempotencyConflictError(
          runId,
          control,
          retained,
          ["control_id", "action"],
        );
      },
    },
  });

  await assert.rejects(
    service.controlRun(runId, control, {
      callerId: "governance-operations-console",
    }),
    (error) =>
      error instanceof OrchestrationServiceError &&
      error.code === "orchestration_control_idempotency_conflict" &&
      error.statusCode === 409 &&
      JSON.stringify(error.details) ===
        JSON.stringify({
          action: "cancel",
          run_id: runId,
          state: "waiting",
          mismatched_fields: ["control_id", "action"],
        }),
  );
});

function activeConfig() {
  return loadConfig(validOrchestrationActivationEnv());
}

function inactiveConfig() {
  return loadConfig({
    CALLER_ALLOWED_IDS: "governance-operations-console",
    CALLER_AUTH_SHARED_SECRET: "test-secret",
  });
}

function unreachableAdapter() {
  return {
    startRun() {
      throw new Error("runtime adapter must not be called");
    },
  };
}

function runControl(action) {
  return {
    schema_version: 1,
    control_id: `control:${action}:1`,
    action,
    operator_id: "operator:mfshaf7",
    reason_ref: `decision:${action}:1`,
    idempotency_key: `control-${action}-1`,
  };
}

function controlProjection(state, action, available) {
  return {
    state,
    control_availability: [{ action, available }],
  };
}
