import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";

const caller = "governance-operations-console";
const prototypeCaller = "workspace-prototype-studio";
function config(shared = false) {
  return loadConfig({
    CALLER_ALLOWED_IDS: `${caller},${prototypeCaller}`,
    ...(shared
      ? { CALLER_AUTH_SHARED_SECRET: "test-secret" }
      : { CALLER_AUTH_SECRETS_JSON: JSON.stringify({ [caller]: "test-secret", [prototypeCaller]: "prototype-secret" }) }),
  });
}
async function invoke(app, { url = "/v1/workspace-intake/requests", method = "POST", body = "{}", callerId = caller, secret = "test-secret" } = {}) {
  const request = Readable.from([Buffer.from(body)]);
  Object.assign(request, { url, method, headers: { "x-oos-caller-id": callerId, "x-oos-caller-secret": secret } });
  let code; let output = "";
  await app(request, { writeHead(value) { code = value; }, end(value) { output += value ?? ""; } });
  return { code, body: JSON.parse(output) };
}
test("Workspace Intake has bounded caller-bound prepare, submit, read, continue and cancel APIs", async () => {
  const calls = [];
  const service = {
    attest: async (input) => { calls.push(input); return { candidate: { candidate_digest: "sha256:attested" } }; },
    prepare: async (input) => { calls.push(input); return { canonical_mutation: false }; },
    submit: async (input) => { calls.push(input); return { status: "accepted" }; },
    advance: async (input) => { calls.push(input); return { status: "review-required" }; },
    project: async (id, options) => { calls.push({ id, ...options }); return { status: "accepted" }; },
  };
  const app = createApp({ config: config(), workspaceIntakeService: service });
  assert.equal((await invoke(app, { url: "/v1/workspace-intake/source-candidates", callerId: prototypeCaller, secret: "prototype-secret" })).code, 201);
  assert.equal((await invoke(app, { url: "/v1/workspace-intake/preparations", body: '{"target":{"kind":"product","name":"intake-proof"}}' })).code, 200);
  assert.equal((await invoke(app)).code, 202);
  assert.equal((await invoke(app, { url: "/v1/workspace-intake/requests/request%3Atest", method: "GET", body: "" })).code, 200);
  for (const action of ["continue", "cancel"]) assert.equal((await invoke(app, { url: `/v1/workspace-intake/requests/request%3Atest/${action}` })).code, 200);
  assert.equal(calls[0].callerId, prototypeCaller);
  assert.ok(calls.slice(1).every((call) => call.callerId === caller));
  assert.equal(calls[5].action, "cancel");
  assert.equal(calls[5].requestId, "request:test");
  assert.equal((await invoke(app, { body: '{"a":1,"a":2}' })).code, 400);
  assert.equal((await invoke(app, { body: JSON.stringify({ text: "x".repeat(65536) }) })).code, 413);
  assert.equal((await invoke(app, { url: "/v1/workspace-intake/requests/request%3Atest/cancel", body: '{"force":true}' })).code, 400);
});
test("unconfigured runtime, wrong credential and shared-secret fallback cannot invoke intake", async () => {
  assert.equal((await invoke(createApp({ config: config() }))).code, 503);
  assert.equal((await invoke(createApp({ config: config() }), { secret: "wrong" })).code, 401);
  assert.equal((await invoke(createApp({ config: config(true), workspaceIntakeService: { submit() { throw new Error("must not execute"); } } }))).code, 403);
});

test("retained request listing is authenticated, exact-selector and read-only", async () => {
  const calls = [];
  const app = createApp({ config: config(), workspaceIntakeService: {
    list: async input => { calls.push(input); return { schema_version: 1, workflow_id: "workspace-intake", records: [], revision: 0, updated_at: null, next_cursor: null }; },
    submit: () => { throw new Error("Listing must not submit."); },
  } });
  const url = "/v1/workspace-intake/requests?target_kind=repo&target_name=example-repository&custody_request_id=repository-custody-request%3Aexample";
  assert.equal((await invoke(app, { method: "GET", url, body: "" })).code, 200);
  assert.deepEqual(calls, [{ callerId: caller, input: { target: { kind: "repo", name: "example-repository" }, custody_request_id: "repository-custody-request:example" } }]);
  assert.equal((await invoke(app, { method: "GET", url: `${url}&force=true`, body: "" })).code, 400);
  assert.equal((await invoke(app, { method: "GET", url: `${url}&target_name=second`, body: "" })).code, 400);
  assert.equal((await invoke(app, { method: "GET", url, body: "", secret: "wrong" })).code, 401);
  assert.equal(calls.length, 1);
});
