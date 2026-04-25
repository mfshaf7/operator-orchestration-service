import { readFileSync } from "node:fs";

export const DELIVERY_BLOCKER_WORKFLOW = JSON.parse(
  readFileSync(new URL("./delivery-blocker-workflow.json", import.meta.url), "utf8"),
);

export const DELIVERY_BLOCKED_STATUS = DELIVERY_BLOCKER_WORKFLOW.blocked_status;

export const DELIVERY_BLOCKER_RESUME_ALLOWED_STATUSES = new Set(
  DELIVERY_BLOCKER_WORKFLOW.resume_allowed_statuses,
);
