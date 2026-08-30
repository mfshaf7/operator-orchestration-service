import assert from "node:assert/strict";
import test from "node:test";

import { createGitHubRepositoryLifecycleClient } from "../src/repository-lifecycle/provider-client.js";
import { createWgcfRepositoryLifecycleClient } from "../src/repository-lifecycle/wgcf-client.js";
import {
  lifecycleClock,
  lifecycleDecision,
  lifecycleRequest,
} from "../test-fixtures/repository-lifecycle.js";

function envelope(request, resolution) {
  const decision = lifecycleDecision(request);
  return {
    decision,
    ledger: {
      state: "durable",
      resolution,
      ref: {
        uri: "wgcf://decisions/repository-lifecycle/0123456789abcdef01234567.json",
        digest: decision.integrity.content_digest,
      },
    },
  };
}

test("WGCF lifecycle client issues and rereads one immutable decision", async () => {
  const request = lifecycleRequest();
  const responses = [envelope(request, "created"), envelope(request, "read")];
  const calls = [];
  const client = createWgcfRepositoryLifecycleClient({
    baseUrl: "http://wgcf.local",
    callerSecret: "s".repeat(32),
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return new Response(JSON.stringify(responses.shift()), { status: 200 });
    },
  });
  assert.equal((await client.evaluate(request)).decision.outcome, "allowed");
  assert.match(calls[1].url, /\/v1\/readiness\/repository-lifecycle\/0123456789abcdef01234567$/);
  assert.equal(calls[0].options.headers["x-wgcf-caller-id"], "operator-orchestration-service");
});

test("provider lifecycle client archives by immutable read, bounded patch, and fresh readback", async () => {
  const request = lifecycleRequest("archive-provider");
  const calls = [];
  let archived = false;
  const body = () => ({
    id: 123456789,
    owner: { login: "example-owner" },
    name: "example-repository",
    archived,
    updated_at: lifecycleClock().toISOString(),
  });
  const client = createGitHubRepositoryLifecycleClient({
    clock: lifecycleClock,
    installationToken: "lifecycle-token",
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      if (options.method === "PATCH") archived = JSON.parse(options.body).archived;
      return new Response(JSON.stringify(body()), {
        headers: { etag: archived ? "etag-after" : "etag-before" },
        status: 200,
      });
    },
  });
  const readback = await client.setArchived(request, true);
  assert.equal(readback.provider_lifecycle_state, "archived");
  assert.equal(readback.provider_version, "etag-after");
  assert.deepEqual(calls.map(({ options }) => options.method ?? "GET"), ["GET", "PATCH", "GET"]);
  assert.match(calls[0].url, /\/repositories\/123456789$/);
  assert.match(calls[1].url, /\/repos\/example-owner\/example-repository$/);
  assert.equal("delete" in client, false);
});

test("provider lifecycle client rejects personal, missing, and unadmitted authority", async () => {
  const request = lifecycleRequest("archive-provider");
  const missing = createGitHubRepositoryLifecycleClient({ installationToken: "" });
  await assert.rejects(
    missing.read(request),
    (error) => error.code === "repository_provider_not_configured",
  );
  assert.throws(
    () => createGitHubRepositoryLifecycleClient({
      apiBaseUrl: "https://github.example",
      installationToken: "token",
    }),
    (error) => error.code === "repository_provider_destination_not_admitted",
  );
});
