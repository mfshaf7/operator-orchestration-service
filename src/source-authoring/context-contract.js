import { createHash } from "node:crypto";
import { canonicalStringify } from "../delivery-art/canonical-json.js";
import { HttpError } from "../errors.js";
const SHA256 = /^sha256:[0-9a-f]{64}$/;
const STABLE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const PACKET_REF = /^\/v1\/context\/packets\/[A-Za-z0-9._:-]+$/;
const REDACTION_RECEIPT_REF = /^\/v1\/context\/receipts\/[A-Za-z0-9._:-]+$/;
const PROJECTION_RECEIPT_REF = /^\/v1\/context\/lifecycle\/projections\/[A-Za-z0-9._:-]+$/;

export function sourceSummary(sources) {
  const available = sources.filter((source) => source.availability === "available").length;
  return {
    total: sources.length,
    available,
    unavailable: sources.length - available,
    classes: [...new Set(sources.map((source) => source.source_class))].sort(),
  };
}

export function textDigest(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

// CGG lifecycle wire envelopes use Python json.dumps(ensure_ascii=True),
// independently of ART/internal UTF-8 custody. Source text itself is unchanged.
export function lifecycleContextDigest(value) {
  const wire = canonicalStringify(value).replace(/[\u007f-\uffff]/g,
    character => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`);
  return textDigest(wire);
}

function safeSourceBindings(sources) {
  return sources.map(({ content: _content, ...source }) => source);
}

function expectedCggBinding(request, callerId) {
  return {
    request_id: request.request_id,
    correlation_id: request.correlation_id,
    idempotency_key: request.idempotency_key,
    workflow_session_id: request.workflow_session_id,
    execution_id: request.execution_id,
    ...(request.subject?.kind === "prototype" ? { subject: request.subject } : {
      delivery_id: request.delivery_id, work_item_ref: request.work_item_ref,
    }),
    landing_unit_id: request.landing_unit_id,
    caller_id: callerId,
    operator_id: request.operator.id,
    lifecycle: request.lifecycle,
    requested_at: request.requested_at,
    sources_digest: request.sources_digest,
    budget_tokens: request.budget_tokens,
  };
}

export function assertLifecycleContextResult(result, request, callerId, failure = message => new HttpError(502, "lifecycle_context_response_invalid", message)) {
  const expectedBinding = expectedCggBinding(request, callerId);
  const expectedSources = safeSourceBindings(request.sources);
  const expectedSummary = sourceSummary(request.sources);
  const deniedAuthority = result?.authority?.may_select_or_invoke_model === false &&
    result?.authority?.may_approve_suggestion === false &&
    result?.authority?.may_mutate_delivery === false &&
    result?.lifecycle_authority?.may_choose_action === false &&
    result?.lifecycle_authority?.may_mutate_art === false &&
    result?.lifecycle_authority?.may_mutate_source === false &&
    result?.lifecycle_authority?.may_invoke_model === false &&
    result?.lifecycle_authority?.may_choose_raw_fallback === false;
  const binding = result?.binding;
  if (
    result?.schema_version !== 1 ||
    result?.status !== "ready" ||
    result?.request_id !== request.request_id ||
    result?.correlation_id !== request.correlation_id ||
    result?.idempotency_key !== request.idempotency_key ||
    result?.request_digest !== lifecycleContextDigest({
      binding: expectedBinding,
      lifecycle_sources: request.sources,
    }) ||
    !STABLE_ID.test(result?.artifact_id ?? "") ||
    !SHA256.test(result?.artifact_digest ?? "") ||
    !PACKET_REF.test(result?.packet_ref ?? "") ||
    !REDACTION_RECEIPT_REF.test(result?.redaction_receipt_ref ?? "") ||
    !PROJECTION_RECEIPT_REF.test(result?.projection_receipt_ref ?? "") ||
    typeof result?.content !== "string" || !result.content ||
    result?.admission_decision?.profile !== "developer" ||
    !["not_requested", "denied"].includes(result?.admission_decision?.raw_projection) ||
    result?.admission_decision?.redaction_safe !== true ||
    result?.timeline?.requested_at !== request.requested_at ||
    Number.isNaN(Date.parse(result?.timeline?.projected_at ?? "")) ||
    result?.projection_safety?.raw_context_exposed !== false ||
    typeof result?.projection_safety?.redaction_applied !== "boolean" ||
    result?.projection_safety?.custody_bound !== true ||
    !deniedAuthority ||
    canonicalStringify(binding) !== canonicalStringify(expectedBinding) ||
    canonicalStringify(result.lifecycle_context) !== canonicalStringify(request.lifecycle) ||
    canonicalStringify(result.source_bindings) !== canonicalStringify(expectedSources) ||
    canonicalStringify(result.source_summary) !== canonicalStringify(expectedSummary) ||
    result?.classification?.context_type !== "lifecycle" ||
    canonicalStringify(result?.classification?.source_classes) !==
      canonicalStringify(expectedSummary.classes) ||
    !Array.isArray(result?.classification?.signal_ids) ||
    result.classification.signal_ids.some((value) => typeof value !== "string") ||
    result?.budget?.requested_tokens !== request.budget_tokens ||
    !Number.isInteger(result?.budget?.estimated_tokens) ||
    result.budget.estimated_tokens < 0 ||
    typeof result?.budget?.truncated !== "boolean"
  ) {
    throw failure("CGG lifecycle projection did not preserve the OOS session, source, safety, and authority bindings.");
  }
  return result;
}
