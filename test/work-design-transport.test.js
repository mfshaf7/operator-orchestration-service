import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { createWorkDesignJsonClient } from "../src/work-design/http-client.js";

async function upstream(t, handle) {
  const server = http.createServer(handle);
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  return `http://127.0.0.1:${server.address().port}`;
}

test("native Work Design transport waits for delayed headers and complete delayed JSON", async t => {
  const baseUrl = await upstream(t, async (request, response) => {
    for await (const _chunk of request) { /* read complete submitted request */ }
    setTimeout(() => { response.writeHead(200, { "content-type": "application/json" }); response.write('{"state":');
      setTimeout(() => response.end('"complete"}'), 30);
    }, 80);
  });
  assert.deepEqual(await createWorkDesignJsonClient({ baseUrl, timeoutMs: 1000 }).post("/assist", { note: "full input" }), { state: "complete" });
});

test("aborting a submitted native exchange reports unconfirmed completion and never resends", async t => {
  let calls = 0, submitted;
  const received = new Promise(resolve => { submitted = resolve; });
  const baseUrl = await upstream(t, async request => {
    calls++; for await (const _chunk of request) { /* wait until body received */ } submitted();
  });
  const controller = new AbortController();
  const pending = createWorkDesignJsonClient({ baseUrl }).post("/assist", {}, { signal: controller.signal });
  const rejection = assert.rejects(pending, error => error.code === "upstream_completion_unknown" && error.retryable === false);
  await received; controller.abort(); await rejection;
  assert.equal(calls, 1);
});

test("lost submitted response and an oversized response remain bounded and unconfirmed", async t => {
  const baseUrl = await upstream(t, async (request, response) => {
    for await (const _chunk of request) { /* request is submitted */ }
    if (request.url === "/lost") response.destroy();
    else response.end("x".repeat(1_048_577));
  });
  for (const path of ["/lost", "/oversized"])
    await assert.rejects(createWorkDesignJsonClient({ baseUrl }).post(path, {}), error => error.code === "upstream_completion_unknown" && !error.retryable);
});
