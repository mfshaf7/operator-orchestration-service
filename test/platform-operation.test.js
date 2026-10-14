import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { canonicalDigest } from "../src/delivery-art/canonical-json.js";
import {
  assertPlatformOperationProjection,
  normalizePlatformOperationCommand,
  platformOperationIntent,
} from "../src/platform-operation/contracts.js";
import { createPlatformOperationProviderClient } from "../src/platform-operation/provider-client.js";
import { createPlatformOperationService } from "../src/platform-operation/service.js";
import { createPlatformOperationStore } from "../src/platform-operation/store.js";
import { createPlatformOperationRuntime } from "../src/platform-operation/runtime.js";

const NOW = "2026-10-15T00:00:00.000Z";
const SECURITY = {
  uri: "github://mfshaf7/security-architecture/commit/a/review.md",
  digest: `sha256:${"a".repeat(64)}`,
  revision: "a".repeat(40),
};

function command(overrides = {}) {
  const value = {
    schema_version: 1,
    command_id: "command:accepted-idea-delivery:start:1",
    idempotency_key: "idempotency:accepted-idea-delivery:start:1",
    correlation_id: "correlation:accepted-idea-delivery:1",
    causation_id: null,
    actor_ref: "operator:workspace-owner",
    subject: {
      kind: "dev-integration-profile",
      ref: "profile:accepted-idea-delivery",
      expected_source_version: "version:42",
    },
    capability_id: "dev-integration.accepted-idea-delivery.start",
    action: "dev-integration.start",
    input: {},
    requested_at: NOW,
    ...overrides,
  };
  value.intent_digest = canonicalDigest(platformOperationIntent(value));
  value.approval = {
    decision: "approved",
    operator_id: value.actor_ref,
    decision_ref: "approval:accepted-idea-delivery:start:1",
    decided_at: NOW,
    intent_digest: value.intent_digest,
  };
  return value;
}

function catalog(overrides = {}) {
  return {
    schema_version: 1,
    catalog_id: "platform-console-operations",
    source_version: "version:42",
    observed_at: NOW,
    freshness: "current",
    subjects: [{
      kind: "dev-integration-profile",
      ref: "profile:accepted-idea-delivery",
      source_version: "version:42",
      owner: "platform-engineering",
      capabilities: [{
        capability_id: "dev-integration.accepted-idea-delivery.start",
        action: "dev-integration.start",
        available: true,
        unavailable_reason: null,
        required_capability: "platform.dev-integration.start",
        approval_required: true,
        destructive: false,
      }],
    }],
    ...overrides,
  };
}

function ownerProjection(input, overrides = {}) {
  const state = overrides.state ?? "succeeded";
  return {
    schema_version: 1,
    operation_id: "platform-owner-operation:accepted-idea-delivery:start:1",
    command_id: input.command_id,
    correlation_id: input.correlation_id,
    state,
    attempt: overrides.attempt ?? 1,
    subject_ref: input.subject.ref,
    capability_id: input.capability_id,
    action: input.action,
    retryable: overrides.retryable ?? false,
    cancel_available: overrides.cancel_available ?? false,
    blocker: overrides.blocker ?? null,
    failure: overrides.failure ?? null,
    receipt: Object.hasOwn(overrides, "receipt")
      ? overrides.receipt
      : ["succeeded", "failed", "cancelled"].includes(state)
        ? {
            receipt_ref: `platform://receipts/${input.command_id}`,
            outcome: state === "succeeded" ? "succeeded" : state,
            recorded_at: NOW,
            source_version: "version:43",
            effect: state === "succeeded" ? "verified" : "none",
          }
        : null,
    safe_log_ref: "cgg:packet:platform-operation-1",
    updated_at: NOW,
    events: [{
      event_id: `event:${input.command_id}:owner:1`,
      sequence: 1,
      state,
      occurred_at: NOW,
      summary: "Platform owner projected current operation state.",
    }],
  };
}

function fixture({ audit = { emit() {} }, providerClient } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), "oos-platform-operation-"));
  const service = createPlatformOperationService({
    audit,
    clock: () => new Date(NOW),
    operatorBindings: {
      "governance-operations-console": "operator:workspace-owner",
    },
    providerClient: providerClient ?? {
      async getCatalog() { return catalog(); },
      async submit(input) { return ownerProjection(input); },
      async readByCommand(input) { return ownerProjection(input); },
      async control(input) { return ownerProjection(input); },
    },
    securityDecision: SECURITY,
    store: createPlatformOperationStore({ root }),
  });
  return { root, service };
}

