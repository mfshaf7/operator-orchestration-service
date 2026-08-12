import { readFileSync } from "node:fs";

export const DELIVERY_BLOCKER_WORKFLOW = JSON.parse(
  readFileSync(new URL("./delivery-blocker-workflow.json", import.meta.url), "utf8"),
);

export const DELIVERY_BLOCKED_STATUS = DELIVERY_BLOCKER_WORKFLOW.blocked_status;

export const DELIVERY_BLOCKER_ALLOWED_ACTIONS = new Set(
  DELIVERY_BLOCKER_WORKFLOW.allowed_actions,
);

export const DELIVERY_BLOCKER_DEFAULT_ACTION = DELIVERY_BLOCKER_WORKFLOW.default_action;

export const DELIVERY_BLOCKER_RECOMMENDATION_ACTION_ALIASES = new Map(
  Object.entries(DELIVERY_BLOCKER_WORKFLOW.recommendation_action_aliases),
);

export const DELIVERY_BLOCKER_RESUME_ALLOWED_STATUSES = new Set(
  DELIVERY_BLOCKER_WORKFLOW.resume_allowed_statuses,
);

export function normalizeDeliveryBlockerAction(
  value,
  { allowRecommendationAliases = false } = {},
) {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }

  const action = value.trim().toLowerCase();
  if (!allowRecommendationAliases) {
    return action;
  }
  return DELIVERY_BLOCKER_RECOMMENDATION_ACTION_ALIASES.get(action) ?? action;
}
