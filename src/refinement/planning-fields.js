import {
  DELIVERY_ITERATION_REQUIRED_TYPES,
  validateDeliveryPlanningState,
} from "../delivery-taxonomy.js";

export function isRefinementPlanningField(field) {
  return ["target_pi", "iteration"].includes(field.backend_field);
}

// Use the same type/status rules as the canonical writer. Existing commitment
// cannot be cleared through an optional backlog field; decommit has its own path.
export function refinementPlanningFieldRequired(node, backendField) {
  let requiresPi = Boolean(String(node.target_pi ?? "").trim());
  if (!requiresPi) {
    try {
      validateDeliveryPlanningState({ typeName: node.type, status: node.status });
    } catch {
      requiresPi = true;
    }
  }
  return backendField === "target_pi"
    ? requiresPi
    : requiresPi && DELIVERY_ITERATION_REQUIRED_TYPES.has(node.type);
}

export function acceptedRefinementValue(field, draft, nodeId) {
  const specific = `${field.backend_field}:${nodeId}`;
  return Object.hasOwn(draft.metadata_values, specific)
    ? draft.metadata_values[specific]
    : draft.metadata_values[field.backend_field]
      ?? field.target_values?.[nodeId] ?? field.value;
}

export function effectiveRefinementPlanningValue(field, draft, nodeId) {
  const value = String(acceptedRefinementValue(field, draft, nodeId) ?? "").trim();
  // The existing writer omits empty optional values. Readback must still prove
  // the reviewed retained planning value, rather than ignore that target.
  return value === "" && !field.required
    ? field.target_values?.[nodeId] ?? field.value
    : value;
}

export function validateRefinementPlanningValues(packet, draft) {
  const fields = packet.draft_groups.flatMap((group) => group.fields)
    .filter(isRefinementPlanningField);
  function visit(node) {
    const selected = fields.filter((field) => field.target_node_ids?.includes(node.id));
    // Omitted form properties remain under native writer authority. Do not
    // fabricate a blank counterpart for a populated read-only planning field.
    if (selected.some((field) => field.backend_field === "target_pi") &&
        selected.some((field) => field.backend_field === "iteration")) {
      const value = (key) => {
        const field = selected.find((candidate) => candidate.backend_field === key);
        return field ? effectiveRefinementPlanningValue(field, draft, node.id) : "";
      };
      validateDeliveryPlanningState({
        typeName: node.kind,
        targetPi: value("target_pi"),
        iteration: value("iteration"),
      });
    }
    for (const child of node.children ?? []) visit(child);
  }
  visit(packet.target_tree);
}
