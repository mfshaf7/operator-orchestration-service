import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

import { canonicalDigest, canonicalStringify } from "./canonical-json.js";
import { normalizeWorkItemId } from "./work-session.js";

const CONTRACT_ROOT = fileURLToPath(
  new URL("../../contracts/delivery-art-work-session/", import.meta.url),
);
const requestSchema = JSON.parse(
  readFileSync(path.join(CONTRACT_ROOT, "lifecycle-context-request.schema.json"), "utf8"),
);
const ledgerSchema = JSON.parse(
  readFileSync(path.join(CONTRACT_ROOT, "lifecycle-context-ledger.schema.json"), "utf8"),
);
const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validateRequestSchema = ajv.compile(requestSchema);
const validateLedgerSchema = ajv.compile(ledgerSchema);
const SHA256 = /^sha256:[0-9a-f]{64}$/;
const STABLE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const PACKET_REF = /^\/v1\/context\/packets\/[A-Za-z0-9._:-]+$/;
const REDACTION_RECEIPT_REF = /^\/v1\/context\/receipts\/[A-Za-z0-9._:-]+$/;
const PROJECTION_RECEIPT_REF = /^\/v1\/context\/lifecycle\/projections\/[A-Za-z0-9._:-]+$/;

export class DeliveryArtLifecycleContextError extends Error {
  constructor(code, message, { details = null, statusCode = 400 } = {}) {
    super(message);
    this.name = "DeliveryArtLifecycleContextError";
    this.code = code;
    this.details = details;
    this.statusCode = statusCode;
  }

  toResponse() {
    return { error: this.code, message: this.message, details: this.details };
  }
}

function validationErrors(validator) {
  return (validator.errors ?? []).map((error) =>
    `${error.instancePath || "/"} ${error.message}`);
}

export function validateDeliveryArtLifecycleContextRequest(value) {
  const valid = validateRequestSchema(value);
  return { valid: Boolean(valid), errors: valid ? [] : validationErrors(validateRequestSchema) };
}

export function validateDeliveryArtLifecycleContextLedger(value) {
  const valid = validateLedgerSchema(value);
  return { valid: Boolean(valid), errors: valid ? [] : validationErrors(validateLedgerSchema) };
}

function assertRequest(value) {
  const validation = validateDeliveryArtLifecycleContextRequest(value);
  if (!validation.valid) {
    throw new DeliveryArtLifecycleContextError(
      "delivery_art_lifecycle_context_request_invalid",
      `Lifecycle context request is invalid: ${validation.errors.join("; ")}`,
    );
  }
  return structuredClone(value);
}

function availableSource({ capturedAt, contentValue, revision, sourceClass, sourceRef }) {
  const content = canonicalStringify(contentValue);
  return {
    source_id: sourceClass,
    source_class: sourceClass,
    source_ref: sourceRef,
    source_revision: revision,
    captured_at: capturedAt,
    availability: "available",
    content,
    content_digest: canonicalDigest(contentValue),
    unavailable_reason: null,
  };
}

function unavailableSource({ capturedAt, reason = "not_found", sourceClass, sourceRef }) {
  return {
    source_id: sourceClass,
    source_class: sourceClass,
    source_ref: sourceRef,
    source_revision: null,
    captured_at: capturedAt,
    availability: "unavailable",
    content: null,
    content_digest: null,
    unavailable_reason: reason,
  };
}

function safeNextAction(nextAction) {
  if (!nextAction) return null;
  return {
    authority: nextAction.authority ?? null,
    code: nextAction.code ?? null,
    reason: nextAction.reason ?? null,
  };
}

