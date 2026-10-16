import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";

const caller = "governance-operations-console";
const config = () => loadConfig({ CALLER_ALLOWED_IDS: caller, CALLER_AUTH_SECRETS_JSON: JSON.stringify({ [caller]: "test-secret" }) });
async function invoke(app, { url = "/v1/prototype-landings", method = "POST", body = "{}", secret = "test-secret", accept = "application/json" } = {}) {
  const request = Readable.from([Buffer.from(body)]);
  Object.assign(request, { url, method, headers: { accept, "x-oos-caller-id": caller, "x-oos-caller-secret": secret } });
  let code;
  let output = "";
  await app(request, { writeHead(value) { code = value; }, end(value) { output += value ?? ""; } });
  return { code, body: JSON.parse(output) };
}

test("Prototype Landing exposes bounded prepare, submit, read, continue and cancel APIs", async () => {
  const calls = [];
  const service = {
    prepare: async (value) => { calls.push(value); return { canonical_mutation: false }; },
    submit: async (value) => { calls.push(value); return { status: "accepted" }; },
    project: async (id, options) => { calls.push({ id, ...options }); return { status: "accepted" }; },
    advance: async (value) => { calls.push(value); return { status: "review-required" }; },
  };
  const app = createApp({ config: config(), prototypeLandingService: service });
  assert.equal((await invoke(app, { url: "/v1/prototype-landings/preparations", body: '{"prototype_id":"prototype:test"}' })).code, 200);
  assert.equal((await invoke(app)).code, 202);
  assert.equal((await invoke(app, { url: "/v1/prototype-landings/prototype-landing-request%3Atest", method: "GET", body: "" })).code, 200);
  for (const action of ["continue", "cancel"]) {
    assert.equal((await invoke(app, { url: `/v1/prototype-landings/prototype-landing-request%3Atest/${action}` })).code, 200);
  }
  assert.ok(calls.every((call) => call.callerId === caller));
  assert.equal(calls[4].action, "cancel");
  assert.equal(calls[4].requestId, "prototype-landing-request:test");
  assert.equal((await invoke(app, { url: "/v1/prototype-landings/test/cancel", body: '{"force":true}' })).code, 400);
});

test("canonical Prototype records GET is authenticated, read-only, source-bound and unavailable without its owner", async () => {
  const records = { schema_version: 1, workflow_id: "prototype-records", authority_revision: "a".repeat(40), authority_sequence: 7, registry: { prototypes: [] }, captures: [], documents: {}, canonical_mutation: false };
  let reads = 0;
  const app = createApp({ config: config(), prototypeLandingService: { records: async () => { reads += 1; return records; } } });
  const request = { url: "/v1/prototypes", method: "GET", body: "" };
  const legacy = await invoke(app, request);
  assert.deepEqual(legacy.body, { ...records, workflows: { landing: [], maturity: [], closure: [] }, workflow_sources: { landing: "unavailable", maturity: "unavailable", closure: "unavailable" } });
  const canonical = await invoke(app, { ...request, accept: "application/vnd.mfshaf7.console-source-projection+json; version=1" });
  assert.equal(canonical.code, 200);
  assert.equal(canonical.body.binding.source_owner, "workspace-prototype-studio");
  assert.ok(canonical.body.revision.event_sequence > 0);
  assert.deepEqual(canonical.body.projection, legacy.body);
  assert.equal((await invoke(app, { ...request, secret: "wrong" })).code, 401);
  assert.equal(reads, 2);
  assert.equal((await invoke(createApp({ config: config() }), request)).code, 503);
});

test("Prototype Landing denies inactive runtime, wrong credentials and shared-secret fallback", async () => {
  assert.equal((await invoke(createApp({ config: config() }))).code, 503);
  assert.equal((await invoke(createApp({ config: config() }), { secret: "wrong" })).code, 401);
  const shared = loadConfig({ CALLER_ALLOWED_IDS: caller, CALLER_AUTH_SHARED_SECRET: "test-secret" });
  assert.equal((await invoke(createApp({ config: shared, prototypeLandingService: { submit() { throw new Error("must not execute"); } } }))).code, 403);
});
