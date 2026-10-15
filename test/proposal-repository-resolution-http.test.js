import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";

const caller = "governance-operations-console";
const env = { CALLER_ALLOWED_IDS: `${caller},other-client`, CALLER_AUTH_SECRETS_JSON: JSON.stringify({ [caller]: "console-secret", "other-client": "other-secret" }),
  OPENPROJECT_BASE_URL: "http://backend.invalid", OPENPROJECT_API_TOKEN: "test-token", OPENPROJECT_IDEA_TYPE_ID: "1",
  OPENPROJECT_CAPTURED_STATUS_ID: "1", OPENPROJECT_TRIAGED_STATUS_ID: "2", OPENPROJECT_PARKED_STATUS_ID: "3",
  OPENPROJECT_ACCEPTED_STATUS_ID: "4", OPENPROJECT_REJECTED_STATUS_ID: "5", OPENPROJECT_CUSTOM_FIELD_SOURCE_SURFACE_ID: "1",
  OPENPROJECT_CUSTOM_FIELD_SOURCE_REFERENCE_ID: "2", OPENPROJECT_CUSTOM_FIELD_PROPOSAL_WORKFLOW_STATE_ID: "57" };

async function invoke(app, { id = caller, secret = "console-secret", body = "{}" } = {}) {
  const request = Readable.from([Buffer.from(body)]);
  Object.assign(request, { method: "POST", url: "/v1/proposals/idea-851/repository-resolution", headers: { "x-oos-caller-id": id, "x-oos-caller-secret": secret } });
  let status; let output = "";
  await app(request, { writeHead(value) { status = value; }, end(value) { output += value ?? ""; } });
  return { status, body: JSON.parse(output) };
}

test("Repository resolution admits only the identity-bound Console and maps first acceptance/replay", async () => {
  const calls = [];
  const app = createApp({ config: loadConfig(env), proposalWorkflowService: {
    async resolveRepositoryGate(input) { calls.push(input); return { replayed: calls.length > 1 }; },
  } });
  assert.equal((await invoke(app)).status, 201);
  assert.equal((await invoke(app)).status, 200);
  assert.equal(calls[0].callerId, caller);
  assert.equal(calls[0].proposalId, "idea-851");
  assert.equal((await invoke(app, { secret: "wrong" })).status, 401);
  assert.equal((await invoke(app, { id: "other-client", secret: "other-secret" })).status, 403);
  assert.equal((await invoke(app, { body: "not-json" })).status, 400);
  assert.equal(calls.length, 2);
});

test("Repository resolution denies development bypass and missing canonical configuration", async () => {
  const service = { resolveRepositoryGate() { throw new Error("must not mutate"); } };
  const unconfigured = createApp({ config: loadConfig({ CALLER_ALLOWED_IDS: caller, CALLER_AUTH_SECRETS_JSON: env.CALLER_AUTH_SECRETS_JSON }), proposalWorkflowService: service });
  assert.equal((await invoke(unconfigured)).status, 503);
  const bypass = createApp({ config: loadConfig({ ...env, CALLER_AUTH_SECRETS_JSON: "", CALLER_AUTH_SHARED_SECRET: "", CALLER_AUTH_ALLOW_UNAUTHENTICATED_DEV: "true" }), proposalWorkflowService: service });
  assert.equal((await invoke(bypass, { secret: "" })).status, 403);
});
