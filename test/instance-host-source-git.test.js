import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { createHostSourceGitReader } from "../src/instance-records/host-source-git.js";
import { instanceSourceLocation, sourceWorktreeRelativePath } from "../src/instance-records/source-location.js";
import { nativeSourceAuthorityRef } from "../src/repository-owner-bootstrap/private-source-reader.js";
import { instanceSourceProof } from "./fixtures/instance-source-authority.js";

const workspaceRoot = "/synthetic/workspace";
const authority = instanceSourceProof().source_authority;
const location = instanceSourceLocation(workspaceRoot, authority);
const env = { OOS_PLATFORM_OPERATION_PROVIDER_BASE_URL: "http://127.0.0.1:8080", OOS_PLATFORM_OPERATION_PROVIDER_ALLOW_HTTP: "true",
  OOS_PLATFORM_OPERATION_PROVIDER_CALLER_SECRET: "s".repeat(32) };
function response(input) {
  return { schema_version: 1, read_scope: "repository-checkout", owner_repo: authority.owner_repo, operation: "ordinary-source",
    authority_ref: nativeSourceAuthorityRef(authority), provider_repository: authority.provider_repository, action: input.action, branch: "main",
    remote_commit: "a".repeat(40), workspace_relative_path: path.relative(workspaceRoot, location.root),
    read_credential_issued: true, read_credential_revoked: true };
}

test("private Git transport binds the current owner, derived destination, exact branch and revoked read token", () => {
  let calls = 0;
  const reader = createHostSourceGitReader({ workspaceRoot, env, execute: (_node, args, options) => {
    calls++;
    assert.equal(args.length, 1); assert.equal(options.env.GH_TOKEN, undefined);
    const body = JSON.parse(options.input);
    assert.equal(body.kind, "checkout");
    assert.equal(body.connection.callerSecret, "s".repeat(32));
    assert.deepEqual(body.selector.authority_ref, nativeSourceAuthorityRef(authority));
    assert.equal(body.selector.destination, undefined); assert.equal(body.selector.token, undefined);
    return JSON.stringify(response(body.selector));
  } });
  const result = reader({ authority, action: "fetch", expectedBase: "a".repeat(40) });
  assert.equal(result.read_credential_revoked, true); assert.equal(calls, 1);
  assert.ok(location.root.includes("/.worktrees/instance-sources/"));
  assert.equal(sourceWorktreeRelativePath(".worktrees/unit/owner", location), `${location.worktreePrefix}/unit/owner`);
});

test("private checkout cannot claim completion with changed namespace, path, branch, base, token or revocation", () => {
  for (const mutate of [value => { value.authority_ref = { ...value.authority_ref, canonical_authority: { ...value.authority_ref.canonical_authority, instance_id: "foreign" } }; },
    value => { value.workspace_relative_path = "outside/source"; }, value => { value.branch = "another-branch"; },
    value => { value.remote_commit = "b".repeat(40); }, value => { value.read_credential_revoked = false; },
    value => { value.token = "must-not-return"; }, value => { value.provider_repository = { ...value.provider_repository, provider_repository_id: "999" }; }]) {
    const value = structuredClone(response({ action: "fetch" })); mutate(value);
    const reader = createHostSourceGitReader({ workspaceRoot, env, execute: () => JSON.stringify(value) });
    assert.throws(() => reader({ authority, action: "fetch", expectedBase: "a".repeat(40) }), { code: "instance_records_source_git_unavailable" });
  }
});
