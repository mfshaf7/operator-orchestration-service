import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";

const caller = "governance-operations-console";
const config = () =>
  loadConfig({
    CALLER_ALLOWED_IDS: caller,
    CALLER_AUTH_SECRETS_JSON: JSON.stringify({ [caller]: "test-secret" }),
  });

async function invoke(app, {
  url = "/v1/prototype-maturity/requests",
  method = "POST",
  body = "{}",
  secret = "test-secret",
} = {}) {
  const request = Readable.from([Buffer.from(body)]);
  Object.assign(request, {
    url,
    method,
    headers: {
      "x-oos-caller-id": caller,
      "x-oos-caller-secret": secret,
    },
  });
  let code;
  let output = "";
  await app(request, {
    writeHead(value) {
      code = value;
    },
    end(value) {
      output += value ?? "";
    },
  });
  return { code, body: JSON.parse(output) };
}

test("Prototype Maturity exposes prepare, submit, decision, read, continue and cancel", async () => {
  const calls = [];
  const service = {
    prepare: async (value) => { calls.push(value); return { canonical_mutation: false }; },
    submit: async (value) => { calls.push(value); return { status: "accepted" }; },
    decide: async (value) => { calls.push(value); return { status: "preparing" }; },
    project: async (id, options) => { calls.push({ id, ...options }); return { status: "decision-required" }; },
    advance: async (value) => { calls.push(value); return { status: "review-required" }; },
  };
  const app = createApp({ config: config(), prototypeMaturityService: service });
  assert.equal((await invoke(app, { url: "/v1/prototype-maturity/preparations", body: '{"prototype_id":"prototype:test","transition":"candidate-promotion"}' })).code, 200);
  assert.equal((await invoke(app)).code, 202);
  const id = "prototype-maturity-request%3Atest%3A1";
  assert.equal((await invoke(app, { url: `/v1/prototype-maturity/requests/${id}`, method: "GET", body: "" })).code, 200);
  assert.equal((await invoke(app, { url: `/v1/prototype-maturity/requests/${id}/decisions`, body: '{"decision":"promote-candidate"}' })).code, 200);
  for (const action of ["continue", "cancel"]) {
    assert.equal((await invoke(app, { url: `/v1/prototype-maturity/requests/${id}/${action}` })).code, 200);
  }
  assert.ok(calls.every((call) => call.callerId === caller));
  assert.equal(calls[3].requestId, "prototype-maturity-request:test:1");
  assert.equal(calls[5].action, "cancel");
});

test("Prototype Maturity denies inactive runtime and malformed empty actions", async () => {
  assert.equal((await invoke(createApp({ config: config() }))).code, 503);
  const app = createApp({
    config: config(),
    prototypeMaturityService: { advance() { throw new Error("must not execute"); } },
  });
  assert.equal((await invoke(app, { url: "/v1/prototype-maturity/requests/test/cancel", body: '{"force":true}' })).code, 400);
});
