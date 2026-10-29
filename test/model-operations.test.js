import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { Readable } from "node:stream";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createModelOperationsRuntime } from "../src/model-operations/runtime.js";
import { selectionEvidence } from "../src/model-operations/selection-evidence.js";
import { assertBackends, assertConfiguration, assertProviderHealth, digest } from "../src/model-operations/contracts.js";
import { createModelOperationsService } from "../src/model-operations/service.js";
import { createModelOperationsPlatformClient, ModelOwnerError } from "../src/model-operations/platform-client.js";
import { createModelProfileRequestStore } from "../src/model-profile-request/store.js";

const callerId = "console", operatorId = "operator:mfshaf7";
const identity = { callerId, operatorId };
const request = (id = "test:one", extra = {}) => ({ schema_version: 1, request_id: id, idempotency_key: id,
  expected_configuration_revision: 0, action: "backend.register", input: { backend_id: "local" }, ...extra });

function owner() {
  const configuration = { backends: {}, models: {}, default: null, overrides: {} };
  const snapshots = [structuredClone(configuration)], receipts = new Map(), calls = [];
  const login = new Map();
  let revision = 0;
  return {
    calls, receipts, snapshots,
    async backends() { return { tasks: ["profile/task"], backends: [{ backend_id: "local", provider: "ollama", allowed_tasks: ["profile/task"], registered: revision > 0, account_login_supported: false, availability: "not-probed" }] }; },
    async configuration({ revision: selected = revision } = {}) {
      const config = structuredClone(snapshots[selected]);
      return { revision: selected, current_revision: revision, digest: digest(config), configuration: config,
        history: snapshots.map((config, index) => ({ revision: index, digest: digest(config) })) };
    },
    async command({ command, operatorId: actor }) {
      calls.push(structuredClone(command));
      if (receipts.has(command.command_id)) return structuredClone(receipts.get(command.command_id));
      if (command.action === "account.login.start") {
        const item = { command_id: command.command_id, request_digest: digest({ command_id: command.command_id, backend_id: command.input.backend_id, actor }),
          backend_id: command.input.backend_id, actor, state: "waiting-for-operator", verification_url: "https://auth.openai.com/codex/device", user_code: "ABCD-EFGH", failure: null };
        login.set(command.command_id, item); receipts.set(command.command_id, item); return structuredClone(item);
      }
      if (command.action === "account.login.cancel") {
        const item = login.get(command.input.login_command_id); item.state = "cancelled"; item.user_code = null; item.verification_url = null;
        return structuredClone(item);
      }
      if (command.expected_revision !== revision) throw new ModelOwnerError("revision-conflict", { status: 409, responseKnown: true });
      revision += 1;
      const config = structuredClone(snapshots.at(-1)); config.backends[command.input.backend_id] = { backend_id: command.input.backend_id };
      snapshots.push(config);
      const receipt = { command_id: command.command_id, command_digest: digest({ actor, command }), actor, action: command.action,
        previous_revision: revision - 1, revision, configuration_digest: digest(config) };
      receipt.receipt_digest = digest(receipt); receipts.set(command.command_id, receipt); return structuredClone(receipt);
    },
    async login({ commandId }) { return structuredClone(login.get(commandId)); },
  };
}
async function fixture(t, platform = owner()) {
  const root = await mkdtemp(path.join(os.tmpdir(), "oos-model-operations-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = createModelProfileRequestStore({ root });
  const service = createModelOperationsService({ store, platform, operatorBindings: { console: operatorId, other: operatorId } });
  t.after(() => service.idle());
  return { service, store, platform, root };
}
const read = (service, id = "test:one") => service.get({ ...identity, requestId: id });
const control = (service, record, action, id = action) => service.control({ ...identity, requestId: record.request_id, input: { control_id: id, expected_revision: record.revision, action } });

test("model operation preserves immutable intent, receipt and historical readback across later edits", async t => {
  const { service, platform } = await fixture(t);
  await service.create({ ...identity, input: request() }); await service.idle();
  const record = await read(service);
  assert.equal(record.state, "completed"); assert.equal(record.owner_receipt.revision, 1);
  await platform.command({ operatorId, command: { command_id: "independent", expected_revision: 1, action: "backend.register", input: { backend_id: "other" } } });
  const replay = await service.create({ ...identity, input: request() });
  assert.deepEqual(replay.owner_receipt, record.owner_receipt); assert.equal(platform.calls.length, 2);
  assert.equal((await service.registry(identity)).configuration.revision, 2);
  await assert.rejects(service.create({ ...identity, input: request("test:one", { input: { backend_id: "other" } }) }), { code: "model_operations_idempotency_conflict" });
  await assert.rejects(service.get({ callerId: "other", operatorId, requestId: "test:one" }), { statusCode: 404 });
  await assert.rejects(service.registry({ ...identity, operatorId: "operator:other" }), { statusCode: 403 });
});

test("lost owner response reconciles same command after service restart and later edits", async t => {
  const platform = owner(), apply = platform.command.bind(platform); let lose = true;
  platform.command = async input => { const result = await apply(input); if (lose) { lose = false; throw new ModelOwnerError("owner-transport-unknown"); } return result; };
  const { service, store } = await fixture(t, platform);
  await service.create({ ...identity, input: request() }); await service.idle();
  const uncertain = await read(service); assert.equal(uncertain.state, "unknown");
  await assert.rejects(control(service, uncertain, "retry"), { code: "model_operations_retry_not_safe" });
  await assert.rejects(control(service, uncertain, "cancel"), { code: "model_operations_cancellation_unconfirmed" });
  await apply({ operatorId, command: { command_id: "later", expected_revision: 1, action: "backend.register", input: { backend_id: "later" } } });
  const resumed = createModelOperationsService({ store, platform, operatorBindings: { console: operatorId } });
  await control(resumed, uncertain, "reconcile"); await resumed.idle();
  const complete = await read(resumed); assert.equal(complete.state, "completed");
  assert.equal(complete.applied_configuration.revision, 1); assert.equal(complete.applied_configuration.current_revision, 2);
  assert.equal(platform.calls[0].command_id, platform.calls.at(-1).command_id); assert.equal(platform.snapshots.length, 3);
});

test("known pre-effect failure permits explicit next attempt, while stale configuration requires correction", async t => {
  const platform = owner(), apply = platform.command.bind(platform); let unavailable = true;
  platform.command = async input => {
    if (unavailable) { unavailable = false; platform.calls.push(input.command); throw new ModelOwnerError("provider-unavailable", { responseKnown: true }); }
    return apply(input);
  };
  const { service } = await fixture(t, platform);
  await service.create({ ...identity, input: request() }); await service.idle();
  const failed = await read(service); assert.equal(failed.state, "retryable");
  await control(service, failed, "retry"); await service.idle();
  const done = await read(service); assert.equal(done.state, "completed"); assert.equal(done.attempt, 2);
  assert.notEqual(platform.calls[0].command_id, platform.calls[1].command_id);
  await service.create({ ...identity, input: request("test:stale") }); await service.idle();
  const stale = await read(service, "test:stale"); assert.equal(stale.state, "rejected"); assert.equal(stale.failure.code, "revision-conflict");
});

test("a receipt survives failed readback and recovery never submits a second mutation", async t => {
  const platform = owner(), snapshot = platform.configuration; let fail = true;
  platform.configuration = async input => { if (fail) { fail = false; throw new ModelOwnerError("owner-transport-unknown"); } return snapshot(input); };
  const { service } = await fixture(t, platform);
  await service.create({ ...identity, input: request() }); await service.idle();
  const pending = await read(service); assert.equal(pending.state, "unknown"); assert.equal(pending.owner_receipt.revision, 1);
  await control(service, pending, "reconcile"); await service.idle();
  assert.equal((await read(service)).state, "completed"); assert.equal(platform.calls.length, 1);
});

test("tampered owner receipt is blocked without projecting completion or issuing fallback", async t => {
  const platform = owner(), apply = platform.command.bind(platform);
  platform.command = async input => ({ ...await apply(input), actor: "operator:intruder" });
  const { service } = await fixture(t, platform);
  await service.create({ ...identity, input: request() }); await service.idle();
  const record = await read(service); assert.equal(record.state, "blocked"); assert.equal(record.owner_receipt, null); assert.equal(platform.calls.length, 1);
});

test("native account progress and cancellation retain the original owner login binding", async t => {
  const { service, platform } = await fixture(t);
  await service.create({ ...identity, input: request("test:one", { action: "account.login.start", input: { backend_id: "codex" } }) }); await service.idle();
  const waiting = await read(service); assert.equal(waiting.state, "awaiting-account"); assert.equal(waiting.account_login.user_code, "ABCD-EFGH");
  await control(service, waiting, "cancel"); await service.idle();
  const cancelled = await read(service); assert.equal(cancelled.state, "cancelled"); assert.equal(cancelled.account_login.command_id, waiting.owner_command_id);
  assert.equal(platform.calls[1].input.login_command_id, waiting.owner_command_id);
  assert.equal(cancelled.account_login.user_code, null);
});

test("queued cancellation is honest and control replay cannot cancel another caller's request", async t => {
  const platform = owner(), apply = platform.command.bind(platform);
  let release; const gate = new Promise(resolve => { release = resolve; });
  platform.command = async input => { await gate; return apply(input); };
  const { service } = await fixture(t, platform);
  await service.create({ ...identity, input: request() });
  const queued = await service.create({ ...identity, input: request("test:two") });
  await assert.rejects(service.control({ callerId: "other", operatorId, requestId: queued.request_id, input: { control_id: "bad", expected_revision: queued.revision, action: "cancel" } }), { statusCode: 404 });
  const cancelled = await control(service, queued, "cancel"); assert.equal(cancelled.state, "cancelled");
  assert.equal((await control(service, queued, "cancel")).state, "cancelled");
  release(); await service.idle(); assert.equal(platform.calls.length, 1);
});

test("owner projections reject secret-bearing extra fields instead of forwarding raw metadata", () => {
  assert.throws(() => assertBackends({ tasks: [], backends: [], token: "secret" }), { statusCode: 502 });
  const config = { backends: {}, models: {}, default: null, overrides: {}, credential: "secret" };
  assert.throws(() => assertConfiguration({ revision: 0, current_revision: 0, digest: digest(config), configuration: config, history: [] }), { statusCode: 502 });
});

test("Platform client uses only configured endpoint/credential and sanitizes transport and provider errors", async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), "oos-model-client-")); t.after(() => rm(root, { recursive: true, force: true }));
  const tokenFile = path.join(root, "management-token"); await writeFile(tokenFile, "private-management-token\n", { mode: 0o600 });
  const calls = [];
  const client = createModelOperationsPlatformClient({ baseUrl: "http://owner.test:8000", tokenFile,
    fetchImpl: async (url, options) => { calls.push({ url, options }); return new Response(JSON.stringify({ error: "provider-unavailable", message: "secret-account-data" }), { status: 503 }); } });
  await assert.rejects(client.backends({ operatorId }), error => error instanceof ModelOwnerError && error.responseKnown && !error.message.includes("secret"));
  assert.equal(calls[0].url.origin, "http://owner.test:8000"); assert.equal(calls[0].options.headers.authorization, "Bearer private-management-token");
  assert.equal(calls[0].options.headers["X-Platform-Operator"], operatorId);
});

