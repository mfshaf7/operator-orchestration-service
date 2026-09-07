import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import {
  createPrototypeLandingApply,
  createPrototypeLandingEvaluation,
  prototypeLandingDigest,
} from "../src/prototype-landing/contracts.js";
import { createPrototypeLandingGitHubClient } from "../src/prototype-landing/provider-client.js";
import { createPrototypeLandingSourceClient } from "../src/prototype-landing/source-client.js";
import { createWgcfPrototypeLandingClient } from "../src/prototype-landing/wgcf-client.js";
import { at, caller, commandFixture, preparationFixture, readinessFixture } from "../test-fixtures/prototype-landing/fixture.js";

test("WGCF Prototype Landing issue and readback bind exact durable readiness", async () => {
  const evaluation = createPrototypeLandingEvaluation(commandFixture(), caller);
  const options = {
    baseUrl: "http://127.0.0.1:18080",
    callerId: "operator-orchestration-service",
    callerSecret: "s".repeat(32),
    implementationRef: "5".repeat(40),
    serviceIdentityRef: "spiffe://test/wgcf/prototype-landing",
    clock: () => new Date(at),
  };
  const calls = [];
  const client = createWgcfPrototypeLandingClient({ ...options, fetchImpl: async (url, request) => {
    calls.push({ url, request });
    const result = readinessFixture(evaluation);
    result.ledger.resolution = request.method === "POST" ? "created" : "read";
    return Response.json(result);
  } });
  const result = await client.evaluate(evaluation);
  assert.equal(result.readiness.outcome, "ready");
  assert.equal(calls.length, 2);
  assert.equal(calls[0].request.headers["x-wgcf-caller-id"], options.callerId);
});

test("WGCF Prototype Landing rejects expired or mismatched evidence", async () => {
  const evaluation = createPrototypeLandingEvaluation(commandFixture(), caller);
  const base = {
    baseUrl: "http://127.0.0.1:18080",
    callerId: "operator-orchestration-service",
    callerSecret: "s".repeat(32),
    implementationRef: "5".repeat(40),
    serviceIdentityRef: "spiffe://test/wgcf/prototype-landing",
    clock: () => new Date("2026-09-07T12:16:00Z"),
  };
  await assert.rejects(createWgcfPrototypeLandingClient({ ...base, fetchImpl: async () => Response.json(readinessFixture(evaluation)) }).evaluate(evaluation), /expired/);
  const current = { ...base, clock: () => new Date(at) };
  await assert.rejects(createWgcfPrototypeLandingClient({ ...current, fetchImpl: async () => {
    const result = readinessFixture(evaluation);
    result.ledger.implementation_ref = "6".repeat(40);
    return Response.json(result);
  } }).evaluate(evaluation), /configured issuer/);
});

test("Prototype Landing provider rejects broad identity, PAT and non-loopback sandbox", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "prototype-landing-provider-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const tokenFile = path.join(root, "token");
  await writeFile(tokenFile, "ghs_test", { mode: 0o600 });
  const options = { owner: "example", repositoryId: "123", tokenFile };
  assert.throws(() => createPrototypeLandingGitHubClient({ ...options, apiBaseUrl: "https://other.invalid" }), /not admitted/);
  let broad = true;
  const client = createPrototypeLandingGitHubClient({ ...options, fetchImpl: async (url, request) => {
    assert.equal(request.redirect, "error");
    assert.equal(request.headers.Authorization, "Bearer ghs_test");
    if (url.includes("/installation/repositories")) return Response.json({ total_count: broad ? 2 : 1, repositories: [{ id: 123, full_name: "example/workspace-prototype-studio" }] });
    return Response.json({ object: { sha: "1".repeat(40) } });
  } });
  await assert.rejects(client.mainRevision(), /restricted/);
  broad = false;
  assert.equal(await client.mainRevision(), "1".repeat(40));
  await writeFile(tokenFile, "ghp_personal");
  await assert.rejects(client.mainRevision(), /installation token/);
});

test("Prototype Landing provider proves exact-head review, checks and merged bytes", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "prototype-landing-provider-merge-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const tokenFile = path.join(root, "token");
  await writeFile(tokenFile, "ghs_test", { mode: 0o600 });
  const base = "1".repeat(40);
  const head = "9".repeat(40);
  const merge = "a".repeat(40);
  const branch = `prototype-landing/${"2".repeat(64)}`;
  const bytes = Buffer.from("prototype: exact merged content\n");
  const fetchImpl = async (url) => {
    const route = new URL(url).pathname + new URL(url).search;
    if (route === "/installation/repositories?per_page=2") {
      return Response.json({ total_count: 1, repositories: [{ id: 123, full_name: "example/workspace-prototype-studio" }] });
    }
    if (route.endsWith("/pulls/7")) {
      return Response.json({
        number: 7,
        html_url: "https://github.com/example/workspace-prototype-studio/pull/7",
        state: "closed",
        merged: true,
        merge_commit_sha: merge,
        merged_by: { type: "User" },
        base: { ref: "main", repo: { id: 123 } },
        head: { ref: branch, sha: head, repo: { id: 123 } },
      });
    }
    if (route.endsWith(`/git/commits/${head}`)) return Response.json({ parents: [{ sha: base }] });
    if (route.endsWith("/pulls/7/reviews?per_page=100")) {
      return Response.json([{ state: "APPROVED", commit_id: head, user: { id: 42, type: "User" } }]);
    }
    if (route.endsWith(`/commits/${head}/check-runs?per_page=100`)) {
      return Response.json({ total_count: 1, check_runs: [{ head_sha: head, status: "completed", conclusion: "success" }] });
    }
    if (route.endsWith(`/compare/${merge}...main`)) return Response.json({ status: "identical" });
    if (route.endsWith(`/contents/prototypes.yaml?ref=${merge}`)) {
      return Response.json({ encoding: "base64", content: bytes.toString("base64") });
    }
    throw new Error(`Unexpected provider route: ${route}`);
  };
  const client = createPrototypeLandingGitHubClient({ owner: "example", repositoryId: "123", tokenFile, fetchImpl });
  const review = await client.review(7);
  assert.equal(review.human_reviewed, true);
  await client.verifyMergedFiles(review, {
    files: [{ path: "prototypes.yaml", mode: "100644", content_base64: bytes.toString("base64") }],
  });
});

test("Prototype Landing cancellation reconciles a retained prepared branch", async () => {
  const input = commandFixture();
  const evaluation = createPrototypeLandingEvaluation(input, caller);
  const readiness = readinessFixture(evaluation);
  const bindingDigest = prototypeLandingDigest({ caller_id: caller, evaluation, operator_approval_ref: input.operator_approval_ref });
  const sourceClient = createPrototypeLandingSourceClient({
    authorityRoot: "/not-used-for-cancel",
    provider: {
      async findReview() { return null; },
      async verifyPreparedBranch(preparation) {
        assert.equal(preparation.branch, `prototype-landing/${bindingDigest.slice(7)}`);
        return true;
      },
    },
  });
  const record = { binding_digest: bindingDigest, evaluation, readiness, review: null };
  record.apply = createPrototypeLandingApply({
    evaluation,
    readiness: readiness.readiness,
    operatorApprovalRef: input.operator_approval_ref,
    sourceBranch: sourceClient.branch(record),
    requestedAt: at,
  });
  record.preparation = preparationFixture(evaluation, readiness.readiness, record.apply, sourceClient.branch(record));
  assert.deepEqual(await sourceClient.cancel(record, () => {}), { retained_branch: record.preparation.branch });
});
