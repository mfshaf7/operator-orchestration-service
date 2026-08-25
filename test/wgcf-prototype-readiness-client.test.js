import test from "node:test";
import assert from "node:assert/strict";

import { HttpError } from "../src/errors.js";
import { createWgcfPrototypeIngressReadinessClient } from
  "../src/delivery-ingress/wgcf-prototype-readiness-client.js";

function packet() {
  return {
    schema_version: 1,
    packet_id: `proof-${"a".repeat(64)}`,
    packet_ref: `record://delivery-packets/proof-${"a".repeat(64)}`,
    packet_digest: `sha256:${"a".repeat(64)}`,
    content: {
      source: {
        prototype_id: "proof",
        record_ref: "record://prototypes/proof",
        record_version: "1".repeat(40),
        revision: {
          repository: "workspace-prototype-studio",
          ref: "refs/heads/main",
          base_commit: "2".repeat(40),
          head_commit: "1".repeat(40),
          tree: "3".repeat(40),
        },
      },
      baseline: {
        record_ref: "record://design-baselines/proof-v1",
        version: "proof-v1@sha256:proof",
        record_digest: `sha256:${"4".repeat(64)}`,
      },
      custody: {
        classification: "existing-repo",
        repository_gate_state: "resolved",
        owner: "workspace-prototype-studio",
        source_ref: "repo://workspace-prototype-studio@main",
      },
    },
  };
}

function responseBody(sourcePacket = packet()) {
  const digest = `sha256:${"5".repeat(64)}`;
  const token = "6".repeat(24);
  const uri =
    `wgcf://receipts/prototype-ingress-readiness/` +
    `prototype-ingress-readiness-receipt-${token}-${digest.slice(7)}.json`;
  return {
    receipt: {
      schema_version: 1,
      artifact_type: "prototype_ingress_readiness_receipt",
      receipt_id: `prototype-ingress-readiness-receipt:${token}`,
      subject: {
        source_kind: "prototype",
        prototype_id: sourcePacket.content.source.prototype_id,
        record_ref: sourcePacket.content.source.record_ref,
        record_version: sourcePacket.content.source.record_version,
        packet_ref: sourcePacket.packet_ref,
        packet_digest: sourcePacket.packet_digest,
      },
      decision: {
        outcome: "allow",
        target_application_allowed: true,
        mutation_authority: "none",
        reason_codes: ["eligible"],
        evaluated_at: "2026-08-25T06:00:00.000Z",
      },
      policy: {
        profile_id: "dev-integration",
        target: "workspace-delivery-art",
        contract_digest: `sha256:${"7".repeat(64)}`,
        authority_refs: [
          "contract://prototype-delivery-packet/v1",
          "contract://prototype-ingress-readiness/v1",
        ],
      },
      evidence: {
        source_revision: sourcePacket.content.source.revision,
        baseline: sourcePacket.content.baseline,
        custody: sourcePacket.content.custody,
      },
      issuer: {
        owner_repo: "workspace-governance-control-fabric",
        service_identity_ref: "service://workspace-governance-control-fabric",
        implementation_ref: "8".repeat(40),
      },
      integrity: {
        canonicalization: "RFC8785",
        algorithm: "sha256",
        content_digest: digest,
      },
      custody: {
        state: "durable",
        backend: "wgcf-receipt-ledger",
        uri,
        persisted_at: "2026-08-25T06:00:00.000Z",
        supersedes: null,
      },
    },
    ledger: {
      state: "durable",
      generation: 1,
      resolution: "created",
      ref: { uri, digest },
    },
  };
}

function jsonResponse(value) {
  return {
    ok: true,
    status: 200,
    headers: { get() { return null; } },
    async text() {
      return JSON.stringify(value);
    },
  };
}

test("WGCF Prototype readiness client authenticates and validates the exact packet receipt", async () => {
  const calls = [];
  const sourcePacket = packet();
  const client = createWgcfPrototypeIngressReadinessClient({
    baseUrl: "http://wgcf.test/",
    callerId: "operator-orchestration-service",
    callerSecret: "s".repeat(32),
    async fetchImpl(url, options) {
      calls.push({ options, url });
      return jsonResponse(responseBody(sourcePacket));
    },
  });

  const result = await client.issue({ packet: sourcePacket });
  assert.equal(calls[0].url, "http://wgcf.test/v1/readiness/prototype-ingress");
  assert.equal(
    calls[0].options.headers["x-wgcf-caller-id"],
    "operator-orchestration-service",
  );
  assert.equal(JSON.parse(calls[0].options.body).packet.packet_ref, sourcePacket.packet_ref);
  assert.equal(result.receipt.decision.outcome, "allow");
});

test("WGCF Prototype readiness client rejects a receipt bound to another packet", async () => {
  const sourcePacket = packet();
  const response = responseBody(sourcePacket);
  response.receipt.subject.packet_ref =
    `record://delivery-packets/other-${"a".repeat(64)}`;
  const client = createWgcfPrototypeIngressReadinessClient({
    baseUrl: "http://wgcf.test",
    callerSecret: "s".repeat(32),
    async fetchImpl() {
      return jsonResponse(response);
    },
  });

  await assert.rejects(
    () => client.issue({ packet: sourcePacket }),
    (error) =>
      error instanceof HttpError &&
      error.code === "wgcf_prototype_ingress_readiness_invalid_response",
  );
});
