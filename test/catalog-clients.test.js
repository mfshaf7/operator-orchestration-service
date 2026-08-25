import assert from "node:assert/strict";
import test from "node:test";

import { createCatalogBackendClient } from "../src/catalog/http-client.js";
import { createWgcfRepositoryReadinessClient } from "../src/catalog/wgcf-readiness-client.js";

const digest = `sha256:${"a".repeat(64)}`;
const token = "1234567890abcdef12345678";
const uri = `wgcf://receipts/repository-readiness/repository-readiness-receipt-${token}-${"a".repeat(64)}.json`;

function reference() {
  return {
    repo_name: "operator-orchestration-service",
    repo_ref: "repo://operator-orchestration-service",
    catalog_value_key: "operator-orchestration-service",
    receipt: {
      receipt_id: `repository-readiness-receipt:${token}`,
      uri,
      digest,
      issuer: "workspace-governance-control-fabric",
      target_scope: "repo:operator-orchestration-service",
      outcome: "ready",
      evaluated_at: "2026-08-26T00:00:00Z",
      generation: 1,
    },
  };
}

function readinessEnvelope() {
  return {
    receipt: {
      artifact_type: "repository_readiness_receipt",
      receipt_id: `repository-readiness-receipt:${token}`,
      subject: {
        repo_name: "operator-orchestration-service",
        repo_ref: "repo://operator-orchestration-service",
        owner_repo: "operator-orchestration-service",
        catalog_value_key: "operator-orchestration-service",
      },
      decision: { outcome: "ready", linking_allowed: true, mutation_authority: "none" },
      authority: { record_digest: `sha256:${"c".repeat(64)}` },
      integrity: { content_digest: digest },
      custody: { state: "durable", uri },
    },
    ledger: {
      generation: 1,
      resolution: "reused",
      state: "durable",
      ref: { uri, digest },
    },
    repository_readiness_reference: reference(),
  };
}

test("WGCF repository readiness is reread and reevaluated before linking", async () => {
  const calls = [];
  const client = createWgcfRepositoryReadinessClient({
    baseUrl: "http://wgcf.test",
    callerId: "operator-orchestration-service",
    callerSecret: "s".repeat(32),
    async fetchImpl(url, init) {
      calls.push({ url, init });
      return new Response(JSON.stringify(readinessEnvelope()), {
        headers: { "content-type": "application/json" },
        status: 200,
      });
    },
  });
  assert.deepEqual(await client.verifyCurrent(reference()), reference());
  assert.equal(calls.length, 2);
  assert.match(calls[0].url, new RegExp(`${token}$`));
  assert.equal(calls[0].init.method, "GET");
  assert.equal(calls[1].init.method, "POST");
  const reevaluation = JSON.parse(calls[1].init.body);
  assert.equal(reevaluation.expected_authority_digest, `sha256:${"c".repeat(64)}`);
  assert.equal(reevaluation.policy_scope, "delivery-catalog-owner-repo");
});

test("Catalog backend client is fail-closed until its privileged route is configured", async () => {
  const client = createCatalogBackendClient({});
  await assert.rejects(
    client.project(),
    (error) => error.code === "upstream_not_configured" && error.statusCode === 503,
  );
});

test("Catalog backend client binds token, item identity, and mutation body", async () => {
  const calls = [];
  const client = createCatalogBackendClient({
    baseUrl: "http://openproject-control.test/",
    token: "t".repeat(32),
    async fetchImpl(url, init) {
      calls.push({ url, init });
      return new Response(JSON.stringify({ status: "applied" }), { status: 200 });
    },
  });
  await client.mutate("owner repo", { request_id: "request-1" });
  assert.equal(
    calls[0].url,
    "http://openproject-control.test/v1/delivery-catalog/owner%20repo/mutations",
  );
  assert.equal(calls[0].init.headers.Authorization, `Bearer ${"t".repeat(32)}`);
  assert.deepEqual(JSON.parse(calls[0].init.body), { request_id: "request-1" });
});

test("Catalog backend client enforces the response budget while streaming", async () => {
  const client = createCatalogBackendClient({
    baseUrl: "http://openproject-control.test",
    token: "t".repeat(32),
    async fetchImpl() {
      return new Response("x".repeat(1_048_577), { status: 200 });
    },
  });

  await assert.rejects(
    client.project(),
    (error) => error.code === "upstream_response_oversized",
  );
});
