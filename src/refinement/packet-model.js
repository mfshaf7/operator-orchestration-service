import { canonicalDigest } from "../delivery-art/canonical-json.js";
import { assertRefinementPacket } from "./contracts.js";
import { isRefinementPlanningField, refinementPlanningFieldRequired } from "./planning-fields.js";

const GOVERNANCE_ROUTE =
  "POST /v1/delivery-initiatives/{delivery_id}/governance";
const BULK_UPDATE_ROUTE = "POST /v1/delivery-work-items/bulk-update";
const PLAN_APPLY_ROUTE = "POST /v1/delivery-initiatives/{delivery_id}/plan/apply";
const PLANNING_FIELDS = new Set(["target_pi", "iteration"]);

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
  const planning = target === "work_item" && PLANNING_FIELDS.has(definition.backendField);
  return {
    operation_kind: target === "initiative" ? "governance" : planning ? "plan_apply" : "bulk_update",
    oos_route: target === "initiative" ? GOVERNANCE_ROUTE : planning ? PLAN_APPLY_ROUTE : BULK_UPDATE_ROUTE,
    payload_key: definition.backendField,
    target,
  };
}

// Retain the whole hierarchy as source evidence. Closed work does not acquire
// new mutable metadata obligations when another branch enters Refinement.
export function isRefinementMetadataTarget(node) {
  return !["done", "retired"].includes(stringValue(node.status).trim().toLowerCase());
}

function fieldProjection(definition, nodes, target, metadata) {
  if (target === "work_item") nodes = nodes.filter(isRefinementMetadataTarget);
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

function workItemFieldProjections(definition, nodes, metadata) {
  if (!isRefinementPlanningField({ backend_field: definition.backendField })) {
    return [fieldProjection(definition, nodes, "work_item", metadata)].filter(Boolean);
  }
  // Existing v1 fields already have explicit target ids and required markers.
  // Partition their targets instead of imposing one obligation on every branch.
  return [true, false].flatMap((required) => {
    const selected = nodes.filter((node) =>
      refinementPlanningFieldRequired(node, definition.backendField) === required,
    );
    const projected = fieldProjection({
      ...definition,
      fieldKey: definition.fieldKey + (required ? "" : "-backlog"),
      required,
    }, selected, "work_item", metadata);
    return projected ? [projected] : [];
  });
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
  const workItemFields = WORK_ITEM_FIELDS.flatMap((definition) =>
    workItemFieldProjections(definition, itemTargets, fieldMetadata),
  );
  const requiredFields = [...governanceFields, ...workItemFields].filter(
    (entry) => entry.required,
  );
  const metadataComplete = requiredFields.every(
    (entry) => entry.status === "complete",
  );
  const receiptId = workDesignCompletion.event.application_id;
  const planningFields = workItemFields.filter((entry) => entry.route_binding.operation_kind === "plan_apply");
  const bulkFields = workItemFields.filter((entry) => entry.route_binding.operation_kind === "bulk_update");
  const optionalPlanning = (entry) => isRefinementPlanningField(entry) && !entry.required;
  const draftGroups = [
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
      fields: workItemFields.filter((entry) => !optionalPlanning(entry)),
    },
    {
      group_id: `${packageRef}-backlog-planning`,
      title: "Backlog Planning",
      summary: "Future scope may retain blank PI and blank or backlog Iteration.",
      fields: workItemFields.filter(optionalPlanning),
    },
  ].filter((group) => group.fields.length > 0);
  const applyPlan = {
    summary: "Apply reviewed governance, coordinated PI planning and ID-scoped metadata through existing Delivery authorities.",
    expected_routes: [GOVERNANCE_ROUTE, PLAN_APPLY_ROUTE, BULK_UPDATE_ROUTE],
    operations: [
      {
        operation_id: `${packageRef}-governance`, kind: "governance",
        label: "Update Initiative Governance", detail: "Apply accepted package-level governance values.",
        target: workDesignCompletion.event.result.target.delivery_ref, oos_route: GOVERNANCE_ROUTE, status: "planned",
      },
      {
        operation_id: `${packageRef}-planning`, kind: "plan_apply",
        label: "Apply Coordinated PI Planning",
        detail: "Apply accepted Target PI and Iteration to the existing hierarchy; preserve taxonomy and current statuses.",
        target: "Reviewed ART planning scope", oos_route: PLAN_APPLY_ROUTE,
        status: workItems.length > 0 && planningFields.length > 0 ? "planned" : "skipped",
      },
      {
        operation_id: `${packageRef}-work-items`, kind: "bulk_update",
        label: "Update Work Item Metadata",
        detail: "Apply accepted non-planning metadata by explicit work-item id without reshaping the tree.",
        target: "Reviewed ART work items", oos_route: BULK_UPDATE_ROUTE,
        status: workItems.length > 0 && bulkFields.length > 0 ? "planned" : "skipped",
      },
    ],
  };
  const packetRevision = canonicalDigest({
    apply_plan: applyPlan,
    metadata_fields: [...governanceFields, ...workItemFields],
    draft_groups: draftGroups,
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
    draft_groups: draftGroups,
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
        oos_route: (bulkFields[0] ?? planningFields[0] ?? governanceFields[0])?.route_binding.oos_route ?? BULK_UPDATE_ROUTE,
        detail: metadataComplete
          ? "Every required metadata target has a current value."
          : "Required metadata still needs an operator decision.",
        status: metadataComplete ? "passed" : "open",
      },
    ],
    apply_plan: applyPlan,
    last_saved_at: workDesignCompletion.event.recorded_at,
  };
  return assertRefinementPacket(packet);
}
