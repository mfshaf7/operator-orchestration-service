import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  artifactContentDigest,
  validateDeliveryArtArtifact,
  validateDeliveryArtReferences,
} from "../src/delivery-art/contracts.js";

const FIXTURE_ROOT = new URL("../contracts/delivery-art/fixtures/", import.meta.url);

test("runtime image includes the pinned Delivery ART contract bundle", () => {
  const dockerfile = readFileSync(new URL("../Dockerfile", import.meta.url), "utf8");
  assert.match(
    dockerfile,
    /COPY --chown=node:node contracts\/delivery-art \.\/contracts\/delivery-art/,
  );
});

function fixture(filename) {
  return JSON.parse(readFileSync(new URL(filename, FIXTURE_ROOT), "utf8"));
}

function fixtureClosure() {
  return [
    fixture("architecture-packet.valid.json"),
    fixture("architecture-custody-receipt.valid.json"),
    fixture("work-start-record.valid.json"),
    fixture("work-start-custody-receipt.valid.json"),
    fixture("review-packet-merge-ready.valid.json"),
    fixture("merge-ready-custody-receipt.valid.json"),
    fixture("review-packet-finalized.valid.json"),
    fixture("finalized-custody-receipt.valid.json"),
    fixture("readiness-receipt.valid.json"),
  ];
}

test("pinned Delivery ART fixtures validate as one complete custody closure", () => {
  const closure = fixtureClosure();
  for (const artifact of closure) {
    assert.deepEqual(validateDeliveryArtArtifact(artifact).errors, []);
  }

  const finalized = closure.find(
    (artifact) =>
      artifact.artifact_type === "art_review_packet" &&
      artifact.status === "finalized",
  );
  assert.deepEqual(
    validateDeliveryArtReferences(
      finalized,
      closure.filter((artifact) => artifact !== finalized),
    ),
    [],
  );
});

test("artifact digest binds the non-null supersession predecessor", () => {
  const packet = fixture("review-packet-finalized.valid.json");
  const originalDigest = artifactContentDigest(packet);
  packet.custody.supersedes.digest = `sha256:${"f".repeat(64)}`;

  assert.notEqual(artifactContentDigest(packet), originalDigest);
});

test("durable source artifact fails closed without its custody receipt", () => {
  const architecture = fixture("architecture-packet.valid.json");
  const errors = validateDeliveryArtReferences(architecture, []);

  assert.ok(errors.some((error) => error.includes("custody receipt ref does not resolve")));
});

test("custody receipt must bind the exact source artifact subject", () => {
  const architecture = fixture("architecture-packet.valid.json");
  const receipt = fixture("architecture-custody-receipt.valid.json");
  receipt.subject.artifact_id = "architecture-packet:delivery-698-wrong";
  receipt.integrity.content_digest = artifactContentDigest(receipt);
  receipt.custody.uri = receipt.custody.uri.replace(
    /-[0-9a-f]{64}\.json$/,
    `-${receipt.integrity.content_digest.slice("sha256:".length)}.json`,
  );
  architecture.custody.receipt_ref = {
    digest: receipt.integrity.content_digest,
    uri: receipt.custody.uri,
  };

  const errors = validateDeliveryArtReferences(architecture, [receipt]);
  assert.ok(errors.some((error) => error.includes("subject.artifact_id")));
});

test("custody chronology is strictly storage then receipt then artifact", () => {
  const architecture = fixture("architecture-packet.valid.json");
  const receipt = fixture("architecture-custody-receipt.valid.json");
  receipt.storage.persisted_at = receipt.custody.persisted_at;
  receipt.integrity.content_digest = artifactContentDigest(receipt);
  receipt.custody.uri = receipt.custody.uri.replace(
    /-[0-9a-f]{64}\.json$/,
    `-${receipt.integrity.content_digest.slice("sha256:".length)}.json`,
  );
  architecture.custody.receipt_ref = {
    digest: receipt.integrity.content_digest,
    uri: receipt.custody.uri,
  };

  const errors = validateDeliveryArtReferences(architecture, [receipt]);
  assert.ok(
    errors.some((error) =>
      error.includes("storage.persisted_at must be earlier than custody.persisted_at")),
  );
});
