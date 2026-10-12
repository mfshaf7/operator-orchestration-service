import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { loadConfig } from "../src/config.js";
import {
  assertProductPublicationContract,
  createProductPublicationEvaluation,
  productPublicationDigest,
  productPublicationManifest,
} from "../src/product-publication/contracts.js";
import { createProductPublicationRuntime } from "../src/product-publication/runtime.js";
import { createProductPublicationService } from "../src/product-publication/service.js";
import { createProductPublicationStore } from "../src/product-publication/store.js";
import { createWgcfProductPublicationClient } from "../src/product-publication/wgcf-client.js";

const callerId = "governance-operations-console";
const operatorId = "operator:mfshaf7";
const authorityRevision = "a".repeat(40);
const sourceRevision = "b".repeat(40);
const manifestRevision = "c".repeat(40);
const implementationRef = "d".repeat(40);
const serviceIdentityRef = "spiffe://dev-integration/wgcf/product-publication";
const now = "2026-10-12T05:15:00.000Z";

function command(overrides = {}) {
  return {
    schema_version: 1,
    artifact_type: "product-publication-command",
    request_id: "product-publication-request:console:1",
    idempotency_key: "product-publication:console:1",
    session_ref: "session:console:1",
    execution_ref: "execution:console:1",
    authority_revision: authorityRevision,
    manifest_source: {
      repo: "governance-operations-console",
      path: "product-publication/manifest.json",
      source_revision: sourceRevision,
      manifest_revision: manifestRevision,
      manifest_digest: `sha256:${"e".repeat(64)}`,
    },
    action: "publish",
    expected_publication_version: 0,
    current_publication_posture: "unlisted",
    target_publication: {
      posture: "internal",
      listing_scope: "workspace-portfolio",
      audience: "workspace-operators",
      access_class: "workspace-authenticated",
    },
    previous_receipt: null,
    operator_id: operatorId,
    operator_decision: {
      decision: "approve",
      reason: "Publish the reviewed internal portfolio record.",
      decided_at: "2026-10-12T05:00:00Z",
    },
    security_decision: {
      uri: "security-architecture://product-publication/decisions/console-internal-v1",
      digest: `sha256:${"f".repeat(64)}`,
      revision: "1".repeat(40),
    },
    requested_at: "2026-10-12T05:01:00Z",
    ...overrides,
  };
}

function readinessFor(evaluation, outcome = "ready") {
  const readiness = {
    schema_version: 1,
    artifact_type: "product-publication-readiness",
    readiness_id: evaluation.evaluation_id.replace("evaluation", "readiness"),
    evaluated_at: "2026-10-12T05:02:00Z",
    expires_at: "2026-10-12T05:30:00Z",
    request_ref: {
      id: evaluation.request.request_id,
      digest: evaluation.request.request_digest,
      idempotency_key: evaluation.request.idempotency_key,
    },
    product_id: "product:governance-operations-console",
    manifest_binding: {
      manifest_id: "product-publication-manifest:governance-operations-console:1",
      manifest_digest: evaluation.manifest_source.manifest_digest,
      owner_repo: evaluation.manifest_source.repo,
      owner_revision: evaluation.manifest_source.source_revision,
      manifest_revision: evaluation.manifest_source.manifest_revision,
      path: evaluation.manifest_source.path,
    },
    authority_binding: {
      revision: evaluation.authority_revision,
      contract_digest: `sha256:${"2".repeat(64)}`,
      products_digest: `sha256:${"3".repeat(64)}`,
    },
    target_publication: structuredClone(evaluation.request.target_publication),
    outcome,
    findings: outcome === "ready" ? [] : [{
      code: "stale-owner-manifest",
      severity: "blocking",
      message: "Refresh the owner manifest.",
    }],
    secret_values_embedded: false,
  };
  readiness.readiness_digest = productPublicationDigest(readiness, "readiness_digest");
  const ref = {
    uri: `wgcf://product-publication/readiness-receipts/${readiness.readiness_digest.slice(7)}`,
    digest: readiness.readiness_digest,
  };
  return {
    readiness,
    ledger: {
      resolution: "read",
      state: "durable",
      ref,
      authority_revision: evaluation.authority_revision,
      contract_digest: readiness.authority_binding.contract_digest,
      implementation_ref: implementationRef,
      service_identity_ref: serviceIdentityRef,
      expires_at: readiness.expires_at,
    },
  };
}

