import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { createPublicBootstrapSourceReader } from "../src/repository-owner-bootstrap/source-reader.js";

const binding = { provider: "github", provider_repository_id: "123456789", full_name: "sample-org/sample-app" };
const merge = "1".repeat(40), current = "2".repeat(40);
const metadata = "records/prototype-source-imports/sample-tool.json";
const manifest = { schema_version: 1, prototype_id: "sample-tool" };
function fixture(mutate = () => {}, bytes = Buffer.from(JSON.stringify(manifest))) {
  const blob = createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
  const calls = [];
  let mainReads = 0;
  const reader = createPublicBootstrapSourceReader({ fetchImpl: async (url, options) => {
    assert.equal(new URL(url).origin, "https://api.github.com");
    assert.equal(options.method, "GET"); assert.equal(options.redirect, "error");
    assert.equal(Object.hasOwn(options.headers, "Authorization"), false);
    calls.push(url);
    let value;
    if (url.endsWith(`/repositories/${binding.provider_repository_id}`)) value = { id: Number(binding.provider_repository_id),
      full_name: binding.full_name, private: false, visibility: "public", archived: false, default_branch: "main" };
    else if (url.endsWith("/commits/main")) { mainReads++; value = { sha: current }; }
    else if (url.endsWith(`/compare/${merge}...${current}`)) value = { status: "ahead", merge_base_commit: { sha: merge } };
    else if (url.endsWith(`/git/trees/${merge}?recursive=1`)) value = { truncated: false, tree: [
      { path: "records", type: "tree", mode: "040000" },
      { path: "records/prototype-source-imports", type: "tree", mode: "040000" },
      { path: metadata, type: "blob", mode: "100644", sha: blob, size: bytes.length },
      { path: "app", type: "tree", mode: "040000" },
      { path: "app/app.mjs", type: "blob", mode: "100755", sha: "3".repeat(40), size: 123 },
    ] };
    else if (url.endsWith(`/git/blobs/${blob}`)) value = { sha: blob, encoding: "base64", size: bytes.length, content: bytes.toString("base64") };
    else assert.fail("Unexpected public reader route");
    const replacement = mutate({ url, value, mainReads });
    return replacement ?? new Response(JSON.stringify(value));
  } });
  return { reader, calls, inspect: () => reader.inspectPrototypeImport({ providerRepository: binding, mergeCommit: merge,
    prototypeId: "sample-tool", validateManifest(value) { assert.deepEqual(value, manifest); } }) };
}

test("public reader proves a native historical merge on current main and exposes only bounded Git identities", async () => {
  const h = fixture(), source = await h.inspect();
  assert.equal(source.merge_commit, merge); assert.equal(source.current_main, current);
  assert.equal(source.metadata_path, metadata);
  assert.deepEqual(source.regularFile("app/app.mjs"), { git_mode: "100755", git_blob: "3".repeat(40), size: 123 });
  assert.equal(Object.hasOwn(source, "bytes"), false);
  await source.recheckCurrent();
  assert.equal(h.calls.length, 7);
  for (const unsafe of ["../app.mjs", "/app/app.mjs", "app//app.mjs", "app/./app.mjs", "app/.git/config", "missing.mjs"]) {
    assert.throws(() => source.regularFile(unsafe));
  }
});

test("public import rejects wrong identity, branch, private source, unmerged commit and incomplete trees", async () => {
  for (const mutate of [
    ({ url, value }) => { if (url.includes("/repositories/")) value.id++; },
    ({ url, value }) => { if (url.includes("/repositories/")) value.private = true; },
    ({ url, value }) => { if (url.includes("/repositories/")) value.default_branch = "other"; },
    ({ url, value }) => { if (url.includes("/compare/")) value.status = "diverged"; },
    ({ url, value }) => { if (url.includes("/compare/")) value.merge_base_commit.sha = "4".repeat(40); },
    ({ url, value }) => { if (url.includes("/git/trees/")) value.truncated = true; },
    ({ url, value }) => { if (url.includes("/git/trees/")) value.tree.push({ ...value.tree[0] }); },
    ({ url, value }) => { if (url.includes("/git/trees/")) value.tree[1].mode = "120000"; },
    ({ url, value }) => { if (url.includes("/git/trees/")) value.tree[2].mode = "100755"; },
    ({ url, value }) => { if (url.includes("/git/trees/")) value.tree[2].size = 262145; },
    ({ url, value }) => { if (url.includes("/git/blobs/")) value.content = "aW52YWxpZA=="; },
    ({ url }) => url.includes("/compare/") ? new Response("denied", { status: 403 }) : undefined,
    () => { throw new Error("provider detail must not escape"); },
  ]) await assert.rejects(fixture(mutate).inspect());
});

test("strict source metadata rejects duplicate keys, invalid Unicode and a changed main during readback", async () => {
  for (const bytes of [Buffer.from('{"schema_version":1,"schema_version":1,"prototype_id":"sample-tool"}'), Buffer.from([0xff, 0xfe])]) {
    await assert.rejects(fixture(undefined, bytes).inspect());
  }
  const h = fixture(({ url, value, mainReads }) => { if (url.endsWith("/commits/main") && mainReads === 2) value.sha = "4".repeat(40); });
  const source = await h.inspect();
  await assert.rejects(source.recheckCurrent());
  for (const mutate of [row => { row.mode = "120000"; }, row => { row.mode = "160000"; row.type = "commit"; },
    row => { row.size = 4194305; }]) {
    const bad = await fixture(({ url, value }) => { if (url.includes("/git/trees/")) mutate(value.tree[4]); }).inspect();
    assert.throws(() => bad.regularFile("app/app.mjs"));
  }
});
