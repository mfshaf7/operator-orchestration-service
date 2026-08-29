const EVENT_PREFIX = "OOS_DELIVERY_CLOSEOUT_EVENT_V1 ";

export function encodeDeliveryCloseoutEvent(event) {
  return `${EVENT_PREFIX}${JSON.stringify(event)}`;
}

export function decodeDeliveryCloseoutEvent(rawComment) {
  if (typeof rawComment !== "string" || !rawComment.startsWith(EVENT_PREFIX)) {
    return null;
  }
  try {
    return JSON.parse(rawComment.slice(EVENT_PREFIX.length));
  } catch {
    return null;
  }
}
