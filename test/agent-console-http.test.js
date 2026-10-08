import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";

import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";

const CALLER = "governance-operations-console";

function config({ shared = false } = {}) {
  return loadConfig({
    CALLER_ALLOWED_IDS: CALLER,
    ...(shared
      ? { CALLER_AUTH_SHARED_SECRET: "test-secret" }
      : { CALLER_AUTH_SECRETS_JSON: JSON.stringify({ [CALLER]: "test-secret" }) }),
    OOS_AGENT_CONSOLE_CALLER_OPERATOR_BINDINGS_JSON: JSON.stringify({
      [CALLER]: "operator-1",
    }),
  });
}

async function invoke(app, {
  body = "{}",
  caller = CALLER,
  method = "POST",
  operator = "operator-1",
  secret = "test-secret",
  url = "/v1/agent-console/sessions",
} = {}) {
  const request = Readable.from(body ? [Buffer.from(body)] : []);
  Object.assign(request, {
    headers: {
      "x-oos-caller-id": caller,
      "x-oos-caller-secret": secret,
      "x-oos-operator-id": operator,
    },
    method,
    url,
  });
  let code;
  let output = "";
  await app(request, {
    writeHead(value) { code = value; },
    end(value) { output += value ?? ""; },
  });
  return { body: JSON.parse(output), code };
}

test("Agent Console exposes the bounded session, invocation, action, and close routes", async () => {
  const calls = [];
  const service = {
    async createSession(input) { calls.push(["create", input]); return { state: "active" }; },
    async readSession(input) { calls.push(["read", input]); return { state: "active" }; },
    async invoke(input) { calls.push(["invoke", input]); return { state: "active" }; },
    async executeAction(input) { calls.push(["action", input]); return { action_receipt: {} }; },
    async closeSession(input) { calls.push(["close", input]); return { state: "closed" }; },
  };
  const app = createApp({ agentConsoleService: service, config: config() });

  assert.equal((await invoke(app, { body: '{"schema_version":1}' })).code, 201);
  assert.equal((await invoke(app, {
    method: "GET",
    body: "",
    url: "/v1/agent-console/sessions/session-1",
  })).code, 200);
  assert.equal((await invoke(app, {
    body: '{"schema_version":1}',
    url: "/v1/agent-console/sessions/session-1/invocations",
  })).code, 200);
  assert.equal((await invoke(app, {
    body: '{"artifact_type":"agent_action_request"}',
    url: "/v1/agent-console/sessions/session-1/actions",
  })).code, 200);
  assert.equal((await invoke(app, {
    body: '{"closed_at":"2026-10-09T12:00:03.000Z","expected_revision":2}',
    url: "/v1/agent-console/sessions/session-1/close",
  })).code, 200);

  assert.deepEqual(calls.map(([kind]) => kind), ["create", "read", "invoke", "action", "close"]);
  for (const [, input] of calls) {
    assert.equal(input.callerId, CALLER);
    assert.equal(input.operatorId, "operator-1");
  }
  assert.equal(calls[1][1].sessionId, "session-1");
  assert.equal(calls[4][1].expectedRevision, 2);
});

test("Agent Console requires activation, caller-specific auth, and operator attribution", async () => {
  assert.equal((await invoke(createApp({ config: config() }))).code, 503);
  const service = { createSession() { throw new Error("must not execute"); } };
  assert.equal((await invoke(createApp({ agentConsoleService: service, config: config() }), {
    secret: "wrong",
  })).code, 401);
  assert.equal((await invoke(createApp({ agentConsoleService: service, config: config({ shared: true }) }))).code, 403);
  assert.equal((await invoke(createApp({ agentConsoleService: service, config: config() }), {
    operator: "",
  })).code, 400);
});
