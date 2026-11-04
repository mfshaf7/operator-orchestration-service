import assert from "node:assert/strict";
import test from "node:test";
import { createBootstrapSourceReader, nativeSourceAuthorityRef, qualifiedOwnerSource } from "../src/repository-owner-bootstrap/private-source-reader.js";
import { createPlatformOperationProviderClient } from "../src/platform-operation/provider-client.js";

const owner = "canonical-project-key";
const authority = { owner_repo: owner, intake_entry_ref: { id: `repo:${owner}`, version: 3, digest: `sha256:${"a".repeat(64)}` },
  canonical_authority: { kind: "internal-instance-record", instance_id: "synthetic-installation", record_id: `repo:${owner}` },
  record_ref: { version: 3, digest: `sha256:${"a".repeat(64)}` },
  policy_ref: { repo: "workspace-governance", revision: "b".repeat(40), contract_digest: `sha256:${"c".repeat(64)}` },
  provider_repository: { provider: "github", provider_repository_id: "123", full_name: "example-org/different-physical-name" } };
const args = { providerRepository: authority.provider_repository, ownerAuthority: authority, paths: ["README.md", "AGENTS.md"],
  callerId: "synthetic-console", operatorId: "operator:synthetic", operation: "bootstrap" };
function result(input) {
  return { schema_version: 1, read_scope: "trusted-owner-controls", read_credential_issued: true, read_credential_revoked: true,
    owner_repo: owner, operation: "bootstrap", authority_ref: input.authority_ref, provider_repository: authority.provider_repository,
    fetched_base: "d".repeat(40), visibility: "private", default_branch: "main",
    observed_files: Object.fromEntries(input.paths.map(path => [path, path === "README.md" ? "# Synthetic private controls\n" : null])) };
}

test("native inspection uses the existing protected provider with exact namespace, finite files and no generic command", async () => {
  const calls = [];
  const provider = createPlatformOperationProviderClient({ allowHttp: true, baseUrl: "http://127.0.0.1:8080", callerId: "operator-orchestration-service", callerSecret: "s".repeat(32),
    fetchImpl: async (url, init) => { calls.push([url, init]); return Response.json(result(JSON.parse(init.body))); } });
  let publicReads = 0;
  const reader = createBootstrapSourceReader({ publicReader: { inspect: async () => { publicReads++; } },
    platformOperations: { inspectOwnerControls: ({ callerId, operatorId, input }) => {
      assert.equal(callerId, args.callerId); assert.equal(operatorId, args.operatorId);
      return provider.inspectOwnerControls(input);
    } } });
  const source = await reader.inspect(args);
  assert.equal(source.visibility, "private");
  assert.equal(source.read_credential_revoked, true);
  assert.equal(qualifiedOwnerSource(source, authority), true);
  assert.equal(publicReads, 0); assert.equal(calls.length, 1);
  const [url, init] = calls[0];
  assert.equal(new URL(url).pathname, "/v1/console-operations/source-controls/inspect");
  assert.equal(init.method, "POST"); assert.equal(init.redirect, "error");
  assert.equal(init.headers["x-platform-caller-id"], "operator-orchestration-service");
  assert.deepEqual(JSON.parse(init.body), { schema_version: 1, owner_repo: owner, operation: "bootstrap", paths: ["AGENTS.md", "README.md"], authority_ref: nativeSourceAuthorityRef(authority) });
  assert.equal(JSON.parse(init.body).command, undefined);
});

test("unavailable or substituted native source cannot fall back to anonymous public inspection", async () => {
  let publicReads = 0;
  for (const mutate of [value => { value.authority_ref = { ...value.authority_ref, record_ref: { ...value.authority_ref.record_ref, version: 4 } }; },
    value => { value.provider_repository = { ...value.provider_repository, provider_repository_id: "456" }; },
    value => { value.read_credential_revoked = false; }, value => { value.observed_files["private-application.py"] = "Unrequested private bytes"; },
    value => { value.default_branch = "different-branch"; }, value => { value.token = "must-not-return"; }]) {
    const reader = createBootstrapSourceReader({ publicReader: { inspect: async () => { publicReads++; } }, platformOperations: {
      inspectOwnerControls: async ({ input }) => { const value = structuredClone(result(input)); mutate(value); return value; } } });
    await assert.rejects(reader.inspect(args), { code: "repository_private_source_unavailable" });
  }
  const reader = createBootstrapSourceReader({ publicReader: { inspect: async () => { publicReads++; } }, platformOperations: {
    inspectOwnerControls: async () => { throw new Error("Synthetic unavailable provider"); } } });
  await assert.rejects(reader.inspect(args));
  assert.equal(publicReads, 0);
});

test("unknown paths, mismatched current record and unknown storage fail before a protected read", async () => {
  let calls = 0;
  const reader = createBootstrapSourceReader({ publicReader: { inspect: async () => { calls++; } }, platformOperations: { inspectOwnerControls: async () => { calls++; } } });
  await assert.rejects(reader.inspect({ ...args, paths: ["private-application.py"] }));
  const wrong = structuredClone(authority); wrong.record_ref.version++;
  await assert.rejects(reader.inspect({ ...args, ownerAuthority: wrong }));
  await assert.rejects(reader.inspect({ ...args, ownerAuthority: { canonical_authority: { kind: "unknown" }, authority_revision: "a".repeat(40) } }));
  assert.equal(calls, 0);
});

test("a positive legacy proof retains the existing public-only reader", async () => {
  let calls = 0;
  const reader = createBootstrapSourceReader({ publicReader: { inspect: async value => { calls++; return { ...value, visibility: "public", default_branch: "main" }; } },
    platformOperations: { inspectOwnerControls: async () => { throw new Error("Unexpected native read"); } } });
  const source = await reader.inspect({ ...args, ownerAuthority: { authority_revision: "a".repeat(40) } });
  assert.equal(calls, 1); assert.equal(qualifiedOwnerSource(source, null), true);
});
