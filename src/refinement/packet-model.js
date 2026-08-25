import { canonicalDigest } from "../delivery-art/canonical-json.js";
import { assertRefinementPacket } from "./contracts.js";

const GOVERNANCE_ROUTE =
  "POST /v1/delivery-initiatives/{delivery_id}/governance";
const BULK_UPDATE_ROUTE = "POST /v1/delivery-work-items/bulk-update";

const GOVERNANCE_FIELDS = [
  field("target-pi", "target_pi", "Target PI", "select", true),
  field("owner-repo", "owner_repo", "Owner Repo", "short_text", true),
  field("initiative-family", "initiative_family", "Initiative Family", "select", false),
  field("lineage-role", "lineage_role", "Lineage Role", "select", false),
];
const WORK_ITEM_FIELDS = [
  field("target-pi", "target_pi", "Target PI", "select", true),
  field("owner-repo", "owner_repo", "Owner Repo", "short_text", true),
  field("delivery-team", "delivery_team", "Delivery Team", "select", true),
  field("iteration", "iteration", "Iteration", "select", true),
  field("assignee", "assignee_login", "Assignee", "select", false),
  field("responsible", "responsible_login", "Responsible", "select", false),
  field(
    "planned-business-value",
    "planned_business_value",
    "Planned Business Value",
    "number",
    false,
  ),
];

function field(fieldKey, backendField, label, fieldKind, required) {
  return { backendField, fieldKey, fieldKind, label, required };
}

function stringValue(value) {
  return value === null || value === undefined ? "" : String(value);
}

function routeBinding(definition, target) {
  return {
    operation_kind: target === "initiative" ? "governance" : "bulk_update",
    oos_route: target === "initiative" ? GOVERNANCE_ROUTE : BULK_UPDATE_ROUTE,
    payload_key: definition.backendField,
    target,
  };
}

function fieldProjection(definition, nodes, target) {
  const targetValues = Object.fromEntries(
    nodes.map((node) => [String(node.id), stringValue(node[definition.backendField])]),
  );
  const values = Object.values(targetValues);
  const populated = values.filter((value) => value.trim().length > 0);
  const commonValue = new Set(values).size === 1 ? values[0] : "";
  return {
    field_key: `${target}-${definition.fieldKey}`,
    backend_field: definition.backendField,
    label: definition.label,
    field_kind: definition.fieldKind,
    required: definition.required,
    status:
      definition.required && populated.length !== values.length
        ? "missing"
        : "complete",
    value: commonValue,
    target_node_ids: nodes.map((node) => String(node.id)),
    target_values: targetValues,
    validation_hint: definition.required
      ? `${definition.label} must resolve for every selected ${target === "initiative" ? "initiative" : "work item"}.`
      : `${definition.label} is applied only when the operator records a value.`,
    route_binding: routeBinding(definition, target),
  };
}

function refinementTreeNode(node) {
  return {
    id: String(node.id),
    kind: node.type,
    title: node.subject,
    description: "",
    draft_body: "",
    remark: "",
    children: (node.children ?? []).map(refinementTreeNode),
  };
}

function flattenChildren(node) {
  return (node.children ?? []).flatMap((child) => [child, ...flattenChildren(child)]);
}

export function buildRefinementPacket({
  deliveryTree,
  packageRef,
  source,
  workDesignCompletion,
}) {
  const workItems = flattenChildren(deliveryTree);
  const governanceFields = GOVERNANCE_FIELDS.map((definition) =>
    fieldProjection(definition, [deliveryTree], "initiative"),
  );
  const itemTargets = workItems.length > 0 ? workItems : [deliveryTree];
  const workItemFields = WORK_ITEM_FIELDS.map((definition) =>
    fieldProjection(definition, itemTargets, "work_item"),
  );
  const requiredFields = [...governanceFields, ...workItemFields].filter(
    (entry) => entry.required,
  );
  const metadataComplete = requiredFields.every(
    (entry) => entry.status === "complete",
  );
  const receiptId = workDesignCompletion.event.application_id;
  const packetRevision = canonicalDigest({
    delivery_tree: deliveryTree,
    source_revision: source.sourceRevision,
    work_design_receipt: workDesignCompletion.event.content_digest,
  });
  const packet = {
    schema_version: 1,
    packet_id: `refinement-packet:${packageRef}`,
    packet_revision: packetRevision,
    status: metadataComplete ? "ready_for_review" : "drafting",
    active_step: metadataComplete ? "readiness_review" : "metadata_draft",
    source: {
      delivery_id: workDesignCompletion.event.delivery_id,
      package_ref: packageRef,
      source_ref: source.recordRef,
      source_revision: source.sourceRevision,
      source_work_design_receipt_id: receiptId,
      tree_snapshot_ref: `tree://work-design/${receiptId}`,
      finalized_brief_ref: `brief://work-design/${receiptId}/final`,
    },
    target_tree: refinementTreeNode(deliveryTree),
    draft_groups: [
      {
        group_id: `${packageRef}-governance`,
        title: "Initiative Governance",
        summary: "Review the package-level fields that remain with the Delivery initiative.",
        fields: governanceFields,
      },
      {
        group_id: `${packageRef}-work-items`,
        title: "Work Item Metadata",
        summary: "Review item-scoped metadata before the package enters execution control.",
        fields: workItemFields,
      },
    ],
    readiness_gates: [
      {
        gate_id: `${packageRef}-work-design-handoff`,
        label: "Work Design Handoff",
        detail: "A trusted applied Work Design receipt and canonical target tree are present.",
        status: "passed",
      },
      {
        gate_id: `${packageRef}-metadata-review`,
        label: "Metadata Review",
        detail: metadataComplete
          ? "Every required metadata target has a current value."
          : "Required metadata still needs an operator decision.",
        status: metadataComplete ? "passed" : "open",
      },
    ],
    apply_plan: {
      summary: "Apply reviewed initiative and item metadata through existing OOS Delivery authorities.",
      expected_routes: [GOVERNANCE_ROUTE, BULK_UPDATE_ROUTE],
      operations: [
        {
          operation_id: `${packageRef}-governance`,
          kind: "governance",
          label: "Update Initiative Governance",
          detail: "Apply accepted package-level governance values.",
          target: workDesignCompletion.event.result.target.delivery_ref,
          oos_route: GOVERNANCE_ROUTE,
          status: "planned",
        },
        {
          operation_id: `${packageRef}-work-items`,
          kind: "bulk_update",
          label: "Update Work Item Metadata",
          detail: "Apply accepted item-scoped metadata values without changing the Work Design tree.",
          target: "Reviewed ART work items",
          oos_route: BULK_UPDATE_ROUTE,
          status: workItems.length > 0 ? "planned" : "skipped",
        },
      ],
    },
    last_saved_at: workDesignCompletion.event.recorded_at,
  };
  return assertRefinementPacket(packet);
}
