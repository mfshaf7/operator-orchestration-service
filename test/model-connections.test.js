import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { Readable } from "node:stream";
import { createServer } from "node:http";
import { once } from "node:events";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createModelOperationsService } from "../src/model-operations/service.js";
import { createModelProfileRequestStore } from "../src/model-profile-request/store.js";
import { createModelOperationsPlatformClient, ModelOwnerError } from "../src/model-operations/platform-client.js";
import { assertBackends, assertCatalogue, assertConfiguration, digest } from "../src/model-operations/contracts.js";
import { API_PRESETS, assertConnections, assertConnectionOperation } from "../src/model-operations/connections.js";

const identity = { callerId: "console", operatorId: "operator:mfshaf7" };
const secret = "CONTROLLED-TEST-API-KEY";
const id = "api-" + "a".repeat(32);
const command = { command_id: "connection:test", expected_revision: 0, action: "connection.create", input: { provider: "claude-api", name: "Test connection" } };
function registry() {
  return { revision: 0, presets: Object.entries(API_PRESETS).map(([provider, value]) => ({ provider, label: value.label,
    endpoint_origin: value.origin, experimental: true, qualification: "real-account-verification-pending", catalogue_supported: provider !== "glm-api" })), connections: [] };
}
function receipt(command, actor = identity.operatorId) {
  const value = { command_id: command.command_id, command_digest: digest({ actor, command }), actor, action: command.action,
    connection_id: command.action === "connection.create" ? "api-" + digest({ actor, command: command.command_id }).slice(7, 39) : command.input.connection_id,
    previous_revision: command.expected_revision, revision: command.expected_revision + 1, state_digest: digest(registry()) };
  value.receipt_digest = digest(value); return value;
}
async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "controlled-oos-connections-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = createModelProfileRequestStore({ root }), events = [], operations = new Map();
  let writes = 0, lose = false;
  const platform = {
    async connections() { return registry(); },
    async connectionCommand({ command, operatorId }) { const result = receipt(command, operatorId); operations.set(command.command_id, result); return result; },
    async connectionCredentials({ credentials, operatorId }) {
      assert.equal(credentials.api_key, secret); writes++;
      const safe = { command_id: credentials.command_id, expected_revision: credentials.expected_revision,
        action: "connection.credentials", input: { connection_id: credentials.connection_id } };
      const result = receipt(safe, operatorId); operations.set(safe.command_id, result);
      if (lose) throw new ModelOwnerError("owner-transport-unknown");
      return result;
    },
    async connectionOperation({ commandId }) { const value = operations.get(commandId); return { command_id: value.command_id, command_digest: value.command_digest,
      actor: value.actor, action: value.action, connection_id: value.connection_id, state: "finished", receipt: value }; },
    async reconcileConnection(options) { return this.connectionOperation(options); },
  };
  const service = createModelOperationsService({ store, platform, operatorBindings: { console: identity.operatorId }, audit: { emit: x => events.push(x) } });
  const credentials = { command_id: "credentials:test", expected_revision: 0, connection_id: id, api_key: secret };
  return { service, store, platform, root, credentials, events, operations, writes: () => writes, lose: () => { lose = true; } };
}

test("bounded connection commands bind operator, source receipt and persistent Experimental maturity", async t => {
  const { service, platform } = await fixture(t);
  const value = await service.connectionCommand({ ...identity, input: command });
  assert.equal(value.command_digest, digest({ actor: identity.operatorId, command }));
  assert.equal((await service.connections(identity)).presets.every(x => x.experimental), true);
  await assert.rejects(service.connectionCommand({ ...identity, operatorId: "operator:other", input: command }), { statusCode: 403 });
  await assert.rejects(service.connectionCommand({ ...identity, input: { ...command, input: { ...command.input, endpoint: "https://untrusted.invalid" } } }), { statusCode: 400 });
  platform.connectionCommand = async () => ({ ...value, actor: "operator:other" });
  await assert.rejects(service.connectionCommand({ ...identity, input: command }), { statusCode: 502 });
  for (const change of [x => { x.presets[0].experimental = false; }, x => { x.presets[1].endpoint_origin = "https://untrusted.invalid"; },
    x => { x.presets[2].catalogue_supported = true; }, x => { x.presets.push(x.presets[0]); }]) {
    const snapshot = registry(); change(snapshot); assert.throws(() => assertConnections(snapshot), { statusCode: 502 });
  }
});

test("credential ingress remains outside OOS journals, audit and generic request queue", async t => {
  const { service, store, root, credentials, events, writes } = await fixture(t);
  const result = await service.connectionCredentials({ ...identity, input: credentials });
  assert.equal(result.action, "connection.credentials"); assert.equal(writes(), 1);
  assert.equal(JSON.stringify(result).includes(secret), false);
  assert.deepEqual(await store.list(), []);
  assert.equal(JSON.stringify(events).includes(secret), false);
  await assert.rejects(service.create({ ...identity, input: { schema_version: 1, request_id: "bad:secret", idempotency_key: "bad:secret", expected_configuration_revision: 0,
    action: "model.register", input: { backend_id: id, model: "test", api_key: secret } } }), { statusCode: 400 });
  await assert.rejects(service.connectionCredentials({ ...identity, input: { ...credentials, endpoint: "https://untrusted.invalid" } }), { statusCode: 400 });
  await assert.rejects(service.connectionCredentials({ ...identity, operatorId: "operator:other", input: credentials }), { statusCode: 403 });
  assert.equal(writes(), 1);
  for (const file of await readdir(root, { recursive: true })) {
    if (file.endsWith(".json")) assert.equal((await readFile(path.join(root, file), "utf8")).includes(secret), false);
  }
});

