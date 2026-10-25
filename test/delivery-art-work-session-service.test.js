import { canonicalDigest } from "../src/delivery-art/canonical-json.js";
import { createDeliveryArtSourceRealizationService } from "../src/delivery-art/source-realization.js";
import { loadOpenApiSpec, resolveOperation, validateValueAgainstSchema } from "../scripts/api_contract_tools.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";

import {
  createDeliveryArtWorkSessionService,
  DeliveryArtWorkSessionServiceError,
} from "../src/delivery-art/work-session-service.js";
import { createDeliveryArtWorkSessionStore } from "../src/delivery-art/work-session-store.js";

function valid() {
  return { errors: [], valid: true };
}

function createStore(root) {
  return createDeliveryArtWorkSessionStore({
    root,
    validateArchitectureSupersessionReceipt: valid,
    validateCleanupReceipt: valid,
    validateDecision: valid,
    validateRecoveryReceipt: valid,
    validateResourceManifest: valid,
    validateSession: valid,
  });
}

function session(revision = "2026-08-27T01:00:00.000Z") {
  return {
    schema_version: 1,
    artifact_type: "delivery_art_work_session",
    session_id: "work-session:delivery-886:delivery-886-api",
    delivery_id: "delivery-886",
    landing_unit_id: "delivery-886-api",
    covered_work_item_ids: ["work-item-1024"],
    aliases: ["delivery-886-api", "work-item-1024"],
    owner_repo: "operator-orchestration-service",
    target_pi: "PI-2026-03",
    caller_id: "operator:workspace-owner",
    operator: {
      id: "operator:workspace-owner",
      decision_source: "operator",
    },
    landing_unit: {
      decision: "child_isolated_landing_unit",
      split_reason: "The API is independently reviewable.",
      base_ref: "origin/main",
      base_commit: "a".repeat(40),
      branch: "feature/1024-delivery-work-session-api",
      rollback_boundary: "Revert the API landing unit.",
    },
    architecture: { required: false, artifact_file: null },
    artifacts: {
      work_start_file: "artifacts/work-start.json",
      review_packet_file: "artifacts/review-packet.json",
      readiness_receipt_file: "artifacts/readiness-receipt.json",
      evidence_file: "artifacts/evidence.json",
      resource_manifest_file: "resource-manifest.json",
    },
    human_gate_work_item_ids: { security_acceptance: [] },
    state: "source-work",
    created_at: "2026-08-27T01:00:00.000Z",
    updated_at: revision,
  };
}

function result(current) {
  return {
    workflow_id: "delivery-art-work-session",
    delivery_id: current.delivery_id,
    work_item_id: "work-item-1024",
    landing_unit_id: current.landing_unit_id,
    session_id: current.session_id,
    session_revision: current.updated_at,
    state: current.state,
    next_action: {
      code: "source-work-required",
      command: "git -C '/private/worktree' status --short",
      reason: "Complete the source change.",
      authority: current.owner_repo,
    },
    source: {
      base_commit: current.landing_unit.base_commit,
      branch: current.landing_unit.branch,
      changed_files: ["src/delivery-art/work-session-service.js"],
      head_commit: "b".repeat(40),
      state: "unpushed",
      upstream_commit: null,
    },
  };
}

function createHarness(
  store,
  { available = true, lifecycleContext = null, sourceRealization = null, sourceCredentials = null } = {},
) {
  const controller = {
    async prepareSourceCredential() { return { source_start_digest: `sha256:${"a".repeat(64)}` }; },
    async preflight() {
      return {
        ...result(store.readByAlias("work-item-1024") ?? session()),
        configured_path: {
          blockers: [],
          ready: true,
          status: "implementation-ready",
        },
        state: "implementation-ready",
      };
    },
    async start() {
      const current = session();
      store.writeSession(current);
      return result(current);
    },
    async status() {
      return result(store.readByAlias("work-item-1024") ?? session());
    },
    async continue() {
      const current = {
        ...store.readByAlias("work-item-1024"),
        updated_at: "2026-08-27T01:01:00.000Z",
      };
      store.writeSession(current);
      return result(current);
    },
    async merge() {
      const current = {
        ...store.readByAlias("work-item-1024"),
        state: "implementation-ready",
        updated_at: "2026-08-27T01:02:00.000Z",
      };
      store.writeSession(current);
      return result(current);
    },
    async reconstruct() {
      const current = {
        ...store.readByAlias("work-item-1024"),
        updated_at: "2026-08-27T01:01:30.000Z",
      };
      store.writeSession(current);
      return result(current);
    },
    async recover() {
      return result(store.readByAlias("work-item-1024"));
    },
    async close() {
      return {
        ...result(store.readByAlias("work-item-1024")),
        state: "closed",
      };
    },
  };
  return createDeliveryArtWorkSessionService({
    controller,
    executor: { available, id: "source-executor:test" },
    lifecycleContext,
    sourceRealization,
    sourceCredentials,
    store,
  });
}

