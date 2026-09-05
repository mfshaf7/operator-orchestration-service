import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { bindIntake, createIntakeEvaluation } from "../src/workspace-intake/contracts.js";
import { createWgcfWorkspaceIntakeClient } from "../src/workspace-intake/wgcf-client.js";
import { createWorkspaceIntakeGitHubClient } from "../src/workspace-intake/provider-client.js";
import { caller, inputFixture, readinessFixture } from "../test-fixtures/workspace-intake/fixture.js";

test("WGCF issue/readback binds durable digest and configured issuer", async () => {
  const evaluation = createIntakeEvaluation(inputFixture(), caller);
  const options = { baseUrl: "http://127.0.0.1:18080", callerId: "operator-orchestration-service", callerSecret: "s".repeat(32), implementationRef: "2".repeat(40), serviceIdentityRef: "spiffe://test/wgcf" };
  for (const fault of [null, "issuer", "ledger", "session", "digest"]) {
    const calls = [];
    const client = createWgcfWorkspaceIntakeClient({ ...options, fetchImpl: async (url, request) => {
      calls.push({ url, ...request });
      const body = readinessFixture(evaluation);
      body.ledger.resolution = request.method === "POST" ? "created" : "read";
      if (fault === "issuer") body.receipt.issuer.implementation_ref = "3".repeat(40);
      if (fault === "session") body.receipt.session_ref = "different-session";
      body.receipt = bindIntake(body.receipt, "receipt_digest");
      if (fault === "ledger") body.ledger.ref.digest = "sha256:" + "4".repeat(64);
      if (fault === "digest") body.receipt.outcome = "denied";
      return new Response(JSON.stringify(body), { status: 200 });
    } });
    if (fault) await assert.rejects(client.evaluate(evaluation));
    else {
      assert.equal((await client.evaluate(evaluation)).ledger.state, "durable");
      assert.equal(calls.length, 2);
      assert.equal(calls[0].headers["x-wgcf-caller-id"], options.callerId);
    }
  }
});

test("GitHub boundary rejects broad identity, PAT, wrong host and wrong canonical ancestry", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "intake-provider-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const tokenFile = path.join(root, "token");
  await writeFile(tokenFile, "ghs_test", { mode: 0o600 });
  const options = { owner: "example", repositoryId: "123", tokenFile };
  assert.throws(() => createWorkspaceIntakeGitHubClient({ ...options, apiBaseUrl: "https://other.invalid" }));
  let broad = true;
  let conclusion = "success";
  const client = createWorkspaceIntakeGitHubClient({ ...options, fetchImpl: async (url, request) => {
    assert.equal(request.redirect, "error");
    assert.equal(request.headers.Authorization, "Bearer ghs_test");
    if (url.includes("/installation/repositories")) return Response.json({ total_count: broad ? 2 : 1, repositories: [{ id: 123, full_name: "example/workspace-governance" }] });
    if (url.includes("compare")) return Response.json({ status: "diverged" });
    if (url.includes("check-runs")) return Response.json({ total_count: 1, check_runs: [{ head_sha: "3".repeat(40), status: "completed", conclusion }] });
    return Response.json({ object: { sha: "1".repeat(40) } });
  } });
  await assert.rejects(client.mainRevision(), /restricted/);
  broad = false;
  assert.equal(await client.mainRevision(), "1".repeat(40));
  await assert.rejects(client.readMergedRegister({ merged: true, human_reviewed: true, merge_commit: "2".repeat(40), head_commit: "3".repeat(40) }), /canonical main/);
  await assert.rejects(client.readMergedRegister({ merged: true, human_reviewed: true, merge_commit: "2".repeat(40), head_commit: "4".repeat(40) }), /validation/);
  for (conclusion of ["skipped", "neutral", "failure"]) {
    await assert.rejects(client.readMergedRegister({ merged: true, human_reviewed: true, merge_commit: "2".repeat(40), head_commit: "3".repeat(40) }), /validation/);
  }
  await writeFile(tokenFile, "ghp_personal");
  await assert.rejects(client.mainRevision(), /installation token/);
});
