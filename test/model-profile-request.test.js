import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import test from "node:test";

import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import {
  assertModelProfileContract,
  modelProfileDigest,
  modelProfileRequestManifest,
} from "../src/model-profile-request/contracts.js";
import { createModelProfileRequestRuntime } from "../src/model-profile-request/runtime.js";
import { createModelProfileRequestService } from "../src/model-profile-request/service.js";
import { createModelProfileRequestStore } from "../src/model-profile-request/store.js";

const consoleCaller = "governance-operations-console";
const platformCaller = "platform-engineering";
const operatorId = "operator:mfshaf7";
const at = (minute) => `2026-10-09T12:${String(minute).padStart(2, "0")}:00Z`;
const artifact = (name) => ({
  uri: `https://example.test/${name}`,
  digest: `sha256:${"a".repeat(64)}`,
});

function request(overrides = {}) {
  return {
    schema_version: 1,
    request_id: "model-profile-request:1203-demo",
    intent: "create",
    requested_at: at(0),
    operator_id: operatorId,
    profile_intent: {
      profile_id: null,
      source: null,
      display_name: "Bounded refinement assistant",
      intended_purpose: "Produce structured refinement suggestions from admitted context.",
      requesting_owner: "operator-orchestration-service",
      registered_callers: [{ caller_id: "oos-refinement", owner_repo: "operator-orchestration-service" }],
      requested_environments: ["dev-integration"],
      input_data_classification: "internal",
      admitted_context_ref: artifact("context-contract"),
      required_output_schema_ref: {
        repo: "operator-orchestration-service",
        path: "contracts/refinement/output.schema.json",
        version: "v1",
      },
      human_approval_required: true,
      operational_expectations: ["Fail closed when admitted context is absent."],
      operator_justification: "Needed for the governed refinement workflow.",
    },
    delivery_ref: "openproject://work_packages/1240",
    correlation_id: "delivery-1203",
    causation_id: null,
    idempotency_key: "model-profile-request-1203-demo-v1",
    ...overrides,
  };
}

function command(revision, action, minute, overrides = {}) {
  return {
    schema_version: 1,
    command_id: `command-${action}-${revision}`,
    request_id: "model-profile-request:1203-demo",
    expected_revision: revision,
    action,
    operator_id: operatorId,
    issued_at: at(minute),
    reason: null,
    decision_ref: null,
    requirements: [],
    revised_profile_intent: null,
    idempotency_key: `idempotency-${action}-${revision}`,
    ...overrides,
  };
}

function fulfillment(revision, state, minute, overrides = {}) {
  return {
    schema_version: 1,
    fulfillment_id: `fulfillment-${state}-${revision}`,
    request_id: "model-profile-request:1203-demo",
    expected_revision: revision,
    state,
    actor_id: platformCaller,
    recorded_at: at(minute),
    source: null,
    receipt_ref: null,
    failure: null,
    idempotency_key: `idempotency-${state}-${revision}`,
    ...overrides,
  };
}

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "oos-model-profile-request-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const service = createModelProfileRequestService({
    clock: () => new Date(at(0)),
    store: createModelProfileRequestStore({ root }),
    operatorBindings: { [consoleCaller]: operatorId },
    fulfillmentCallerIds: new Set([platformCaller]),
  });
  return { root, service };
}

test("model-profile contracts reject missing authority bindings and lifecycle shortcuts", () => {
  assertModelProfileContract("request.schema.json", request());
  assert.throws(
    () => assertModelProfileContract("request.schema.json", request({
      intent: "activate",
      profile_intent: { ...request().profile_intent, profile_id: "existing", source: null },
    })),
    /Invalid model-profile request contract/,
  );
  assert.throws(
    () => assertModelProfileContract("command.schema.json", command(1, "approve", 1)),
    /Invalid model-profile command contract/,
  );
  assert.throws(
    () => assertModelProfileContract("fulfillment.schema.json", fulfillment(1, "applied", 1)),
    /Invalid model-profile fulfillment contract/,
  );
});

