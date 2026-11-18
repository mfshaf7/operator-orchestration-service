import { refinementSelectedField } from "./catalog-fields.js";
import { DELIVERY_PLANNING_WORKFLOW, validateDeliveryPlanningState } from "../delivery-taxonomy.js";

const fields = packet => packet.draft_groups.flatMap(group => group.fields);
const sourceValue = (field, id) => field.target_values?.[id] ?? field.value;
const commonValue = values => new Set(values).size === 1 ? values[0] : "";
export class RefinementAdviceError extends Error {
  constructor(message) { super(message); this.code = "packet_stale"; }
}

export function refinementAdviceTarget(packet, request) {
  const field = fields(packet).find(item => item.field_key === request.target.field_key);
  const ids = request.target.selected_node_ids;
  if (!field || !ids.length || new Set(ids).size !== ids.length ||
      ids.some(id => !field.target_node_ids.includes(id) || (field.target_statuses?.[id] ?? field.status) === "blocked") ||
      request.target.field_label !== field.label || request.target.field_kind !== field.field_kind ||
      request.target.required !== field.required ||
      request.target.source_value !== commonValue(ids.map(id => sourceValue(field, id))) ||
      JSON.stringify([...request.target.allowed_values].sort()) !== JSON.stringify([...(refinementSelectedField(field, ids).allowed_values ?? [])].sort())) {
    throw new RefinementAdviceError("The selected Refinement field no longer matches the canonical packet.");
  }
  return refinementSelectedField(field, ids);
}

export function refinementAdviceWorkContext(packet, request) {
  const selected = new Set(request.target.selected_node_ids), nodes = [];
  function visit(node) {
    const descendant = (node.children ?? []).map(visit).some(Boolean);
    if (selected.has(node.id) || descendant) {
      nodes.push({ id: node.id, kind: node.kind, title: node.title, description: node.description,
        ...(node.planning ? { planning: node.planning } : {}) });
      return true;
    }
    return false;
  }
  visit(packet.target_tree);
  if ([...selected].some(id => !nodes.some(node => node.id === id))) throw new RefinementAdviceError("Selected work items are absent from the current canonical tree.");
  const metadata = fields(packet).flatMap(field => nodes.filter(node => field.target_node_ids.includes(node.id)).map(node => ({
    node_id: node.id, field_key: field.field_key, backend_field: field.backend_field,
    field_kind: field.field_kind, required: field.required,
    status: field.target_statuses?.[node.id] ?? field.status, source_value: sourceValue(field, node.id),
    allowed_values: refinementSelectedField(field, [node.id]).allowed_values ?? [], validation_hint: field.validation_hint,
    ...(field.numeric_type ? { numeric_type: field.numeric_type } : {}),
  })));
  const seen = new Set();
  for (const draft of request.related_drafts ?? []) {
    const key = `${draft.field_key}:${draft.node_id}`;
    const item = metadata.find(item => item.node_id === draft.node_id && item.field_key === draft.field_key);
    if (!item || item.field_kind === "generated" || item.status === "blocked" || seen.has(key))
      throw new RefinementAdviceError("Related drafts must identify unique editable fields on the selected items or their ancestors.");
    seen.add(key); item.draft_value = draft.value;
  }
  // The selected control is authoritative only as the operator's unaccepted draft.
  // Preserve mixed shared values per node instead of replacing them by the first value.
  for (const item of metadata.filter(item => selected.has(item.node_id) && item.field_key === request.target.field_key)) {
    if (!Object.hasOwn(item, "draft_value")) item.draft_value = request.target.draft_value;
  }
  const workflow = DELIVERY_PLANNING_WORKFLOW;
  return {
    package_ref: packet.source.package_ref, source_ref: packet.source.source_ref,
    source_revision: packet.source.source_revision, source_work_design_receipt_id: packet.source.source_work_design_receipt_id,
    nodes, metadata,
    planning_rules: {
      workflow_id: workflow.workflow_id,
      backlog_iteration_label: workflow.backlog_iteration_label,
      iteration_prefix_templates: workflow.pi_lifecycle.iteration_compatibility.allowed_prefix_templates,
      target_pi_required_types: workflow.planning_sets.target_pi_required_types,
      iteration_required_types: workflow.planning_sets.iteration_required_when_target_pi_types,
    },
    coverage: "Canonical selected items and ancestors only. planning/source_value are saved owner facts; draft_value is unaccepted operator input, not approval. Allowed values are exclusive only for select fields. Catalog-backed choices are authoritative; existing assignments are not approval to commit other work. A legacy text field without supplied choices does not establish that a proposed identifier exists. Never infer an active PI, dates, people, capacity or intent. Missing planning snapshots on older packets are unavailable, not blank. Separate diagrams, proof contents, other projects and unrelated branches are not loaded.",
  };
}

export function refinementPlanningSuggestion(output, field, context, request) {
  if (output.value === null || !["target_pi", "iteration"].includes(field.backend_field)) return output;
  try {
    for (const id of request.target.selected_node_ids) {
      const node = context.nodes.find(node => node.id === id);
      const value = key => {
        if (key === field.backend_field) return output.value;
        const item = context.metadata.find(item => item.node_id === id && item.backend_field === key);
        // Empty optional controls retain their source value under the Apply contract.
        return item ? item.draft_value?.trim() || item.source_value : node.planning?.[key];
      };
      const targetPi = value("target_pi"), iteration = value("iteration");
      if (node.kind !== "Epic" && (targetPi === undefined || iteration === undefined))
        throw Error("The related PI or Iteration value is unavailable. Read or enter it before drafting a commitment.");
      if (field.backend_field === "target_pi" && !output.value.trim() && node.planning?.target_pi)
        throw Error("Existing PI commitment must be changed through the applicable planning workflow, not cleared by field advice.");
      validateDeliveryPlanningState({ typeName: node.kind, status: node.planning?.status ?? "new", targetPi, iteration });
    }
    return output;
  } catch (error) {
    return { ...output, value: null, required_operator_action: "none", summary: "Review the related planning values first.", rationale: error.message };
  }
}
