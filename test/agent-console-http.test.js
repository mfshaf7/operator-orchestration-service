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

test("AI history uses existing authentication and forwards only a bounded query", async () => {
  const calls = [];
  const app = createApp({ config: config(), agentConsoleService: { async listActivity(input) { calls.push(input); return { items: [] }; } } });
  assert.equal((await invoke(app, { method: "GET", body: "", url: "/v1/agent-console/activity?limit=10" })).code, 200);
  assert.deepEqual(calls[0], { callerId: CALLER, operatorId: "operator-1", limit: 10, cursor: null });
  for (const query of ["limit=10&limit=20", "limit=0", "owner=other", "cursor=x&cursor=y", "limit=1.5"]) {
    assert.equal((await invoke(app, { method: "GET", body: "", url: `/v1/agent-console/activity?${query}` })).code, 400);
  }
  assert.equal(calls.length, 1);
  assert.equal((await invoke(app, { method: "GET", body: "", url: "/v1/agent-console/activity", secret: "wrong" })).code, 401);
});

test("native advice cannot enter bound AI history through legacy shared-secret caller claims", async () => {
  let effects = 0;
  const app = createApp({ config: config({ shared: true }), agentConsoleService: { recordsAdviceForCaller() { return true; }, trackAdvice() { effects++; } }, workDesignService: { assist() { effects++; } } });
  const result = await invoke(app, { url: "/v1/delivery-work-design/delivery-package:1400/assist", body: JSON.stringify({ operator: { id: "operator-1" }, task: { kind: "context_advice" } }) });
  assert.equal(result.code, 403); assert.equal(effects, 0);
});


test("native advice retains its existing service path for callers outside Agent Console enrollment", async () => {
  let calls = 0;
  const settings = loadConfig({ CALLER_ALLOWED_IDS: `${CALLER},other-native-client`, CALLER_AUTH_SECRETS_JSON: JSON.stringify({ [CALLER]: "test-secret", "other-native-client": "other-test-secret" }) });
  const app = createApp({ config: settings,
    agentConsoleService: { recordsAdviceForCaller: id => id === CALLER, trackAdvice() { throw Error("must not record another caller"); } },
    workDesignService: { async assist(input) { calls++; assert.equal(input.callerId, "other-native-client"); return { status: "ready" }; } },
  });
  const result = await invoke(app, { caller: "other-native-client", secret: "other-test-secret", url: "/v1/delivery-work-design/delivery-package:1400/assist", body: JSON.stringify({ operator: { id: "other-operator" }, task: { kind: "context_advice" } }) });
  assert.equal(result.code, 200); assert.equal(calls, 1);
});