test("model-profile request records review and Platform fulfillment without changing profile lifecycle", async (t) => {
  const { service } = await fixture(t);
  let projection = await service.create({
    callerId: consoleCaller,
    input: request(),
    operatorId,
  });
  assert.equal(projection.review_state, "draft");
  assert.equal(projection.profile_lifecycle_changed, false);

  projection = await service.command({
    callerId: consoleCaller,
    requestId: projection.request_id,
    operatorId,
    input: command(1, "submit", 1),
  });
  projection = await service.command({
    callerId: consoleCaller,
    requestId: projection.request_id,
    operatorId,
    input: command(2, "start-review", 2),
  });
  projection = await service.command({
    callerId: consoleCaller,
    requestId: projection.request_id,
    operatorId,
    input: command(3, "request-changes", 3, {
      reason: "Clarify rollback ownership.",
      requirements: [{
        requirement_id: "rollback-owner",
        summary: "Name the rollback owner.",
        owner_repo: "platform-engineering",
        next_action: "Update the operational expectations.",
      }],
    }),
  });
  assert.equal(projection.review_state, "changes-required");
  const revised = {
    ...projection.request.profile_intent,
    operational_expectations: [
      ...projection.request.profile_intent.operational_expectations,
      "Platform Engineering owns rollback of the registry change.",
    ],
  };
  projection = await service.command({
    callerId: consoleCaller,
    requestId: projection.request_id,
    operatorId,
    input: command(4, "revise", 4, {
      reason: "Added rollback ownership.",
      revised_profile_intent: revised,
    }),
  });
  projection = await service.command({
    callerId: consoleCaller,
    requestId: projection.request_id,
    operatorId,
    input: command(5, "submit", 5),
  });
  projection = await service.command({
    callerId: consoleCaller,
    requestId: projection.request_id,
    operatorId,
    input: command(6, "start-review", 6),
  });
  projection = await service.command({
    callerId: consoleCaller,
    requestId: projection.request_id,
    operatorId,
    input: command(7, "approve", 7, {
      reason: "Security review may proceed against this exact request.",
      decision_ref: artifact("review-decision"),
    }),
  });
  projection = await service.fulfill({
    callerId: platformCaller,
    requestId: projection.request_id,
    input: fulfillment(8, "implementing", 8),
  });
  projection = await service.fulfill({
    callerId: platformCaller,
    requestId: projection.request_id,
    input: fulfillment(9, "applied", 9, {
      source: {
        owner_repo: "platform-engineering",
        base_version: "registry-before",
        result_version: "registry-after",
        review_ref: artifact("platform-review"),
      },
      receipt_ref: artifact("platform-receipt"),
    }),
  });

  assert.equal(projection.review_state, "approved");
  assert.equal(projection.fulfillment_state, "applied");
  assert.equal(projection.profile_lifecycle_changed, false);
  assert.equal(projection.next_action, "refresh-authoritative-projections");
  assert.equal(projection.history.length, 10);
  assert.equal(projection.history.at(-1).event_type, "fulfillment-applied");
  assert.match(projection.latest_receipt.digest, /^sha256:[0-9a-f]{64}$/);
  assertModelProfileContract("projection.schema.json", projection);
});

