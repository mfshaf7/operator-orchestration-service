import { canonicalDigest } from "../delivery-art/canonical-json.js";
import {
  assertRefinementApplyReceipt,
  assertRefinementRunProjection,
} from "./contracts.js";
export * from "./runtime-constants.js";

function digestId(prefix, value) {
  return `${prefix}:${canonicalDigest(value).slice("sha256:".length, 40)}`;
}

export function refinementRunId(request) {
  return digestId("refinement-run", {
    accepted_draft_digest: request.accepted_draft.draft_digest,
    idempotency_key: request.idempotency_key,
  });
}

export function refinementRequestDigest(request) {
  return canonicalDigest(request);
}

export function refinementAcceptedDraftDigest(acceptedDraft) {
  const { draft_digest: _digest, ...content } = acceptedDraft;
  return canonicalDigest(content);
}

export function refinementRunBinding(request) {
  return {
    package_ref: request.package_ref,
    request_digest: refinementRequestDigest(request),
    request_id: request.request_id,
  };
}

export function assertRefinementRunBinding(binding, request) {
  const expected = refinementRunBinding(request);
  if (
    binding?.package_ref !== expected.package_ref ||
    binding?.request_digest !== expected.request_digest ||
    binding?.request_id !== expected.request_id
  ) {
    throw new Error("Refinement run identity is already bound to another request.");
  }
  return binding;
}

export function refinementEvent({
  eventType,
  message,
  recordedAt,
  runId,
  sequence,
  status,
}) {
  return {
    event_id: digestId("refinement-event", { event_type: eventType, run_id: runId, sequence }),
    sequence,
    event_type: eventType,
    recorded_at: recordedAt,
    message,
    status,
  };
}

export function refinementPollRef(packageRef, runId) {
  return `/v1/delivery-refinement/${encodeURIComponent(packageRef)}/runs/${encodeURIComponent(runId)}`;
}

export function buildRefinementRunProjection({
  events,
  failure = null,
  receipt = null,
  replayed = false,
  request,
  runId = refinementRunId(request),
  state,
  submittedAt,
  updatedAt,
}) {
  return assertRefinementRunProjection({
    schema_version: 1,
    request_id: request.request_id,
    correlation_id: request.correlation_id,
    run_id: runId,
    state,
    replayed,
    submitted_at: submittedAt,
    updated_at: updatedAt,
    poll_ref: refinementPollRef(request.package_ref, runId),
    events,
    receipt,
    failure,
  });
}

export function buildRefinementReceipt({
  appliedAt,
  readback,
  receiptRef,
  request,
  runId = refinementRunId(request),
}) {
  const core = {
    receipt_id: digestId("refinement-receipt", { request, run_id: runId }),
    run_id: runId,
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
  const receiptDigest = canonicalDigest(core);
  return assertRefinementApplyReceipt({
    ...core,
    receipt_ref: receiptRef,
    receipt_digest: receiptDigest,
  });
}
