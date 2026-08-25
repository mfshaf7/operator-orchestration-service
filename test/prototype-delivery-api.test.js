import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";

import { createApp } from "../src/app.js";

function config() {
  return {
    callerAuth: {
      allowedIds: ["codex-local"],
      callerSecrets: {},
      sharedSecret: "test-secret",
    },
  };
}

async function request(app, { body, method, url }) {
  const input = body === undefined
    ? Readable.from([])
    : Readable.from([Buffer.from(JSON.stringify(body))]);
  input.headers = {
    "x-oos-caller-id": "codex-local",
    "x-oos-caller-secret": "test-secret",
  };
  input.method = method;
  input.url = url;
  let responseBody = "";
  let statusCode = 200;
  await app(input, {
    end(value = "") {
      responseBody += value;
    },
    writeHead(value) {
      statusCode = value;
    },
  });
  return {
    body: responseBody ? JSON.parse(responseBody) : null,
    statusCode,
  };
}

test("Prototype Delivery application API authenticates create and read routes", async () => {
  const calls = [];
  const service = {
    async apply(input) {
      calls.push({ operation: "apply", ...input });
      return {
        application_id: "prototype-delivery-application:abc",
        resolution: "created",
      };
    },
    async get(input) {
      calls.push({ operation: "get", ...input });
      return {
        application_id: input.applicationId,
        resolution: "read",
      };
    },
  };
  const app = createApp({
    config: config(),
    prototypeDeliveryApplicationService: service,
  });
  const created = await request(app, {
    body: { schema_version: 1 },
    method: "POST",
    url: "/v1/delivery-ingress/prototype/applications",
  });
  const read = await request(app, {
    method: "GET",
    url:
      "/v1/delivery-ingress/prototype/applications/" +
      encodeURIComponent("prototype-delivery-application:abc"),
  });

  assert.equal(created.statusCode, 201);
  assert.equal(read.statusCode, 200);
  assert.equal(calls[0].callerId, "codex-local");
  assert.equal(calls[1].applicationId, "prototype-delivery-application:abc");
});
