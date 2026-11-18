import { assertCatalogProjectionResult } from "../catalog/contracts.js";
import { DELIVERY_PLANNING_WORKFLOW } from "../delivery-taxonomy.js";
import { parseDeliveryInitiativeLineageRef } from "../delivery-initiative-lineage.js";

const catalogFields = {
  target_pi: "catalog-target-pi", iteration: "catalog-iteration", owner_repo: "catalog-owner-repo",
  delivery_team: "catalog-delivery-team", assignee_login: "catalog-principal-lookup", responsible_login: "catalog-principal-lookup",
  initiative_family: "catalog-initiative-family", lineage_role: "catalog-lineage-role", pi_objective_type: "catalog-pi-objective-type",
};

// Catalog is the existing value authority. Storage as an OpenProject String
// does not turn a repository, principal or planning identifier into prose.
export function refinementCatalogMetadata(fieldMetadata, projection) {
  if (projection) assertCatalogProjectionResult(projection);
  const ready = projection?.projection_status === "ready";
  const result = structuredClone(fieldMetadata);
  const reservedPis = new Set([DELIVERY_PLANNING_WORKFLOW.roadmap_unassigned_version_name, DELIVERY_PLANNING_WORKFLOW.roadmap_retired_version_name]);
  for (const metadata of Object.values(result)) for (const [key, detail] of Object.entries(metadata)) {
    const itemId = catalogFields[key];
    if (!itemId || detail.writable === false) continue;
    const item = projection?.items.find(item => item.catalog_item_id === itemId);
    const values = ready && item && !["retired", "stale", "missing"].includes(item.lifecycle_state)
      ? projection.values.filter(value => value.catalog_item_id === itemId && ["active", "read_only", "admitted"].includes(value.lifecycle_state)) : [];
    const options = [...new Set(values.map(value => value.value_key))].filter(value => key !== "target_pi" || !reservedPis.has(value));
    detail.allowed_values = detail.field_kind === "select" ? options.filter(value => detail.allowed_values?.includes(value)) : options;
    detail.field_kind = "select";
    detail.unavailable = !ready || !item;
    detail.validation_hint = !ready ? "Catalog is unavailable. Restore it before selecting a governed value."
      : "Choose an existing Catalog value. Create missing values through Catalog; account membership and repository onboarding keep their own workflows.";
  }
  return result;
}

// Per-record permissions come from the current native form. Only intersect
// the explicitly selected set; unselected siblings must not restrict it.
export function refinementSelectedField(field, ids) {
  const options = ids.map(id => field.target_allowed_values ? field.target_allowed_values[id] ?? [] : field.allowed_values ?? []);
  return { ...field,
    status: ids.some(id => (field.target_statuses?.[id] ?? field.status) === "blocked") ? "blocked"
      : ids.some(id => (field.target_statuses?.[id] ?? field.status) === "missing") ? "missing" : "complete",
    ...(field.field_kind === "select" ? { allowed_values: options.length ? options[0].filter(value => options.every(list => list.includes(value))) : [] } : {}),
  };
}

export function refinementFieldValueError(field, input) {
  const value = String(input ?? "").trim();
  if (!value) return field.required ? "A required field needs a value." : null;
  if (field.status === "blocked") return "The field's source is unavailable or read-only.";
  if (field.field_kind === "select" && !field.allowed_values?.includes(value)) return "Choose a current value offered by the connected authority.";
  if (field.field_kind === "number") {
    if (field.numeric_type === "integer" && (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)))) return "Enter a whole number of zero or more.";
    if (!/^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value) || !Number.isFinite(Number(value))) return "Enter a number of zero or more.";
  }
  if (field.backend_field === "risk_review_date" && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value)) || new Date(value).toISOString().slice(0,10) !== value)) return "Enter a real date in YYYY-MM-DD format.";
  if (["architecture_anchor_ref", "required_upstream_ref"].includes(field.backend_field) && !parseDeliveryInitiativeLineageRef(value)) return "Use an existing Delivery reference in its supported reference format.";
  return null;
}
