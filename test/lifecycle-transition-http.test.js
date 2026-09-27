import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";

import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createLifecycleTransitionRuntime } from "../src/lifecycle-transition/runtime.js";

const caller = "governance-operations-console";
const config = () => loadConfig({
  CALLER_ALLOWED_IDS: caller,
  CALLER_AUTH_SECRETS_JSON: JSON.stringify({ [caller]: "test-secret" }),
});

async function invoke(app, {
  accept = "application/json",
  body,
  method = "GET",
  secret = "test-secret",
  url,
} = {}) {
  const request = body === undefined
    ? Readable.from([])
    : Readable.from([Buffer.from(JSON.stringify(body))]);
  Object.assign(request, {
    url,
    method,
    headers: {
      accept,
      "x-oos-caller-id": caller,
      "x-oos-caller-secret": secret,
    },
  });
  let code = 200;
  let output = "";
  let headers = {};
  await app(request, {
    writeHead(value, values = {}) {
      code = value;
      headers = values;
    },
    end(value = "") {
      output += value;
    },
  });
  return {
    code,
    headers,
    body: output ? JSON.parse(output) : null,
  };
}

test("Lifecycle Transition API exposes create, append, read, list, and history", async () => {
  const calls = [];
  const transition = {
    schema_version: 1,
    artifact_type: "console-source-projection",
  };
  const service = {
    create: async (value) => {
      calls.push({ operation: "create", ...value });
      return { replayed: false, transition };
    },
    append: async (value) => {
      calls.push({ operation: "append", ...value });
      return { replayed: false, transition };
    },
    get: async (value) => {
      calls.push({ operation: "get", ...value });
      return transition;
    },
    list: async (value) => {
      calls.push({ operation: "list", ...value });
      return { schema_version: 1, transitions: [transition], next_cursor: null };
    },
    history: async (value) => {
      calls.push({ operation: "history", ...value });
      return { schema_version: 1, transition_id: value.transitionId, entries: [], next_cursor: null };
    },
  };
  const app = createApp({ config: config(), lifecycleTransitionService: service });
  const id = encodeURIComponent("lifecycle-transition:abc");
  assert.equal((await invoke(app, {
    body: { schema_version: 1 },
    method: "POST",
    url: "/v1/lifecycle-transitions",
  })).code, 201);
  assert.equal((await invoke(app, {
    body: { schema_version: 1 },
    method: "POST",
    url: `/v1/lifecycle-transitions/${id}/events`,
  })).code, 201);
  const read = await invoke(app, {
    accept: "application/vnd.mfshaf7.console-source-projection+json; version=1",
    url: `/v1/lifecycle-transitions/${id}`,
  });
  assert.equal(read.code, 200);
  assert.equal(
    read.headers["Content-Type"],
    "application/vnd.mfshaf7.console-source-projection+json; version=1",
  );
  assert.equal((await invoke(app, {
    url: "/v1/lifecycle-transitions?route_id=prototype-to-delivery&limit=25",
  })).code, 200);
  assert.equal((await invoke(app, {
    url: `/v1/lifecycle-transitions/${id}/history?limit=10`,
  })).code, 200);

  assert.deepEqual(calls.map((entry) => entry.operation), [
    "create", "append", "get", "list", "history",
  ]);
  assert.ok(calls.every((entry) => entry.callerId === caller));
  assert.equal(calls[1].transitionId, "lifecycle-transition:abc");
  assert.equal(calls[3].filters.routeId, "prototype-to-delivery");
});

test("Lifecycle Transition API fails closed when unavailable or unauthenticated", async () => {
  const app = createApp({ config: config() });
  assert.equal((await invoke(app, {
    method: "POST",
    body: {},
    url: "/v1/lifecycle-transitions",
  })).code, 503);
  assert.equal((await invoke(app, {
    secret: "wrong",
    url: "/v1/lifecycle-transitions",
  })).code, 401);
});

test("Lifecycle Transition runtime requires explicit profile, state, and writers", () => {
  assert.equal(createLifecycleTransitionRuntime({ config: { enabled: false } }), null);
  assert.throws(
    () => createLifecycleTransitionRuntime({
      config: { enabled: true, profile: "stage" },
    }),
    /admitted dev-integration profile/,
  );
  assert.throws(
    () => createLifecycleTransitionRuntime({
      config: { enabled: true, profile: "dev-integration", stateRoot: "/tmp/test", writerBindings: {} },
    }),
    /explicit writer bindings/,
  );

  const parsed = loadConfig({
    OOS_LIFECYCLE_TRANSITION_ENABLED: "true",
    OOS_LIFECYCLE_TRANSITION_STATE_ROOT: "/var/lib/oos/lifecycle-transitions",
    OOS_LIFECYCLE_TRANSITION_WRITER_BINDINGS_JSON: JSON.stringify({
      console: ["proposal", "prototype"],
    }),
  });
  assert.equal(parsed.lifecycleTransition.enabled, true);
  assert.deepEqual(parsed.lifecycleTransition.writerBindings, {
    console: ["proposal", "prototype"],
  });
});