export function buildDeliveryArtLifecycleSources(projection, capturedAt) {
  const sessionRef = `oos://delivery-art/work-sessions/${encodeURIComponent(projection.session_id)}`;
  const revision = projection.session_revision;
  const art = availableSource({
    capturedAt,
    contentValue: {
      delivery_id: projection.delivery_id,
      facts: projection.facts ?? {},
      next_action: safeNextAction(projection.next_action),
      projection: projection.projection ?? null,
      state: projection.state,
      work_item_id: projection.work_item_id,
    },
    revision,
    sourceClass: "art",
    sourceRef: `openproject://work_packages/${projection.work_item_id.replace("work-item-", "")}`,
  });
  const repository = projection.source
    ? availableSource({
        capturedAt,
        contentValue: {
          pull_request: projection.pull_request ?? null,
          repository: projection.agent_source?.repository ?? null,
          source: projection.source,
        },
        revision: projection.source.head_commit ?? revision,
        sourceClass: "repository",
        sourceRef: projection.agent_source?.repository
          ? `github://${projection.agent_source.repository}`
          : `${sessionRef}/repository`,
      })
    : unavailableSource({ capturedAt, sourceClass: "repository", sourceRef: `${sessionRef}/repository` });
  const validation = projection.facts
    ? availableSource({
        capturedAt,
        contentValue: {
          architecture: projection.facts.architecture ?? null,
          evidence: projection.facts.evidence ?? null,
          evidence_projection: projection.facts.evidence_projection ?? null,
          readiness_receipt: projection.facts.readiness_receipt ?? null,
          review_packet: projection.facts.review_packet ?? null,
          review_packet_evidence: projection.facts.review_packet_evidence ?? null,
          work_start: projection.facts.work_start ?? null,
        },
        revision,
        sourceClass: "validation",
        sourceRef: `${sessionRef}/validation`,
      })
    : unavailableSource({ capturedAt, sourceClass: "validation", sourceRef: `${sessionRef}/validation` });
  const runtime = projection.agent_source
    ? availableSource({
        capturedAt,
        contentValue: {
          definition_digest: projection.agent_source.definition_digest ?? null,
          identity_id: projection.agent_source.identity_id ?? null,
          logical_agent_id: projection.agent_source.logical_agent_id ?? null,
          provider_principal: projection.agent_source.provider_principal ?? null,
          state: projection.agent_source.state ?? null,
        },
        revision: projection.agent_source.definition_digest ?? revision,
        sourceClass: "runtime",
        sourceRef: `${sessionRef}/runtime`,
      })
    : unavailableSource({
        capturedAt,
        reason: "not_configured",
        sourceClass: "runtime",
        sourceRef: `${sessionRef}/runtime`,
      });
  return [art, repository, validation, runtime];
}

function sourceSummary(sources) {
  const available = sources.filter((source) => source.availability === "available").length;
  return {
    total: sources.length,
    available,
    unavailable: sources.length - available,
    classes: sources.map((source) => source.source_class).sort(),
  };
}

function textDigest(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
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
    delivery_id: request.delivery_id,
    work_item_ref: request.work_item_ref,
    landing_unit_id: request.landing_unit_id,
    caller_id: callerId,
    operator_id: request.operator.id,
    lifecycle: request.lifecycle,
    requested_at: request.requested_at,
    sources_digest: request.sources_digest,
    budget_tokens: request.budget_tokens,
  };
}

