const EVENT_PREFIX = "OOS_PROPOSAL_EVENT_V1 ";

export function encodeProposalEvent(event) {
  return `${EVENT_PREFIX}${JSON.stringify(event)}`;
}

export function decodeProposalEvent(rawComment) {
  if (typeof rawComment !== "string" || !rawComment.startsWith(EVENT_PREFIX)) {
    return null;
  }
  try {
    return JSON.parse(rawComment.slice(EVENT_PREFIX.length));
  } catch {
    return null;
  }
}