test("source credential pending does not journal a failed source command and permits exact retry", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "oos-work-source-pending-"));
  const store = createStore(root);
  let ready = false; let leases = 0;
  const sourceCredentials = {
    async ensureSourceCredential(scope) {
      assert.equal(scope.workItemId, "work-item-1024");
      assert.equal(scope.intentId, "source-intent:test-1024");
      if (!ready) throw new DeliveryArtWorkSessionServiceError("platform_source_credential_pending", "Owner operation pending.", { statusCode: 409 });
    },
    async withSourceLease({ operation }) { leases++; return operation(); },
    async stopSourceCredential() {},
  };
  const service = createHarness(store, { sourceCredentials });
  const command = { command_id: "work-session-command:credential-start", expected_session_revision: null, source_intent_ref: "source-intent:test-1024",
    decision: { caller_id: "operator:workspace-owner", operator: { id: "operator:workspace-owner" } } };
  const input = { action: "start", callerId: "operator:workspace-owner", workItemId: "1024", command };
  await assert.rejects(service.execute(input), { code: "platform_source_credential_pending" });
  assert.equal(store.readCommandRecord(command.command_id), null);
  assert.equal(store.readByAlias("1024"), null);
  assert.equal(leases, 0);
  ready = true;
  const started = await service.execute(input);
  assert.equal(leases, 1);
  assert.equal(started.source_authorization.intent_ref, command.source_intent_ref);
  assert.equal((await service.execute(input)).source_authorization.intent_ref, command.source_intent_ref);
  const recovered = await createHarness(store, { sourceCredentials }).read({ callerId: "operator:workspace-owner", workItemId: "1024" });
  assert.equal(recovered.source_authorization.intent_ref, command.source_intent_ref);
});

test("continued source work cannot bypass a stopped lease or silently replace its binding", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "oos-work-source-stop-"));
  const store = createStore(root); store.writeSession(session());
  let writes = 0;
  const sourceCredentials = {
    async ensureSourceCredential(scope) {
      if (scope.previousIntentId) throw new DeliveryArtWorkSessionServiceError("platform_source_successor_unconfirmed", "No approved successor exists.", { statusCode: 409 });
    },
    async withSourceLease() { throw new DeliveryArtWorkSessionServiceError("platform_source_intent_revoked", "Source access stopped.", { statusCode: 409 }); },
    async stopSourceCredential() {},
  };
  const service = createHarness(store, { sourceCredentials });
  const input = { action: "continue", callerId: "operator:workspace-owner", workItemId: "1024",
    command: { command_id: "work-session-command:stopped-continue", expected_session_revision: session().updated_at, source_intent_ref: "source-intent:stopped" } };
  await assert.rejects(service.execute(input), { code: "platform_source_intent_revoked" });
  assert.equal(store.readCommandRecord(input.command.command_id), null);
  assert.equal(store.readByAlias("work-item-1024").updated_at, session().updated_at);
  const realization = { async read() {}, async start() {}, async continue() { writes++; }, async cancel() {}, async recover() { writes++; } };
  const realized = createHarness(store, { sourceCredentials, sourceRealization: realization });
  store.writeArtifact(session(), "artifacts/source-intent.json", { schema_version: 1, artifact_type: "delivery-art-source-intent-binding", session_id: session().session_id, source_intent_ref: "source-intent:stopped" });
  await assert.rejects(realized.executeRealization({ action: "continue", callerId: "operator:workspace-owner", workItemId: "1024", request: {} }), { code: "platform_source_intent_revoked" });
  assert.equal(writes, 0);
  await assert.rejects(service.execute({ ...input, command: { ...input.command, source_intent_ref: "source-intent:replacement" } }), { code: "platform_source_successor_unconfirmed" });
});

test("terminal work close invokes exact source revocation and exposes pending owner confirmation", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "oos-work-source-terminal-"));
  const store = createStore(root); store.writeSession(session());
  store.writeArtifact(session(), "artifacts/source-intent.json", { schema_version: 1, artifact_type: "delivery-art-source-intent-binding", session_id: session().session_id, source_intent_ref: "source-intent:terminal" });
  const stops = [];
  const sourceCredentials = {
    async ensureSourceCredential() { throw new Error("close must not renew source credentials"); },
    async withSourceLease() { throw new Error("cleanup is not a new Gary source effect"); },
    async stopSourceCredential(scope) { stops.push(scope); return { state: "queued", operation_id: "platform-operation:revoke-terminal" }; },
  };
  const service = createHarness(store, { sourceCredentials });
  const closed = await service.execute({ action: "close", callerId: "operator:workspace-owner", workItemId: "1024",
    command: { command_id: "work-session-command:close-with-revoke", expected_session_revision: session().updated_at } });
  assert.equal(stops.length, 1); assert.equal(stops[0].intentId, "source-intent:terminal");
  assert.equal(closed.source_authorization.state, "revocation-pending");
  assert.equal(closed.next_action.code, "source-revocation-pending");
});