test("platform operation command binds exact operator approval to canonical intent", () => {
  assert.equal(normalizePlatformOperationCommand(command()).action, "dev-integration.start");
  const invalid = command();
  invalid.approval.intent_digest = `sha256:${"b".repeat(64)}`;
  assert.throws(
    () => normalizePlatformOperationCommand(invalid),
    (error) => error.code === "platform_operation_contract_invalid",
  );
});

test("platform owner projections reject unknown fields and incomplete terminal receipts", () => {
  const input = command();
  assert.throws(
    () => assertPlatformOperationProjection({
      ...ownerProjection(input),
      undocumented: true,
    }, input),
    (error) => error.code === "platform_operation_contract_invalid",
  );
  const invalidReceipt = ownerProjection(input);
  delete invalidReceipt.receipt.effect;
  assert.throws(
    () => assertPlatformOperationProjection(invalidReceipt, input),
    (error) => error.code === "platform_operation_contract_invalid",
  );
});

test("platform provider client admits only bounded authenticated owner targets", async () => {
  assert.throws(
    () => createPlatformOperationProviderClient({
      allowHttp: true,
      baseUrl: "http://example.com",
      callerId: "oos",
      callerSecret: "x".repeat(32),
    }),
    (error) => error.code === "platform_operation_provider_not_configured",
  );
  let observed;
  const input = command();
  const client = createPlatformOperationProviderClient({
    allowHttp: true,
    baseUrl: "http://platform-operations.platform.svc.cluster.local",
    callerId: "operator-orchestration-service",
    callerSecret: "s".repeat(32),
    async fetchImpl(url, request) {
      observed = { url: String(url), request };
      return new Response(JSON.stringify(ownerProjection(input)), {
        headers: { "content-type": "application/json" },
        status: 200,
      });
    },
  });
  const result = await client.submit(input);
  assert.equal(result.state, "succeeded");
  assert.equal(observed.url, "http://platform-operations.platform.svc.cluster.local/v1/console-operations/commands");
  assert.equal(observed.request.headers["x-platform-caller-id"], "operator-orchestration-service");
  assert.equal(observed.request.headers["x-platform-caller-secret"], "s".repeat(32));
  assert.equal(observed.request.redirect, "error");

  const denied = createPlatformOperationProviderClient({
    allowHttp: true,
    baseUrl: "http://platform-operations.platform.svc.cluster.local",
    callerId: "operator-orchestration-service",
    callerSecret: "s".repeat(32),
    async fetchImpl() {
      return new Response(JSON.stringify({ message: "secret backend detail" }), {
        headers: { "content-type": "application/json" },
        status: 403,
      });
    },
  });
  await assert.rejects(
    () => denied.getCatalog(),
    (error) =>
      error.code === "platform_operation_provider_forbidden" &&
      !error.message.includes("secret backend detail"),
  );
});

test("platform operation runtime remains disabled until profile, provider, operator, and Security bindings exist", () => {
  assert.equal(createPlatformOperationRuntime({ config: { enabled: false } }), null);
  assert.throws(
    () => createPlatformOperationRuntime({
      config: {
        enabled: true,
        profile: "stage",
        operatorBindings: { console: "operator:workspace-owner" },
      },
    }),
    (error) => error.code === "platform_operation_profile_not_admitted",
  );
  assert.throws(
    () => createPlatformOperationRuntime({
      config: {
        enabled: true,
        profile: "dev-integration",
        operatorBindings: { console: "operator:workspace-owner" },
      },
    }),
    (error) => error.code === "platform_operation_security_decision_missing",
  );
});

test("platform operation submit persists terminal owner readback and replays by idempotency key", async (t) => {
  let submits = 0;
  const { root, service } = fixture({
    providerClient: {
      async getCatalog() { return catalog(); },
      async submit(input) { submits += 1; return ownerProjection(input); },
      async readByCommand(input) { return ownerProjection(input); },
      async control(input) { return ownerProjection(input); },
    },
  });
  t.after(() => rmSync(root, { force: true, recursive: true }));
  const created = await service.submit({
    callerId: "governance-operations-console",
    input: command(),
  });
  const replayed = await service.submit({
    callerId: "governance-operations-console",
    input: command(),
  });
  assert.equal(created.state, "succeeded");
  assert.equal(created.provider_operation.receipt.outcome, "succeeded");
  assert.equal(replayed.replayed, true);
  assert.equal(submits, 1);
});

