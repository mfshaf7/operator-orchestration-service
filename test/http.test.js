import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";

import { createApp } from "../src/app.js";

function createBaseConfig() {
  return {
    callerAuth: {
      allowedIds: ["openclaw-telegram-enhanced"],
      sharedSecret: "test-secret",
    },
    openProject: {
      apiToken: "test-token",
      baseUrl: "http://example.test",
      capturedStatusId: 81,
      customFieldSourceReferenceId: 2,
      customFieldSourceSurfaceId: 1,
      hostHeader: "example.test",
      ideaTypeId: 41,
      projectIdentifier: "workspace-proposals",
    },
    service: {
      gitCommit: "abc123",
      name: "operator-orchestration-service",
      version: "0.1.0-test",
    },
  };
}

async function executeRequest(app, { body, headers = {}, method, url }) {
  const request =
    body === undefined
      ? Readable.from([])
      : Readable.from([Buffer.from(JSON.stringify(body))]);

  request.method = method;
  request.url = url;
  request.headers = Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]),
  );

  let statusCode = 200;
  let responseHeaders = {};
  let responseBody = "";

  const response = {
    end(chunk = "") {
      responseBody += chunk;
    },
    writeHead(code, nextHeaders = {}) {
      statusCode = code;
      responseHeaders = nextHeaders;
    },
  };

  await app(request, response);

  return {
    body: responseBody ? JSON.parse(responseBody) : null,
    headers: responseHeaders,
    statusCode,
  };
}

test("health and version endpoints are available without caller auth", async () => {
  const app = createApp({
    config: createBaseConfig(),
    ideaService: {},
    openProjectClient: {
      checkProjectReachability: async () => ({
        targetRef: "openproject://projects/workspace-proposals",
      }),
    },
  });

  const [healthResponse, versionResponse] = await Promise.all([
    executeRequest(app, {
      method: "GET",
      url: "/healthz",
    }),
    executeRequest(app, {
      method: "GET",
      url: "/version",
    }),
  ]);

  assert.equal(healthResponse.statusCode, 200);
  assert.deepEqual(healthResponse.body, {
    ok: true,
    status: "live",
  });

  assert.equal(versionResponse.statusCode, 200);
  assert.deepEqual(versionResponse.body, {
    callerAuthMode: "required",
    gitCommit: "abc123",
    service: "operator-orchestration-service",
    version: "0.1.0-test",
  });
});

test("capture endpoint enforces caller auth before invoking the service", async () => {
  const app = createApp({
    config: createBaseConfig(),
    ideaService: {
      captureIdea: async () => {
        throw new Error("captureIdea should not be called");
      },
    },
    openProjectClient: {
      checkProjectReachability: async () => ({
        targetRef: "openproject://projects/workspace-proposals",
      }),
    },
  });

  const response = await executeRequest(app, {
    body: {},
    headers: {
      "Content-Type": "application/json",
    },
    method: "POST",
    url: "/v1/ideas/capture",
  });

  assert.equal(response.statusCode, 401);
  assert.deepEqual(response.body, {
    details: null,
    error: "caller_auth_required",
    message: "Caller id header is required.",
  });
});

test("capture endpoint returns the broker response when the service succeeds", async () => {
  const captureCalls = [];
  const app = createApp({
    config: createBaseConfig(),
    ideaService: {
      captureIdea: async (input) => {
        captureCalls.push(input);
        return {
          idea_id: "idea-12",
          record_ref: "openproject://work_packages/12",
          record_system: "openproject",
          status: "captured",
        };
      },
    },
    openProjectClient: {
      checkProjectReachability: async () => ({
        targetRef: "openproject://projects/workspace-proposals",
      }),
    },
  });

  const response = await executeRequest(app, {
    body: {
      body: "One of the most common triggers for new ideas is discussion with Codex.",
      operator: {
        handle: "mfshaf7",
        id: "1338752889",
      },
      source: "telegram",
      source_ref: {
        chat_id: "-1002519919856",
        message_id: "123",
        topic_id: "1",
      },
      title: "Need a durable place to store deferred ideas",
    },
    headers: {
      "Content-Type": "application/json",
      "x-oos-caller-id": "openclaw-telegram-enhanced",
      "x-oos-caller-secret": "test-secret",
    },
    method: "POST",
    url: "/v1/ideas/capture",
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, {
    idea_id: "idea-12",
    record_ref: "openproject://work_packages/12",
    record_system: "openproject",
    status: "captured",
  });

  assert.equal(captureCalls.length, 1);
  assert.equal(captureCalls[0].callerId, "openclaw-telegram-enhanced");
  assert.equal(captureCalls[0].source, "telegram");
  assert.equal(captureCalls[0].title, "Need a durable place to store deferred ideas");
  assert.equal(captureCalls[0].sourceRef.message_id, "123");
  assert.match(captureCalls[0].correlationId, /^[0-9a-f-]{36}$/);
});
