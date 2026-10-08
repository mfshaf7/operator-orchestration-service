import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  architectureScopeFingerprint,
  artifactContentDigest,
  deliveryArtArchitectureContractPosture,
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

function architectureV3Candidate() {
  const packet = architectureV2Candidate();
  packet.schema_version = 3;
  packet.artifact_id = "architecture-packet:delivery-698-v3";
  delete packet.architecture.work_dependency_graph;
  packet.architecture.work_item_execution_plan = [
    {
      work_item_id: "work-item-801",
      start_after_work_item_ids: [],
      close_after_work_item_ids: [],
      emits_human_gate_ids: ["gate:security-source-merge"],
    },
    {
      work_item_id: "work-item-802",
      start_after_work_item_ids: ["work-item-801"],
      close_after_work_item_ids: [],
      emits_human_gate_ids: [],
    },
  ];
  packet.architecture.required_human_gates[0]
    .evidence_prerequisite_work_item_ids = [];
  packet.architecture.evidence_receipt_handoffs = [{
    handoff_id: "handoff:contract-to-implementation",
    producer: "workspace-governance",
    consumer: "operator-orchestration-service",
    producer_landing_unit_id: "delivery-698-contract",
    consumer_landing_unit_id: "delivery-698-implementation",
    producer_work_item_id: "work-item-801",
    consumer_work_item_id: "work-item-802",
    integration_point: "OOS pinned Delivery ART contract loader",
    artifact: "Delivery ART contract bundle",
    acceptance: "consumer contract tests pass against the exact authority digest",
  }];
  return refreshArchitectureCandidate(packet);
}

function architectureV4Candidate() {
  const packet = architectureV3Candidate();
  packet.schema_version = 4;
  packet.artifact_id = "architecture-packet:delivery-698-v4";
  return refreshArchitectureCandidate(packet);
}

function architectureV5Candidate() {
  const packet = architectureV4Candidate();
  packet.schema_version = 5;
  packet.artifact_id = "architecture-packet:delivery-698-v5";
  for (const entry of packet.conformance_plan.cases) {
    entry.evidence_owner_landing_unit_id =
      entry.applies_to_work_item_ids.includes("work-item-801")
        ? "delivery-698-contract"
        : "delivery-698-implementation";
  }
  return refreshArchitectureCandidate(packet);
}

