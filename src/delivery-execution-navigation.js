// Read-only navigation from current ART facts, never work-start eligibility.
// Whole-package navigation must survive partial scopes and the final child close.
export function preparedForPIPlanning(node) {
  return ["new", "ready"].includes(node.status) && (
    node.ready_contract_satisfied === true ||
    node.ready_contract_applicable === true &&
      Array.isArray(node.ready_contract_missing_fields) &&
      node.ready_contract_missing_fields.every(field => field === "Iteration")
  );
}

export function deliveryExecutionNavigation(root) {
  const nodes = (root.children ?? []).flatMap(function walk(node) {
    return [node, ...(node.children ?? []).flatMap(walk)];
  });
  const terminal = node => ["done", "retired"].includes(node.status);
  const leaves = nodes.filter(node => ["User story", "Defect", "Task"].includes(node.type));
  const open = leaves.filter(node => !terminal(node));
  const active = nodes.filter(node => node.status === "in-progress");
  const prepared = open.filter(node => ["new", "ready"].includes(node.status) && node.ready_contract_satisfied === true);
  const planningPrepared = nodes.filter(node =>
    ["Feature", "User story", "Defect", "Task"].includes(node.type) && preparedForPIPlanning(node));
  const blocked = nodes.filter(node => !terminal(node) && (node.blocked || node.dependency_blocked || node.status === "blocked"));
  const finishedScope = leaves.length > 0 && leaves.every(terminal);
  const executionSeen = leaves.length > 0 && ["in-progress", "blocked", "parked"].includes(root.status) ||
    active.length > 0 || blocked.length > 0 || leaves.some(terminal) || prepared.length > 0;
  const phase = terminal(root) ? "audit_only" : executionSeen ? "execution" : leaves.length ? "refinement" : "work_design";
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
    // Includes remaining backlog: it can be refined without resetting work
    // already underway. No receipt or admission is fabricated for older work.
    refinement_work_item_ids: open.filter(node => node.ready_contract_satisfied !== true && node.status !== "in-progress").map(node => node.id),
    eligibility: "check-selected-work-item",
  };
}