test("platform operation rejects idempotency conflicts, stale source, and caller impersonation", async (t) => {
  const { root, service } = fixture();
  t.after(() => rmSync(root, { force: true, recursive: true }));
  await service.submit({ callerId: "governance-operations-console", input: command() });
  const conflict = command({ input: { mode: "different" } });
  await assert.rejects(
    () => service.submit({ callerId: "governance-operations-console", input: conflict }),
    (error) => error.code === "platform_operation_idempotency_conflict",
  );
  await assert.rejects(
    () => service.submit({
      callerId: "untrusted-console",
      input: command({ command_id: "command:untrusted:1", idempotency_key: "idempotency:untrusted:1" }),
    }),
    (error) => error.code === "platform_operation_caller_forbidden",
  );

  const staleFixture = fixture({
    providerClient: {
      async getCatalog() { return catalog({ freshness: "stale" }); },
      async submit() { throw new Error("must not run"); },
    },
  });
  t.after(() => rmSync(staleFixture.root, { force: true, recursive: true }));
  await assert.rejects(
    () => staleFixture.service.submit({
      callerId: "governance-operations-console",
      input: command({ command_id: "command:stale:1", idempotency_key: "idempotency:stale:1" }),
    }),
    (error) => error.code === "platform_operation_catalog_not_current",
  );
});

test("platform operation survives process loss and reconciles owner readback without resubmission", async (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "oos-platform-operation-restart-"));
  t.after(() => rmSync(root, { force: true, recursive: true }));
  const first = createPlatformOperationService({
    operatorBindings: { "governance-operations-console": "operator:workspace-owner" },
    providerClient: {
      async getCatalog() { return catalog(); },
      async submit() { throw Object.assign(new Error("owner response lost"), { code: "platform_operation_provider_unavailable" }); },
    },
    securityDecision: SECURITY,
    store: createPlatformOperationStore({ root }),
  });
  const blocked = await first.submit({
    callerId: "governance-operations-console",
    input: command(),
  });
  assert.equal(blocked.state, "blocked");
  assert.equal(blocked.provider_operation.receipt, null);

  let resubmitted = false;
  const recovered = createPlatformOperationService({
    operatorBindings: { "governance-operations-console": "operator:workspace-owner" },
    providerClient: {
      async getCatalog() { return catalog(); },
      async submit() { resubmitted = true; throw new Error("must not resubmit"); },
      async readByCommand(input) { return ownerProjection(input); },
    },
    securityDecision: SECURITY,
    store: createPlatformOperationStore({ root }),
  });
  const result = await recovered.get({
    callerId: "governance-operations-console",
    operationId: blocked.operation_id,
  });
  assert.equal(result.state, "succeeded");
  assert.equal(result.reconciled, true);
  assert.equal(resubmitted, false);
});

test("platform operation exposes bounded retry controls with replay protection", async (t) => {
  const controlActions = [];
  const input = command();
  const { root, service } = fixture({
    providerClient: {
      async getCatalog() { return catalog(); },
      async submit(commandValue) {
        return ownerProjection(commandValue, {
          state: "failed",
          retryable: true,
          failure: {
            code: "owner-temporary-failure",
            detail: "The owner dependency was unavailable.",
            owner: "platform-engineering",
          },
        });
      },
      async control(commandValue, _operationId, control) {
        controlActions.push(control.action);
        return ownerProjection(commandValue, { attempt: 2, state: "succeeded" });
      },
    },
  });
  t.after(() => rmSync(root, { force: true, recursive: true }));
  const failed = await service.submit({
    callerId: "governance-operations-console",
    input,
  });
  assert.equal(failed.next_action.code, "retry");
  const control = {
    schema_version: 1,
    control_id: "control:retry:1",
    idempotency_key: "idempotency:control:retry:1",
    action: "retry",
    operator_id: "operator:workspace-owner",
    reason: "Retry after the owner dependency recovered.",
    requested_at: NOW,
  };
  const retried = await service.control({
    callerId: "governance-operations-console",
    operationId: failed.operation_id,
    input: control,
  });
  const replayed = await service.control({
    callerId: "governance-operations-console",
    operationId: failed.operation_id,
    input: control,
  });
  assert.equal(retried.state, "succeeded");
  assert.equal(replayed.replayed, true);
  assert.deepEqual(controlActions, ["retry"]);
});