test("model-profile request fails closed on stale, replayed-conflict, invalid transition and authority errors", async (t) => {
  const { service } = await fixture(t);
  const created = await service.create({ callerId: consoleCaller, input: request(), operatorId });

  await assert.rejects(
    service.command({
      callerId: consoleCaller,
      requestId: created.request_id,
      operatorId,
      input: command(1, "approve", 1, { reason: "invalid", decision_ref: artifact("decision") }),
    }),
    (error) => error.code === "model_profile_request_transition_invalid",
  );
  const submitted = await service.command({
    callerId: consoleCaller,
    requestId: created.request_id,
    operatorId,
    input: command(1, "submit", 1),
  });
  const replay = await service.command({
    callerId: consoleCaller,
    requestId: created.request_id,
    operatorId,
    input: command(1, "submit", 1),
  });
  assert.equal(replay.revision, submitted.revision);
  await assert.rejects(
    service.command({
      callerId: consoleCaller,
      requestId: created.request_id,
      operatorId,
      input: command(1, "submit", 2),
    }),
    (error) => error.code === "model_profile_request_idempotency_conflict",
  );
  await assert.rejects(
    service.command({
      callerId: consoleCaller,
      requestId: created.request_id,
      operatorId,
      input: command(1, "start-review", 2),
    }),
    (error) => error.code === "model_profile_request_revision_conflict",
  );
  await assert.rejects(
    service.command({
      callerId: consoleCaller,
      requestId: created.request_id,
      operatorId,
      input: command(2, "start-review", 2, {
        command_id: "command-submit-1",
        idempotency_key: "different-key-same-command-id",
      }),
    }),
    (error) => error.code === "model_profile_request_idempotency_conflict",
  );
  await assert.rejects(
    service.command({
      callerId: consoleCaller,
      requestId: created.request_id,
      operatorId,
      input: command(2, "start-review", 0),
    }),
    (error) => error.code === "model_profile_request_timestamp_out_of_order",
  );
  await assert.rejects(
    service.fulfill({
      callerId: consoleCaller,
      requestId: created.request_id,
      input: fulfillment(2, "implementing", 2),
    }),
    (error) => error.code === "model_profile_request_fulfillment_forbidden",
  );
  await assert.rejects(
    service.fulfill({
      callerId: platformCaller,
      requestId: created.request_id,
      input: fulfillment(2, "implementing", 2, { actor_id: "different-platform-caller" }),
    }),
    (error) => error.code === "model_profile_request_fulfillment_actor_invalid",
  );
  await assert.rejects(
    service.get({ callerId: "different-caller", requestId: created.request_id }),
    (error) => error.statusCode === 404,
  );
});

test("model-profile request list is caller-scoped and cursor bounded", async (t) => {
  const { service } = await fixture(t);
  for (const suffix of ["a", "b", "c"]) {
    await service.create({
      callerId: consoleCaller,
      operatorId,
      input: request({
        request_id: `model-profile-request:${suffix}`,
        idempotency_key: `create-${suffix}`,
      }),
    });
  }
  const first = await service.list({ callerId: consoleCaller, limit: 2 });
  assert.deepEqual(first.requests.map((entry) => entry.request_id), [
    "model-profile-request:a",
    "model-profile-request:b",
  ]);
  assert.equal(first.next_cursor, "model-profile-request:b");
  const second = await service.list({
    callerId: consoleCaller,
    cursor: first.next_cursor,
    limit: 2,
  });
  assert.deepEqual(second.requests.map((entry) => entry.request_id), [
    "model-profile-request:c",
  ]);
  assert.equal(second.next_cursor, null);
});

async function invoke(app, {
  body,
  caller = consoleCaller,
  method = "GET",
  operator = operatorId,
  secret = "console-secret",
  url,
} = {}) {
  const requestStream = body === undefined
    ? Readable.from([])
    : Readable.from([Buffer.from(JSON.stringify(body))]);
  Object.assign(requestStream, {
    url,
    method,
    headers: {
      "x-oos-caller-id": caller,
      "x-oos-caller-secret": secret,
      ...(operator ? { "x-oos-operator-id": operator } : {}),
    },
  });
  let code = 200;
  let output = "";
  await app(requestStream, {
    writeHead(value) { code = value; },
    end(value = "") { output += value; },
  });
  return { code, body: output ? JSON.parse(output) : null };
}

