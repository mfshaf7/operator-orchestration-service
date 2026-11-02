import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";

const env = { CALLER_ALLOWED_IDS: "console", CALLER_AUTH_SECRETS_JSON: JSON.stringify({ console: "synthetic-secret" }) };
async function invoke(app, method, url, body = {}, secret = "synthetic-secret") {
  const request = Readable.from([Buffer.from(JSON.stringify(body))]);
  Object.assign(request, { method, url, headers: { "x-oos-caller-id": "console", "x-oos-caller-secret": secret } });
  let status, output = "";
  await app(request, { writeHead(value) { status = value; }, end(value) { output += value ?? ""; } });
  return { status, body: JSON.parse(output) };
}
test("profile API is disabled without reviewed integration and requires bound credentials", async () => {
  const app = createApp({ config: loadConfig(env) });
  assert.equal((await invoke(app, "GET", "/v1/dev-integration/profiles")).status, 503);
  assert.equal((await invoke(app, "GET", "/v1/dev-integration/profiles", {}, "wrong")).status, 401);
});
test("profile API preserves bounded query and exact decoded original request identity", async () => {
  const calls = [];
  const service = Object.fromEntries(["profiles", "submit", "listRequests", "get"].map(method => [method,
    async input => { calls.push({ method, input }); return { synthetic: true }; }]));
  const app = createApp({ config: loadConfig(env), platformOperationService: { profileIntegration: service } });
  assert.equal((await invoke(app, "GET", "/v1/dev-integration/profiles?limit=5&q=alpha")).status, 200);
  assert.deepEqual(calls.at(-1).input.query, { limit: "5", q: "alpha" });
  assert.equal((await invoke(app, "GET", "/v1/dev-integration/profiles/alpha")).status, 200);
  assert.equal(calls.at(-1).input.query.profile_id, "alpha");
  assert.equal((await invoke(app, "POST", "/v1/dev-integration/requests", { request_id: "devint-request:one" })).status, 201);
  assert.equal((await invoke(app, "GET", "/v1/dev-integration/requests/devint-request%3Aone")).status, 200);
  assert.equal(calls.at(-1).input.requestId, "devint-request:one");
  assert.equal((await invoke(app, "GET", "/v1/dev-integration/requests?limit=5&offset=10")).status, 200);
  assert.equal(calls.at(-1).input.limit, 5);
  assert.equal((await invoke(app, "GET", "/v1/dev-integration/profiles?owner=a&owner=b")).status, 400);
  assert.equal((await invoke(app, "DELETE", "/v1/dev-integration/requests/devint-request%3Aone")).status, 405);
});
