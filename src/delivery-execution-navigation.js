import { isRefinementMetadataTarget, REFINEMENT_METADATA_FIELDS } from "./refinement/packet-model.js";

const workTypes = new Set(["User story", "Defect", "Task"]);
const planTypes = new Set(["Feature", ...workTypes]);

function hasRefinementPreparation(node) {
  return node.ready_contract_satisfied === true || (
    node.ready_contract_applicable === true &&
    Array.isArray(node.ready_contract_missing_fields) &&
    node.ready_contract_missing_fields.length > 0 &&
    node.ready_contract_missing_fields.every(field => field === "Iteration")
  );
}

function hasMissingRefinementFields(node, target) {
  return REFINEMENT_METADATA_FIELDS.some(field =>
    field.target === target && field.required &&
    (!field.targetTypes || field.targetTypes.includes(node.type)) &&
    Object.hasOwn(node, field.backendField) && !String(node[field.backendField] ?? "").trim());
}

// Read-only navigation from current ART facts, never work-start eligibility.
// Whole-package navigation must survive partial scopes and the final child close.
export function preparedForPIPlanning(node) {
  return planTypes.has(node.type) && ["new", "ready"].includes(node.status) &&
    hasRefinementPreparation(node);
}

export function deliveryExecutionNavigation(root) {
  const nodes = (root.children ?? []).flatMap(function walk(node) {
    return [node, ...(node.children ?? []).flatMap(walk)];
  });
  const terminal = node => ["done", "retired"].includes(node.status);
  const leaves = nodes.filter(node => workTypes.has(node.type));
  const open = leaves.filter(node => !terminal(node));
  const active = nodes.filter(node => node.status === "in-progress");
  const prepared = open.filter(node => ["new", "ready"].includes(node.status) && node.ready_contract_satisfied === true);
  const planningPrepared = nodes.filter(preparedForPIPlanning);
  const blocked = nodes.filter(node => !terminal(node) && (node.blocked || node.dependency_blocked || node.status === "blocked"));
  const finishedScope = leaves.length > 0 && leaves.every(terminal);
  const executionSeen = leaves.length > 0 && ["in-progress", "blocked", "parked"].includes(root.status) ||
    active.length > 0 || blocked.length > 0 || leaves.some(terminal) || prepared.length > 0;
  const phase = terminal(root) ? "audit_only" : executionSeen ? "execution" : leaves.length ? "refinement" : "work_design";
  const refinementOpen = phase !== "work_design" && phase !== "audit_only" && root.status !== "parked";
  const needsRefinement = node => isRefinementMetadataTarget(node) && node.status !== "in-progress" &&
    (planTypes.has(node.type) ? !hasRefinementPreparation(node) : hasMissingRefinementFields(node, "work_item"));
  const closeoutPending = !terminal(root) && finishedScope;
  const posture = root.status === "done" ? "Done" : root.status === "retired" ? "Retired" :
    root.status === "parked" ? "Deferred" : root.status === "blocked" || blocked.length ? "Blocked" :
    closeoutPending ? "Closeout Pending" : active.length || root.status === "in-progress" || leaves.some(terminal) ? "In Progress" :
    phase === "execution" || root.status === "ready" ? "Ready" : "New";
  return {
    authority: "operator-orchestration-service",
    workflow_phase: phase,
    package_posture: posture,
    native_status: root.status,
    closeout_pending: closeoutPending,
    active_work_item_ids: active.map(node => node.id),
    prepared_work_item_ids: prepared.map(node => node.id),
    planning_prepared_work_item_ids: planningPrepared.map(node => node.id),
    blocked_work_item_ids: blocked.map(node => node.id),
    // A package can have actionable work in more than one surface.
    refinement_work_item_ids: refinementOpen ? nodes.filter(needsRefinement).map(node => node.id) : [],
    ...(refinementOpen && hasMissingRefinementFields(root, "initiative") ? { refinement_governance_pending: true } : {}),
    eligibility: "check-selected-work-item",
  };
}