test("completed realization acknowledgements remain readable after source authorization stops", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "oos-work-source-history-"));
  const store = createStore(root); store.writeSession(session());
  const denied = async () => { throw new Error("historical receipt read must not obtain new source authority"); };
  const sourceRealization = { async read() {}, async start() {}, async continue() { throw new Error("must not apply twice"); }, async cancel() {}, async recover() {},
    readCompletedCommand(input) { assert.equal(input.action, "continue"); return { workflow_id: "delivery-art-source-realization", state: "source-created", replayed: true }; } };
  const service = createHarness(store, { sourceRealization, sourceCredentials: { ensureSourceCredential: denied, withSourceLease: denied, stopSourceCredential: denied } });
  const replay = await service.executeRealization({ action: "continue", callerId: "operator:workspace-owner", workItemId: "1024", request: {} });
  assert.equal(replay.replayed, true); assert.equal(replay.state, "source-created");
});

test("normal source continuation adopts only its explicitly approved exact successor and preserves the real session", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "oos-work-source-reauthorize-"));
  const store = createStore(root); store.writeSession(session());
  store.writeArtifact(session(), "artifacts/source-intent.json", { schema_version: 1, artifact_type: "delivery-art-source-intent-binding", session_id: session().session_id, source_intent_ref: "source-intent:expired" });
  const scopes = [];
  const sourceCredentials = {
    async ensureSourceCredential(scope) { scopes.push(scope); assert.equal(scope.previousIntentId, "source-intent:expired"); assert.equal(scope.intentId, "source-intent:fresh-approved"); },
    async withSourceLease({ operation }) { return operation(); }, async stopSourceCredential() {},
  };
  const continued = await createHarness(store, { sourceCredentials }).execute({ action: "continue", callerId: "operator:workspace-owner", workItemId: "1024",
    command: { command_id: "work-session-command:explicit-reauthorization", expected_session_revision: session().updated_at, source_intent_ref: "source-intent:fresh-approved" } });
  assert.equal(scopes.length, 1); assert.equal(continued.session_id, session().session_id);
  assert.equal(continued.source_authorization.intent_ref, "source-intent:fresh-approved");
  assert.equal(store.readByAlias("work-item-1024").landing_unit.branch, session().landing_unit.branch);
});

test("realization successor adoption advances canonical source ordering without changing the actual Work Session command revision", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "oos-work-source-ordering-"));
  const store = createStore(root); store.writeSession(session());
  store.writeArtifact(session(), "artifacts/source-intent.json", { schema_version: 1, artifact_type: "delivery-art-source-intent-binding", session_id: session().session_id, source_intent_ref: "source-intent:expired" });
  let effects = 0;
  const sourceRealization = { async read() {}, async start() {}, async cancel() {}, async recover() {},
    async continue() { effects++; assert.equal(store.readArtifact(session(), "artifacts/source-intent.json").source_intent_ref, "source-intent:fresh-approved"); return { workflow_id: "delivery-art-source-realization", state: "source-created" }; } };
  const sourceCredentials = { async ensureSourceCredential(scope) { assert.equal(scope.previousIntentId, "source-intent:expired"); assert.equal(scope.intentId, "source-intent:fresh-approved"); }, async withSourceLease({ operation }) { return operation(); }, async stopSourceCredential() {} };
  const service = createHarness(store, { sourceCredentials, sourceRealization });
  const config = loadConfig({ CALLER_ALLOWED_IDS: "operator:workspace-owner", CALLER_AUTH_SECRETS_JSON: JSON.stringify({ "operator:workspace-owner": "test-secret" }), OOS_DELIVERY_WORK_SESSION_CALLER_OPERATOR_BINDINGS_JSON: JSON.stringify({ "operator:workspace-owner": "operator:workspace-owner" }) });
  const app = createApp({ config, deliveryArtWorkSessionService: service });
  async function read() {
    const request = Readable.from([]); request.method = "GET"; request.url = "/v1/delivery-work-items/1024/work-session";
    request.headers = { "x-oos-caller-id": "operator:workspace-owner", "x-oos-caller-secret": "test-secret", "x-oos-operator-id": "operator:workspace-owner", accept: "application/vnd.mfshaf7.console-source-projection+json; version=1" };
    let body, code; await app(request, { writeHead(value) { code = value; }, end(value) { body = JSON.parse(value); } });
    assert.equal(code, 200, JSON.stringify(body)); return body;
  }
  const before = await read();
  await service.executeRealization({ action: "continue", callerId: "operator:workspace-owner", workItemId: "1024", request: {}, sourceIntentRef: "source-intent:fresh-approved" });
  await new Promise(resolve => setTimeout(resolve, 2));
  const after = await read(), unchanged = await read();
  assert.equal(effects, 1); assert.equal(after.projection.session_revision, before.projection.session_revision);
  assert.equal(after.projection.source_authorization.intent_ref, "source-intent:fresh-approved");
  assert.ok(after.revision.event_sequence > before.revision.event_sequence); assert.notEqual(after.revision.source_revision, before.revision.source_revision);
  assert.ok(unchanged.revision.event_sequence >= after.revision.event_sequence); assert.equal(unchanged.revision.source_revision, after.revision.source_revision);
});

