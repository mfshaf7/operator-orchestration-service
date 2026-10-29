import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import test from "node:test";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createSavedWorkStore } from "../src/saved-work/store.js";

const caller = "governance-operations-console", operator = "operator:test";
function setup(t, shared = false) {
  const root = mkdtempSync(path.join(tmpdir(), "saved-work-http-")); t.after(() => rmSync(root, { recursive: true, force: true }));
  const config = loadConfig({ CALLER_ALLOWED_IDS: caller,
    ...(shared ? { CALLER_AUTH_SHARED_SECRET: "test-secret" } : { CALLER_AUTH_SECRETS_JSON: JSON.stringify({ [caller]: "test-secret" }) }),
    OOS_DELIVERY_WORK_SESSION_CALLER_OPERATOR_BINDINGS_JSON: JSON.stringify({ [caller]: operator }) });
  return createApp({ config, savedWorkService: createSavedWorkStore({ root }) });
}
async function invoke(app, { method = "GET", body, secret = "test-secret", operatorId = operator, query = "", accept = "application/json" } = {}) {
  const request = Readable.from(body ? [Buffer.from(typeof body === "string" ? body : JSON.stringify(body))] : []);
  Object.assign(request, { method, url: `/v1/operator-saved-work/refinement/delivery-42${query}`, headers: {
    "x-oos-caller-id": caller, "x-oos-caller-secret": secret, "x-oos-operator-id": operatorId, accept,
  } });
  let status, headers, output = "";
  await app(request, { writeHead(code, value) { status = code; headers = value; }, end(value) { output += value ?? ""; } });
  return { status, headers, body: JSON.parse(output) };
}
const command = () => ({ command_id: "save-1", expected_revision: 0, origin: "operator-edit", payload_json: JSON.stringify({ schemaVersion: 1, packageId: "delivery-42", metadata: { draftValues: {} } }) });

test("actual saved-work API saves, restarts reads and preserves raw browser records", async t => {
  const app = setup(t); assert.equal((await invoke(app)).body.record, null);
  const first = await invoke(app, { method: "POST", body: command() }); assert.equal(first.status, 200); assert.equal(first.body.record.revision, 1);
  const projection = await invoke(app); assert.deepEqual(projection.body.record, first.body.record);
  const original = { storage_key: "delivery-refinement-session:delivery-42:v1", raw_value: "old-raw" };
  const saved = await invoke(app, { method: "POST", body: original, query: "?action=preserve" }); assert.equal(saved.status, 200);
  const recovery = await invoke(app, { query: `?recovery_id=${saved.body.recoveries[0].recovery_id}` }); assert.deepEqual(recovery.body.recovery, original);
});
test("saved-work reads and writes require caller-specific credentials and bound operator", async t => {
  const app = setup(t);
  assert.equal((await invoke(app, { secret: "wrong" })).status, 401);
  assert.equal((await invoke(app, { operatorId: "operator:other" })).status, 403);
  assert.equal((await invoke(app, { operatorId: "" })).status, 403);
  assert.equal((await invoke(setup(t, true))).status, 403);
});
test("duplicate transport keys and concurrent stale saves fail before replacement", async t => {
  const app = setup(t);
  assert.equal((await invoke(app, { method: "POST", body: '{"command_id":"one","command_id":"two"}' })).status, 400);
  assert.equal((await invoke(app, { method: "POST", body: command() })).status, 200);
  const stale = await invoke(app, { method: "POST", body: { ...command(), command_id: "other" } }); assert.equal(stale.status, 409);
  assert.equal((await invoke(app)).body.record.revision, 1);
});
test("native GET supports the standard canonical source envelope", async t => {
  const app = setup(t); const read = await invoke(app, { accept: "application/vnd.mfshaf7.console-source-projection+json;version=1" });
  assert.equal(read.status, 200); assert.equal(read.body.artifact_type, "console-source-projection");
  assert.equal(read.body.binding.record_ref, "oos://operator-saved-work/refinement/delivery-42");
  assert.equal(read.body.binding.source_owner, "operator-orchestration-service");
  assert.equal(read.body.projection.record, null);
});
