import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { loadConfig } from "../src/config.js";
import {
  assertProductPublicationContract,
  assertProductPublicationTransition,
  createProductPublicationEvaluation,
  productPublicationDigest,
  productPublicationCapability,
  productPublicationManifest,
  productPublicationSecurityAuthority,
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
      uri: "security-architecture://product-publication/decisions/audience-internal-only-v1",
      digest: "sha256:9a3ca8531c686fe9c278d82e7328099517e56de4fc856f33c177d9de2ed44494",
      revision: "9729514bd764fad8700a649035f860fa1e0a97d4",
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
  if (evaluation.schema_version === 2) {
    const restoring = evaluation.request.action === "restore";
    readiness.schema_version = 2;
    readiness.authority_binding.history_digest = `sha256:${"4".repeat(64)}`;
    readiness.action = evaluation.request.action;
    readiness.current_publication_posture = evaluation.request.current_publication_posture;
    readiness.previous_receipt = structuredClone(evaluation.request.previous_receipt);
    readiness.inventory_lifecycle_binding = {
      action: restoring ? "restore" : "retire",
      receipt_ref: {
        id: `workspace-inventory-lifecycle-receipt:${restoring ? "restore" : "retire"}:console`,
        digest: `sha256:${(restoring ? "5" : "6").repeat(64)}`,
      },
      history_event_ref: {
        id: `workspace-inventory-history-event:${restoring ? "restore" : "retire"}:console`,
        digest: `sha256:${(restoring ? "7" : "8").repeat(64)}`,
        sequence: restoring ? 12 : 11,
      },
      previous_event_ref: {
        id: "workspace-inventory-history-event:previous:console",
        digest: `sha256:${"9".repeat(64)}`,
      },
      after: {
        record_version: restoring ? 12 : 11,
        record_digest: `sha256:${(restoring ? "a" : "b").repeat(64)}`,
        posture: restoring ? "active" : "retired",
      },
    };
  }
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

async function fixture(t, outcome = "ready", options = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "oos-product-publication-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  let calls = 0;
  const service = createProductPublicationService({
    allowedTargetPostures: options.allowedTargetPostures ?? productPublicationManifest.allowed_target_postures,
    allowedLifecycleMaintenanceActions: options.allowedLifecycleMaintenanceActions ?? [],
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
  assert.equal(productPublicationManifest.runtime_activation, true);
  assert.deepEqual(productPublicationManifest.allowed_target_postures, ["internal"]);
  assert.deepEqual(productPublicationCapability.targetPostures, [
    "unlisted", "internal", "client", "public", "archived",
  ]);
  assert.equal(productPublicationManifest.publication_authority.minimum_commit, "06b954b31466f9779dce8ec54f722f348b885505");
  assert.equal(productPublicationManifest.readiness_authority.minimum_commit, "9d3e5ef1b8fafac1bf0970a7d997021c37052535");
  assert.deepEqual(productPublicationCapability.lifecycleMaintenance, {
    contract_support: true,
    runtime_activation: false,
    supported_actions: ["archive", "restore"],
    allowed_actions: [],
    activation_prerequisites: {
      security_work_item: "openproject://work_packages/1271",
      oos_activation_work_item: "openproject://work_packages/1272",
      platform_commissioning_work_item: "openproject://work_packages/1273",
    },
  });
  assert.deepEqual(productPublicationSecurityAuthority, {
    uri: "security-architecture://product-publication/decisions/audience-internal-only-v1",
    digest: "sha256:9a3ca8531c686fe9c278d82e7328099517e56de4fc856f33c177d9de2ed44494",
    revision: "9729514bd764fad8700a649035f860fa1e0a97d4",
    approvedTargetPostures: ["internal"],
  });
  assert.deepEqual(productPublicationManifest.activation_prerequisites, {
    security_work_item: "openproject://work_packages/1262",
    platform_work_item: "openproject://work_packages/1264",
  });
  assertProductPublicationContract("command.schema.json", command());
  const evaluation = createProductPublicationEvaluation(command());
  assert.equal(evaluation.request.request_digest, productPublicationDigest(evaluation.request, "request_digest"));
  assert.equal(evaluation.evaluation_digest, productPublicationDigest(evaluation, "evaluation_digest"));
});

test("case:1260-positive accepts every contract-defined tuple and legal transition without broadening activation", () => {
  const targets = {
    unlisted: { posture: "unlisted", listing_scope: null, audience: null, access_class: null },
    internal: { posture: "internal", listing_scope: "workspace-portfolio", audience: "workspace-operators", access_class: "workspace-authenticated" },
    client: { posture: "client", listing_scope: "client-portfolio", audience: "authorized-clients", access_class: "client-authorized" },
    public: { posture: "public", listing_scope: "public-catalog", audience: "public", access_class: "public-anonymous" },
    archived: { posture: "archived", listing_scope: "historical-archive", audience: "historical", access_class: "historical-read-only" },
  };
  const cases = [
    ["publish", "unlisted", "internal"],
    ["publish", "unlisted", "client"],
    ["publish", "unlisted", "public"],
    ["update", "internal", "client"],
    ["update", "client", "public"],
    ["update", "public", "internal"],
    ["unpublish", "internal", "unlisted"],
    ["archive", "unlisted", "archived"],
  ];
  for (const [action, current, target] of cases) {
    assert.doesNotThrow(() => assertProductPublicationTransition(command({
      action,
      current_publication_posture: current,
      target_publication: targets[target],
    })));
  }
  assert.deepEqual(productPublicationManifest.allowed_target_postures, ["internal"]);
});

test("case:1260-negative rejects contradictory tuples and unsupported transitions before readiness", async (t) => {
  const { calls, service } = await fixture(t);
  await assert.rejects(
    service.submit({
      callerId,
      operatorId,
      input: command({
        target_publication: {
          posture: "internal",
          listing_scope: "public-catalog",
          audience: "public",
          access_class: "public-anonymous",
        },
      }),
    }),
    (error) => error.code === "product_publication_target_tuple_invalid",
  );
  await assert.rejects(
    service.submit({
      callerId,
      operatorId,
      input: command({
        action: "archive",
        current_publication_posture: "internal",
        target_publication: {
          posture: "archived",
          listing_scope: "historical-archive",
          audience: "historical",
          access_class: "historical-read-only",
        },
      }),
    }),
    (error) => error.code === "product_publication_transition_invalid",
  );
  assert.equal(calls(), 0);
});

test("case:1263-positive binds the exact Security decision without widening source activation", () => {
  assert.deepEqual(productPublicationManifest.allowed_target_postures, ["internal"]);
  assert.deepEqual(productPublicationSecurityAuthority.approvedTargetPostures, ["internal"]);
  assert.deepEqual(command().security_decision, {
    uri: productPublicationSecurityAuthority.uri,
    digest: productPublicationSecurityAuthority.digest,
    revision: productPublicationSecurityAuthority.revision,
  });
});

test("case:1263-negative rejects every unapproved target before readiness", async (t) => {
  const { calls, service } = await fixture(t);
  const cases = [
    ["unpublish", "internal", { posture: "unlisted", listing_scope: null, audience: null, access_class: null }],
    ["publish", "unlisted", { posture: "client", listing_scope: "client-portfolio", audience: "authorized-clients", access_class: "client-authorized" }],
    ["publish", "unlisted", { posture: "public", listing_scope: "public-catalog", audience: "public", access_class: "public-anonymous" }],
    ["archive", "unlisted", { posture: "archived", listing_scope: "historical-archive", audience: "historical", access_class: "historical-read-only" }],
  ];
  for (const [action, current, target] of cases) {
    await assert.rejects(
      service.submit({
        callerId,
        operatorId,
        input: command({
          action,
          current_publication_posture: current,
          target_publication: target,
        }),
      }),
      (error) => error.code === "product_publication_target_posture_not_approved",
    );
  }
  assert.equal(calls(), 0);
});

test("case:1268-negative keeps schema-v2 archive and restore source-inactive", async (t) => {
  const { calls, service } = await fixture(t);
  const archive = command({
    schema_version: 2,
    action: "archive",
    current_publication_posture: "unlisted",
    target_publication: {
      posture: "archived",
      listing_scope: "historical-archive",
      audience: "historical",
      access_class: "historical-read-only",
    },
    expected_publication_version: 1,
    previous_receipt: {
      receipt_id: "product-publication-receipt:console:prior",
      receipt_digest: `sha256:${"1".repeat(64)}`,
      publication_version: 1,
      publication_posture: "unlisted",
    },
  });
  assertProductPublicationContract("command.schema.json", archive);
  assertProductPublicationTransition(archive);
  await assert.rejects(
    service.submit({ callerId, input: archive, operatorId }),
    (error) => error.code === "product_publication_lifecycle_maintenance_inactive",
  );
  assert.equal(calls(), 0);

  const restore = {
    ...archive,
    request_id: "product-publication-request:console:restore",
    idempotency_key: "product-publication:console:restore",
    action: "restore",
    current_publication_posture: "archived",
    target_publication: {
      posture: "unlisted",
      listing_scope: null,
      audience: null,
      access_class: null,
    },
    previous_receipt: { ...archive.previous_receipt, publication_posture: "archived" },
  };
  assertProductPublicationContract("command.schema.json", restore);
  assertProductPublicationTransition(restore);
  await assert.rejects(
    service.submit({ callerId, input: restore, operatorId }),
    (error) => error.code === "product_publication_lifecycle_maintenance_inactive",
  );
  assert.equal(calls(), 0);
});

test("case:1268-positive projects independent lifecycle, publication, owner, issue, and bounded history axes", async (t) => {
  const { service } = await fixture(t, "ready", {
    allowedTargetPostures: ["unlisted", "internal", "archived"],
    allowedLifecycleMaintenanceActions: ["archive", "restore"],
  });
  const published = await service.submit({ callerId, input: command(), operatorId });
  const unlisted = await service.submit({
    callerId,
    operatorId,
    input: command({
      request_id: "product-publication-request:console:2",
      idempotency_key: "product-publication:console:2",
      action: "unpublish",
      expected_publication_version: 1,
      current_publication_posture: "internal",
      target_publication: { posture: "unlisted", listing_scope: null, audience: null, access_class: null },
      previous_receipt: {
        receipt_id: published.receipt.receipt_id,
        receipt_digest: published.receipt_digest,
        publication_version: 1,
      },
    }),
  });
  const archived = await service.submit({
    callerId,
    operatorId,
    input: command({
      schema_version: 2,
      request_id: "product-publication-request:console:3",
      idempotency_key: "product-publication:console:3",
      action: "archive",
      expected_publication_version: 2,
      current_publication_posture: "unlisted",
      target_publication: { posture: "archived", listing_scope: "historical-archive", audience: "historical", access_class: "historical-read-only" },
      previous_receipt: {
        receipt_id: unlisted.receipt.receipt_id,
        receipt_digest: unlisted.receipt_digest,
        publication_version: 2,
        publication_posture: "unlisted",
      },
    }),
  });
  const restored = await service.submit({
    callerId,
    operatorId,
    input: command({
      schema_version: 2,
      request_id: "product-publication-request:console:4",
      idempotency_key: "product-publication:console:4",
      action: "restore",
      expected_publication_version: 3,
      current_publication_posture: "archived",
      target_publication: { posture: "unlisted", listing_scope: null, audience: null, access_class: null },
      previous_receipt: {
        receipt_id: archived.receipt.receipt_id,
        receipt_digest: archived.receipt_digest,
        publication_version: 3,
        publication_posture: "archived",
      },
    }),
  });

  assert.equal(restored.receipt.schema_version, 2);
  assert.equal(restored.receipt.publication_posture, "unlisted");
  assert.deepEqual(restored.receipt.previous_receipt, restored.command.previous_receipt);
  assert.deepEqual(
    restored.receipt.lifecycle_history_binding.inventory_history_event_ref,
    restored.readiness.readiness.inventory_lifecycle_binding.history_event_ref,
  );
  assert.deepEqual(restored.maintenance_projection.lifecycle, {
    state: "active",
    record_version: 12,
    record_digest: `sha256:${"a".repeat(64)}`,
    receipt_ref: restored.readiness.readiness.inventory_lifecycle_binding.receipt_ref,
    history_event_ref: restored.readiness.readiness.inventory_lifecycle_binding.history_event_ref,
  });
  assert.equal(restored.maintenance_projection.publication.posture, "unlisted");
  assert.equal(restored.maintenance_projection.publication.version, 4);
  assert.equal(restored.maintenance_projection.owner_route.repo, "governance-operations-console");
  assert.equal(restored.maintenance_projection.evidence_posture.state, "ready");
  assert.equal(restored.maintenance_projection.operational_health, "not-projected");
  assert.deepEqual(restored.maintenance_projection.history.map((entry) => entry.sequence), [1, 2, 3, 4]);
  assert.deepEqual(restored.maintenance_projection.implications, {
    runtime_restored: false,
    release_restored: false,
    access_restored: false,
    security_acceptance_granted: false,
  });

  const replay = await service.submit({ callerId, input: restored.command, operatorId });
  assert.equal(replay.resolution, "replayed");
  assert.deepEqual(replay.maintenance_projection.history, restored.maintenance_projection.history);
});

test("case:1268-history keeps an immutable ordered window of 50 applied events", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "oos-product-publication-history-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = createProductPublicationStore({ root });
  let first;
  for (let version = 1; version <= 55; version += 1) {
    await store.transact(async (transaction) => {
      const record = {
        owner_caller_id: callerId,
        command: {
          request_id: `product-publication-request:history:${version}`,
          idempotency_key: `product-publication:history:${version}`,
          action: "update",
        },
        command_digest: `sha256:${version.toString(16).padStart(64, "0")}`,
        receipt: {
          outcome: "applied",
          product_id: "product:governance-operations-console",
          receipt_id: `product-publication-receipt:history:${version}`,
          publication_version: version,
          publication_posture: "internal",
          recorded_at: new Date(Date.UTC(2026, 9, 12, 6, 0, version)).toISOString(),
        },
        receipt_digest: `sha256:${(version + 100).toString(16).padStart(64, "0")}`,
      };
      await transaction.put(record);
    });
    if (version === 1) first = await store.get("product-publication-request:history:1");
  }
  const last = await store.get("product-publication-request:history:55");
  assert.deepEqual(first.publication_history.map((entry) => entry.sequence), [1]);
  assert.equal(last.publication_history.length, 50);
  assert.equal(last.publication_history[0].sequence, 6);
  assert.equal(last.publication_history.at(-1).sequence, 55);
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
  await assert.rejects(
    service.submit({
      callerId,
      operatorId,
      input: command({
        target_publication: {
          posture: "public",
          listing_scope: "public-catalog",
          audience: "public",
          access_class: "public-anonymous",
        },
      }),
    }),
    (error) => error.code === "product_publication_target_posture_not_approved",
  );
  assert.equal(calls(), 0);
  const created = await service.submit({ callerId, input: command(), operatorId });
  await assert.rejects(
    service.submit({
      callerId,
      operatorId,
      input: command({
        operator_decision: {
          ...command().operator_decision,
          reason: "Conflicting content under the same idempotency key.",
        },
      }),
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

  const ownerPathDrift = readinessFor(evaluation);
  ownerPathDrift.readiness.manifest_binding.path = "product-publication/another-manifest.json";
  ownerPathDrift.readiness.readiness_digest = productPublicationDigest(
    ownerPathDrift.readiness,
    "readiness_digest",
  );
  ownerPathDrift.ledger.ref = {
    uri: `wgcf://product-publication/readiness-receipts/${ownerPathDrift.readiness.readiness_digest.slice(7)}`,
    digest: ownerPathDrift.readiness.readiness_digest,
  };
  const ownerPathDriftClient = createWgcfProductPublicationClient({
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
      text: async () => JSON.stringify(ownerPathDrift),
    }),
  });
  await assert.rejects(
    ownerPathDriftClient.evaluate(evaluation),
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

test("case:1268-wgcf binds exact lifecycle semantics and rejects contradictory readback", async () => {
  const input = command({
    schema_version: 2,
    request_id: "product-publication-request:console:archive",
    idempotency_key: "product-publication:console:archive",
    action: "archive",
    expected_publication_version: 2,
    current_publication_posture: "unlisted",
    target_publication: { posture: "archived", listing_scope: "historical-archive", audience: "historical", access_class: "historical-read-only" },
    previous_receipt: {
      receipt_id: "product-publication-receipt:console:unlisted",
      receipt_digest: `sha256:${"1".repeat(64)}`,
      publication_version: 2,
      publication_posture: "unlisted",
    },
  });
  const evaluation = createProductPublicationEvaluation(input);
  const exact = readinessFor(evaluation);
  const exactResponses = [
    { ...structuredClone(exact), ledger: { ...exact.ledger, resolution: "created" } },
    structuredClone(exact),
  ];
  const exactClient = createWgcfProductPublicationClient({
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
      text: async () => JSON.stringify(exactResponses.shift()),
    }),
  });
  assert.equal((await exactClient.evaluate(evaluation)).readiness.inventory_lifecycle_binding.action, "retire");

  const contradictory = readinessFor(evaluation);
  contradictory.readiness.inventory_lifecycle_binding.action = "restore";
  contradictory.readiness.inventory_lifecycle_binding.after.posture = "active";
  contradictory.readiness.readiness_digest = productPublicationDigest(contradictory.readiness, "readiness_digest");
  contradictory.ledger.ref = {
    uri: `wgcf://product-publication/readiness-receipts/${contradictory.readiness.readiness_digest.slice(7)}`,
    digest: contradictory.readiness.readiness_digest,
  };
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

test("runtime activation remains limited to the reviewed profile and complete Platform configuration", () => {
  assert.throws(
    () => createProductPublicationRuntime({
      config: { enabled: true, profile: "stage" },
    }),
    (error) => error.code === "product_publication_activation_required",
  );
  assert.throws(
    () => createProductPublicationRuntime({
      config: { enabled: true, profile: "dev-integration" },
    }),
    (error) => error.code === "product_publication_configuration_missing",
  );
  const exactConfig = {
    enabled: true,
    profile: "dev-integration",
    stateRoot: "/tmp/oos-product-publication-runtime-test",
    operatorBindings: { [callerId]: operatorId },
    securityDecisionUri: productPublicationSecurityAuthority.uri,
    securityDecisionDigest: productPublicationSecurityAuthority.digest,
    securityDecisionRevision: productPublicationSecurityAuthority.revision,
    wgcfBaseUrl: "http://wgcf.test",
    wgcfCallerId: "operator-orchestration-service",
    wgcfCallerSecret: "x".repeat(32),
    wgcfImplementationRef: implementationRef,
    wgcfServiceIdentityRef: serviceIdentityRef,
  };
  assert.ok(createProductPublicationRuntime({ config: exactConfig, fetchImpl: async () => null }));
  assert.throws(
    () => createProductPublicationRuntime({
      config: {
        ...exactConfig,
        securityDecisionUri: "security-architecture://product-publication/decisions/console-internal-v1",
      },
      fetchImpl: async () => null,
    }),
    (error) => error.code === "product_publication_security_decision_mismatch",
  );
});