function assertCggResult(result, request, callerId) {
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
    result?.request_digest !== canonicalDigest({
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
    throw new DeliveryArtLifecycleContextError(
      "delivery_art_lifecycle_context_response_invalid",
      "CGG lifecycle projection did not preserve the OOS session, source, safety, and authority bindings.",
      { statusCode: 502 },
    );
  }
  return result;
}

function emptyLedger(session, now) {
  return {
    schema_version: 1,
    artifact_type: "delivery_art_lifecycle_context_ledger",
    session_id: session.session_id,
    bindings: [],
    measurements: { packet_count: 0, raw_fallback_count: 0, denied_count: 0 },
    updated_at: now,
  };
}

function assertLedger(ledger, sessionId) {
  const validation = validateDeliveryArtLifecycleContextLedger(ledger);
  if (!validation.valid || ledger.session_id !== sessionId) {
    throw new DeliveryArtLifecycleContextError(
      "delivery_art_lifecycle_context_ledger_invalid",
      "Lifecycle context ledger failed its session binding contract.",
      { details: validation, statusCode: 500 },
    );
  }
  return ledger;
}

function bindingProjection(binding) {
  return binding ? structuredClone(binding) : null;
}

export function createDeliveryArtLifecycleContextService({
  clock = () => new Date(),
  contextClient,
  defaultBudgetTokens = 3000,
  store,
  workSessionController,
} = {}) {
  if (typeof contextClient?.project !== "function") throw new Error("contextClient.project is required");
  if (typeof contextClient?.callerId !== "string" || !contextClient.callerId.trim()) {
    throw new Error("contextClient.callerId is required");
  }
  if (typeof workSessionController?.status !== "function") throw new Error("workSessionController.status is required");
  for (const method of [
    "readByAlias",
    "readLifecycleContextLedger",
    "withLock",
    "writeLifecycleContextLedger",
  ]) {
    if (typeof store?.[method] !== "function") throw new Error(`store.${method} is required`);
  }

  function readLedger(session) {
    const ledger = store.readLifecycleContextLedger(session.session_id);
    return ledger ? assertLedger(ledger, session.session_id) : null;
  }

  function status(session) {
    const ledger = readLedger(session);
    return {
      commissioned: contextClient.configured === true,
      default_mode: "packet",
      latest_binding: bindingProjection(ledger?.bindings.at(-1) ?? null),
      measurements: structuredClone(
        ledger?.measurements ?? { packet_count: 0, raw_fallback_count: 0, denied_count: 0 },
      ),
    };
  }

  function appendBinding(session, binding) {
    const now = clock().toISOString();
    const ledger = readLedger(session) ?? emptyLedger(session, now);
    const existing = ledger.bindings.find((entry) => entry.request_id === binding.request_id);
    if (existing) {
      if (canonicalDigest(existing) !== canonicalDigest(binding)) {
        throw new DeliveryArtLifecycleContextError(
          "delivery_art_lifecycle_context_replay_conflict",
          "Lifecycle context request_id is already bound to different context.",
          { statusCode: 409 },
        );
      }
      return { binding: existing, ledger, replayed: true };
    }
    ledger.bindings.push(binding);
    if (binding.mode === "packet") ledger.measurements.packet_count += 1;
    if (binding.mode === "raw-fallback") ledger.measurements.raw_fallback_count += 1;
    if (binding.mode === "denied") ledger.measurements.denied_count += 1;
    ledger.updated_at = now;
    assertLedger(ledger, session.session_id);
    store.writeLifecycleContextLedger(session.session_id, ledger);
    return { binding, ledger, replayed: false };
  }

  async function project({ callerId, operatorId, request: input, workItemId }) {
    const contextRequest = assertRequest(input);
    workItemId = normalizeWorkItemId(workItemId);
    const session = store.readByAlias(workItemId);
    if (!session) {
      throw new DeliveryArtLifecycleContextError(
        "delivery_art_lifecycle_context_session_missing",
        "Start the work session before requesting lifecycle context.",
        { statusCode: 409 },
      );
    }
    if (session.caller_id !== callerId || session.operator.id !== operatorId) {
      throw new DeliveryArtLifecycleContextError(
        "delivery_art_lifecycle_context_identity_mismatch",
        "Lifecycle context caller and operator must match the work session.",
        { statusCode: 403 },
      );
    }

    return store.withLock(`lifecycle-context:${session.session_id}`, async () => {
      const prior = readLedger(session)?.bindings.find(
        (entry) => entry.request_id === contextRequest.request_id,
      );
      const capturedAt = prior?.captured_at ?? clock().toISOString();
      const rawProjection = await workSessionController.status(workItemId);
      const sources = buildDeliveryArtLifecycleSources(rawProjection, capturedAt);
      const sourcesDigest = canonicalDigest(sources);
      const lifecycle = {
        operation: contextRequest.operation,
        state: rawProjection.state,
        next_action: rawProjection.next_action?.code ?? null,
      };
      const content = canonicalStringify(rawProjection);
      const contentDigest = canonicalDigest(rawProjection);
      const summary = sourceSummary(sources);
      const baseBinding = {
        request_id: contextRequest.request_id,
        execution_id: contextRequest.execution_id,
        operation: contextRequest.operation,
        lifecycle_state: rawProjection.state,
        captured_at: capturedAt,
        sources_digest: sourcesDigest,
        source_summary: summary,
        content_digest: contentDigest,
      };

      if (contextRequest.mode === "raw-fallback") {
        const binding = {
          ...baseBinding,
          mode: "raw-fallback",
          packet_ref: null,
          redaction_receipt_ref: null,
          projection_receipt_ref: null,
          request_digest: canonicalDigest({
            caller_id: callerId,
            fallback_reason: contextRequest.fallback_reason,
            lifecycle,
            sources_digest: sourcesDigest,
          }),
          artifact_digest: null,
          fallback_reason: contextRequest.fallback_reason,
        };
        const recorded = appendBinding(session, binding);
        return {
          workflow_id: "delivery-art-lifecycle-context",
          session_id: session.session_id,
          mode: "raw-fallback",
          replayed: recorded.replayed,
          content,
          binding: bindingProjection(recorded.binding),
          measurements: structuredClone(recorded.ledger.measurements),
          authority: {
            legal_next_action: rawProjection.next_action?.code ?? null,
            lifecycle_authority: "operator-orchestration-service",
            raw_fallback_explicit: true,
          },
        };
      }

      const projectionRequest = {
        schema_version: 1,
        request_id: contextRequest.request_id,
        correlation_id: contextRequest.request_id,
        idempotency_key: `lifecycle-context.${canonicalDigest({
          request_id: contextRequest.request_id,
          session_id: session.session_id,
        }).slice("sha256:".length)}`,
        workflow_session_id: session.session_id,
        execution_id: contextRequest.execution_id,
        delivery_id: session.delivery_id,
        work_item_ref: rawProjection.work_item_id,
        landing_unit_id: session.landing_unit_id,
        operator: { id: operatorId },
        lifecycle,
        requested_at: capturedAt,
        sources,
        sources_digest: sourcesDigest,
        budget_tokens: contextRequest.budget_tokens ?? defaultBudgetTokens,
      };

      let result;
      try {
        result = assertCggResult(
          await contextClient.project(projectionRequest),
          projectionRequest,
          contextClient.callerId,
        );
      } catch (error) {
        const denied = {
          ...baseBinding,
          mode: "denied",
          packet_ref: null,
          redaction_receipt_ref: null,
          projection_receipt_ref: null,
          request_digest: canonicalDigest(projectionRequest),
          artifact_digest: null,
          fallback_reason: error?.code ?? "lifecycle_context_projection_failed",
        };
        appendBinding(session, denied);
        throw error;
      }
      const binding = {
        ...baseBinding,
        mode: "packet",
        packet_ref: result.packet_ref,
        redaction_receipt_ref: result.redaction_receipt_ref,
        projection_receipt_ref: result.projection_receipt_ref,
        request_digest: result.request_digest,
        artifact_digest: result.artifact_digest,
        content_digest: textDigest(result.content),
        fallback_reason: null,
      };
      const recorded = appendBinding(session, binding);
      return {
        workflow_id: "delivery-art-lifecycle-context",
        session_id: session.session_id,
        mode: "packet",
        replayed: result.replayed === true || recorded.replayed,
        content: result.content,
        binding: bindingProjection(recorded.binding),
        measurements: structuredClone(recorded.ledger.measurements),
        classification: result.classification,
        budget: result.budget,
        authority: {
          legal_next_action: rawProjection.next_action?.code ?? null,
          lifecycle_authority: "operator-orchestration-service",
          raw_fallback_explicit: false,
        },
      };
    });
  }

  return { project, status };
}