test("first and ordinary work-session reads construct canonical observations without source authorization", async () => {
  const config = loadConfig({ CALLER_ALLOWED_IDS: "operator:workspace-owner", CALLER_AUTH_SECRETS_JSON: JSON.stringify({ "operator:workspace-owner": "test-secret" }), OOS_DELIVERY_WORK_SESSION_CALLER_OPERATOR_BINDINGS_JSON: JSON.stringify({ "operator:workspace-owner": "operator:workspace-owner" }) });
  for (const revision of [null, "2026-08-27T01:00:00.000Z"]) {
    const native = {workflow_id:"delivery-art-work-session",delivery_id:"delivery-886",work_item_id:"work-item-1024",landing_unit_id:revision?"delivery-886-api":null,session_id:revision?"work-session:delivery-886:delivery-886-api":null,session_revision:revision,state:revision?"source-work":"decision-required",next_action:{code:revision?"source-work-required":"work-session-start-required",authority:"operator",reason:"Native next step"}};
    const app=createApp({config,deliveryArtWorkSessionService:{async read(){return structuredClone(native);}}});
    const read=async accept=>{
      const request=Readable.from([]);request.method="GET";request.url="/v1/delivery-work-items/1024/work-session";request.headers={"x-oos-caller-id":"operator:workspace-owner","x-oos-caller-secret":"test-secret","x-oos-operator-id":"operator:workspace-owner",accept};
      let body,code;await app(request,{writeHead(value){code=value;},end(value){body=JSON.parse(value);}});assert.equal(code,200,JSON.stringify(body));return body;
    };
    const before=await read("application/vnd.mfshaf7.console-source-projection+json; version=1");
    await new Promise(resolve=>setTimeout(resolve,2));
    const after=await read("application/vnd.mfshaf7.console-source-projection+json; version=1");
    assert.deepEqual(before.projection,native);assert.deepEqual(after.projection,native);
    assert.match(before.revision.source_revision,/^sha256:[0-9a-f]{64}$/);
    assert.equal(after.revision.source_revision,before.revision.source_revision);
    assert.ok(after.revision.event_sequence>before.revision.event_sequence);
    assert.equal(after.projection.session_revision,revision);
    assert.deepEqual(await read("application/json"),native);
  }
});

test("work-session service binds source realization to the authenticated session identity", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "oos-work-session-realization-"));
  const store = createStore(root);
  store.writeSession(session());
  const calls = [];
  const sourceRealization = {
    async read(input) {
      calls.push(["read", input]);
      return { workflow_id: "delivery-art-source-realization", state: "not-started" };
    },
    async start(input) {
      calls.push(["start", input]);
      return { workflow_id: "delivery-art-source-realization", state: "draft-ready" };
    },
    async continue() {},
    async cancel() {},
    async recover() {},
  };
  const service = createHarness(store, { sourceRealization });
  const status = await service.readRealization({
    callerId: "operator:workspace-owner",
    operatorId: "operator:workspace-owner",
    workItemId: "1024",
  });
  assert.equal(status.state, "not-started");
  const request = { request_id: "source-realization-request-1024-1" };
  const started = await service.executeRealization({
    action: "start",
    callerId: "operator:workspace-owner",
    operatorId: "operator:workspace-owner",
    request,
    workItemId: "1024",
  });
  assert.equal(started.state, "draft-ready");
  assert.deepEqual(calls, [
    ["read", {
      callerId: "operator:workspace-owner",
      operatorId: "operator:workspace-owner",
      workItemId: "work-item-1024",
    }],
    ["start", {
      callerId: "operator:workspace-owner",
      operatorId: "operator:workspace-owner",
      request,
      signal: null,
      workItemId: "work-item-1024",
    }],
  ]);
  await assert.rejects(
    service.readRealization({
      callerId: "another-caller",
      operatorId: "operator:workspace-owner",
      workItemId: "1024",
    }),
    { code: "delivery_art_work_session_caller_mismatch", statusCode: 403 },
  );
});

test("coordination records retain non-secret references and reject credential material", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "oos-work-session-references-"));
  const store = createStore(root);
  assert.doesNotThrow(() => store.writeCommandRecord("work-session-command:safe-ref", {
    runtime: {
      credential_ref: "env://AGENT_GARY_SOURCE_TOKEN",
      secret_values_embedded: false,
    },
  }));
  assert.doesNotThrow(() => store.writeCommandRecord("work-session-command:nullable-ref", {
    runtime: {
      credential_ref: null,
      secret_values_embedded: false,
    },
  }));
  assert.throws(
    () => store.writeCommandRecord("work-session-command:empty-ref", {
      runtime: { credential_ref: "" },
    }),
    { code: "delivery_art_work_session_secret_field_forbidden" },
  );
  assert.throws(
    () => store.writeCommandRecord("work-session-command:secret", {
      runtime: { credential: "material-must-not-persist" },
    }),
    { code: "delivery_art_work_session_secret_field_forbidden" },
  );
});

