import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { canonicalDigest } from "../src/delivery-art/canonical-json.js";
import {
  DeliveryArtEvidenceAcquisitionError,
  deliveryArtEvidenceAcquisitionRequest,
  projectDeliveryArtOwnerEvidence,
  validateDeliveryArtEvidenceProfile,
} from "../src/delivery-art/review-evidence-acquisition.js";

const OWNER_REPO = "operator-orchestration-service";
const SOURCE = {
  base_commit: "a".repeat(40),
  head_commit: "b".repeat(40),
};

function profile(overrides = {}) {
  return {
    schema_version: 1,
    profile_id: "owner-evidence-v1",
    owner_repo: OWNER_REPO,
    commands: [{
      id: "real-git-proof",
      kind: "tests",
      name: "Real Git proof",
      executable: "node",
      args: ["--test", "test/example.test.js"],
      fidelity: "real-git",
      conformance_binding: "matching-fidelity",
      timeout_seconds: 60,
    }],
    ...overrides,
  };
}

function receipt({ result = "pass" } = {}) {
  const commandResult = {
    command: "node --test test/example.test.js",
    command_id: "real-git-proof",
    conformance_case_ids: ["case:positive"],
    fidelity: "real-git",
    kind: "tests",
    name: "Real Git proof",
    output_digest: `sha256:${"c".repeat(64)}`,
    result,
    result_digest: null,
  };
  commandResult.result_digest = canonicalDigest({
    command: commandResult.command,
    command_id: commandResult.command_id,
    conformance_case_ids: commandResult.conformance_case_ids,
    fidelity: commandResult.fidelity,
    kind: commandResult.kind,
    name: commandResult.name,
    owner_repo: OWNER_REPO,
    result,
    source_revision: SOURCE.head_commit,
  });
  const value = {
    schema_version: 1,
    artifact_type: "delivery_art_owner_evidence_receipt",
    acquisition_id: "owner-evidence:test",
    owner_repo: OWNER_REPO,
    profile_digest: canonicalDigest(profile()),
    profile_id: "owner-evidence-v1",
    profile_path: "contracts/delivery-art-work-session/evidence-profile.json",
    profile_revision: SOURCE.base_commit,
    provider: { id: "delivery-source-executor", kind: "oos-source-executor" },
    source_revision: SOURCE.head_commit,
    started_at: "2026-09-24T07:00:00.000Z",
    completed_at: "2026-09-24T07:00:01.000Z",
    results: [commandResult],
    evidence_digest: null,
    receipt_digest: null,
  };
  value.evidence_digest = canonicalDigest({
    acquisition_id: value.acquisition_id,
    owner_repo: value.owner_repo,
    profile_digest: value.profile_digest,
    profile_id: value.profile_id,
    profile_revision: value.profile_revision,
    provider_id: value.provider.id,
    results: [{
      command: commandResult.command,
      command_id: commandResult.command_id,
      conformance_case_ids: commandResult.conformance_case_ids,
      fidelity: commandResult.fidelity,
      kind: commandResult.kind,
      name: commandResult.name,
      result,
      result_digest: commandResult.result_digest,
    }],
    source_revision: value.source_revision,
  });
  const { receipt_digest: _receiptDigest, ...receiptInput } = value;
  value.receipt_digest = canonicalDigest(receiptInput);
  return value;
}

test("owner evidence profile validation rejects mismatched or unsafe commands", () => {
  const admittedProfile = JSON.parse(readFileSync(new URL(
    "../contracts/delivery-art-work-session/evidence-profile.json",
    import.meta.url,
  ), "utf8"));
  assert.equal(
    validateDeliveryArtEvidenceProfile(admittedProfile, OWNER_REPO).profile_id,
    "oos-delivery-art-evidence-v1",
  );
  assert.equal(
    validateDeliveryArtEvidenceProfile(profile(), OWNER_REPO).profile_id,
    "owner-evidence-v1",
  );
  assert.throws(
    () => validateDeliveryArtEvidenceProfile(
      profile({ owner_repo: "another-repo" }),
      OWNER_REPO,
    ),
    (error) => error instanceof DeliveryArtEvidenceAcquisitionError &&
      error.code === "delivery_art_evidence_profile_mismatch",
  );
  const unsafe = profile();
  unsafe.commands[0].executable = "bash";
  assert.throws(
    () => validateDeliveryArtEvidenceProfile(unsafe, OWNER_REPO),
    { code: "delivery_art_evidence_profile_invalid" },
  );
});

test("acquisition request binds exact source and covers every conformance fidelity", () => {
  const request = deliveryArtEvidenceAcquisitionRequest({
    conformanceCases: [{ fidelity: "real-git", id: "case:positive" }],
    ownerRepo: OWNER_REPO,
    profile: profile({
      commands: [{
        ...profile().commands[0],
        args: ["diff", "{{base_commit}}...{{head_commit}}"],
        executable: "git",
      }],
    }),
    source: SOURCE,
  });
  assert.deepEqual(request.commands[0].args, [
    "diff",
    `${SOURCE.base_commit}...${SOURCE.head_commit}`,
  ]);
  assert.deepEqual(request.commands[0].conformance_case_ids, ["case:positive"]);
  assert.equal(request.source_revision, SOURCE.head_commit);

  assert.throws(
    () => deliveryArtEvidenceAcquisitionRequest({
      conformanceCases: [{ fidelity: "process-crash", id: "case:crash" }],
      ownerRepo: OWNER_REPO,
      profile: profile(),
      source: SOURCE,
    }),
    { code: "delivery_art_evidence_profile_incomplete" },
  );
});

test("typed owner receipt projects exact-source evidence and rejects tampering", () => {
  const projected = projectDeliveryArtOwnerEvidence(receipt(), {
    ownerRepo: OWNER_REPO,
    sourceRevision: SOURCE.head_commit,
  });
  assert.equal(projected.acquisition.state, "ready");
  assert.equal(projected.acquisition.provider.id, "delivery-source-executor");
  assert.equal(projected.evidence.tests[0].result, "pass");
  assert.equal(
    projected.evidence.tests[0].source_revisions[0].commit,
    SOURCE.head_commit,
  );

  const blocked = projectDeliveryArtOwnerEvidence(receipt({ result: "fail" }));
  assert.equal(blocked.acquisition.state, "blocked");

  const tampered = receipt();
  tampered.results[0].result = "fail";
  assert.throws(
    () => projectDeliveryArtOwnerEvidence(tampered),
    { code: "delivery_art_owner_evidence_receipt_invalid" },
  );
});
