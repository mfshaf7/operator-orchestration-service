import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

import { canonicalDigest, canonicalStringify } from "./canonical-json.js";
import { assertLifecycleContextResult, lifecycleContextDigest, sourceSummary, textDigest } from "../source-authoring/context-contract.js";
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

export function buildDeliveryArtLifecycleSources(
  projection,
  capturedAt,
  { sourceRealization = null } = {},
) {
  const sessionRef = `oos://delivery-art/work-sessions/${encodeURIComponent(projection.session_id)}`;
  const revision = projection.session_revision;
  const art = availableSource({
    capturedAt,
    contentValue: {
      delivery_id: projection.delivery_id,
      facts: projection.facts ?? {},
      next_action: safeNextAction(projection.next_action),
      projection: projection.projection ?? null,
      ...(sourceRealization
        ? {
            source_realization: {
              objective: sourceRealization.objective,
              objective_digest: sourceRealization.objective_digest,
            },
          }
        : {}),
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
          ...(sourceRealization
            ? { source_realization_context: sourceRealization.repository_context }
            : {}),
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

function assertCggResult(result, request, callerId) {
  return assertLifecycleContextResult(result, request, callerId, message =>
    new DeliveryArtLifecycleContextError("delivery_art_lifecycle_context_response_invalid", message, { statusCode: 502 }));
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

  async function project({
    callerId,
    operatorId,
    request: input,
    sourceRealization = null,
    workItemId,
  }) {
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
      if (
        sourceRealization !== null &&
        (
          typeof sourceRealization?.objective !== "string" ||
          !sourceRealization.objective.trim() ||
          !SHA256.test(sourceRealization?.objective_digest ?? "") ||
          !sourceRealization?.repository_context ||
          typeof sourceRealization.repository_context !== "object"
        )
      ) {
        throw new DeliveryArtLifecycleContextError(
          "delivery_art_lifecycle_context_source_realization_invalid",
          "Internal source-realization context is incomplete or invalid.",
        );
      }
      const sources = buildDeliveryArtLifecycleSources(rawProjection, capturedAt, {
        sourceRealization,
      });
      const sourcesDigest = lifecycleContextDigest(sources);
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
