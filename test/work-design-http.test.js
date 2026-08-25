import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";

import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { WorkDesignServiceError } from "../src/work-design/service.js";

function config() {
  return loadConfig({
    CALLER_ALLOWED_IDS: "governance-operations-console,wgcf",
    CALLER_AUTH_SHARED_SECRET: "test-secret",
  });
}

async function executeRequest(app, { body, callerId = "governance-operations-console", url }) {
  const request = Readable.from([Buffer.from(JSON.stringify(body))]);
  request.method = "POST";
  request.url = url;
  request.headers = {
    "content-type": "application/json",
    "x-oos-caller-id": callerId,
    "x-oos-caller-secret": "test-secret",
  };
  let statusCode = 200;
  let responseBody = "";
  const response = {
    end(chunk = "") {
      responseBody += chunk;
    },
    writeHead(code) {
      statusCode = code;
    },
  };
  await app(request, response);
  return {
    body: responseBody ? JSON.parse(responseBody) : null,
    statusCode,
  };
}

function appWith(workDesignService) {
  return createApp({
    config: config(),
    deliveryService: {},
    ideaService: {},
    openProjectClient: {},
    workDesignService,
  });
}

test("Work Design HTTP routes preserve package identity and caller identity", async () => {
  const calls = [];
  const app = appWith({
    async assist(input) {
      calls.push({ operation: "assist", ...input });
      return { status: "ready" };
    },
    async apply(input) {
      calls.push({ operation: "apply", ...input });
      return { status: "applied" };
    },
  });

  const assist = await executeRequest(app, {
    body: { correlation_id: "correlation-1" },
    url: "/v1/delivery-work-design/delivery-package%3A908/assist",
  });
  const apply = await executeRequest(app, {
    body: { correlation_id: "correlation-2" },
    url: "/v1/delivery-work-design/delivery-package%3A908/apply",
  });

  assert.equal(assist.statusCode, 200);
  assert.equal(apply.statusCode, 200);
  assert.equal(calls[0].packageId, "delivery-package:908");
  assert.equal(calls[0].callerId, "governance-operations-console");
  assert.equal(calls[1].packageId, "delivery-package:908");
});

test("Work Design HTTP apply preserves existing mutation authority", async () => {
  const app = appWith({
    async apply() {
      throw new Error("apply must not be called");
    },
  });
  const response = await executeRequest(app, {
    body: {},
    callerId: "wgcf",
    url: "/v1/delivery-work-design/package-1/apply",
  });

  assert.equal(response.statusCode, 403);
  assert.equal(response.body.error, "caller_recommendation_only");
});

test("Work Design HTTP routes emit the bounded workflow error contract", async () => {
  const app = appWith({
    async assist({ request }) {
      throw new WorkDesignServiceError(
        "ai_profile_inactive",
        "The governed Work Design profile is not active.",
        {
          auditRef: "local-ledger:denied-1",
          correlationId: request.correlation_id,
          statusCode: 503,
        },
      );
    },
  });
  const response = await executeRequest(app, {
    body: { correlation_id: "correlation-1" },
    url: "/v1/delivery-work-design/package-1/assist",
  });

  assert.equal(response.statusCode, 503);
  assert.equal(response.body.schema_version, 1);
  assert.equal(response.body.correlation_id, "correlation-1");
  assert.equal(response.body.code, "ai_profile_inactive");
  assert.equal(response.body.audit_ref, "local-ledger:denied-1");
  assert.equal(response.body.receipt_ref, null);
});
