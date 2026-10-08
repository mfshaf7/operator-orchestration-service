import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { proposalTargetDigest, proposalTargetManifest } from "../src/proposal-target-application/contracts.js";
import { createProposalTargetGitHubClient } from "../src/proposal-target-application/provider-client.js";
import { createProposalTargetRuntime } from "../src/proposal-target-application/runtime.js";

test("Proposal target canonical JSON is deterministic and lossless", () => {
  assert.equal(proposalTargetDigest({ b: 2, a: 1 }), proposalTargetDigest({ a: 1, b: 2 }));
  assert.throws(() => proposalTargetDigest({ value: 1.5 }), /lossless integral/);
});

test("Proposal target runtime activates only in the reviewed dev-integration boundary", () => {
  assert.equal(createProposalTargetRuntime({ config: { enabled: false } }), null);
  assert.equal(proposalTargetManifest.runtime_activation, true);
  assert.equal(proposalTargetManifest.security_review_work_item, "openproject://work_packages/1235");
  assert.equal(proposalTargetManifest.activation_work_item, "openproject://work_packages/1236");
  assert.throws(() => createProposalTargetRuntime({ config: { enabled: true, profile: "stage" } }), /awaits the reviewed Security and Platform activation chain/);
  assert.ok(createProposalTargetRuntime({
    config: {
      enabled: true,
      profile: "dev-integration",
      stateRoot: "/tmp/proposal-target-test-state",
      authorityRoot: "/tmp/proposal-target-test-authority",
      tokenFile: "/tmp/proposal-target-test-token",
      owner: "mfshaf7",
      repositoryId: "1231020532",
    },
    proposalWorkflowService: {},
  }));
});

test("Proposal target provider rejects broad identity, personal tokens and alternate destinations", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "proposal-target-provider-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const tokenFile = path.join(root, "token");
  await writeFile(tokenFile, "ghs_test", { mode: 0o600 });
  const options = { owner: "example", repositoryId: "123", tokenFile };
  assert.throws(() => createProposalTargetGitHubClient({ ...options, apiBaseUrl: "https://other.invalid" }), /not admitted/);
  let broad = true;
  const client = createProposalTargetGitHubClient({ ...options, fetchImpl: async (url, request) => {
    assert.equal(request.redirect, "error");
    assert.equal(request.headers.Authorization, "Bearer ghs_test");
    if (url.includes("/installation/repositories")) return Response.json({ total_count: broad ? 2 : 1, repositories: [{ id: 123, full_name: "example/workspace-prototype-studio" }] });
    return Response.json({ object: { sha: "1".repeat(40) } });
  } });
  await assert.rejects(client.mainRevision(), /restricted to the exact Prototype Studio repository/);
  broad = false;
  assert.equal(await client.mainRevision(), "1".repeat(40));
  await writeFile(tokenFile, "ghp_personal");
  await assert.rejects(client.mainRevision(), /installation token/);
  assert.equal(await readFile(tokenFile, "utf8"), "ghp_personal");
});

test("runtime image carries the pinned Proposal target application contract", () => {
  const dockerfile = readFileSync(new URL("../Dockerfile", import.meta.url), "utf8");
  assert.match(dockerfile, /COPY --chown=node:node contracts\/proposal-target-application \.\/contracts\/proposal-target-application/);
});
