import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { assertClosureReadiness, closureDigest, closureManifest, createClosureEvaluation } from "../src/prototype-closure/contracts.js";
import { createPrototypeClosureGitHubClient } from "../src/prototype-closure/provider-client.js";

test("Closure readiness binds record, evidence, contract, issuer and expiry", () => {
  const request = {
    schema_version: 2, artifact_type: "prototype-closure-request",
    request_id: "closure:test", prototype_id: "sample", action: "retire-incubation",
    expected_lifecycle: "candidate", expected_source_revision: "a".repeat(40),
    operator_id: "operator:test", correlation_id: "correlation:test", idempotency_key: "key:test",
    retirement_reason: "Exploration ended", retention_plan_ref: "plan://sample/retention",
    runtime_disposition_plan_ref: "plan://sample/runtime",
  };
  const evaluation = createClosureEvaluation(request, `sha256:${"b".repeat(64)}`);
  const evidence = [{ field: "runtime_disposition_proof_ref", ref: "proof://sample/absent" }];
  const readiness = {
    artifact_type: "prototype-closure-readiness",
    request_ref: { id: request.request_id, digest: closureDigest(request, { ascii: true }) },
    prototype_id: request.prototype_id, action: request.action, actor: "operator-orchestration-service",
    operator_id: request.operator_id, source_revision: request.expected_source_revision,
    record_digest: evaluation.expected_record_digest,
    contract_digest: `sha256:${closureManifest.contract_authority.digest}`,
    security_review_ref: closureManifest.security_review.commit,
    outcome: "ready", evidence, evidence_digest: closureDigest(evidence),
  };
  readiness.readiness_digest = closureDigest(readiness);
  const body = {
    readiness,
    ledger: {
      state: "durable", expires_at: "2026-09-14T13:00:00.000Z",
      ref: { uri: `wgcf://readiness/prototype-closure/${readiness.readiness_digest.slice(7)}`, digest: readiness.readiness_digest },
      authority_revision: request.expected_source_revision,
      implementation_ref: "c".repeat(40), service_identity_ref: "spiffe://test/closure",
    },
  };
  const options = { implementationRef: "c".repeat(40), serviceIdentityRef: "spiffe://test/closure", now: new Date("2026-09-14T12:00:00.000Z") };
  assert.equal(assertClosureReadiness(body, evaluation, options), body);
  const tampered = structuredClone(body);
  tampered.readiness.record_digest = `sha256:${"d".repeat(64)}`;
  tampered.readiness.readiness_digest = closureDigest(tampered.readiness, { omit: "readiness_digest" });
  tampered.ledger.ref.digest = tampered.readiness.readiness_digest;
  tampered.ledger.ref.uri = `wgcf://readiness/prototype-closure/${tampered.readiness.readiness_digest.slice(7)}`;
  assert.throws(() => assertClosureReadiness(tampered, evaluation, options), /record|request|issuer/i);
});

test("Closure provider requires exact-head delegated approval attestation and owner validation", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "prototype-closure-provider-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const tokenFile = path.join(root, "token");
  await writeFile(tokenFile, "ghs_test", { mode: 0o600 });
  let checkName = "validate";
  let reviewer = 11;
  let reviewerLogin = "example";
  let approvalHead = "a".repeat(40);
  let approvalNumber = 7;
  let changesRequested = false;
  const head = "a".repeat(40);
  const base = "b".repeat(40);
  const merge = "c".repeat(40);
  const client = createPrototypeClosureGitHubClient({
    owner: "example", repositoryId: "123", tokenFile,
    fetchImpl: async (url) => {
      if (url.includes("/installation/repositories")) return Response.json({ total_count: 1, repositories: [{ id: 123, full_name: "example/workspace-prototype-studio" }] });
      if (url.includes("/pulls/7/reviews")) return Response.json([{
        id: 17, state: "APPROVED", commit_id: head,
        user: { id: reviewer, login: reviewerLogin, type: "User" },
        body: JSON.stringify({
          schema_version: 1, artifact_type: "prototype-closure-delegated-approval",
          pull_request_number: approvalNumber, head_commit: approvalHead, operator_login: "example",
          operator_decision: "approved-in-conversation", executed_by: "agent-gary",
        }),
      }, ...(changesRequested ? [{ id: 18, state: "CHANGES_REQUESTED", commit_id: head, user: { id: 12, login: "reviewer", type: "User" } }] : [])]);
      if (url.includes("/pulls/7")) return Response.json({
        number: 7, html_url: "https://github.com/example/workspace-prototype-studio/pull/7",
        state: "closed", merged: true, merge_commit_sha: merge, user: { id: 10, type: "User" },
        base: { ref: "main", repo: { id: 123 } },
        head: { ref: `prototype-closure/${"d".repeat(64)}`, sha: head, repo: { id: 123 } },
      });
      if (url.includes("/git/commits/")) return Response.json({ parents: [{ sha: base }] });
      if (url.includes("/check-runs")) return Response.json({ total_count: 1, check_runs: [{ name: checkName, head_sha: head, status: "completed", conclusion: "success" }] });
      if (url.includes("/compare/")) return Response.json({ status: "ahead" });
      throw new Error("unexpected provider route");
    },
  });
  const reviewed = await client.review(7);
  assert.equal(reviewed.delegated_approval?.head_commit, head);
  assert.equal(reviewed.delegated_approval?.review_ref, "https://github.com/example/workspace-prototype-studio/pull/7#pullrequestreview-17");
  await client.verifyMergedFiles(reviewed, { files: [] });
  checkName = "unrelated";
  await assert.rejects(client.verifyMergedFiles(reviewed, { files: [] }), /validation/i);
  reviewer = 10;
  const selfReviewed = await client.review(7);
  assert.equal(selfReviewed.delegated_approval, null);
  await assert.rejects(client.verifyMergedFiles(selfReviewed, { files: [] }), /delegated approval/i);
  reviewer = 11;
  reviewerLogin = "different-user";
  assert.equal((await client.review(7)).delegated_approval, null);
  reviewerLogin = "example";
  approvalHead = "f".repeat(40);
  assert.equal((await client.review(7)).delegated_approval, null);
  approvalHead = head;
  approvalNumber = 8;
  assert.equal((await client.review(7)).delegated_approval, null);
  approvalNumber = 7;
  changesRequested = true;
  assert.equal((await client.review(7)).delegated_approval, null);
});
