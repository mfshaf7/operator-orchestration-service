import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { bindInventory, createInventoryEvaluation, createInventoryLifecycleEvaluation } from "../src/workspace-inventory/contracts.js";
import { createWorkspaceInventoryGitHubClient } from "../src/workspace-inventory/provider-client.js";
import { createWgcfWorkspaceInventoryClient, createWgcfWorkspaceInventoryLifecycleClient } from "../src/workspace-inventory/wgcf-client.js";
import { caller, inputFixture, lifecycleInputFixture, lifecycleReadinessFixture, readinessFixture } from "../test-fixtures/workspace-inventory/fixture.js";

test("WGCF issue and readback bind the exact promotion and durable receipt", async () => {
  const evaluation = createInventoryEvaluation(inputFixture(), caller);
  const options = {
    baseUrl: "http://127.0.0.1:18080",
    callerId: "operator-orchestration-service",
    callerSecret: "s".repeat(32),
  };
  for (const fault of [null, "target", "state", "ledger", "digest"]) {
    const calls = [];
    const client = createWgcfWorkspaceInventoryClient({
      ...options,
      fetchImpl: async (url, request) => {
        calls.push({ url, ...request });
        const body = readinessFixture(evaluation);
        body.ledger.resolution = request.method === "POST" ? "created" : "read";
        if (fault === "target") body.readiness.target.name = "other";
        if (fault === "state") body.readiness.observed_state.intake_entry_version = 2;
        if (fault === "ledger") body.ledger.ref.digest = `sha256:${"4".repeat(64)}`;
        if (fault === "digest") body.readiness.outcome = "blocked";
        body.readiness = bindInventory(body.readiness, "readiness_digest");
        return Response.json(body);
      },
    });
    if (fault) {
      await assert.rejects(client.evaluate(evaluation));
    } else {
      assert.equal((await client.evaluate(evaluation)).ledger.state, "durable");
      assert.equal(calls.length, 2);
      assert.equal(calls[0].headers["x-wgcf-caller-id"], options.callerId);
    }
  }
});

test("WGCF issue and readback bind the exact lifecycle action and durable receipt", async () => {
  const evaluation = createInventoryLifecycleEvaluation(lifecycleInputFixture().input, caller);
  const calls = [];
  const client = createWgcfWorkspaceInventoryLifecycleClient({
    baseUrl: "http://127.0.0.1:18080",
    callerId: "operator-orchestration-service",
    callerSecret: "s".repeat(32),
    fetchImpl: async (url, request) => {
      calls.push({ url, ...request });
      const body = lifecycleReadinessFixture(evaluation);
      body.ledger.resolution = request.method === "POST" ? "created" : "read";
      return Response.json(body);
    },
  });
  assert.equal((await client.evaluate(evaluation)).ledger.state, "durable");
  assert.equal(calls.length, 2);
  assert.ok(calls[0].url.endsWith("/v1/readiness/workspace-inventory-lifecycle"));
});

test("GitHub boundary rejects broad identity, PAT, wrong host and unproven merged readback", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "inventory-provider-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const tokenFile = path.join(root, "token");
  await writeFile(tokenFile, "ghs_test", { mode: 0o600 });
  const options = { owner: "example", repositoryId: "123", tokenFile };
  assert.throws(() => createWorkspaceInventoryGitHubClient({ ...options, apiBaseUrl: "https://other.invalid" }));
  let broad = true;
  let conclusion = "success";
  const client = createWorkspaceInventoryGitHubClient({ ...options, fetchImpl: async (url) => {
    if (url.includes("/installation/repositories")) {
      return Response.json({ total_count: broad ? 2 : 1, repositories: [{ id: 123, full_name: "example/workspace-governance" }] });
    }
    if (url.includes("check-runs")) {
      return Response.json({ total_count: 1, check_runs: [{ head_sha: "3".repeat(40), status: "completed", conclusion }] });
    }
    if (url.includes("compare")) return Response.json({ status: "diverged" });
    if (url.includes("/contents/")) return Response.json({ encoding: "base64", content: Buffer.from("schema_version: 2\n").toString("base64") });
    return Response.json({ object: { sha: "1".repeat(40) } });
  } });
  await assert.rejects(client.mainRevision(), /restricted/);
  broad = false;
  assert.equal(await client.mainRevision(), "1".repeat(40));
  const review = { merged: true, human_reviewed: true, merge_commit: "2".repeat(40), head_commit: "3".repeat(40) };
  await assert.rejects(client.readMergedFiles(review, "contracts/components.yaml"), /canonical main/);
  for (conclusion of ["skipped", "neutral", "failure"]) {
    await assert.rejects(client.readMergedFiles(review, "contracts/components.yaml"));
  }
  await writeFile(tokenFile, "ghp_personal");
  await assert.rejects(client.mainRevision(), /installation token/);
});