async function invoke(app, { url, method = "GET", body, operator = operatorId, secret = "console-secret" }) {
  const stream = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
  Object.assign(stream, { url, method, headers: { "x-oos-caller-id": callerId, "x-oos-caller-secret": secret, ...(operator ? { "x-oos-operator-id": operator } : {}) } });
  let code, payload;
  await app(stream, { writeHead(value) { code = value; }, end(value) { payload = value; } });
  return { code, body: payload ? JSON.parse(payload) : null };
}

test("model operations HTTP API binds reads and writes, routes progress, and does not accept credentials in intent", async t => {
  const { service } = await fixture(t);
  const config = loadConfig({ CALLER_ALLOWED_IDS: callerId, CALLER_AUTH_SECRETS_JSON: JSON.stringify({ [callerId]: "console-secret" }) });
  const app = createApp({ config, modelOperationsService: service });
  assert.equal((await invoke(app, { url: "/v1/model-operations/registry" })).code, 200);
  assert.equal((await invoke(app, { url: "/v1/model-operations/registry", operator: null })).code, 400);
  assert.equal((await invoke(app, { url: "/v1/model-operations/registry", secret: "incorrect" })).code, 401);
  assert.equal((await invoke(createApp({ config }), { url: "/v1/model-operations/registry" })).code, 503);
  const bad = await invoke(app, { url: "/v1/model-operations/requests", method: "POST", body: { ...request(), token: "should-never-be-forwarded" } });
  assert.equal(bad.code, 400);
  const accepted = await invoke(app, { url: "/v1/model-operations/requests", method: "POST", body: request() });
  assert.equal(accepted.code, 202); await service.idle();
  const readback = await invoke(app, { url: "/v1/model-operations/requests/test%3Aone" });
  assert.equal(readback.code, 200); assert.equal(readback.body.state, "completed");
  assert.equal((await invoke(app, { url: "/v1/model-operations/requests?limit=1" })).body.requests.length, 1);
});

