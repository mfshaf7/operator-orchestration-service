import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  architectureScopeFingerprint,
  artifactContentDigest,
  validateDeliveryArtArtifact,
  validateDeliveryArtReferences,
  workStartScopeFingerprint,
} from "../src/delivery-art/contracts.js";

const FIXTURE_ROOT = new URL("../contracts/delivery-art/fixtures/", import.meta.url);

test("runtime image includes the pinned Delivery ART contract bundle", () => {
  const dockerfile = readFileSync(new URL("../Dockerfile", import.meta.url), "utf8");
  assert.match(
    dockerfile,
    /COPY --chown=node:node contracts\/delivery-art \.\/contracts\/delivery-art/,
  );
  assert.match(
    dockerfile,
    /COPY --chown=node:node contracts\/delivery-art-lifecycle \.\/contracts\/delivery-art-lifecycle/,
  );
  assert.match(
    dockerfile,
    /COPY --chown=node:node contracts\/delivery-art-work-session \.\/contracts\/delivery-art-work-session/,
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

function localCandidate(artifact, name) {
  const candidate = structuredClone(artifact);
  candidate.custody = {
    backend: "local-filesystem",
    persisted_at: null,
    receipt_ref: null,
    state: "local-draft",
    supersedes: null,
    uri: `local://delivery-art/${name}.json`,
  };
  candidate.integrity.content_digest = artifactContentDigest(candidate);
  return candidate;
}

function architectureV2Candidate() {
  const packet = fixture("architecture-packet.valid.json");
  packet.schema_version = 2;
  packet.artifact_id = "architecture-packet:delivery-698-v2";
  delete packet.architecture.dependency_merge_dag;
  packet.architecture.work_dependency_graph = {
    nodes: ["work-item-801", "work-item-802"],
    edges: [
      {
        prerequisite_work_item_id: "work-item-801",
        dependent_work_item_id: "work-item-802",
      },
    ],
  };
  packet.architecture.landing_units = [
    {
      id: "delivery-698-contract",
      owner_repo: "workspace-governance",
      source_backed: true,
      covered_work_item_ids: ["work-item-801"],
    },
    {
      id: "delivery-698-implementation",
      owner_repo: "operator-orchestration-service",
      source_backed: true,
      covered_work_item_ids: ["work-item-802"],
    },
  ];
  packet.architecture.source_landing_graph = {
    nodes: ["delivery-698-contract", "delivery-698-implementation"],
    edges: [
      {
        prerequisite_landing_unit_id: "delivery-698-contract",
        dependent_landing_unit_id: "delivery-698-implementation",
      },
    ],
  };
  packet.architecture.required_human_gates = [
    {
      gate_id: "gate:security-source-merge",
      authority_work_item_id: "work-item-801",
      authority_owner_repo: "workspace-governance",
      affected_landing_unit_ids: ["delivery-698-implementation"],
      blocked_transition: "before_source_merge",
      evidence_requirement: "Bind the exact implementation review head.",
    },
  ];
  packet.scope_fingerprint = architectureScopeFingerprint(packet);
  return localCandidate(packet, "architecture-v2");
}

function refreshArchitectureCandidate(packet) {
  packet.scope_fingerprint = architectureScopeFingerprint(packet);
  packet.integrity.content_digest = artifactContentDigest(packet);
  return packet;
}

function validationOnlyReviewPacket() {
  const packet = fixture("review-packet-merge-ready.valid.json");
  const testEvidenceIds = new Set(packet.evidence.tests.map((entry) => entry.id));
  packet.evidence.tests = [];
  for (const mapping of packet.evidence.acceptance_mapping) {
    mapping.evidence_ids = mapping.evidence_ids.filter(
      (evidenceId) => !testEvidenceIds.has(evidenceId),
    );
  }
  packet.integrity.content_digest = artifactContentDigest(packet);
  packet.custody.uri =
    `wgcf://artifacts/delivery-art/sha256/${packet.integrity.content_digest.slice("sha256:".length)}`;
  return packet;
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

test("validation-only Review Packet accepts empty test evidence", () => {
  const packet = validationOnlyReviewPacket();

  assert.deepEqual(validateDeliveryArtArtifact(packet).errors, []);
});

test("source-backed Review Packet still requires validation evidence", () => {
  const packet = validationOnlyReviewPacket();
  packet.evidence.validations = [];
  packet.integrity.content_digest = artifactContentDigest(packet);

  assert.ok(
    validateDeliveryArtArtifact(packet).errors.some((error) =>
      error.includes("must NOT have fewer than 1 items")),
  );
});

test("artifact digest binds the non-null supersession predecessor", () => {
  const packet = fixture("review-packet-finalized.valid.json");
  const originalDigest = artifactContentDigest(packet);
  packet.custody.supersedes.digest = `sha256:${"f".repeat(64)}`;

  assert.notEqual(artifactContentDigest(packet), originalDigest);
});

test("approved architecture decision remains a valid local persistence candidate", () => {
  const candidate = localCandidate(
    fixture("architecture-packet.valid.json"),
    "approved-architecture",
  );

  assert.deepEqual(validateDeliveryArtArtifact(candidate).errors, []);
});

test("architecture v2 validates separated work and source topology", () => {
  assert.deepEqual(validateDeliveryArtArtifact(architectureV2Candidate()).errors, []);
});

test("architecture v2 work dependency graph must cover all work items", () => {
  const candidate = architectureV2Candidate();
  candidate.architecture.work_dependency_graph.nodes.pop();
  refreshArchitectureCandidate(candidate);

  assert.ok(
    validateDeliveryArtArtifact(candidate).errors.includes(
      "architecture work dependency graph nodes must exactly cover the work items",
    ),
  );
});

test("architecture v2 Landing Unit owner must match work ownership", () => {
  const candidate = architectureV2Candidate();
  candidate.architecture.landing_units[1].owner_repo = "workspace-governance";
  refreshArchitectureCandidate(candidate);

  assert.ok(
    validateDeliveryArtArtifact(candidate).errors.includes(
      "architecture Landing Unit delivery-698-implementation owner does not match work-item-802 owner",
    ),
  );
});

test("architecture v2 source landing graph must be acyclic", () => {
  const candidate = architectureV2Candidate();
  candidate.architecture.source_landing_graph.edges.push({
    prerequisite_landing_unit_id: "delivery-698-implementation",
    dependent_landing_unit_id: "delivery-698-contract",
  });
  refreshArchitectureCandidate(candidate);

  assert.ok(
    validateDeliveryArtArtifact(candidate).errors.includes(
      "architecture source landing graph must be acyclic",
    ),
  );
});

test("architecture v2 human gate authority owner must match its work item", () => {
  const candidate = architectureV2Candidate();
  candidate.architecture.required_human_gates[0].authority_owner_repo =
    "operator-orchestration-service";
  refreshArchitectureCandidate(candidate);

  assert.ok(
    validateDeliveryArtArtifact(candidate).errors.includes(
      "architecture human gate gate:security-source-merge authority owner does not match its work item",
    ),
  );
});

test("local architecture candidate cannot claim a persistence timestamp", () => {
  const candidate = localCandidate(
    fixture("architecture-packet.valid.json"),
    "false-persistence",
  );
  candidate.custody.persisted_at = "2026-08-08T10:06:00+08:00";

  assert.ok(validateDeliveryArtArtifact(candidate).errors.length > 0);
});

test("work-start cannot resolve architecture from local candidate custody", () => {
  const architecture = localCandidate(
    fixture("architecture-packet.valid.json"),
    "unpersisted-architecture",
  );
  const workStart = fixture("work-start-record.valid.json");
  workStart.architecture.packet_ref = architecture.custody.uri;
  workStart.architecture.packet_digest = architecture.integrity.content_digest;
  workStart.scope_fingerprint = workStartScopeFingerprint(workStart);
  workStart.integrity.content_digest = artifactContentDigest(workStart);

  const errors = validateDeliveryArtReferences(workStart, [architecture]);
  assert.ok(errors.some((error) => error.includes("durable WGCF artifact")));
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
