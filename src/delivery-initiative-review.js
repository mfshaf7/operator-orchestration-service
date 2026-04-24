import { readFileSync } from "node:fs";

export const DELIVERY_INITIATIVE_REVIEW_WORKFLOW = JSON.parse(
  readFileSync(
    new URL("./delivery-initiative-review-workflow.json", import.meta.url),
    "utf8",
  ),
);

export const DELIVERY_PM2_PHASES = DELIVERY_INITIATIVE_REVIEW_WORKFLOW.pm2_phases;

export const DELIVERY_PM2_CLOSING_PHASE =
  DELIVERY_INITIATIVE_REVIEW_WORKFLOW.closing_transition.to_phase;

export const DELIVERY_RETIRED_STATUS =
  DELIVERY_INITIATIVE_REVIEW_WORKFLOW.retirement_transition.to_status;

export const DELIVERY_INITIATIVE_REVIEW_REASON_DETAILS = {
  blocked_items_present: {
    gateId: "initiative-closing-requires-clean-execution-state",
    message: "Initiative still has blocked descendant work.",
  },
  completed_items_missing_ownership: {
    gateId: "initiative-closing-requires-clean-execution-state",
    message:
      "Done descendants are still missing Owner Repo, Assignee, or Responsible.",
  },
  done_narrative_weak: {
    gateId: "initiative-closing-requires-clean-execution-state",
    message: "Done descendants still have weak done-state narrative evidence.",
  },
  completion_evidence_missing: {
    gateId: "initiative-closing-requires-clean-execution-state",
    message: "Done descendants are still missing completion evidence.",
  },
  completion_evidence_weak: {
    gateId: "initiative-closing-requires-clean-execution-state",
    message: "Done descendants still have weak completion evidence.",
  },
  inspect_and_adapt_missing: {
    gateId: "initiative-done-requires-inspect-and-adapt",
    message:
      "Inspect & Adapt Actions must be recorded before initiative closeout.",
  },
  open_descendants_present: {
    gateId: "initiative-closing-requires-clean-execution-state",
    message: "Initiative still has descendants outside done or retired.",
  },
  pm2_phase_not_closing: {
    gateId: "initiative-done-requires-closing-phase",
    message: "Done initiative must remain in PM² Closing.",
  },
  pm2_phase_not_cleared_for_retired: {
    gateId: "initiative-retired-clears-pm2-phase",
    message: "Retired initiative must not retain a PM² Phase value.",
  },
  system_demo_missing: {
    gateId: "initiative-closing-requires-system-demo",
    message: "System Demo Evidence must be recorded on the initiative Epic.",
  },
  unresolved_dependencies_present: {
    gateId: "initiative-closing-requires-clean-execution-state",
    message: "Initiative still has unresolved dependency relations.",
  },
};

function addReason(reasons, reasonId) {
  if (!reasons.includes(reasonId)) {
    reasons.push(reasonId);
  }
}

export function describeDeliveryInitiativeReviewReasons(reasonIds) {
  return reasonIds.map((reasonId) => {
    const detail = DELIVERY_INITIATIVE_REVIEW_REASON_DETAILS[reasonId];
    return detail?.message ?? reasonId;
  });
}

export function evaluateDeliveryInitiativeReviewState({ epic, summary }) {
  const closingTransitionReasons = [];
  if (!epic?.system_demo_evidence_present) {
    addReason(closingTransitionReasons, "system_demo_missing");
  }
  if ((summary?.open_descendant_count ?? 0) > 0) {
    addReason(closingTransitionReasons, "open_descendants_present");
  }
  if ((summary?.blocked_count ?? 0) > 0) {
    addReason(closingTransitionReasons, "blocked_items_present");
  }
  if ((summary?.completed_without_evidence_count ?? 0) > 0) {
    addReason(closingTransitionReasons, "completion_evidence_missing");
  }
  if ((summary?.completed_with_weak_evidence_count ?? 0) > 0) {
    addReason(closingTransitionReasons, "completion_evidence_weak");
  }
  if ((summary?.completed_with_weak_done_narrative_count ?? 0) > 0) {
    addReason(closingTransitionReasons, "done_narrative_weak");
  }
  if ((summary?.completed_without_owner_count ?? 0) > 0) {
    addReason(closingTransitionReasons, "completed_items_missing_ownership");
  }
  if ((summary?.unresolved_dependency_count ?? 0) > 0) {
    addReason(closingTransitionReasons, "unresolved_dependencies_present");
  }

  const completionTransitionReasons = [...closingTransitionReasons];
  if ((epic?.pm2_phase ?? null) !== DELIVERY_PM2_CLOSING_PHASE) {
    addReason(completionTransitionReasons, "pm2_phase_not_closing");
  }
  if (!epic?.inspect_and_adapt_actions_present) {
    addReason(completionTransitionReasons, "inspect_and_adapt_missing");
  }

  const retirementTransitionReasons = [];
  if ((summary?.open_descendant_count ?? 0) > 0) {
    addReason(retirementTransitionReasons, "open_descendants_present");
  }
  if ((epic?.status ?? null) === DELIVERY_RETIRED_STATUS && (epic?.pm2_phase ?? null)) {
    addReason(retirementTransitionReasons, "pm2_phase_not_cleared_for_retired");
  }

  return {
    closing_transition_ready: closingTransitionReasons.length === 0,
    closing_transition_reasons: closingTransitionReasons,
    completion_transition_ready: completionTransitionReasons.length === 0,
    completion_transition_reasons: completionTransitionReasons,
    retirement_transition_ready: retirementTransitionReasons.length === 0,
    retirement_transition_reasons: retirementTransitionReasons,
  };
}