function architectureV6Candidate() {
  const packet = architectureV5Candidate();
  packet.schema_version = 6;
  packet.artifact_id = "architecture-packet:delivery-698-v6";
  packet.covered_work_item_ids.push("work-item-803");
  packet.architecture.descendant_owner_map.push({
    work_item_id: "work-item-803",
    work_item_type: "Enabler",
    owner_repo: "platform-engineering",
    parent_work_item_id: "work-item-801",
  });
  packet.architecture.landing_units.push({
    id: "delivery-698-platform",
    owner_repo: "platform-engineering",
    source_backed: true,
    covered_work_item_ids: ["work-item-803"],
  });
  packet.architecture.source_landing_graph.nodes.push("delivery-698-platform");
  packet.architecture.source_landing_graph.edges.push({
    prerequisite_landing_unit_id: "delivery-698-implementation",
    dependent_landing_unit_id: "delivery-698-platform",
  });
  packet.architecture.work_item_execution_plan.push({
    work_item_id: "work-item-803",
    start_after_work_item_ids: ["work-item-802"],
    close_after_work_item_ids: [],
    emits_human_gate_ids: [],
  });
  packet.architecture.required_human_gates[0].blocked_transition =
    "before_runtime_activation";
  packet.architecture.required_human_gates[0].affected_landing_unit_ids = [
    "delivery-698-platform",
  ];
  const oosRevision = packet.source_snapshot.repo_revisions.find(
    (entry) => entry.repo === "operator-orchestration-service",
  );
  packet.source_snapshot.repo_revisions.push({
    ...structuredClone(oosRevision),
    repo: "platform-engineering",
    commit: "c".repeat(40),
  });
  packet.architecture.runtime_activation_chains = [{
    chain_id: "activation:delivery-698",
    gate_id: "gate:security-source-merge",
    source_owner_repo: "operator-orchestration-service",
    source_activation_posture: "owner-source-change-required",
    source_activation_evidence: {
      repo: "operator-orchestration-service",
      revision: oosRevision.commit,
      path: "contracts/example/manifest.json",
      field: "runtime_activation",
      observed_value: false,
      observed_posture: "owner-source-change-required",
    },
    source_activation_landing_unit_id: "delivery-698-implementation",
    commissioning_landing_unit_ids: ["delivery-698-platform"],
  }];
  packet.conformance_plan.work_item_dimension_applicability.push({
    ...structuredClone(
      packet.conformance_plan.work_item_dimension_applicability.find(
        (entry) => entry.work_item_id === "work-item-802",
      ),
    ),
    work_item_id: "work-item-803",
  });
  for (const entry of packet.conformance_plan.cases) {
    if (entry.applies_to_work_item_ids.includes("work-item-802")) {
      entry.applies_to_work_item_ids.push("work-item-803");
    }
  }
  return refreshArchitectureCandidate(packet);
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

test("historical architecture remains schema-valid for read compatibility", () => {
  const candidate = localCandidate(
    fixture("architecture-packet.valid.json"),
    "historical-architecture",
  );
  candidate.architecture.runtime_boundaries =
    candidate.architecture.runtime_boundaries.map((boundary) => ({
      allowed: ["Historical owner action retained exactly as recorded."],
      owner_repo: boundary.owner_repo,
      prohibited: ["Historical prohibited action retained exactly as recorded."],
    }));
  refreshArchitectureCandidate(candidate);

  assert.deepEqual(validateDeliveryArtArtifact(candidate).errors, []);
});

test("architecture assigns durable artifact persistence only to WGCF", () => {
  const candidate = localCandidate(
    fixture("architecture-packet.valid.json"),
    "invalid-custody-owner",
  );
  candidate.architecture.runtime_boundaries[0].allowed_capability_ids.push(
    "delivery-art.persist-canonical-artifacts",
  );
  refreshArchitectureCandidate(candidate);

  assert.ok(
    validateDeliveryArtArtifact(candidate).errors.includes(
      "architecture runtime boundaries may assign durable artifact persistence only to workspace-governance-control-fabric",
    ),
  );
});

test("architecture requires an explicit WGCF durable custody boundary", () => {
  const candidate = localCandidate(
    fixture("architecture-packet.valid.json"),
    "missing-wgcf-custody",
  );
  candidate.architecture.runtime_boundaries =
    candidate.architecture.runtime_boundaries.filter(
      (boundary) =>
        boundary.owner_repo !== "workspace-governance-control-fabric",
    );
  refreshArchitectureCandidate(candidate);

  assert.ok(
    validateDeliveryArtArtifact(candidate).errors.includes(
      "architecture runtime boundaries must assign durable artifact persistence to workspace-governance-control-fabric",
    ),
  );
});

test("architecture rejects canonical artifact content projection to OpenProject", () => {
  const candidate = localCandidate(
    fixture("architecture-packet.valid.json"),
    "openproject-artifact-attachment",
  );
  candidate.architecture.runtime_boundaries[0].allowed_capability_ids.push(
    "delivery-art.project-canonical-content-to-openproject",
  );
  refreshArchitectureCandidate(candidate);

  assert.ok(
    validateDeliveryArtArtifact(candidate).errors.includes(
      "architecture runtime boundaries must not allow canonical artifact content projection to OpenProject",
    ),
  );
});

test("architecture requires OOS safe reference projection capability", () => {
  const candidate = localCandidate(
    fixture("architecture-packet.valid.json"),
    "missing-safe-reference-projection",
  );
  candidate.architecture.runtime_boundaries[0].allowed_capability_ids =
    candidate.architecture.runtime_boundaries[0].allowed_capability_ids.filter(
      (capability) =>
        capability !== "delivery-art.project-safe-references-to-openproject",
    );
  refreshArchitectureCandidate(candidate);

  assert.ok(
    validateDeliveryArtArtifact(candidate).errors.includes(
      "architecture runtime boundaries must assign artifact authorship, WGCF submission, and safe OpenProject reference projection to operator-orchestration-service",
    ),
  );
});

test("architecture v2 validates separated work and source topology", () => {
  assert.deepEqual(validateDeliveryArtArtifact(architectureV2Candidate()).errors, []);
});

test("architecture v3 validates executable work and human-gate ordering", () => {
  assert.deepEqual(validateDeliveryArtArtifact(architectureV3Candidate()).errors, []);
});

test("architecture v4 remains immutable historical compatibility", () => {
  const candidate = architectureV4Candidate();
  assert.deepEqual(validateDeliveryArtArtifact(candidate).errors, []);
  assert.equal(deliveryArtArchitectureContractPosture(candidate), "historical-read-only");

  const legacyBoundaries = candidate;
  legacyBoundaries.architecture.runtime_boundaries =
    legacyBoundaries.architecture.runtime_boundaries.map((boundary) => ({
      allowed: ["Historical owner action."],
      owner_repo: boundary.owner_repo,
      prohibited: ["Historical prohibited action."],
    }));
  refreshArchitectureCandidate(legacyBoundaries);
  assert.ok(validateDeliveryArtArtifact(legacyBoundaries).errors.length > 0);
});

test("architecture v5 is the current evidence-owner authoring shape", () => {
  const candidate = architectureV5Candidate();

  assert.deepEqual(validateDeliveryArtArtifact(candidate).errors, []);
  assert.equal(deliveryArtArchitectureContractPosture(candidate), "current");

  const v4WithOwner = architectureV4Candidate();
  v4WithOwner.conformance_plan.cases[0].evidence_owner_landing_unit_id =
    "delivery-698-contract";
  refreshArchitectureCandidate(v4WithOwner);
  assert.ok(validateDeliveryArtArtifact(v4WithOwner).errors.length > 0);
});

test("architecture v5 rejects evidence ownership without causal closure", () => {
  const candidate = architectureV5Candidate();
  const implementationCase = candidate.conformance_plan.cases.find(
    (entry) => entry.id === "case:real-git-positive",
  );
  implementationCase.evidence_owner_landing_unit_id =
    "delivery-698-contract";
  candidate.architecture.work_item_execution_plan.find(
    (entry) => entry.work_item_id === "work-item-802",
  ).start_after_work_item_ids = [];
  refreshArchitectureCandidate(candidate);

  const errors = validateDeliveryArtArtifact(candidate).errors;
  assert.ok(
    errors.includes(
      "conformance case case:real-git-positive evidence-owner Landing Unit delivery-698-contract is not causally ordered before applicable outcome work-item-802",
    ),
    JSON.stringify(errors),
  );
});

test("architecture v5 cyclic parent links terminate with a validation error", () => {
  const candidate = architectureV5Candidate();
  candidate.architecture.descendant_owner_map.find(
    (entry) => entry.work_item_id === "work-item-801",
  ).parent_work_item_id = "work-item-802";
  refreshArchitectureCandidate(candidate);

  const errors = validateDeliveryArtArtifact(candidate).errors;
  assert.ok(
    errors.includes(
      "architecture descendant parent links must be acyclic: work-item-801, work-item-802",
    ),
    JSON.stringify(errors),
  );
});

test("architecture v6 stages exact source activation ownership and ordering", () => {
  const candidate = architectureV6Candidate();

  assert.deepEqual(validateDeliveryArtArtifact(candidate).errors, []);
  assert.equal(deliveryArtArchitectureContractPosture(candidate), "unsupported");
});

test("architecture v6 rejects omitted, mismatched, and unordered source activation", () => {
  const missingChain = architectureV6Candidate();
  missingChain.architecture.runtime_activation_chains = [];
  refreshArchitectureCandidate(missingChain);
  assert.ok(
    validateDeliveryArtArtifact(missingChain).errors.includes(
      "architecture runtime activation chains must exactly cover before_runtime_activation gates",
    ),
  );

  const wrongEvidenceOwner = architectureV6Candidate();
  wrongEvidenceOwner.architecture.runtime_activation_chains[0]
    .source_activation_evidence.repo = "workspace-governance";
  refreshArchitectureCandidate(wrongEvidenceOwner);
  assert.ok(
    validateDeliveryArtArtifact(wrongEvidenceOwner).errors.includes(
      "architecture runtime activation chain activation:delivery-698 source evidence repo must match its source owner",
    ),
  );

  const unorderedCommissioning = architectureV6Candidate();
  unorderedCommissioning.architecture.source_landing_graph.edges.pop();
  refreshArchitectureCandidate(unorderedCommissioning);
  assert.ok(
    validateDeliveryArtArtifact(unorderedCommissioning).errors.includes(
      "architecture runtime activation chain activation:delivery-698 does not order source activation Landing Unit delivery-698-implementation before commissioning Landing Unit delivery-698-platform",
    ),
  );

  const prematureActivation = architectureV6Candidate();
  prematureActivation.architecture.work_item_execution_plan.find(
    (entry) => entry.work_item_id === "work-item-802",
  ).start_after_work_item_ids = [];
  refreshArchitectureCandidate(prematureActivation);
  assert.ok(
    validateDeliveryArtArtifact(prematureActivation).errors.includes(
      "architecture runtime activation chain activation:delivery-698 source activation work item work-item-802 must wait for gate authority work item work-item-801",
    ),
  );
});

test("architecture v3 binds cross-repo handoffs to exact owners and source order", () => {
  const wrongOwner = architectureV3Candidate();
  wrongOwner.architecture.evidence_receipt_handoffs[0].producer =
    "operator-orchestration-service";
  refreshArchitectureCandidate(wrongOwner);
  assert.ok(
    validateDeliveryArtArtifact(wrongOwner).errors.includes(
      "architecture handoff handoff:contract-to-implementation producer does not own its Landing Unit",
    ),
  );

  const reversed = architectureV3Candidate();
  const handoff = reversed.architecture.evidence_receipt_handoffs[0];
  [handoff.producer, handoff.consumer] = [handoff.consumer, handoff.producer];
  [handoff.producer_landing_unit_id, handoff.consumer_landing_unit_id] = [
    handoff.consumer_landing_unit_id,
    handoff.producer_landing_unit_id,
  ];
  [handoff.producer_work_item_id, handoff.consumer_work_item_id] = [
    handoff.consumer_work_item_id,
    handoff.producer_work_item_id,
  ];
  refreshArchitectureCandidate(reversed);
  assert.ok(
    validateDeliveryArtArtifact(reversed).errors.includes(
      "architecture handoff handoff:contract-to-implementation is not ordered from producer to consumer Landing Unit",
    ),
  );
});

test("architecture v3 rejects an impossible combined start-and-close schedule", () => {
  const candidate = architectureV3Candidate();
  candidate.architecture.work_item_execution_plan[0]
    .close_after_work_item_ids = ["work-item-802"];
  refreshArchitectureCandidate(candidate);

  assert.ok(
    validateDeliveryArtArtifact(candidate).errors.includes(
      "architecture work item execution plan has no executable start-and-close schedule",
    ),
  );
});

test("architecture v3 requires every declared human gate to be emitted", () => {
  const candidate = architectureV3Candidate();
  candidate.architecture.work_item_execution_plan[0].emits_human_gate_ids = [];
  refreshArchitectureCandidate(candidate);

  assert.ok(
    validateDeliveryArtArtifact(candidate).errors.includes(
      "architecture work item execution plan must emit every declared human gate: gate:security-source-merge",
    ),
  );
});

test("architecture v3 requires every Security-owned item to emit a gate", () => {
  const candidate = architectureV3Candidate();
  candidate.architecture.descendant_owner_map[0].owner_repo =
    "security-architecture";
  candidate.architecture.landing_units[0].owner_repo = "security-architecture";
  candidate.source_snapshot.repo_revisions[0].repo = "security-architecture";
  candidate.architecture.required_human_gates = [];
  candidate.architecture.work_item_execution_plan[0].emits_human_gate_ids = [];
  refreshArchitectureCandidate(candidate);

  assert.ok(
    validateDeliveryArtArtifact(candidate).errors.includes(
      "architecture Security-owned work item work-item-801 must emit at least one explicit human gate",
    ),
  );
});

test("architecture v3 binds gate evidence to authority execution prerequisites", () => {
  const candidate = architectureV3Candidate();
  candidate.architecture.required_human_gates[0]
    .evidence_prerequisite_work_item_ids = ["work-item-802"];
  refreshArchitectureCandidate(candidate);

  assert.ok(
    validateDeliveryArtArtifact(candidate).errors.includes(
      "architecture human gate gate:security-source-merge evidence prerequisites are absent from authority work item work-item-801 execution prerequisites: work-item-802",
    ),
  );
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