test("work-session reads expose context posture and delegate bounded context requests", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "oos-work-session-context-"));
  const store = createStore(root);
  store.writeSession(session());
  const calls = [];
  const lifecycleContext = {
    status(current) {
      return {
        commissioned: true,
        default_mode: "packet",
        latest_binding: null,
        measurements: { packet_count: 0, raw_fallback_count: 0, denied_count: 0 },
        session_id: current.session_id,
      };
    },
    async project(input) {
      calls.push(input);
      return { workflow_id: "delivery-art-lifecycle-context", mode: "packet" };
    },
  };
  const service = createHarness(store, { lifecycleContext });
  const projection = await service.read({
    callerId: "operator:workspace-owner",
    operatorId: "operator:workspace-owner",
    workItemId: "1024",
  });
  assert.equal(projection.lifecycle_context.commissioned, true);

  const context = await service.projectContext({
    callerId: "operator:workspace-owner",
    operatorId: "operator:workspace-owner",
    request: { request_id: "request-1" },
    workItemId: "1024",
  });
  assert.equal(context.mode, "packet");
  assert.equal(calls[0].workItemId, "work-item-1024");
});

test("work-session commands retain one durable replay result and bounded source truth", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "oos-work-session-service-"));
  const store = createStore(root);
  const service = createHarness(store);
  const command = {
    command_id: "work-session-command:start-1024-1",
    expected_session_revision: null,
    decision: {
      caller_id: "operator:workspace-owner",
      operator: { id: "operator:workspace-owner" },
    },
  };

  const first = await service.execute({
    action: "start",
    callerId: "operator:workspace-owner",
    command,
    workItemId: "1024",
  });
  const replay = await createHarness(store).execute({
    action: "start",
    callerId: "operator:workspace-owner",
    command,
    workItemId: "work-item-1024",
  });

  assert.equal(first.replayed, false);
  assert.equal(replay.replayed, true);
  assert.deepEqual(replay.source, first.source);
  assert.equal(first.next_action.command, undefined);
  assert.equal(replay.command_receipt.digest, first.command_receipt.digest);
});

test("work-session commands persist safe Agent source authorization metadata", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "oos-work-session-agent-source-"));
  const store = createStore(root);
  const current = session();
  const projected = {
    ...result(current),
    agent_source: {
      authorization_expires_at: "2026-09-12T13:00:00Z",
      display_name: "Agent Gary",
      state: "ready",
    },
  };
  const service = createDeliveryArtWorkSessionService({
    controller: {
      async close() {},
      async continue() {},
      async merge() {},
      async preflight() {},
      async reconstruct() {},
      async recover() {},
      async start() {
        store.writeSession(current);
        return projected;
      },
      async status() {},
    },
    executor: { available: true, id: "source-executor:test" },
    store,
  });

  const response = await service.execute({
    action: "start",
    callerId: "operator:workspace-owner",
    command: {
      command_id: "work-session-command:start-agent-source-1",
      decision: {
        caller_id: "operator:workspace-owner",
        operator: { id: "operator:workspace-owner" },
      },
      expected_session_revision: null,
    },
    workItemId: "1024",
  });

  assert.equal(
    response.agent_source.authorization_expires_at,
    "2026-09-12T13:00:00Z",
  );
  assert.equal(Object.hasOwn(response.agent_source, "token_expires_at"), false);
});

test("work-session commands reject stale revisions and caller mismatches", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "oos-work-session-stale-"));
  const store = createStore(root);
  store.writeSession(session());
  const service = createHarness(store);

  await assert.rejects(
    service.execute({
      action: "continue",
      callerId: "operator:workspace-owner",
      command: {
        command_id: "work-session-command:continue-stale-1",
        expected_session_revision: "2026-08-27T00:00:00.000Z",
      },
      workItemId: "1024",
    }),
    (error) =>
      error instanceof DeliveryArtWorkSessionServiceError &&
      error.code === "delivery_art_work_session_revision_stale" &&
      error.statusCode === 409,
  );
  await assert.rejects(
    service.read({ callerId: "operator:other", workItemId: "1024" }),
    (error) =>
      error instanceof DeliveryArtWorkSessionServiceError &&
      error.code === "delivery_art_work_session_caller_mismatch" &&
      error.statusCode === 403,
  );
});

test("work-session merge commands retain one replay-safe receipt", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "oos-work-session-merge-"));
  const store = createStore(root);
  store.writeSession(session());
  const service = createHarness(store);
  const input = {
    action: "merge",
    callerId: "operator:workspace-owner",
    command: {
      command_id: "work-session-command:merge-1024-1",
      expected_session_revision: "2026-08-27T01:00:00.000Z",
    },
    workItemId: "1024",
  };

  const first = await service.execute(input);
  const replay = await service.execute(input);

  assert.equal(first.replayed, false);
  assert.equal(replay.replayed, true);
  assert.equal(first.session_revision, "2026-08-27T01:02:00.000Z");
  assert.equal(replay.command_receipt.digest, first.command_receipt.digest);
});

