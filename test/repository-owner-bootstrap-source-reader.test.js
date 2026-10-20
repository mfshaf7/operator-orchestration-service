import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { createPublicBootstrapSourceReader } from "../src/repository-owner-bootstrap/source-reader.js";
import { sourceOwnerBootstrapPaths } from "../src/repository-owner-bootstrap/scaffold.js";

const binding = { provider: "github", provider_repository_id: "123456789", full_name: "example-owner/example-repository" };
const base = "1".repeat(40);
function fixture(change = () => {}, bytes = Buffer.from("# Existing public documentation\n")) {
  const blobSha = execFileSync("git", ["hash-object", "--stdin"], { input: bytes, encoding: "utf8" }).trim();
  const repository = { id: 123456789, full_name: binding.full_name, private: false, visibility: "public", archived: false, disabled: false, default_branch: "main" };
  const tree = { truncated: false, tree: [{ path: "README.md", type: "blob", mode: "100644", sha: blobSha, size: bytes.length }] };
  const blob = { sha: blobSha, size: bytes.length, encoding: "base64", content: bytes.toString("base64") };
  const calls = [];
  let commits = 0;
  const reader = createPublicBootstrapSourceReader({ fetchImpl: async (url, options) => {
    assert.equal(new URL(url).origin, "https://api.github.com");
    assert.equal(options.method, "GET");
    assert.equal(options.redirect, "error");
    assert.equal(Object.hasOwn(options.headers, "Authorization"), false);
    calls.push(url);
    let value;
    if (url.endsWith(`/repositories/${binding.provider_repository_id}`)) value = structuredClone(repository);
    else if (url.endsWith("/commits/main")) { commits++; value = { sha: base }; }
    else if (url.endsWith(`/git/trees/${base}?recursive=1`)) value = structuredClone(tree);
    else if (url.endsWith(`/git/blobs/${blobSha}`)) value = structuredClone(blob);
    else assert.fail(`Unexpected provider route ${url}`);
    const replacement = change({ url, value, commits, bytes });
    return replacement ?? new Response(JSON.stringify(value), { status: 200 });
  } });
  return { reader, calls, bytes, inspect: () => reader.inspect({ providerRepository: binding, paths: sourceOwnerBootstrapPaths(false) }) };
}

test("bootstrap reader verifies actual Git blob bytes at one stable public provider base, without a credential or write", async () => {
  const h = fixture();
  const result = await h.inspect();
  assert.equal(result.fetched_base, base);
  assert.equal(result.observed_files["README.md"], h.bytes.toString());
  assert.equal(result.observed_files["Makefile"], null);
  assert.deepEqual(Object.keys(result.observed_files), sourceOwnerBootstrapPaths(false));
  assert.equal(h.calls.filter(url => url.endsWith("/commits/main")).length, 2);
});

test("exact existing UTF-8 documentation bytes retain a byte-order mark rather than silently changing source", async () => {
  const bytes = Buffer.from("\ufeff# Existing Unicode purpose — preserve bytes\n");
  const h = fixture(undefined, bytes), result = await h.inspect();
  assert.deepEqual(Buffer.from(result.observed_files["README.md"], "utf8"), bytes);
});

test("public bootstrap reader rejects changed identity, visibility, posture, branch or main", async () => {
  for (const mutate of [
    value => { value.id = 42; }, value => { value.full_name = "foreign-owner/same-name"; },
    value => { value.private = true; value.visibility = "private"; }, value => { value.archived = true; },
    value => { value.disabled = true; }, value => { value.default_branch = "other"; },
  ]) {
    const h = fixture(({ url, value }) => { if (url.includes("/repositories/")) mutate(value); });
    await assert.rejects(h.inspect(), /exact active public/);
    assert.equal(h.calls.length, 1, "Ineligible provider must fail before source reads");
  }
  await assert.rejects(fixture(({ url, value, commits }) => {
    if (url.endsWith("/commits/main") && commits === 2) value.sha = "2".repeat(40);
  }).inspect(), /main changed/);
});

test("provider tree must be complete and exact; symlinks, executable files, submodules and ambiguous paths fail closed", async () => {
  for (const mutate of [
    value => { value.truncated = true; },
    value => { value.tree[0].mode = "120000"; },
    value => { value.tree[0].mode = "100755"; },
    value => { value.tree[0].type = "commit"; value.tree[0].mode = "160000"; },
    value => { value.tree.push({ ...value.tree[0] }); },
    value => { value.tree.push({ path: "scripts", type: "blob", mode: "120000" }); },
    value => { value.tree[0].size = 65_537; },
  ]) {
    await assert.rejects(fixture(({ url, value }) => { if (url.includes("/git/trees/")) mutate(value); }).inspect());
  }
});

test("provider blob encoding, size, object identity and read budgets are checked without projecting raw failures", async () => {
  for (const mutate of [
    value => { value.sha = "a".repeat(40); }, value => { value.encoding = "utf8"; },
    value => { value.content = "!not-base64!"; }, value => { value.content = Buffer.from("different source").toString("base64"); },
    value => { value.size++; },
  ]) {
    await assert.rejects(fixture(({ url, value }) => { if (url.includes("/git/blobs/")) mutate(value); }).inspect());
  }
  await assert.rejects(fixture(() => new Response(" ".repeat(262_145))).inspect(), /bounded read/);
  const unavailable = createPublicBootstrapSourceReader({ fetchImpl: async () => { throw new Error("must not project raw provider response"); } });
  await assert.rejects(unavailable.inspect({ providerRepository: binding, paths: sourceOwnerBootstrapPaths(false) }), error =>
    error.message === "The exact public provider source could not be inspected safely.");
});

test("unknown paths and invalid provider bindings are refused before any network request", async () => {
  const h = fixture();
  await assert.rejects(h.reader.inspect({ providerRepository: binding, paths: ["app/arbitrary.js"] }));
  await assert.rejects(h.reader.inspect({ providerRepository: { ...binding, full_name: "../private" }, paths: sourceOwnerBootstrapPaths(false) }));
  assert.equal(h.calls.length, 0);
});
