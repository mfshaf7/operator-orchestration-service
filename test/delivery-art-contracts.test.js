import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  artifactContentDigest,
  assertValidDeliveryArtArtifact,
  validateDeliveryArtArtifact,
  validateDeliveryArtReferences,
} from "../src/delivery-art/contracts.js";
import {
  CanonicalJsonError,
  canonicalDigest,
  canonicalStringify,
  parseCanonicalJson,
} from "../src/delivery-art/canonical-json.js";

const FIXTURE_ROOT = new URL("../test-fixtures/delivery-art/", import.meta.url);

function fixture(name) {
  return JSON.parse(readFileSync(new URL(name, FIXTURE_ROOT), "utf8"));
}

function refreshDigest(artifact) {
  artifact.integrity.content_digest = artifactContentDigest(artifact);
  return artifact;
}

const fixtureNames = [
  "architecture-packet.valid.json",
  "work-start-record.valid.json",
  "review-packet-merge-ready.valid.json",
  "review-packet-finalized.valid.json",
  "readiness-receipt.valid.json",
];

test("canonical JSON rejects ambiguous or unsupported input", () => {
  assert.throws(
    () => parseCanonicalJson('{"decision":"approve","decision":"reject"}'),
    CanonicalJsonError,
  );
  assert.throws(() => parseCanonicalJson('{"confidence":0.5}'), CanonicalJsonError);
  assert.throws(() => parseCanonicalJson('{"schema_version":2.0}'), CanonicalJsonError);
  assert.throws(() => parseCanonicalJson('{"count":1e3}'), CanonicalJsonError);
  assert.throws(() => parseCanonicalJson('{"value":9007199254740992}'), CanonicalJsonError);
  assert.throws(() => parseCanonicalJson('{"value":"\\ud800"}'), CanonicalJsonError);
});

test("canonical JSON is stable across object insertion order", () => {
  const left = { z: 1, nested: { b: true, a: "value" }, a: [3, 2, 1] };
  const right = { a: [3, 2, 1], nested: { a: "value", b: true }, z: 1 };

  assert.equal(canonicalStringify(left), canonicalStringify(right));
  assert.equal(canonicalDigest(left), canonicalDigest(right));
});

for (const fixtureName of fixtureNames) {
  test(`${fixtureName} matches the governed Delivery ART contract snapshot`, () => {
    const artifact = fixture(fixtureName);
    const validation = validateDeliveryArtArtifact(artifact);

    assert.deepEqual(validation.errors, []);
    assert.equal(validation.valid, true);
    assert.equal(validation.content_digest, artifact.integrity.content_digest);
  });
}

test("artifact validation rejects content changed after digesting", () => {
  const artifact = fixture("work-start-record.valid.json");
  artifact.landing_unit.branch_plan[0].branch = "codex/tampered-branch";

  const validation = validateDeliveryArtArtifact(artifact);

  assert.equal(validation.valid, false);
  assert.match(validation.errors.join("\n"), /integrity\.content_digest/);
});

test("Review Packet reference validation resolves the governed dependency chain", () => {
  const architecture = fixture("architecture-packet.valid.json");
  const workStart = fixture("work-start-record.valid.json");
  const mergeReady = fixture("review-packet-merge-ready.valid.json");
  const finalized = fixture("review-packet-finalized.valid.json");
  const readinessReceipt = fixture("readiness-receipt.valid.json");
  const dependencies = [architecture, workStart, mergeReady, readinessReceipt];

  assert.deepEqual(validateDeliveryArtReferences(mergeReady, dependencies), []);
  assert.deepEqual(validateDeliveryArtReferences(finalized, dependencies), []);
  assert.doesNotThrow(() => assertValidDeliveryArtArtifact(finalized, dependencies));
});

test("Review Packet reference validation fails closed when a dependency is absent", () => {
  const finalized = fixture("review-packet-finalized.valid.json");
  const errors = validateDeliveryArtReferences(finalized, []);

  assert.ok(errors.length > 0);
  assert.ok(errors.every((message) => message.includes("does not resolve")));
});

