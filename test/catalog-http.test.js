import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";

import { createApp } from "../src/app.js";
import { CatalogServiceError } from "../src/catalog/service.js";
import { loadConfig } from "../src/config.js";

function config() {
  return loadConfig({
    CALLER_ALLOWED_IDS: "operator:workspace-owner,wgcf",
    CALLER_AUTH_SHARED_SECRET: "test-secret",
  });
}

async function executeRequest(app, {
  body = null,
  callerId = "operator:workspace-owner",
  method = "POST",
  url,
}) {
  const request = body === null
    ? Readable.from([])
    : Readable.from([Buffer.from(JSON.stringify(body))]);
  request.method = method;
  request.url = url;
  request.headers = {
    "x-oos-caller-id": callerId,
    "x-oos-caller-secret": "test-secret",
  };
  let statusCode = 200;
  let responseBody = "";
  const response = {
    end(chunk = "") { responseBody += chunk; },
    writeHead(code) { statusCode = code; },
  };
  await app(request, response);
  return { body: responseBody ? JSON.parse(responseBody) : null, statusCode };
}

function appWith(catalogService) {
  return createApp({
    catalogService,
    config: config(),
    deliveryService: {},
    ideaService: {},
    openProjectClient: {},
  });
}

test("Catalog routes preserve item and caller identity", async () => {
  const calls = [];
  const app = appWith({
    async mutate(input) {
      calls.push({ operation: "mutate", ...input });
      return { mutation_id: "mutation-1" };
    },
    async project(input) {
      calls.push({ operation: "project", ...input });
      return { source_revision: "revision-1" };
    },
  });
  const projection = await executeRequest(app, {
    method: "GET",
    url: "/v1/delivery-catalog/projection",
  });
  const mutation = await executeRequest(app, {
    body: { correlation_id: "correlation-1" },
    url: "/v1/delivery-catalog/owner-repo/mutations",
  });
  assert.equal(projection.statusCode, 200);
  assert.equal(mutation.statusCode, 200);
  assert.equal(calls[0].callerId, "operator:workspace-owner");
  assert.equal(calls[1].catalogItemId, "owner-repo");
  assert.equal(calls[1].request.correlation_id, "correlation-1");
});

test("Catalog mutation preserves Delivery mutation authority", async () => {
  const response = await executeRequest(appWith({
    async mutate() { throw new Error("must not execute"); },
  }), {
    body: {},
    callerId: "wgcf",
    url: "/v1/delivery-catalog/owner-repo/mutations",
  });
  assert.equal(response.statusCode, 403);
  assert.equal(response.body.error, "caller_recommendation_only");
});

test("Catalog routes emit the bounded error contract", async () => {
  const response = await executeRequest(appWith({
    async project({ correlationId }) {
      throw new CatalogServiceError(
        "backend_projection_failed",
        "Catalog source is unavailable.",
        { correlationId, retryable: true, statusCode: 503 },
      );
    },
  }), {
    method: "GET",
    url: "/v1/delivery-catalog/projection",
  });
  assert.equal(response.statusCode, 503);
  assert.equal(response.body.schema_version, 1);
  assert.equal(response.body.code, "backend_projection_failed");
  assert.equal(response.body.retryable, true);
});