async function fixture(t, outcome = "ready") {
  const root = await mkdtemp(path.join(os.tmpdir(), "oos-product-publication-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  let calls = 0;
  const service = createProductPublicationService({
    clock: () => new Date(now),
    operatorBindings: { [callerId]: operatorId },
    securityDecision: command().security_decision,
    readinessClient: {
      async evaluate(evaluation) {
        calls += 1;
        return readinessFor(evaluation, outcome);
      },
    },
    store: createProductPublicationStore({ root }),
  });
  return { calls: () => calls, service };
}

test("Product Publication bundle pins merged Workspace Governance and WGCF authorities", () => {
  assert.equal(productPublicationManifest.runtime_activation, false);
  assert.equal(productPublicationManifest.publication_authority.minimum_commit, "213b9fed48f8bd0e6e6fd658bfeae38cfd9e3784");
  assert.equal(productPublicationManifest.readiness_authority.minimum_commit, "d12545242fed839df3bce65ad4dd5d6482e7854a");
  assertProductPublicationContract("command.schema.json", command());
  const evaluation = createProductPublicationEvaluation(command());
  assert.equal(evaluation.request.request_digest, productPublicationDigest(evaluation.request, "request_digest"));
  assert.equal(evaluation.evaluation_digest, productPublicationDigest(evaluation, "evaluation_digest"));
});

test("Product Publication config binds the exact Security decision", () => {
  const config = loadConfig({
    OOS_PRODUCT_PUBLICATION_SECURITY_DECISION_URI: "  security-architecture://reviews/product-publication  ",
    OOS_PRODUCT_PUBLICATION_SECURITY_DECISION_DIGEST: `  sha256:${"e".repeat(64)}  `,
    OOS_PRODUCT_PUBLICATION_SECURITY_DECISION_REVISION: `  ${"f".repeat(40)}  `,
  });

  assert.deepEqual(
    {
      uri: config.productPublication.securityDecisionUri,
      digest: config.productPublication.securityDecisionDigest,
      revision: config.productPublication.securityDecisionRevision,
    },
    {
      uri: "security-architecture://reviews/product-publication",
      digest: `sha256:${"e".repeat(64)}`,
      revision: "f".repeat(40),
    },
  );
});

test("runtime image carries the Product Publication contract bundle", async () => {
  const dockerfile = await readFile(new URL("../Dockerfile", import.meta.url), "utf8");
  assert.match(
    dockerfile,
    /COPY --chown=node:node contracts\/product-publication \.\/contracts\/product-publication/,
  );
});

test("case:1255-positive journals exact readiness, emits one immutable receipt, and replays safely", async (t) => {
  const { calls, service } = await fixture(t);
  const created = await service.submit({ callerId, input: command(), operatorId });
  assert.equal(created.state, "applied");
  assert.equal(created.receipt.publication_version, 1);
  assert.equal(created.receipt.publication_posture, "internal");
  assert.equal(created.packet.authority_refs.readiness_receipt_ref, created.readiness.ledger.ref.uri);
  assert.equal(created.packet.grants.security_acceptance, false);
  assert.equal(created.cross_boundary_authority_granted, false);
  assert.equal(created.receipt_digest, productPublicationDigest(created.receipt));

  const replayed = await service.submit({ callerId, input: command(), operatorId });
  assert.equal(replayed.resolution, "replayed");
  assert.equal(replayed.receipt_digest, created.receipt_digest);
  assert.equal(calls(), 1);

  const read = await service.get({ callerId, requestId: command().request_id });
  assert.equal(read.resolution, "read");
  assert.deepEqual(read.receipt, created.receipt);
  await assert.rejects(
    service.get({ callerId: "another-caller", requestId: command().request_id }),
    (error) => error.statusCode === 404,
  );
});

test("case:1255-negative rejects replay conflicts, stale versions, unauthorized callers, and cross-boundary refs", async (t) => {
  const { calls, service } = await fixture(t);
  await assert.rejects(
    service.submit({
      callerId,
      operatorId,
      input: command({
        security_decision: {
          ...command().security_decision,
          digest: `sha256:${"0".repeat(64)}`,
        },
      }),
    }),
    (error) => error.code === "product_publication_security_decision_mismatch",
  );
  assert.equal(calls(), 0);
  const created = await service.submit({ callerId, input: command(), operatorId });
  await assert.rejects(
    service.submit({
      callerId,
      operatorId,
      input: command({ target_publication: { ...command().target_publication, posture: "public" } }),
    }),
    (error) => error.code === "product_publication_idempotency_conflict",
  );
  await assert.rejects(
    service.submit({ callerId, input: command(), operatorId: "operator:other" }),
    (error) => error.code === "product_publication_operator_binding_invalid",
  );
  assert.throws(
    () => assertProductPublicationContract("command.schema.json", command({
      security_decision: {
        ...command().security_decision,
        uri: "oos://pretend-security-decision",
      },
    })),
    /Invalid Product Publication command contract/,
  );
  const update = command({
    request_id: "product-publication-request:console:2",
    idempotency_key: "product-publication:console:2",
    action: "update",
    expected_publication_version: 1,
    current_publication_posture: "internal",
    previous_receipt: {
      receipt_id: created.receipt.receipt_id,
      receipt_digest: `sha256:${"9".repeat(64)}`,
      publication_version: 1,
    },
  });
  await assert.rejects(
    service.submit({ callerId, input: update, operatorId }),
    (error) => error.code === "product_publication_publication_version_conflict",
  );
});

test("blocked readiness produces a terminal rejection without advancing publication version", async (t) => {
  const { service } = await fixture(t, "stale");
  const result = await service.submit({ callerId, input: command(), operatorId });
  assert.equal(result.state, "rejected");
  assert.equal(result.receipt.publication_version, null);
  assert.equal(result.receipt.publication_posture, null);
  assert.equal(result.next_action, "correct-owner-evidence-and-submit-new-request");
});

test("WGCF client accepts exact issue/readback and rejects issuer or manifest drift", async () => {
  const evaluation = createProductPublicationEvaluation(command());
  const body = readinessFor(evaluation);
  const responses = [
    { ...structuredClone(body), ledger: { ...body.ledger, resolution: "created" } },
    structuredClone(body),
  ];
  const calls = [];
  const client = createWgcfProductPublicationClient({
    baseUrl: "http://wgcf.test",
    callerId: "operator-orchestration-service",
    callerSecret: "x".repeat(32),
    implementationRef,
    serviceIdentityRef,
    clock: () => new Date(now),
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      const response = responses.shift();
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        text: async () => JSON.stringify(response),
      };
    },
  });
  const result = await client.evaluate(evaluation);
  assert.equal(result.readiness.outcome, "ready");
  assert.equal(calls.length, 2);
  assert.equal(calls[0].options.headers["x-wgcf-caller-id"], "operator-orchestration-service");

  const drift = readinessFor(evaluation);
  drift.ledger.implementation_ref = "0".repeat(40);
  const rejected = createWgcfProductPublicationClient({
    baseUrl: "http://wgcf.test",
    callerId: "operator-orchestration-service",
    callerSecret: "x".repeat(32),
    implementationRef,
    serviceIdentityRef,
    clock: () => new Date(now),
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      text: async () => JSON.stringify(drift),
    }),
  });
  await assert.rejects(
    rejected.evaluate(evaluation),
    (error) => error.code === "product_publication_readiness_mismatch",
  );

  const contradictory = readinessFor(evaluation);
  contradictory.ledger.contract_digest = `sha256:${"0".repeat(64)}`;
  const contradictoryClient = createWgcfProductPublicationClient({
    baseUrl: "http://wgcf.test",
    callerId: "operator-orchestration-service",
    callerSecret: "x".repeat(32),
    implementationRef,
    serviceIdentityRef,
    clock: () => new Date(now),
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      text: async () => JSON.stringify(contradictory),
    }),
  });
  await assert.rejects(
    contradictoryClient.evaluate(evaluation),
    (error) => error.code === "product_publication_readiness_mismatch",
  );
});

test("runtime remains fail-closed until Security and Platform activation land", () => {
  assert.throws(
    () => createProductPublicationRuntime({
      config: { enabled: true, profile: "dev-integration" },
    }),
    (error) => error.code === "product_publication_activation_required",
  );
});
