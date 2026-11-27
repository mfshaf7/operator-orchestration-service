import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { createPlatformOperationProviderClient } from "../src/platform-operation/provider-client.js";
import { createPrototypeImportSourceReader } from "../src/prototype-closure/import-source-reader.js";

const binding = { provider: "github", provider_repository_id: "123456789", full_name: "sample-org/sample-app" };
const merge = "1".repeat(40), current = "2".repeat(40);
const manifest = { file_mappings: [{ owner_path: "app/main.mjs" }] };
const manifestText = JSON.stringify(manifest);
const file = { git_blob: "3".repeat(40), git_mode: "100755", size: 123 };

function fixture(response) {
  const calls = [];
  const platform = createPlatformOperationProviderClient({ allowHttp: true, baseUrl: "http://127.0.0.1:8080",
    callerId: "synthetic-broker", callerSecret: "s".repeat(32), fetchImpl: async (url, options) => {
      assert.equal(url.pathname, "/v1/console-operations/prototype-import/inspect");
      assert.equal(options.method, "POST");
      const input = JSON.parse(options.body);
      calls.push(input);
      return response(input);
    } });
  const reader = createPrototypeImportSourceReader(platform);
  return { calls, inspect: () => reader.inspectPrototypeImport({ ownerRepo: "sample-app", providerRepository: binding,
    mergeCommit: merge, prototypeId: "sample-tool", validateManifest(value) { assert.deepEqual(value, manifest); } }) };
}

test("Prototype readback binds the reviewed merge and rechecks the same current main through Platform", async () => {
  const h = fixture(input => Response.json(input.expected_main ? { current_main: current } : {
    current_main: current, manifest_text: manifestText, files: { "app/main.mjs": file },
  }));
  const result = await h.inspect();
  assert.deepEqual(result.regularFile("app/main.mjs"), file);
  assert.throws(() => result.regularFile("app/unreviewed.mjs"));
  assert.equal(result.metadata_digest, `sha256:${createHash("sha256").update(manifestText).digest("hex")}`);
  await result.recheckCurrent();
  const selector = { owner_repo: "sample-app", provider_repository: binding, merge_commit: merge, prototype_id: "sample-tool" };
  assert.deepEqual(h.calls, [{ ...selector, expected_main: null }, { ...selector, expected_main: current }]);
});

test("Prototype readback preserves a GitHub throttle and its retry time across Platform", async () => {
  const h = fixture(() => Response.json({ code: "github_read_throttled", retry_at: "2026-11-28T06:00:00Z" }, { status: 429 }));
  await assert.rejects(h.inspect(), error => error.code === "github_read_throttled" &&
    error.details.retry_at === "2026-11-28T06:00:00.000Z");
});
