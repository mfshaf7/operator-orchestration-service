import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { createPublicBootstrapSourceReader } from "../src/repository-owner-bootstrap/source-reader.js";
import { sourceOwnerBootstrapPaths } from "../src/repository-owner-bootstrap/scaffold.js";

const binding = { provider: "github", provider_repository_id: "123456789", full_name: "example-owner/example-repository" };
const base = "1".repeat(40);
const rootTree = "2".repeat(40), controlsTree = "3".repeat(40);
function fixture(change = () => {}, bytes = Buffer.from("# Existing public documentation\n")) {
  const blobSha = execFileSync("git", ["hash-object", "--stdin"], { input: bytes, encoding: "utf8" }).trim();
  const repository = { id: 123456789, full_name: binding.full_name, private: false, visibility: "public", archived: false, disabled: false, default_branch: "main" };
  const tree = { sha: rootTree, truncated: false, tree: [{ path: "README.md", type: "blob", mode: "100644", sha: blobSha, size: bytes.length }] };
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
    else if (url.endsWith("/commits/main")) { commits++; value = { sha: base, commit: { tree: { sha: rootTree } } }; }
    else if (url.endsWith(`/git/trees/${rootTree}`)) value = structuredClone(tree);
    else if (url.endsWith(`/git/trees/${controlsTree}`)) value = { sha: controlsTree, truncated: false,
      tree: [{ ...tree.tree[0], path: "CODEOWNERS" }] };
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

test("exact controls are read through verified directories without scanning unrelated repository trees", async () => {
  const unrelated = "4".repeat(40);
  const h = fixture(({ url, value }) => {
    if (url.endsWith(`/git/trees/${rootTree}`)) value.tree.push(
      { path:".github",type:"tree",mode:"040000",sha:controlsTree },
      { path:"large-unrelated-project",type:"tree",mode:"040000",sha:unrelated }
    );
  });
  const result = await h.reader.inspect({ providerRepository:binding, paths:[".github/CODEOWNERS","README.md"] });
  assert.equal(result.observed_files[".github/CODEOWNERS"],h.bytes.toString());
  assert.equal(result.observed_files["README.md"],h.bytes.toString());
  assert.equal(h.calls.filter(url=>url.endsWith(`/git/trees/${rootTree}`)).length,1);
  assert.equal(h.calls.filter(url=>url.endsWith(`/git/trees/${controlsTree}`)).length,1);
  assert.ok(h.calls.every(url=>!url.includes("recursive") && !url.includes(unrelated)));
});

test("repeat inspection reuses immutable public controls and still checks current access and main", async () => {
  let privateSource = false;
  const h = fixture(({ url, value }) => {
    if (privateSource && url.includes("/repositories/")) {
      value.private = true;
      value.visibility = "private";
    }
  });
  const inspected = await h.inspect();
  inspected.observed_files["README.md"] = "changed by caller";
  const prior = h.calls.length;
  const repeated = await h.inspect();
  assert.equal(repeated.observed_files["README.md"], h.bytes.toString());
  assert.equal(h.calls.slice(prior).length, 4);
  assert.ok(h.calls.slice(prior).every(url=>url.includes("/repositories/") || url.endsWith("/commits/main")));
  privateSource = true;
  await assert.rejects(h.inspect(), /exact active public/);
});

test("public source throttling preserves the retry time and avoids duplicate provider reads", async () => {
  const reset = Math.ceil(Date.now() / 1000) + 90;
  const h = fixture(() => new Response("provider detail stays private", {status:403,headers:{
    "x-ratelimit-remaining":"0","x-ratelimit-reset":String(reset),
  }}));
  const throttled = error => error.statusCode === 429 && error.code === "repository_owner_bootstrap_provider_throttled" &&
    error.details.retry_at === new Date(reset * 1000).toISOString() && !error.message.includes("provider detail");
  await assert.rejects(h.inspect(),throttled);
  await assert.rejects(h.inspect(),throttled);
  assert.equal(h.calls.length,1);
  const forbidden = fixture(() => new Response(null,{status:403,headers:{"x-ratelimit-remaining":"17"}}));
  await assert.rejects(forbidden.inspect(),error=>error.statusCode===409);
});
