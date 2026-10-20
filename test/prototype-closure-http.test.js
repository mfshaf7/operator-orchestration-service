import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";

const caller = "governance-operations-console";
const wgcfCaller = "workspace-governance-control-fabric";
const config = () => loadConfig({
  CALLER_ALLOWED_IDS: `${caller},${wgcfCaller}`,
  CALLER_AUTH_SECRETS_JSON: JSON.stringify({ [caller]: "test-secret", [wgcfCaller]: "wgcf-secret" }),
});

async function invoke(app, { url = "/v1/prototype-closures/requests", method = "POST", body = "{}",
  secret = "test-secret", callerId = caller, headers = {} } = {}) {
  const request = Readable.from([Buffer.from(body)]);
  Object.assign(request, {
    url, method,
    headers: { "x-oos-caller-id": callerId, "x-oos-caller-secret": secret, ...headers },
  });
  let code;
  let output = "";
  await app(request, {
    writeHead(value) { code = value; },
    end(value) { output += value ?? ""; },
  });
  return { code, body: JSON.parse(output) };
}

test("Prototype Closure routes caller-bound workflow commands", async () => {
  const calls = [];
  const service = {
    prepare: async (value) => { calls.push(value); return { canonical_mutation: false }; },
    submit: async (value) => { calls.push(value); return { status: "accepted" }; },
    project: async (id, options) => { calls.push({ id, ...options }); return { status: "decision-required" }; },
    decide: async (value) => { calls.push(value); return { status: "reconciling" }; },
    advance: async (value) => { calls.push(value); return { status: "review-required" }; },
  };
  const app = createApp({ config: config(), prototypeClosureService: service });
  const id = "prototype-closure-request%3Asample%3Aapply-delivery";
  assert.equal((await invoke(app, { url: "/v1/prototype-closures/preparations", body: '{"prototype_id":"sample"}' })).code, 200);
  assert.equal((await invoke(app)).code, 202);
  assert.equal((await invoke(app, { url: `/v1/prototype-closures/requests/${id}`, method: "GET", body: "" })).code, 200);
  assert.equal((await invoke(app, { url: `/v1/prototype-closures/requests/${id}/decisions`, body: '{"decision":"approve"}' })).code, 200);
  assert.equal((await invoke(app, { url: `/v1/prototype-closures/requests/${id}/continue` })).code, 200);
  assert.equal((await invoke(app, { url: `/v1/prototype-closures/requests/${id}/cancel` })).code, 200);
  assert.ok(calls.every((value) => value.callerId === caller));
  assert.equal(calls[0].input.prototype_id, "sample");
  assert.equal(calls[2].id, "prototype-closure-request:sample:apply-delivery");
});

test("Closure canonical GET binds the plain prototype subject and retained phase", async () => {
  const retained = { prototype_id: "sample-tool", status: "evaluating", revision: 3,
    failure: { code: "prototype_closure_readiness_unavailable", retryable: true },
    history: [{ at: new Date().toISOString() }] };
  const app = createApp({ config: config(), prototypeClosureService: {
    async project() { return retained; },
  } });
  const result = await invoke(app, {
    url: "/v1/prototype-closures/requests/prototype-closure-request%3Asample-tool%3A123",
    method: "GET", body: "",
    headers: { accept: "application/vnd.mfshaf7.console-source-projection+json; version=1" },
  });
  assert.equal(result.code, 200);
  assert.equal(result.body.binding.record_ref, "prototype://sample-tool");
  assert.equal(result.body.binding.source_owner, "workspace-prototype-studio");
  assert.deepEqual(result.body.projection, retained);
});

test("Prototype Closure remains inactive by default and rejects malformed or unauthenticated commands", async () => {
  assert.equal((await invoke(createApp({ config: config() }))).code, 503);
  const app = createApp({ config: config(), prototypeClosureService: { advance() { throw new Error("must not execute"); } } });
  assert.equal((await invoke(app, { url: "/v1/prototype-closures/requests/test/continue", body: '{"force":true}' })).code, 400);
  assert.equal((await invoke(app, { secret: "wrong" })).code, 401);
});

test("Closure owner readback is WGCF-only, caller-bound, and inactive without a reader", async () => {
  const url = "/v1/prototype-closures/owner-readbacks";
  const body = '{"field":"accepted_baseline_receipt_ref","prototype_id":"sample-tool","ref":"oos://receipts/baseline/1","source_revision":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}';
  assert.equal((await invoke(createApp({ config: config() }), {
    url, body, callerId: wgcfCaller, secret: "wgcf-secret",
  })).code, 503);
  const calls = [];
  const app = createApp({ config: config(), prototypeClosureOwnerReadbackService: {
    async read(input) { calls.push(input); return { ref: input.ref, state: "accepted" }; },
  } });
  assert.equal((await invoke(app, { url, body })).code, 403);
  assert.equal((await invoke(app, { url, body, callerId: wgcfCaller, secret: "wrong" })).code, 401);
  const result = await invoke(app, { url, body, callerId: wgcfCaller, secret: "wgcf-secret" });
  assert.equal(result.code, 200);
  assert.equal(result.body.state, "accepted");
  assert.equal(calls.length, 1);
});
