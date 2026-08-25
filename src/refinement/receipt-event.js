import { canonicalDigest, canonicalStringify } from "../delivery-art/canonical-json.js";

const EVENT_PREFIX = "OOS_REFINEMENT_RECEIPT_EVENT_V1 ";

export function encodeRefinementReceiptEvent(event) {
  return `${EVENT_PREFIX}${canonicalStringify(event)}`;
}

export function isRefinementReceiptEventComment(value) {
  return typeof value === "string" && value.startsWith(EVENT_PREFIX);
}

export function decodeRefinementReceiptEvent(value) {
  if (!isRefinementReceiptEventComment(value)) return null;
  try {
    return JSON.parse(value.slice(EVENT_PREFIX.length));
  } catch {
    return null;
  }
}

export function buildRefinementReceiptEvent({
  appliedAt,
  readback,
  request,
  runId,
}) {
  const core = {
    schema_version: 1,
    event_type: "apply-receipt",
    run_id: runId,
    request_digest: canonicalDigest(request),
    applied_at: appliedAt,
    applied_by: request.operator.id,
    accepted_draft_digest: request.accepted_draft.draft_digest,
    source_work_design_receipt_id:
      request.accepted_draft.source_work_design_receipt_id,
    target: {
      delivery_ref: readback.delivery_ref,
      created_refs: [...readback.created_refs],
      updated_refs: [...readback.updated_refs],
      reused_refs: [...readback.reused_refs],
      readback_complete: true,
      source_revision: readback.source_revision,
    },
  };
  return { ...core, content_digest: canonicalDigest(core) };
}

export function assertRefinementReceiptEvent(event) {
  if (
    !event ||
    event.schema_version !== 1 ||
    event.event_type !== "apply-receipt" ||
    typeof event.run_id !== "string" ||
    typeof event.request_digest !== "string" ||
    typeof event.content_digest !== "string"
  ) {
    throw new Error("Refinement receipt event is malformed.");
  }
  const { content_digest: digest, ...core } = event;
  if (digest !== canonicalDigest(core)) {
    throw new Error("Refinement receipt event digest does not match its content.");
  }
  return event;
}