test("model-profile HTTP surface preserves caller, operator and fulfillment boundaries", async () => {
  const calls = [];
  const service = {
    create: async (input) => { calls.push(["create", input]); return { request_id: input.input.request_id }; },
    list: async (input) => { calls.push(["list", input]); return { requests: [] }; },
    get: async (input) => {
      calls.push(["get", input]);
      return { revision: 1, request_id: input.requestId, history: [{ occurred_at: at(0) }] };
    },
    command: async (input) => { calls.push(["command", input]); return { revision: 2 }; },
    fulfill: async (input) => { calls.push(["fulfill", input]); return { revision: 3 }; },
  };
  const config = loadConfig({
    CALLER_ALLOWED_IDS: `${consoleCaller},${platformCaller}`,
    CALLER_AUTH_SECRETS_JSON: JSON.stringify({
      [consoleCaller]: "console-secret",
      [platformCaller]: "platform-secret",
    }),
  });
  const app = createApp({ config, modelProfileRequestService: service });
  const id = encodeURIComponent("model-profile-request:1203-demo");
  assert.equal((await invoke(app, { method: "POST", url: "/v1/model-profile-requests", body: request() })).code, 201);
  assert.equal((await invoke(app, { url: "/v1/model-profile-requests?limit=25" })).code, 200);
  assert.equal((await invoke(app, { url: `/v1/model-profile-requests/${id}` })).code, 200);
  assert.equal((await invoke(app, { method: "POST", url: `/v1/model-profile-requests/${id}/commands`, body: command(1, "submit", 1) })).code, 200);
  assert.equal((await invoke(app, {
    method: "POST",
    url: `/v1/model-profile-requests/${id}/fulfillment`,
    body: fulfillment(2, "implementing", 2),
    caller: platformCaller,
    operator: null,
    secret: "platform-secret",
  })).code, 200);
  assert.deepEqual(calls.map(([name]) => name), ["create", "list", "get", "command", "fulfill"]);
  assert.equal(calls[0][1].operatorId, operatorId);
  assert.equal(calls[1][1].limit, 25);
  assert.equal(calls[4][1].callerId, platformCaller);

  assert.equal((await invoke(app, {
    method: "POST",
    operator: null,
    url: "/v1/model-profile-requests",
    body: request(),
  })).code, 400);
  assert.equal((await invoke(createApp({ config }), {
    url: "/v1/model-profile-requests",
  })).code, 503);
});

test("model-profile runtime is disabled by default and requires all explicit authority bindings", () => {
  const parsed = loadConfig({
    OOS_RUNTIME_PROFILE: "dev-integration",
    OOS_MODEL_PROFILE_REQUEST_ENABLED: "true",
    OOS_MODEL_PROFILE_REQUEST_STATE_ROOT: "/var/lib/oos/model-profile-requests",
    OOS_MODEL_PROFILE_REQUEST_CALLER_OPERATOR_BINDINGS_JSON: JSON.stringify({
      [consoleCaller]: operatorId,
    }),
    OOS_MODEL_PROFILE_FULFILLMENT_CALLER_IDS: platformCaller,
  });
  assert.equal(parsed.modelProfileRequest.enabled, true);
  assert.equal(parsed.modelProfileRequest.profile, "dev-integration");
  assert.deepEqual(parsed.modelProfileRequest.operatorBindings, { [consoleCaller]: operatorId });
  assert.deepEqual(parsed.modelProfileRequest.fulfillmentCallerIds, [platformCaller]);
  assert.equal(createModelProfileRequestRuntime({ config: { enabled: false } }), null);
  assert.throws(
    () => createModelProfileRequestRuntime({
      config: {
        enabled: true,
        profile: "stage",
        stateRoot: "/tmp/test",
        operatorBindings: {},
        fulfillmentCallerIds: [],
      },
    }),
    /admitted only in the reviewed dev-integration boundary/,
  );
  assert.ok(createModelProfileRequestRuntime({ config: parsed.modelProfileRequest }));
  assert.equal(modelProfileRequestManifest.runtime_activation.enabled, true);
  assert.equal(
    modelProfileRequestManifest.runtime_activation.allowed_runtime_profile,
    "dev-integration",
  );
  assert.equal(
    modelProfileRequestManifest.runtime_activation.security_review_work_item,
    "openproject://work_packages/1243",
  );
  assert.equal(
    modelProfileRequestManifest.runtime_activation.activation_work_item,
    "openproject://work_packages/1241",
  );
});

test("model-profile digest is deterministic across object key order", () => {
  assert.equal(
    modelProfileDigest({ b: 2, a: 1 }),
    modelProfileDigest({ a: 1, b: 2 }),
  );
  assert.deepEqual(Object.keys(modelProfileRequestManifest.files).sort(), [
    "command.schema.json",
    "fulfillment.schema.json",
    "projection.schema.json",
    "receipt.schema.json",
    "request.schema.json",
  ]);
});