test("runtime is disabled by default and commissioning does not accept another profile or missing authority bindings", () => {
  assert.equal(loadConfig({}).modelOperations.enabled, false);
  assert.equal(createModelOperationsRuntime({ config: loadConfig({}).modelOperations }), null);
  const enabled = { enabled: true, profile: "dev-integration", stateRoot: "/private/model-operations", platformBaseUrl: "http://owner.test", managementTokenFile: "/private/model-management-token", operatorBindings: { console: operatorId } };
  assert.throws(() => createModelOperationsRuntime({ config: { ...enabled, profile: "stage" } }), { statusCode: 503 });
  assert.throws(() => createModelOperationsRuntime({ config: { ...enabled, managementTokenFile: "" } }), { statusCode: 503 });
  assert.throws(() => createModelOperationsRuntime({ config: { ...enabled, operatorBindings: {} } }), { statusCode: 503 });
  assert.ok(createModelOperationsRuntime({ config: enabled }));
});

test("after restart a retained dispatch shows reconciliation, and stale control revisions cannot change it", async t => {
  const { service, store, platform } = await fixture(t);
  await service.create({ ...identity, input: request() }); await service.idle();
  await store.transact(async tx => { const record = tx.get("test:one"); record.state = "running"; record.owner_receipt = null; await tx.put(record); });
  const restarted = createModelOperationsService({ store, platform, operatorBindings: { console: operatorId } });
  const record = await read(restarted); assert.equal(record.next_action, "reconcile-original-operation");
  await assert.rejects(control(restarted, { ...record, revision: 1 }, "reconcile"), { code: "model_operations_revision_conflict" });
  await control(restarted, record, "reconcile"); await restarted.idle(); assert.equal((await read(restarted)).state, "completed");
});

