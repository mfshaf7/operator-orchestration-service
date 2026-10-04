import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";

const caller = "governance-operations-console";
const config = () => loadConfig({ CALLER_ALLOWED_IDS: caller, CALLER_AUTH_SECRETS_JSON: JSON.stringify({ [caller]: "test-secret" }) });
async function invoke(app, { url = "/v1/proposal-target-applications", method = "POST", body = "{}", secret = "test-secret" } = {}) {
  const request = Readable.from([Buffer.from(body)]);
  Object.assign(request, { url, method, headers: { "x-oos-caller-id": caller, "x-oos-caller-secret": secret } });
  let code; let output = "";
  await app(request, { writeHead(value) { code = value; }, end(value) { output += value ?? ""; } });
  return { code, body: JSON.parse(output) };
}

test("Proposal target application exposes bounded prepare, submit, read, continue and cancel APIs", async () => {
  const calls = [];
  const service = {
    prepare: async (value) => { calls.push(value); return { canonical_mutation: false }; },
    submit: async (value) => { calls.push(value); return { status: "accepted" }; },
    project: async (id, options) => { calls.push({ id, ...options }); return { status: "accepted", revision: 1, history: [{ at: "2026-10-04T18:00:00Z" }] }; },
    advance: async (value) => { calls.push(value); return { status: "review-required" }; },
  };
  const app = createApp({ config: config(), proposalTargetApplicationService: service });
  assert.equal((await invoke(app, { url: "/v1/proposal-target-applications/preparations", body: '{"proposal_id":"idea-851","prototype_id":"prototype:sample"}' })).code, 200);
  assert.equal((await invoke(app)).code, 202);
  assert.equal((await invoke(app, { url: "/v1/proposal-target-applications/proposal-prototype-application%3Asample%3A1", method: "GET", body: "" })).code, 200);
  for (const action of ["continue", "cancel"]) assert.equal((await invoke(app, { url: `/v1/proposal-target-applications/proposal-prototype-application%3Asample%3A1/${action}` })).code, 200);
  assert.ok(calls.every((call) => call.callerId === caller));
  assert.equal(calls[4].action, "cancel");
  assert.equal((await invoke(app, { url: "/v1/proposal-target-applications/test/cancel", body: '{"force":true}' })).code, 400);
});

test("Proposal target application denies inactive runtime and wrong credentials", async () => {
  assert.equal((await invoke(createApp({ config: config() }))).code, 503);
  assert.equal((await invoke(createApp({ config: config(), proposalTargetApplicationService: { submit() { throw new Error("must not execute"); } } }), { secret: "wrong" })).code, 401);
});