test("recovery commands bind caller, revision, and exact merged PR decision", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "oos-work-session-recover-command-"));
  const store = createStore(root);
  store.writeSession(session());
  const service = createHarness(store);
  const input = {
    action: "recover",
    callerId: "operator:workspace-owner",
    command: {
      command_id: "work-session-command:recover-1024-1",
      expected_session_revision: session().updated_at,
      recovery: {
        session_id: session().session_id,
        session_revision: session().updated_at,
        reason: "Archive the exact merged session and preserve missing proof.",
        pull_request: {
          url: "https://example.test/pr/1",
          head_commit: "a".repeat(40),
          merge_commit: "b".repeat(40),
        },
      },
    },
    workItemId: "1024",
  };
  const first = await service.execute(input);
  const replay = await service.execute(input);
  assert.equal(first.replayed, false);
  assert.equal(replay.replayed, true);

  await assert.rejects(
    service.execute({
      ...input,
      command: {
        ...input.command,
        command_id: "work-session-command:recover-1024-stale",
        expected_session_revision: "2026-08-27T00:00:00.000Z",
      },
    }),
    (error) => error.code === "delivery_art_work_session_command_invalid",
  );
  await assert.rejects(
    service.execute({
      ...input,
      callerId: "operator:other",
      command: { ...input.command, command_id: "work-session-command:recover-1024-other" },
    }),
    (error) => error.code === "delivery_art_work_session_caller_mismatch",
  );
  await assert.rejects(
    service.execute({
      ...input,
      command: {
        ...input.command,
        command_id: "work-session-command:recover-1024-decision",
        decision: { landing_unit: { id: "replacement" } },
      },
    }),
    (error) => error.code === "delivery_art_work_session_command_invalid",
  );
});

test("unmerged recovery command requires exact local source binding and no PR", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "oos-work-service-unmerged-"));
  const store = createStore(root);
  store.writeSession(session());
  const service = createHarness(store);
  const recovery = {
    mode: "archive-unmerged",
    session_id: session().session_id,
    session_revision: session().updated_at,
    reason: "Archive superseded local source without claiming a merged PR.",
    pull_request: null,
    source: {
      local_branch_head: "b".repeat(40),
      worktree_head: "b".repeat(40),
    },
  };
  const command = {
    command_id: "work-session-command:recover-unmerged-1024",
    expected_session_revision: session().updated_at,
    recovery,
  };
  const first = await service.execute({
    action: "recover", callerId: "operator:workspace-owner",
    command, workItemId: "1024",
  });
  assert.equal(first.replayed, false);
  await assert.rejects(
    service.execute({
      action: "recover", callerId: "operator:workspace-owner",
      command: {
        ...command,
        command_id: "work-session-command:recover-unmerged-invalid",
        recovery: { ...recovery, source: { ...recovery.source, worktree_head: "c".repeat(40) } },
      },
      workItemId: "1024",
    }),
    (error) => error.code === "delivery_art_work_session_command_invalid",
  );
});

test("evidence-bearing recovery command requires an explicit merged PR mode", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "oos-work-service-evidence-recovery-"));
  const store = createStore(root);
  store.writeSession(session());
  const service = createHarness(store);
  const recovery = {
    mode: "archive-merged-evidence",
    session_id: session().session_id,
    session_revision: session().updated_at,
    reason: "Archive the superseded merged session and preserve its merge-ready packet.",
    pull_request: {
      url: "https://example.test/pr/1",
      head_commit: "a".repeat(40),
      merge_commit: "b".repeat(40),
    },
  };
  const command = {
    command_id: "work-session-command:recover-evidence-1024",
    expected_session_revision: session().updated_at,
    recovery,
  };

  const first = await service.execute({
    action: "recover",
    callerId: "operator:workspace-owner",
    command,
    workItemId: "1024",
  });
  assert.equal(first.replayed, false);

  await assert.rejects(
    service.execute({
      action: "recover",
      callerId: "operator:workspace-owner",
      command: {
        ...command,
        command_id: "work-session-command:recover-evidence-source-invalid",
        recovery: { ...recovery, source: { local_branch_head: "a".repeat(40) } },
      },
      workItemId: "1024",
    }),
    (error) => error.code === "delivery_art_work_session_command_invalid",
  );
});

test("work-session API service fails closed when the source executor is unavailable", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "oos-work-session-unavailable-"));
  const service = createHarness(createStore(root), { available: false });

  await assert.rejects(
    service.read({ callerId: "operator:workspace-owner", workItemId: "1024" }),
    (error) =>
      error instanceof DeliveryArtWorkSessionServiceError &&
      error.code === "delivery_art_work_session_executor_unavailable" &&
      error.statusCode === 503,
  );
});

test("work-session preflight is read-only and preserves structured remediation inputs", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "oos-work-session-preflight-"));
  const service = createHarness(createStore(root));

  const projection = await service.inspect({
    callerId: "operator:workspace-owner",
    decision: {
      caller_id: "operator:workspace-owner",
      operator: { id: "operator:workspace-owner" },
    },
    workItemId: "1024",
  });

  assert.equal(projection.state, "implementation-ready");
  assert.equal(projection.configured_path.ready, true);
  assert.equal(Object.hasOwn(projection, "command_receipt"), false);
});

