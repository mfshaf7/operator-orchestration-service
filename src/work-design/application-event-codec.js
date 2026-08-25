import { canonicalStringify } from "../delivery-art/canonical-json.js";

const EVENT_PREFIX = "OOS_WORK_DESIGN_APPLICATION_EVENT_V1 ";

export function isWorkDesignApplicationEventComment(rawComment) {
  return typeof rawComment === "string" && rawComment.startsWith(EVENT_PREFIX);
}

export function encodeWorkDesignApplicationEvent(event) {
  return `${EVENT_PREFIX}${canonicalStringify(event)}`;
}

export function decodeWorkDesignApplicationEvent(rawComment) {
  if (!isWorkDesignApplicationEventComment(rawComment)) {
    return null;
  }
  try {
    return JSON.parse(rawComment.slice(EVENT_PREFIX.length));
  } catch {
    return null;
  }
}
