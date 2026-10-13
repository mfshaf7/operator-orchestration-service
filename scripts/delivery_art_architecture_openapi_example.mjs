import { readFileSync } from "node:fs";

const basePacketPath = new URL(
  "../contracts/delivery-art/fixtures/architecture-packet.valid.json",
  import.meta.url,
);

function architectureV6DesignExample() {
  const packet = JSON.parse(readFileSync(basePacketPath, "utf8"));

  delete packet.architecture.dependency_merge_dag;
  packet.architecture.work_dependency_graph = {
    nodes: ["work-item-801", "work-item-802"],
    edges: [{
      prerequisite_work_item_id: "work-item-801",
      dependent_work_item_id: "work-item-802",
    }],
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
    edges: [{
      prerequisite_landing_unit_id: "delivery-698-contract",
      dependent_landing_unit_id: "delivery-698-implementation",
    }],
  };
  packet.architecture.required_human_gates = [{
    gate_id: "gate:security-source-merge",
    authority_work_item_id: "work-item-801",
    authority_owner_repo: "workspace-governance",
    affected_landing_unit_ids: ["delivery-698-platform"],
    blocked_transition: "before_runtime_activation",
    evidence_requirement: "Bind the exact implementation review head.",
    evidence_prerequisite_work_item_ids: [],
  }];
  packet.architecture.evidence_receipt_handoffs = [{
    handoff_id: "handoff:architecture-admission",
    producer: "workspace-governance",
    consumer: "operator-orchestration-service",
    producer_landing_unit_id: "delivery-698-contract",
    consumer_landing_unit_id: "delivery-698-implementation",
    producer_work_item_id: "work-item-801",
    consumer_work_item_id: "work-item-802",
    integration_point: "delivery architecture admission",
    artifact: "delivery architecture contract",
    acceptance: "schema-valid, scope-bound, and dependency-ordered",
  }];
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
    {
      work_item_id: "work-item-803",
      start_after_work_item_ids: ["work-item-802"],
      close_after_work_item_ids: [],
      emits_human_gate_ids: [],
    },
  ];

  for (const entry of packet.conformance_plan.cases) {
    entry.evidence_owner_landing_unit_id =
      entry.applies_to_work_item_ids.includes("work-item-801")
        ? "delivery-698-contract"
        : "delivery-698-implementation";
    if (entry.applies_to_work_item_ids.includes("work-item-802")) {
      entry.applies_to_work_item_ids.push("work-item-803");
    }
  }

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

  return packet;
}

export function deliveryArtArchitectureDraftRequestExample() {
  const packet = architectureV6DesignExample();
  return {
    input: {
      schema_version: 1,
      delivery_id: packet.delivery_id,
      covered_work_item_ids: packet.covered_work_item_ids,
      repo_revisions: packet.source_snapshot.repo_revisions,
      architecture: packet.architecture,
      conformance_plan: packet.conformance_plan,
      decision: {
        status: "draft",
        rationale: "Review the complete schema-v6 design before approval.",
      },
    },
  };
}
