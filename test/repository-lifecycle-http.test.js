import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";

import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { lifecycleRequest } from "../test-fixtures/repository-lifecycle.js";

const config = () => loadConfig({
  CALLER_ALLOWED_IDS: "governance-operations-console",
  CALLER_AUTH_SECRETS_JSON: JSON.stringify({
    "governance-operations-console": "console-secret",
  }),
});

async function call(app, { body = null, method = "GET", url }) {
  const request = body === null
    ? Readable.from([])
    : Readable.from([Buffer.from(JSON.stringify(body))]);
  request.method = method;
  request.url = url;
  request.headers = {
    "x-oos-caller-id": "governance-operations-console",
    "x-oos-caller-secret": "console-secret",
  };
  let statusCode = 200;
  let responseBody = "";
  const response = {
    end(chunk = "") { responseBody += chunk; },
    writeHead(code) { statusCode = code; },
  };
  await app(request, response);
  return { body: JSON.parse(responseBody), statusCode };
}

test("repository lifecycle API preserves command, request, and repository identities", async () => {
  const calls = [];
  const request = lifecycleRequest();
  const app = createApp({
    config: config(),
    deliveryService: {},
    ideaService: {},
    openProjectClient: {},
    repositoryLifecycleService: {
      async execute(value) { calls.push({ operation: "execute", ...value }); return { status: "succeeded" }; },
      async project(requestId) { calls.push({ operation: "project", requestId }); return { request_id: requestId }; },
      async projectRepository(identity) { calls.push({ operation: "audit", identity }); return { repository_identity: identity }; },
    },
  });
  assert.equal((await call(app, { body: request, method: "POST", url: "/v1/repository-lifecycle/requests" })).statusCode, 200);
  assert.equal((await call(app, { url: `/v1/repository-lifecycle/requests/${encodeURIComponent(request.request_id)}` })).statusCode, 200);
  assert.equal((await call(app, { url: "/v1/repository-lifecycle/repositories/github/123456789" })).statusCode, 200);
  assert.equal(calls[0].callerId, "governance-operations-console");
  assert.equal(calls[1].requestId, request.request_id);
  assert.deepEqual(calls[2].identity, { provider: "github", provider_repository_id: "123456789" });
});

test("repository lifecycle API fails closed without runtime or caller-bound credentials", async () => {
  const unavailable = createApp({ config: config(), deliveryService: {}, ideaService: {}, openProjectClient: {} });
  assert.equal((await call(unavailable, {
    body: lifecycleRequest(),
    method: "POST",
    url: "/v1/repository-lifecycle/requests",
  })).statusCode, 503);

  const shared = createApp({
    config: loadConfig({
      CALLER_ALLOWED_IDS: "governance-operations-console",
      CALLER_AUTH_SHARED_SECRET: "console-secret",
    }),
    deliveryService: {},
    ideaService: {},
    openProjectClient: {},
    repositoryLifecycleService: { async execute() { throw new Error("must not run"); } },
  });
  assert.equal((await call(shared, {
    body: lifecycleRequest(),
    method: "POST",
    url: "/v1/repository-lifecycle/requests",
  })).statusCode, 403);
});
