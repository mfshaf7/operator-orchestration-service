import { canonicalStringify } from "../delivery-art/canonical-json.js";

const EVENT_PREFIX = "OOS_PROTOTYPE_DELIVERY_APPLICATION_EVENT_V1 ";

export function isPrototypeDeliveryApplicationEventComment(rawComment) {
  return typeof rawComment === "string" && rawComment.startsWith(EVENT_PREFIX);
}

export function encodePrototypeDeliveryApplicationEvent(event) {
  return `${EVENT_PREFIX}${canonicalStringify(event)}`;
}

export function decodePrototypeDeliveryApplicationEvent(rawComment) {
  if (!isPrototypeDeliveryApplicationEventComment(rawComment)) {
    return null;
  }
  try {
    return JSON.parse(rawComment.slice(EVENT_PREFIX.length));
  } catch {
    return null;
  }
}
