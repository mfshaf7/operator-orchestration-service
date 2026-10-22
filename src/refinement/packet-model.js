import { canonicalDigest } from "../delivery-art/canonical-json.js";
import { assertRefinementPacket } from "./contracts.js";

const GOVERNANCE_ROUTE =
  "POST /v1/delivery-initiatives/{delivery_id}/governance";
const BULK_UPDATE_ROUTE = "POST /v1/delivery-work-items/bulk-update";

const GOVERNANCE_FIELDS = [
  field("target-pi", "target_pi", "Target PI", "short_text", true),
  field("owner-repo", "owner_repo", "Owner Repo", "short_text", true),
  field("initiative-family", "initiative_family", "Initiative Family", "select", false),
  field("lineage-role", "lineage_role", "Lineage Role", "select", false),
  field("architecture-anchor", "architecture_anchor_ref", "Architecture Anchor Ref", "short_text", false),
  field("required-upstream", "required_upstream_ref", "Required Upstream Ref", "short_text", false),
  field("phase", "pm2_phase", "PM² Phase", "select", false),
  field("business-objective", "business_objective", "Business Objective", "long_text", false),
  field("sponsor", "sponsor", "Sponsor", "short_text", false),
  field("success-criteria", "success_criteria", "Success Criteria", "long_text", false),
];
const CONTRACT_TYPES = ["Feature", "User story", "Defect", "Task", "PI Objective"];
const WORK_ITEM_FIELDS = [
  field("target-pi", "target_pi", "Target PI", "short_text", true),
  field("owner-repo", "owner_repo", "Owner Repo", "short_text", true),
  field("delivery-team", "delivery_team", "Delivery Team", "short_text", true),
  field("iteration", "iteration", "Iteration", "short_text", true),
  field("assignee", "assignee_login", "Assignee", "short_text", true),
  field("responsible", "responsible_login", "Responsible", "short_text", true),
  field("classification", "execution_classification", "Execution Classification", "select", true, ["Feature", "User story"]),
  field("acceptance", "acceptance_criteria", "Acceptance Criteria", "long_text", true, CONTRACT_TYPES),
  field("ready", "definition_of_ready", "Definition of Ready", "long_text", true, CONTRACT_TYPES),
  field("done", "definition_of_done", "Definition of Done", "long_text", true, CONTRACT_TYPES),
  field("nfr", "nfr_category", "NFR Category", "select", false, ["Feature", "User story", "Defect", "Task"]),
  field("objective-type", "pi_objective_type", "PI Objective Type", "select", true, ["PI Objective"]),
  field("objective-planned-value", "planned_business_value", "Planned Business Value", "number", true, ["PI Objective"]),
  field("actual-value", "actual_business_value", "Actual Business Value", "number", false, ["PI Objective"]),
  field("objective-review", "pi_objective_review_outcome", "PI Objective Review Outcome", "select", false, ["PI Objective"]),
  field("roam", "roam_state", "ROAM State", "select", true, ["Risk"]),
  field("risk-owner", "risk_owner", "Risk Owner", "short_text", true, ["Risk"]),
  field("risk-review", "risk_review_date", "Risk Review Date", "short_text", true, ["Risk"]),
  field("risk-disposition", "risk_disposition", "Risk Disposition", "long_text", true, ["Risk"]),
  field(
    "planned-business-value",
    "planned_business_value",
    "Planned Business Value",
    "number",
    false,
    ["Epic", "Feature", "User story", "Defect", "Task", "Risk", "Milestone"],
  ),
];

export const REFINEMENT_METADATA_FIELDS = [
  ...GOVERNANCE_FIELDS.map((definition) => ({ ...definition, target: "initiative" })),
  ...WORK_ITEM_FIELDS.map((definition) => ({ ...definition, target: "work_item" })),
];

function field(fieldKey, backendField, label, fieldKind, required, targetTypes = null) {
  return { backendField, fieldKey, fieldKind, label, required, targetTypes };
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

function fieldProjection(definition, nodes, target, metadata) {
  nodes = nodes.filter((node) => !definition.targetTypes || definition.targetTypes.includes(node.type));
  nodes = nodes.filter((node) => {
    const detail = metadata?.[String(node.id)]?.[definition.backendField];
    if (detail?.writable !== false) return true;
    // Preserve non-editable canonical values; do not demand a fabricated score
    // or offer a mutation for an unavailable optional field.
    return definition.required && !stringValue(node[definition.backendField]).trim();
  });
  if (nodes.length === 0) return null;
  const targetValues = Object.fromEntries(
    nodes.map((node) => [String(node.id), stringValue(node[definition.backendField])]),
  );
  const values = Object.values(targetValues);
  const populated = values.filter((value) => value.trim().length > 0);
  const commonValue = new Set(values).size === 1 ? values[0] : "";
  const details = nodes.map((node) => metadata?.[String(node.id)]?.[definition.backendField]);
  const targetStatuses = Object.fromEntries(nodes.map((node, index) => [String(node.id),
    details[index]?.writable === false ? "blocked" : definition.required && !targetValues[String(node.id)].trim() ? "missing" : "complete"]));
  const kinds = [...new Set(details.flatMap((entry) => entry?.field_kind ? [entry.field_kind] : []))];
  if (kinds.length > 1) {
    Object.keys(targetStatuses).forEach((id) => { targetStatuses[id] = "blocked"; });
  }
  const allowed = details.filter(Boolean).map((entry) => entry.allowed_values ?? []);
  const allowedValues = allowed.length ? allowed[0].filter((value) => allowed.every((list) => list.includes(value))) : [];
  const blocked = Object.values(targetStatuses).includes("blocked") || kinds.length > 1;
  return {
    field_key: `${target}-${definition.fieldKey}`,
    backend_field: definition.backendField,
    label: definition.label,
    field_kind: kinds[0] ?? definition.fieldKind,
    required: definition.required,
    status:
      blocked ? "blocked" : definition.required && populated.length !== values.length
        ? "missing"
        : "complete",
    value: commonValue,
    target_node_ids: nodes.map((node) => String(node.id)),
    target_values: targetValues,
    target_statuses: targetStatuses,
    ...(kinds[0] === "select" ? { allowed_values: allowedValues } : {}),
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
    description: node.description ?? "",
    draft_body: node.description ?? "",
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
  fieldMetadata = null,
}) {
  const workItems = flattenChildren(deliveryTree);
  const governanceFields = GOVERNANCE_FIELDS.map((definition) =>
    fieldProjection(definition, [deliveryTree], "initiative", fieldMetadata),
  ).filter(Boolean);
  const itemTargets = workItems.length > 0 ? workItems : [deliveryTree];
  const workItemFields = WORK_ITEM_FIELDS.map((definition) =>
    fieldProjection(definition, itemTargets, "work_item", fieldMetadata),
  ).filter(Boolean);
  const requiredFields = [...governanceFields, ...workItemFields].filter(
    (entry) => entry.required,
  );
  const metadataComplete = requiredFields.every(
    (entry) => entry.status === "complete",
  );
  const receiptId = workDesignCompletion.event.application_id;
  const packetRevision = canonicalDigest({
    delivery_tree: deliveryTree,
    field_metadata: fieldMetadata,
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
    ].filter((group) => group.fields.length > 0),
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
        oos_route: BULK_UPDATE_ROUTE,
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
          status: workItems.length > 0 && workItemFields.length > 0 ? "planned" : "skipped",
        },
      ],
    },
    last_saved_at: workDesignCompletion.event.recorded_at,
  };
  return assertRefinementPacket(packet);
}