test("effective selection keeps actual ordered fallback/native effort and rejects another task or ambiguous success", () => {
  const evidence = { revision: 4, configuration_digest: `sha256:${"a".repeat(64)}`, task: "profile/task", selection_ref: `ai-routing-selection:${"b".repeat(64)}`,
    attempts: [{ backend_id: "codex", model: "test-primary", effort: "high", outcome: "provider-unavailable" },
      { backend_id: "local", model: "test-fallback", effort: false, outcome: "suggestion-produced" }] };
  const result = { output: { text: "Unchanged task output." }, effective_selection: evidence };
  assert.deepEqual(selectionEvidence(result, { profileId: "profile", taskKind: "task" }), { effective_selection: evidence });
  assert.deepEqual(result.output, { text: "Unchanged task output." });
  assert.deepEqual(selectionEvidence({ output: {} }, { profileId: "profile", taskKind: "task" }), {});
  assert.throws(() => selectionEvidence(result, { profileId: "other", taskKind: "task" }), { statusCode: 502 });
  assert.throws(() => selectionEvidence({ ...result, effective_selection: { ...evidence, access_token: "must-not-propagate" } }, { profileId: "profile", taskKind: "task" }), { statusCode: 502 });
  const ambiguous = structuredClone(result); ambiguous.effective_selection.attempts[0].outcome = "provider-completion-unknown";
  assert.throws(() => selectionEvidence(ambiguous, { profileId: "profile", taskKind: "task" }), { statusCode: 502 });
});