test("work-session execution failures are bounded and replay without another action", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "oos-work-session-failure-"));
  const store = createStore(root);
  store.writeSession(session());
  let attempts = 0;
  const controller = {
    async start() {},
    async status() {},
    async preflight() {},
    async continue() {
      attempts += 1;
      const error = new Error("The source executor rejected the observation.");
      error.code = "delivery_art_work_session_source_observation_invalid";
      error.details = {
        method: "GET",
        path: "/repos/mfshaf7/operator-orchestration-service/pulls",
        status: 502,
      };
      throw error;
    },
    async merge() {},
    async reconstruct() {},
    async recover() {},
    async close() {},
  };
  const service = createDeliveryArtWorkSessionService({ controller, store });
  const input = {
    action: "continue",
    callerId: "operator:workspace-owner",
    command: {
      command_id: "work-session-command:continue-failure-1",
      expected_session_revision: "2026-08-27T01:00:00.000Z",
    },
    workItemId: "1024",
  };

  for (let index = 0; index < 2; index += 1) {
    await assert.rejects(
      service.execute(input),
      (error) =>
        error instanceof DeliveryArtWorkSessionServiceError &&
        error.code === "delivery_art_work_session_source_observation_invalid" &&
        error.statusCode === 400,
    );
  }
  assert.equal(attempts, 1);
  const record = store.readCommandRecord(input.command.command_id);
  assert.deepEqual(record.error, {
    code: "delivery_art_work_session_source_observation_invalid",
    details: {
      method: "GET",
      path: "<redacted:absolute-path>",
      status: 502,
    },
    message: "The source executor rejected the observation.",
    status_code: 400,
  });
});

test("work-session mutations serialize revision checks per work item", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "oos-work-session-concurrent-"));
  const store = createStore(root);
  store.writeSession(session());
  let release;
  const blocked = new Promise((resolve) => {
    release = resolve;
  });
  let entered = false;
  const controller = {
    async start() {},
    async status() {},
    async preflight() {},
    async continue() {
      entered = true;
      await blocked;
      return result(session("2026-08-27T01:01:00.000Z"));
    },
    async merge() {},
    async reconstruct() {},
    async recover() {},
    async close() {},
  };
  const service = createDeliveryArtWorkSessionService({ controller, store });
  const command = (id) => ({
    action: "continue",
    callerId: "operator:workspace-owner",
    command: {
      command_id: `work-session-command:${id}`,
      expected_session_revision: "2026-08-27T01:00:00.000Z",
    },
    workItemId: "1024",
  });

  const first = service.execute(command("continue-concurrent-1"));
  while (!entered) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  await assert.rejects(
    service.execute(command("continue-concurrent-2")),
    (error) =>
      error instanceof DeliveryArtWorkSessionServiceError &&
      error.code === "delivery_art_work_session_locked" &&
      error.statusCode === 409,
  );
  release();
  await first;
});

