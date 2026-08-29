import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";

import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { custodyRequest } from "../test-fixtures/repository-custody.js";

function config() {
  return loadConfig({
    CALLER_ALLOWED_IDS: "governance-operations-console",
    CALLER_AUTH_SECRETS_JSON: JSON.stringify({
      "governance-operations-console": "console-secret",
    }),
  });
}

async function execute(app, { body = null, method = "POST", url }) {
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

test("repository custody API preserves caller and request identity", async () => {
  const calls = [];
  const request = custodyRequest();
  const app = createApp({
    config: config(),
    deliveryService: {},
    ideaService: {},
    openProjectClient: {},
    repositoryCustodyService: {
      async link(input) {
        calls.push({ operation: "link", ...input });
        return { request: input.input, status: "succeeded" };
      },
      async project(requestId) {
        calls.push({ operation: "project", requestId });
        return { request_id: requestId, status: "succeeded" };
      },
    },
  });
  const linked = await execute(app, {
    body: request,
    url: "/v1/repository-custody/requests",
  });
  const projected = await execute(app, {
    method: "GET",
    url: `/v1/repository-custody/requests/${encodeURIComponent(request.request_id)}`,
  });
  assert.equal(linked.statusCode, 200);
  assert.equal(projected.statusCode, 200);
  assert.equal(calls[0].callerId, "governance-operations-console");
  assert.equal(calls[1].requestId, request.request_id);
});

test("repository custody API fails closed without runtime or caller-bound credential", async () => {
  const unavailable = createApp({
    config: config(),
    deliveryService: {},
    ideaService: {},
    openProjectClient: {},
  });
  assert.equal((await execute(unavailable, {
    body: custodyRequest(),
    url: "/v1/repository-custody/requests",
  })).statusCode, 503);

  const sharedConfig = loadConfig({
    CALLER_ALLOWED_IDS: "governance-operations-console",
    CALLER_AUTH_SHARED_SECRET: "console-secret",
  });
  const unbound = createApp({
    config: sharedConfig,
    deliveryService: {},
    ideaService: {},
    openProjectClient: {},
    repositoryCustodyService: { async link() { throw new Error("must not run"); } },
  });
  assert.equal((await execute(unbound, {
    body: custodyRequest(),
    url: "/v1/repository-custody/requests",
  })).statusCode, 403);
});