test("platform operation cancellation requires current owner availability and returns a terminal receipt", async (t) => {
  const { root, service } = fixture({
    providerClient: {
      async getCatalog() { return catalog(); },
      async submit(commandValue) {
        return ownerProjection(commandValue, {
          state: "running",
          cancel_available: true,
          receipt: null,
        });
      },
      async control(commandValue, _operationId, control) {
        assert.equal(control.action, "cancel");
        return ownerProjection(commandValue, {
          state: "cancelled",
          receipt: {
            receipt_ref: `platform://receipts/${commandValue.command_id}:cancelled`,
            outcome: "cancelled",
            recorded_at: NOW,
            source_version: "version:42",
            effect: "none",
          },
        });
      },
    },
  });
  t.after(() => rmSync(root, { force: true, recursive: true }));
  const running = await service.submit({
    callerId: "governance-operations-console",
    input: command(),
  });
  const cancelled = await service.control({
    callerId: "governance-operations-console",
    operationId: running.operation_id,
    input: {
      schema_version: 1,
      control_id: "control:cancel:1",
      idempotency_key: "idempotency:control:cancel:1",
      action: "cancel",
      operator_id: "operator:workspace-owner",
      reason: "Stop before the owner applies another effect.",
      requested_at: NOW,
    },
  });
  assert.equal(cancelled.state, "cancelled");
  assert.equal(cancelled.provider_operation.receipt.outcome, "cancelled");
  assert.equal(cancelled.next_action.code, "inspect-cancelled-receipt");
});

test("platform operation persists an unknown control outcome and retries only with the same idempotency binding", async (t) => {
  let controls = 0;
  const { root, service } = fixture({
    providerClient: {
      async getCatalog() { return catalog(); },
      async submit(commandValue) {
        return ownerProjection(commandValue, {
          state: "running",
          cancel_available: true,
          receipt: null,
        });
      },
      async control(commandValue) {
        controls += 1;
        if (controls === 1) {
          throw Object.assign(new Error("owner response lost"), {
            code: "platform_operation_provider_unavailable",
          });
        }
        return ownerProjection(commandValue, { state: "cancelled" });
      },
    },
  });
  t.after(() => rmSync(root, { force: true, recursive: true }));
  const running = await service.submit({
    callerId: "governance-operations-console",
    input: command(),
  });
  const control = {
    schema_version: 1,
    control_id: "control:cancel:unknown:1",
    idempotency_key: "idempotency:control:cancel:unknown:1",
    action: "cancel",
    operator_id: "operator:workspace-owner",
    reason: "Stop the owner operation.",
    requested_at: NOW,
  };
  const unknown = await service.control({
    callerId: "governance-operations-console",
    operationId: running.operation_id,
    input: control,
  });
  assert.equal(unknown.state, "blocked");
  assert.equal(unknown.controls[0].status, "unknown");
  const recovered = await service.control({
    callerId: "governance-operations-console",
    operationId: running.operation_id,
    input: control,
  });
  assert.equal(recovered.state, "cancelled");
  assert.equal(recovered.controls[0].status, "confirmed");
  assert.equal(controls, 2);
});

test("platform operation audit covers denial, replay, and owner reconciliation without command input", async (t) => {
  const events = [];
  let state = "running";
  const { root, service } = fixture({
    audit: { emit(event) { events.push(event); } },
    providerClient: {
      async getCatalog() { return catalog(); },
      async submit(commandValue) {
        return ownerProjection(commandValue, { state, receipt: null });
      },
      async readByCommand(commandValue) {
        state = "succeeded";
        return ownerProjection(commandValue, { state });
      },
    },
  });
  t.after(() => rmSync(root, { force: true, recursive: true }));
  const input = command();
  const running = await service.submit({
    callerId: "governance-operations-console",
    input,
  });
  await service.submit({ callerId: "governance-operations-console", input });
  await assert.rejects(
    () => service.submit({
      callerId: "untrusted-console",
      input: command({
        command_id: "command:audit:denied:1",
        idempotency_key: "idempotency:audit:denied:1",
      }),
    }),
    (error) => error.code === "platform_operation_caller_forbidden",
  );
  await service.get({
    callerId: "governance-operations-console",
    operationId: running.operation_id,
  });
  assert.deepEqual(events.map((event) => event.event_type), [
    "platform.operation.submitted",
    "platform.operation.submit-replayed",
    "platform.operation.submit.denied",
    "platform.operation.reconciled",
  ]);
  assert.equal(events[2].command_input, undefined);
  assert.equal(events[2].error_code, "platform_operation_caller_forbidden");
});