test('Delivery source reads and inert operator saves retain authenticated session identity without minting or leasing source authority',async t=>{
  const root=await mkdtemp(path.join(tmpdir(),'oos-operator-source-service-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const store=createStore(root);store.writeSession(session());const calls=[];
  const sourceRealization={read:async()=>({}),start:async()=>({}),continue:async()=>({}),cancel:async()=>({}),recover:async()=>({}),readCompletedCommand:()=>null,
    files:async input=>{calls.push(['files',input]);return{files:[]};},
    draft:async input=>{calls.push(['draft',input]);return{digest:'retained-digest'};},
    saveDraft:async input=>{calls.push(['save',input]);return{state:'draft-ready'};}};
  const disallow=()=>{throw new Error('inert source input must not issue, renew, stop or lease credentials');};
  const sourceCredentials={ensureSourceCredential:disallow,withSourceLease:disallow,stopSourceCredential:disallow};
  const service=createHarness(store,{sourceRealization,sourceCredentials}),args={callerId:'operator:workspace-owner',operatorId:'operator:workspace-owner',workItemId:'1024'};
  assert.deepEqual(await service.readRealizationSource({...args,kind:'files',requestedPaths:['app/source.js']}),{files:[]});
  assert.deepEqual(await service.readRealizationSource({...args,kind:'draft'}),{digest:'retained-digest'});
  assert.deepEqual(await service.executeRealization({...args,action:'saveDraft',request:{command_id:'save:operator'}}),{state:'draft-ready'});
  assert.equal(calls[0][1].workItemId,'work-item-1024');assert.deepEqual(calls[0][1].requestedPaths,['app/source.js']);assert.equal(calls[2][1].operatorId,args.operatorId);
  await assert.rejects(service.readRealizationSource({...args,operatorId:'operator:other',kind:'files'}),{code:'delivery_art_work_session_operator_mismatch'});
  await assert.rejects(service.readRealizationSource({...args,kind:'files',requestedPaths:['app/source.js','app/source.js']}),{code:'delivery_art_source_realization_request_invalid'});
  assert.equal(calls.length,3);
});

test('Delivery draft/file/save HTTP routes use the real private draft kernel and canonical source envelope',async t=>{
  const root=await mkdtemp(path.join(tmpdir(),'oos-delivery-editor-api-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const store=createStore(root),selected=session();store.writeSession(selected);const at='2026-10-25T01:00:00Z',sha='sha256:'+'a'.repeat(64);
  const sourceRealization=createDeliveryArtSourceRealizationService({store,enabled:true,clock:()=>new Date('2026-10-25T02:00:00Z'),
    gatewayClient:{configured:false,invoke:async()=>{throw new Error('manual save must not invoke model');}},lifecycleContext:{project:async()=>{throw new Error('manual save must not invoke CGG');}},workSessionController:{status:async()=>({})},
    sourceAdapter:{applySourceRealization:async()=>{throw new Error('save must not write Git');},
      validateSourceRealization:async(s,change)=>({valid:true,session_id:s.session_id,base_commit:s.landing_unit.base_commit,change_set_digest:canonicalDigest(change)}),
      captureRealizationContext:async(s,{requestedPaths})=>({schema_version:1,session_id:s.session_id,owner_repo:s.owner_repo,landing_unit_id:s.landing_unit_id,head_commit:s.landing_unit.base_commit,clean:true,
        tree:{paths:['app/example.js'],total_path_count:1,truncated:false},files:requestedPaths.length?[{path:'app/example.js',content:'base\n',content_digest:sha,size_bytes:5}]:[],admitted_bytes:requestedPaths.length?5:0,context_digest:sha})}});
  const service=createHarness(store,{sourceRealization});
  const config=loadConfig({CALLER_ALLOWED_IDS:'operator:workspace-owner',CALLER_AUTH_SECRETS_JSON:JSON.stringify({'operator:workspace-owner':'test-secret'}),OOS_DELIVERY_WORK_SESSION_CALLER_OPERATOR_BINDINGS_JSON:JSON.stringify({'operator:workspace-owner':'operator:workspace-owner'})});
  const app=createApp({config,deliveryArtWorkSessionService:service}),spec=loadOpenApiSpec();
  async function call(method,url,input,{actor='operator:workspace-owner',canonical=false}={}){
    const request=Readable.from(input===undefined?[]:[Buffer.from(JSON.stringify(input))]);Object.assign(request,{method,url,headers:{'x-oos-caller-id':'operator:workspace-owner','x-oos-caller-secret':'test-secret','x-oos-operator-id':actor,...(canonical?{accept:'application/vnd.mfshaf7.console-source-projection+json; version=1'}:{})}});
    let code,raw='';await app(request,{writeHead(value){code=value;},end(value){raw+=value??'';}});const body=JSON.parse(raw);
    if(code===200){const operation=resolveOperation(spec,method,url.split('?')[0]).operation;
      if(input!==undefined)assert.deepEqual(validateValueAgainstSchema(spec,operation.requestBody.content['application/json'].schema,input),[]);
      const media=canonical?'application/vnd.mfshaf7.console-source-projection+json':'application/json';assert.deepEqual(validateValueAgainstSchema(spec,operation.responses['200'].content[media].schema,body),[]);}
    return{code,body};
  }
  const base='/v1/delivery-work-items/1024/work-session/realization';
  const absent=await call('GET',base+'/draft',undefined,{canonical:true});
  assert.equal(absent.code,404);assert.equal(absent.body.error,'delivery_art_source_realization_draft_missing');
  assert.equal((await sourceRealization.read({callerId:selected.caller_id,operatorId:selected.operator.id,workItemId:'1024'})).attempt,null);
  const tree=await call('GET',base+'/files',undefined,{canonical:true});assert.equal(tree.code,200);assert.equal(tree.body.projection.files.length,0);
  assert.equal((await call('GET',base+'/files?path=app%2Fexample.js',undefined,{canonical:true})).body.projection.files[0].content,'base\n');
  const initial=await sourceRealization.read({callerId:selected.caller_id,operatorId:selected.operator.id,workItemId:'1024'});
  const realization={schema_version:1,command_id:'delivery-save:api',execution_id:'execution:api',expected_revision:initial.revision,expected_change_set_digest:null,requested_at:at,objective:'Update the real ordinary application source.',input_origin:'import',retry_of:null,commit_message:'feat: import application source',operations:[{action:'replace',path:'app/example.js',content:'operator source\r\n',expected_digest:sha}]};
  const saved=await call('POST',base+'/draft',{realization});assert.equal(saved.code,200);assert.equal(saved.body.attempt.operator_draft.input_origin,'import');
  assert.equal((await call('GET',base+'/draft',undefined,{canonical:true})).body.projection.change_set.operations[0].content,'operator source\r\n');
  const replay=await call('POST',base+'/draft',{realization});assert.equal(replay.code,200);assert.equal(replay.body.replayed,true);
  const stale=await call('POST',base+'/draft',{realization:{...realization,command_id:'delivery-save:stale'}});
  assert.equal(stale.code,409);assert.equal(stale.body.error,'delivery_art_source_realization_revision_stale');
  assert.equal((await call('GET',base+'/draft',undefined,{canonical:true})).body.projection.digest,saved.body.attempt.change_set.digest);
  assert.equal((await call('POST',base+'/draft',{realization,repository:'other/repo'})).code,400);
  assert.equal((await call('GET',base+'/files?path=x&path=x')).code,400);
  assert.equal((await call('GET',base+'/files',undefined,{actor:'operator:other'})).code,403);
  sourceRealization.files=async()=>{throw new Error('PRIVATE-SENTINEL-unknown-source-failure');};
  const unexpected=await call('GET',base+'/files',undefined,{canonical:true});assert.equal(unexpected.code,500);
  assert.deepEqual(unexpected.body,{error:'internal_error',message:'Unexpected server error.'});
});