test("queuing reconciliation never makes an uncertain prior effect safe to cancel", async t => {
  const platform = owner(), apply = platform.command.bind(platform); let lose = true;
  let release, entered;
  const gate = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { entered = resolve; });
  platform.command = async input => {
    if (input.command.input.backend_id === "slow") { entered(); await gate; }
    const result = await apply(input);
    if (lose) { lose = false; throw new ModelOwnerError("owner-transport-unknown"); }
    return result;
  };
  const { service } = await fixture(t, platform); t.after(release);
  await service.create({ ...identity, input: request() }); await service.idle();
  const unknown = await read(service); assert.equal(unknown.state, "unknown");
  await service.create({ ...identity, input: request("test:slow", { expected_configuration_revision: 1, input: { backend_id: "slow" } }) });
  await started;
  const queued = await control(service, unknown, "reconcile"); assert.equal(queued.state, "queued");
  await assert.rejects(control(service, queued, "cancel"), { code: "model_operations_cancellation_unconfirmed" });
  release(); await service.idle(); assert.equal((await read(service)).state, "completed");
});

test("unavailable native progress is explicit uncertainty, then reconciliation uses the original login", async t => {
  const { service, platform } = await fixture(t);
  await service.create({ ...identity, input: request("test:one", { action: "account.login.start", input: { backend_id: "codex" } }) }); await service.idle();
  const waiting = await read(service); const login = platform.login;
  platform.login = async () => { throw new ModelOwnerError("owner-transport-unknown"); };
  const unknown = await read(service); assert.equal(unknown.state, "unknown"); assert.equal(unknown.next_action, "reconcile-original-operation");
  assert.equal(unknown.account_login.command_id, waiting.account_login.command_id);
  platform.login = login; await control(service, unknown, "reconcile"); await service.idle();
  assert.equal((await read(service)).state, "awaiting-account"); assert.equal(platform.calls[0].command_id, platform.calls[1].command_id);
});

test("post-start health is optional, bound to current configuration, and cannot disable management", async t => {
  const { service, platform } = await fixture(t);
  await service.create({ ...identity, input: request() }); await service.idle();
  const snapshot = await platform.configuration();
  const start = Date.now() - 1000;
  const health = { configuration_revision: snapshot.revision, configuration_digest: snapshot.digest,
    checked_at: new Date(start).toISOString(), expires_at: new Date(start + 120000).toISOString(),
    backends: [{ backend_id: "local", state: "unavailable", code: "provider-unavailable" }], models: [] };
  const backends = platform.backends.bind(platform);
  platform.backends = async () => ({ ...await backends(), health });
  assert.deepEqual((await service.registry(identity)).health, health);
  assert.equal(platform.calls.length, 1);
  health.configuration_revision++;
  assert.equal((await service.registry(identity)).health, null);
  health.configuration_revision--;
  health.token = "never forward";
  const registry = await service.registry(identity);
  assert.equal(registry.health, null); assert.equal(registry.configuration.revision, 1);
  assert.equal(JSON.stringify(registry).includes("never forward"), false);
  delete health.token;
  health.expires_at = new Date(start - 1).toISOString();
  assert.equal(assertProviderHealth(health, snapshot), null);
  platform.backends = backends;
  assert.equal((await service.registry(identity)).health, null);
});
