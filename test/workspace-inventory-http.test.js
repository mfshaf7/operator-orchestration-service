import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";

const caller = "governance-operations-console";
function config(shared = false) {
  return loadConfig({
    CALLER_ALLOWED_IDS: caller,
    ...(shared
      ? { CALLER_AUTH_SHARED_SECRET: "test-secret" }
      : { CALLER_AUTH_SECRETS_JSON: JSON.stringify({ [caller]: "test-secret" }) }),
  });
}

async function invoke(app, {
  url = "/v1/workspace-inventory/promotions",
  method = "POST",
  body = "{}",
  secret = "test-secret",
} = {}) {
  const request = Readable.from([Buffer.from(body)]);
  Object.assign(request, {
    url,
    method,
    headers: { "x-oos-caller-id": caller, "x-oos-caller-secret": secret },
  });
  let code;
  let output = "";
  await app(request, {
    writeHead(value) { code = value; },
    end(value) { output += value ?? ""; },
  });
  return { code, body: JSON.parse(output) };
}

test("Workspace Inventory exposes bounded prepare, submit, read, continue and cancel APIs", async () => {
  const calls = [];
  const service = {
    registry: async (input) => { calls.push(input); return { canonical_mutation: false }; },
    prepare: async (input) => { calls.push(input); return { canonical_mutation: false }; },
    submit: async (input) => { calls.push(input); return { status: "accepted" }; },
    advance: async (input) => { calls.push(input); return { status: "review-required" }; },
    project: async (id, options) => { calls.push({ id, ...options }); return { status: "accepted" }; },
  };
  const app = createApp({ config: config(), workspaceInventoryService: service });
  assert.equal((await invoke(app, { url: "/v1/workspace-inventory/registry", method: "GET", body: "" })).code, 200);
  assert.equal((await invoke(app, { url: "/v1/workspace-inventory/preparations" })).code, 200);
  assert.equal((await invoke(app)).code, 202);
  assert.equal((await invoke(app, { url: "/v1/workspace-inventory/promotions/inventory-request%3Atest", method: "GET", body: "" })).code, 200);
  for (const action of ["continue", "cancel"]) {
    assert.equal((await invoke(app, { url: `/v1/workspace-inventory/promotions/inventory-request%3Atest/${action}` })).code, 200);
  }
  assert.ok(calls.every((call) => call.callerId === caller));
  assert.equal(calls[5].action, "cancel");
  assert.equal(calls[5].requestId, "inventory-request:test");
  assert.equal((await invoke(app, { body: '{"a":1,"a":2}' })).code, 400);
  assert.equal((await invoke(app, { body: JSON.stringify({ text: "x".repeat(65536) }) })).code, 413);
  assert.equal((await invoke(app, { url: "/v1/workspace-inventory/promotions/test/cancel", body: '{"force":true}' })).code, 400);
});

test("registry reads require caller-bound identity but not mutation authority", async () => {
  const service = {
    registry: async ({ callerId }) => ({ callerId, canonical_mutation: false }),
  };
  const readOnlyConfig = loadConfig({
    CALLER_ALLOWED_IDS: "registry-reader",
    CALLER_AUTH_SECRETS_JSON: JSON.stringify({ "registry-reader": "reader-secret" }),
  });
  const request = Readable.from([]);
  Object.assign(request, {
    url: "/v1/workspace-inventory/registry",
    method: "GET",
    headers: { "x-oos-caller-id": "registry-reader", "x-oos-caller-secret": "reader-secret" },
  });
  let code;
  let output = "";
  await createApp({ config: readOnlyConfig, workspaceInventoryService: service })(request, {
    writeHead(value) { code = value; },
    end(value) { output += value ?? ""; },
  });
  assert.equal(code, 200);
  assert.equal(JSON.parse(output).callerId, "registry-reader");
});

test("unconfigured runtime, wrong credential and shared-secret fallback cannot invoke inventory promotion", async () => {
  assert.equal((await invoke(createApp({ config: config() }))).code, 503);
  assert.equal((await invoke(createApp({ config: config(), workspaceInventoryService: {} }), { secret: "wrong" })).code, 401);
  assert.equal((await invoke(createApp({ config: config(true), workspaceInventoryService: { submit() { throw new Error("must not execute"); } } }))).code, 403);
});
