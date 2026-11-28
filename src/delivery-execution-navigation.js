import { isRefinementMetadataTarget, REFINEMENT_METADATA_FIELDS } from "./refinement/packet-model.js";

import { deliveryWorkHold } from "./delivery-blocker.js";

const workTypes = new Set(["User story", "Defect", "Task"]);
export const piPlanningAssignmentTypes = new Set(["Feature", ...workTypes, "Risk", "Milestone"]);

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
  return piPlanningAssignmentTypes.has(node.type) && ["new", "ready"].includes(node.status) &&
    hasRefinementPreparation(node);
}

export function deliveryExecutionNavigation(root) {
  const terminal = node => ["done", "retired"].includes(node.status);
  const rootHold = terminal(root) ? null : deliveryWorkHold(root);
  const nodes = [];
  const current = [];
  const fronts = [];
  const deferred = [];
  function visit(node, ancestorHold, ancestorInactive, ancestorDeferred) {
    nodes.push(node);
    const hold = deliveryWorkHold(node);
    const deferredHere = ancestorDeferred || hold === "deferred";
    const inactive = ancestorInactive || terminal(node) || deferredHere;
    if (ancestorDeferred && !terminal(node) && hold !== "deferred") deferred.push(node.id);
    const held = ancestorHold || hold !== null;
    if (!inactive) current.push({ node, hold, held, inherited: ancestorHold && hold === null });
    const childFronts = (node.children ?? []).map(child => visit(child, held, inactive, deferredHere));
    const hasWorkBelow = childFronts.includes(true);
    if (inactive) return false;
    const isFront = workTypes.has(node.type) || (node.type === "Feature" && !hasWorkBelow);
    if (isFront) fronts.push({ node, held });
    return isFront || hasWorkBelow;
  }
  for (const child of root.children ?? []) {
    visit(child, rootHold !== null, terminal(root), rootHold === "deferred");
  }

  const leaves = nodes.filter(node => workTypes.has(node.type));
  const active = current.filter(({ node, held }) => !held && node.status === "in-progress");
  const prepared = current.filter(({ node, held }) => !held && workTypes.has(node.type) &&
    ["new", "ready"].includes(node.status) && node.ready_contract_satisfied === true);
  const planningPrepared = current.filter(({ node }) => preparedForPIPlanning(node));
  const blocked = current.filter(({ hold }) => hold !== null);
  const blockingScope = rootHold === "blocked" || rootHold === "dependency" ? "package"
    : fronts.length && fronts.every(({ held }) => held) ? "all-work"
    : blocked.length ? "some-work" : "none";
  const started = root.status === "in-progress" || active.length > 0 || leaves.some(node => node.status === "done");
  const executionSeen = active.some(({ node }) => workTypes.has(node.type)) ||
    prepared.length > 0 || leaves.some(terminal) ||
    (leaves.length > 0 && (root.status === "in-progress" || rootHold !== null || fronts.some(({ held }) => held)));
  const phase = terminal(root) ? "audit_only" : executionSeen ? "execution" : leaves.length ? "refinement" : "work_design";
  const refinementOpen = phase !== "work_design" && phase !== "audit_only" && root.status !== "parked";
  const needsRefinement = node => isRefinementMetadataTarget(node) && node.status !== "in-progress" &&
    (piPlanningAssignmentTypes.has(node.type) ? !hasRefinementPreparation(node) : hasMissingRefinementFields(node, "work_item"));
  const closeoutPending = !terminal(root) && rootHold === null && leaves.length > 0 && nodes.every(terminal);
  const posture = root.status === "done" ? "Done" : root.status === "retired" ? "Retired" :
    rootHold === "deferred" ? "Deferred" : ["package", "all-work"].includes(blockingScope) ? "Blocked" :
    closeoutPending ? "Closeout Pending" : started ? "In Progress" :
    prepared.length ? "Ready" : "New";
  return {
    authority: "operator-orchestration-service",
    workflow_phase: phase,
    package_posture: posture,
    native_status: root.status,
    closeout_pending: closeoutPending,
    active_work_item_ids: active.map(({ node }) => node.id),
    prepared_work_item_ids: prepared.map(({ node }) => node.id),
    planning_prepared_work_item_ids: planningPrepared.map(({ node }) => node.id),
    blocked_work_item_ids: blocked.map(({ node }) => node.id),
    blocking_scope: blockingScope,
    actionable_blocker_ids: [
      ...(rootHold === "blocked" ? [root.id] : []),
      ...blocked.filter(({ hold, node }) => hold === "blocked" &&
        (workTypes.has(node.type) || node.type === "Feature" || node.blocker)).map(({ node }) => node.id),
    ],
    held_work_item_ids: current.filter(({ inherited }) => inherited).map(({ node }) => node.id),
    deferred_work_item_ids: deferred,
    // A package can have actionable work in more than one surface.
    refinement_work_item_ids: refinementOpen ? current.filter(({ node }) => needsRefinement(node)).map(({ node }) => node.id) : [],
    ...(refinementOpen && hasMissingRefinementFields(root, "initiative") ? { refinement_governance_pending: true } : {}),
    eligibility: "check-selected-work-item",
  };
}
