import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";

import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";

const caller = "governance-operations-console";

function config() {
  return loadConfig({
    CALLER_ALLOWED_IDS: caller,
    CALLER_AUTH_SECRETS_JSON: JSON.stringify({ [caller]: "test-secret" }),
  });
}

async function invoke(app, { secret = "test-secret", url = "/v1/workflow-activity" } = {}) {
  const request = Readable.from([]);
  Object.assign(request, {
    method: "GET",
    url,
    headers: {
      "x-oos-caller-id": caller,
      "x-oos-caller-secret": secret,
    },
  });
  let code = 200;
  let output = "";
  await app(request, {
    writeHead(value) { code = value; },
    end(value = "") { output += value; },
  });
  return { code, body: output ? JSON.parse(output) : null };
}

test("workflow activity API passes bounded filters and authenticated identity", async () => {
  const calls = [];
  const app = createApp({
    config: config(),
    workflowActivityService: {
      async list(input) {
        calls.push(input);
        return { schema_version: 1, artifact_type: "workflow-activity-page", events: [] };
      },
    },
  });
  const result = await invoke(app, {
    url: "/v1/workflow-activity?source_id=lifecycle-transition&category=transition&outcome=succeeded&subject_ref=record%3A1&limit=25",
  });
  assert.equal(result.code, 200);
  assert.equal(calls[0].callerId, caller);
  assert.deepEqual(calls[0].filters, {
    sourceId: "lifecycle-transition",
    category: "transition",
    outcome: "succeeded",
    subjectRef: "record:1",
  });
  assert.equal(calls[0].limit, "25");
});

test("workflow activity API fails closed when identity or service is unavailable", async () => {
  assert.equal((await invoke(createApp({ config: config() }), { secret: "wrong" })).code, 401);
  assert.equal((await invoke(createApp({ config: config() }))).code, 503);
});