test("lost acknowledgement reconciles original owner operation across OOS restart without another key write", async t => {
  const { service, platform, store, credentials, writes, lose } = await fixture(t);
  lose(); await assert.rejects(service.connectionCredentials({ ...identity, input: credentials }), { code: "owner-transport-unknown" });
  assert.equal(writes(), 1);
  const restarted = createModelOperationsService({ platform, store, operatorBindings: { console: identity.operatorId } });
  const original = await restarted.connectionOperation({ ...identity, requestId: credentials.command_id });
  assert.equal(original.state, "finished");
  assert.deepEqual(await restarted.reconcileConnection({ ...identity, input: { command_id: credentials.command_id } }), original);
  assert.equal(writes(), 1);
  assert.throws(() => assertConnectionOperation({ ...original, api_key: secret }, credentials.command_id, identity.operatorId), { statusCode: 502 });
  assert.throws(() => assertConnectionOperation({ ...original, command_digest: digest("tampered") }, credentials.command_id, identity.operatorId), { statusCode: 502 });
});

async function invoke(app, url, body, headers = {}) {
  const stream = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
  Object.assign(stream, { url, method: body === undefined ? "GET" : "POST", headers: { "x-oos-caller-id": "console", "x-oos-caller-secret": "test-console-secret", "x-oos-operator-id": identity.operatorId, ...headers } });
  let code, value;
  await app(stream, { writeHead(x) { code = x; }, end(x) { value = x ? JSON.parse(x) : null; } });
  return { code, value };
}

test("normal HTTP routes expose connection lifecycle and protected ingress only to the bound caller", async t => {
  const { service, credentials, writes } = await fixture(t);
  const config = loadConfig({ CALLER_ALLOWED_IDS: "console", CALLER_AUTH_SECRETS_JSON: JSON.stringify({ console: "test-console-secret" }) });
  const app = createApp({ config, modelOperationsService: service }), base = "/v1/model-operations/connections";
  assert.equal((await invoke(app, base)).code, 200);
  assert.equal((await invoke(app, base, undefined, { "x-oos-caller-secret": "wrong" })).code, 401);
  assert.equal((await invoke(app, base + "/commands", command)).code, 200);
  assert.equal((await invoke(app, base + "/credentials", credentials, { "x-oos-operator-id": "operator:other" })).code, 403);
  assert.equal(writes(), 0);
  assert.equal((await invoke(app, base + "/credentials", credentials)).code, 200);
  const read = await invoke(app, base + "/operations/" + encodeURIComponent(credentials.command_id));
  assert.equal(read.code, 200); assert.equal(read.value.state, "finished");
  const reconcile = await invoke(app, base + "/reconcile", { command_id: credentials.command_id });
  assert.deepEqual(reconcile.value, read.value); assert.equal(writes(), 1);
});

test("owner HTTP transport rejects redirects and never forwards a native error body", async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), "controlled-owner-wire-")); t.after(() => rm(root, { recursive: true, force: true }));
  const tokenFile = path.join(root, "token"); await writeFile(tokenFile, "controlled-management-token");
  let hits = 0;
  const server = createServer(async (request, response) => {
    hits++; assert.equal(request.headers.authorization, "Bearer controlled-management-token");
    assert.equal(request.headers["x-platform-operator"], identity.operatorId);
    response.writeHead(302, { location: `http://127.0.0.1:${server.address().port}/exfiltration` }); response.end(secret);
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening"); t.after(() => { server.closeAllConnections(); server.close(); });
  const client = createModelOperationsPlatformClient({ baseUrl: `http://127.0.0.1:${server.address().port}`, tokenFile });
  await assert.rejects(client.connectionCredentials({ operatorId: identity.operatorId, credentials: { command_id: "key:wire", expected_revision: 0, connection_id: id, api_key: secret } }),
    error => error instanceof ModelOwnerError && !error.message.includes(secret));
  assert.equal(hits, 1);
});

test("cloud metadata is honestly nullable and Experimental API descriptors cannot lose qualification", () => {
  const backend = { backend_id: id, provider: "glm-api", allowed_tasks: [], registered: false, account_login_supported: false, availability: "not-probed",
    experimental: true, qualification: "real-account-verification-pending", catalogue_supported: false, verification_max_tokens: 4096 };
  assertBackends({ tasks: [], backends: [backend] });
  assert.throws(() => assertBackends({ tasks: [], backends: [{ ...backend, experimental: false }] }), { statusCode: 502 });
  assertCatalogue({ backend_id: id, models: [{ model: "glm-test", supported_efforts: [null], model_digest: null, runtime_version: null }] }, id);
  const model = { backend_id: id, model: "glm-test", supported_efforts: [null], model_digest: null, runtime_version: null, verification_ref: digest("verification") };
  const config = { backends: { [id]: { backend_id: id } }, models: { [digest({ backend_id: id, model: model.model })]: model }, default: null, overrides: {} };
  assertConfiguration({ revision: 1, current_revision: 1, digest: digest(config), history: [{ revision: 1, digest: digest(config) }], configuration: config });
});