test("artifact digest excludes custody and its own digest field", () => {
  const artifact = fixture("review-packet-merge-ready.valid.json");
  const expected = artifact.integrity.content_digest;
  artifact.custody.uri = "local://different-custody-location";
  artifact.integrity.content_digest = "sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";

  assert.equal(artifactContentDigest(artifact), expected);
});

test("passing Review Packet evidence binds every exact landing-unit source head", () => {
  const packet = fixture("review-packet-merge-ready.valid.json");
  packet.evidence.validations[0].source_revisions = [];
  refreshDigest(packet);

  const validation = validateDeliveryArtArtifact(packet);

  assert.equal(validation.valid, false);
  assert.match(validation.errors.join("\n"), /every exact landing-unit source head/);
});

test("direct-land authority must remain valid through readiness evaluation", () => {
  const packet = fixture("review-packet-merge-ready.valid.json");
  packet.landing_unit.evidence_kind = "approved_direct_land";
  packet.landing_unit.repos[0].pr_url = null;
  packet.exceptions = [{
    authority_ref: "openproject://work_packages/801",
    expires_at: "2026-08-08T11:14:00+08:00",
    id: "exception:direct-land-work-item-801",
    kind: "direct-land",
    rationale: "The operator approved a bounded direct landing.",
  }];
  refreshDigest(packet);

  const validation = validateDeliveryArtArtifact(packet);

  assert.equal(validation.valid, false);
  assert.match(validation.errors.join("\n"), /valid through readiness and finalization/);
});

test("work-start chronology cannot evaluate an older source snapshot in the future", () => {
  const workStart = fixture("work-start-record.valid.json");
  workStart.readiness.evaluated_at = "2026-08-08T09:00:00+08:00";
  refreshDigest(workStart);

  const validation = validateDeliveryArtArtifact(workStart);

  assert.equal(validation.valid, false);
  assert.match(validation.errors.join("\n"), /source_snapshot\.captured_at must be no later/);
});

test("finalization cannot rewrite merge-ready evidence", () => {
  const architecture = fixture("architecture-packet.valid.json");
  const workStart = fixture("work-start-record.valid.json");
  const mergeReady = fixture("review-packet-merge-ready.valid.json");
  const finalized = fixture("review-packet-finalized.valid.json");
  const readinessReceipt = fixture("readiness-receipt.valid.json");
  finalized.evidence.tests[0].summary = "Rewritten after merge-ready review.";

  const errors = validateDeliveryArtReferences(finalized, [
    architecture,
    workStart,
    mergeReady,
    readinessReceipt,
  ]);

  assert.match(errors.join("\n"), /did not preserve merge-ready evidence/);
});

test("supersession chains are acyclic", () => {
  const architecture = fixture("architecture-packet.valid.json");
  const workStart = fixture("work-start-record.valid.json");
  const mergeReady = fixture("review-packet-merge-ready.valid.json");
  const finalized = fixture("review-packet-finalized.valid.json");
  const readinessReceipt = fixture("readiness-receipt.valid.json");
  mergeReady.custody.supersedes = {
    digest: finalized.integrity.content_digest,
    uri: finalized.custody.uri,
  };

  const errors = validateDeliveryArtReferences(finalized, [
    architecture,
    workStart,
    mergeReady,
    readinessReceipt,
  ]);

  assert.match(errors.join("\n"), /supersession chain must be acyclic/);
});

test("Review Packet conformance evidence must cover each applicable planned case", () => {
  const architecture = fixture("architecture-packet.valid.json");
  const workStart = fixture("work-start-record.valid.json");
  const packet = fixture("review-packet-merge-ready.valid.json");
  packet.evidence.tests[0].conformance_case_ids = ["case:contract-positive"];

  const errors = validateDeliveryArtReferences(packet, [architecture, workStart]);

  assert.match(errors.join("\n"), /missing applicable conformance cases: case:contract-negative/);
});
