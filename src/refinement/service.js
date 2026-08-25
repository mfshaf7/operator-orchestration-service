import { canonicalDigest } from "../delivery-art/canonical-json.js";
import { HttpError } from "../errors.js";
import {
  assertRefinementApplyRequest,
  assertRefinementAssistRequest,
  assertRefinementAssistResult,
  assertRefinementError,
  assertRefinementProjectionResult,
} from "./contracts.js";
import { RefinementUpstreamError } from "./http-client.js";
import { refinementAcceptedDraftDigest } from "./run-model.js";
import { RefinementRuntimeError } from "./temporal-adapter.js";

const PROFILE_ID = "delivery-refinement-advisor-v1";
const CONTRACT_REF = "oos.delivery-refinement.v1";
const CONTRACT_VERSION = "1.0";
const OUTPUT_SCHEMA_REF =
  "platform-engineering/security/schemas/delivery-refinement-advice.schema.json";
const GATEWAY_CALLER_ID = "operator-orchestration-service/refinement-assist";

export class RefinementServiceError extends Error {
  constructor(code, message, {
    auditRef = null,
    correlationId = "unknown",
    receiptRef = null,
    retryable = false,
    runRef = null,
    statusCode = 400,
  } = {}) {
    super(message);
    this.name = "RefinementServiceError";
    this.auditRef = auditRef;
    this.code = code;
    this.correlationId = correlationId;
    this.receiptRef = receiptRef;
    this.retryable = retryable;
    this.runRef = runRef;
    this.statusCode = statusCode;
  }

  toResponse() {
    const response = {
      schema_version: 1,
      correlation_id: this.correlationId,
      code: this.code,
      message: this.message,
      retryable: this.retryable,
    };
    if (this.auditRef) response.audit_ref = this.auditRef;
    if (this.receiptRef) response.receipt_ref = this.receiptRef;
    if (this.runRef) response.run_ref = this.runRef;
    return assertRefinementError(response);
  }
}

function requestCorrelation(request) {
  return typeof request?.correlation_id === "string" && request.correlation_id
    ? request.correlation_id
    : "unknown";
}

function validateRequest(assertContract, request) {
  try {
    return assertContract(request);
  } catch (error) {
    if (!(error instanceof HttpError)) throw error;
    const operatorMissing = (error.details ?? []).some((detail) =>
      String(detail.path ?? "").startsWith("/operator"),
    );
    throw new RefinementServiceError(
      operatorMissing ? "operator_identity_required" : "request_invalid",
      error.message,
      { correlationId: requestCorrelation(request) },
    );
  }
}

function stableId(prefix, value) {
  return `${prefix}:${canonicalDigest(value).slice("sha256:".length, 40)}`;
}

function allPacketFields(packet) {
  return packet.draft_groups.flatMap((group) => group.fields);
}

function assertPacketBinding(request, packet) {
  if (
    request.delivery_id !== packet.source.delivery_id ||
    request.package_ref !== packet.source.package_ref ||
    request.source_ref !== packet.source.source_ref ||
    request.source_revision !== packet.source.source_revision ||
    request.packet.packet_id !== packet.packet_id ||
    request.packet.packet_revision !== packet.packet_revision ||
    request.packet.source_work_design_receipt_id !==
      packet.source.source_work_design_receipt_id
  ) {
    throw new RefinementServiceError(
      "packet_stale",
      "The Refinement packet changed after this request was prepared.",
      { correlationId: request.correlation_id, statusCode: 409 },
    );
  }
}

function assertAssistTarget(request, packet) {
  const field = allPacketFields(packet).find(
    (candidate) => candidate.field_key === request.target.field_key,
  );
  const selectedNodeIds = [...request.target.selected_node_ids].sort();
  const targetNodeIds = [...(field?.target_node_ids ?? [])].sort();
  if (
    !field ||
    request.target.field_label !== field.label ||
    request.target.field_kind !== field.field_kind ||
    request.target.required !== field.required ||
    JSON.stringify(selectedNodeIds) !== JSON.stringify(targetNodeIds) ||
    request.target.source_value !== field.value ||
    (
      Array.isArray(field.allowed_values) &&
      JSON.stringify([...request.target.allowed_values].sort()) !==
        JSON.stringify([...field.allowed_values].sort())
    )
  ) {
    throw new RefinementServiceError(
      "packet_stale",
      "The selected Refinement field no longer matches the canonical packet.",
      { correlationId: request.correlation_id, statusCode: 409 },
    );
  }
  return field;
}

function assertProjection(request, projection, projectedRequest, contextCallerId) {
  const binding = projection?.binding;
  if (
    projection?.status !== "ready" ||
    projection?.request_id !== request.request_id ||
    projection?.correlation_id !== request.correlation_id ||
    projection?.idempotency_key !== projectedRequest.idempotency_key ||
    projection?.request_digest !== projectedRequest.assist_request_digest ||
    projection?.admission_decision?.redaction_safe !== true ||
    !["not_requested", "denied"].includes(projection?.admission_decision?.raw_projection) ||
    binding?.request_id !== request.request_id ||
    binding?.correlation_id !== request.correlation_id ||
    binding?.idempotency_key !== projectedRequest.idempotency_key ||
    binding?.workflow_session_id !== projectedRequest.workflow_session_id ||
    binding?.execution_id !== projectedRequest.execution_id ||
    binding?.delivery_id !== request.delivery_id ||
    binding?.package_ref !== request.package_ref ||
    binding?.source_ref !== request.source_ref ||
    binding?.source_revision !== request.source_revision ||
    binding?.caller_id !== contextCallerId ||
    binding?.operator_id !== request.operator.id ||
    binding?.task?.kind !== request.task.kind ||
    binding?.task?.contract_ref !== CONTRACT_REF ||
    binding?.task?.version !== CONTRACT_VERSION ||
    binding?.packet?.packet_id !== request.packet.packet_id ||
    binding?.packet?.packet_revision !== request.packet.packet_revision ||
    binding?.packet?.source_work_design_receipt_id !==
      request.packet.source_work_design_receipt_id ||
    binding?.target?.field_key !== request.target.field_key ||
    binding?.target?.field_kind !== request.target.field_kind ||
    JSON.stringify(binding?.target?.selected_node_ids) !==
      JSON.stringify(request.target.selected_node_ids) ||
    binding?.requested_at !== projectedRequest.requested_at ||
    binding?.context_digest !== projectedRequest.assist_request_digest ||
    binding?.budget_tokens !== projectedRequest.budget_tokens ||
    typeof projection?.packet_ref !== "string" ||
    typeof projection?.redaction_receipt_ref !== "string" ||
    typeof projection?.projection_receipt_ref !== "string" ||
    typeof projection?.content !== "string" ||
    !projection.content ||
    projection?.authority?.may_select_or_invoke_model !== false ||
    projection?.authority?.may_approve_suggestion !== false ||
    projection?.authority?.may_mutate_delivery !== false
  ) {
    throw new RefinementServiceError(
      "context_projection_failed",
      "CGG returned a projection that does not match the Refinement request.",
      { correlationId: request.correlation_id, statusCode: 502 },
    );
  }
  return projection;
}

function gatewayFailure(error, correlationId) {
  const reasons = Array.isArray(error.payload?.reasons) ? error.payload.reasons : [];
  if (
    error.code === "upstream_not_configured" ||
    reasons.some((reason) =>
      String(reason).includes("profile-not-active") ||
      String(reason).includes("activation"),
    )
  ) {
    return new RefinementServiceError(
      "ai_profile_inactive",
      "The governed Refinement profile is not active.",
      { auditRef: error.payload?.audit_ref ?? null, correlationId, statusCode: 503 },
    );
  }
  if (reasons.some((reason) => String(reason).includes("provider")) || error.retryable) {
    return new RefinementServiceError(
      "ai_invocation_denied",
      "The governed Refinement provider is unavailable.",
      {
        auditRef: error.payload?.audit_ref ?? null,
        correlationId,
        retryable: true,
        statusCode: 503,
      },
    );
  }
  return new RefinementServiceError(
    "ai_invocation_denied",
    "The governed AI gateway denied the Refinement request.",
    { auditRef: error.payload?.audit_ref ?? null, correlationId, statusCode: 403 },
  );
}

function sourceFailure(error, correlationId) {
  if (error instanceof RefinementServiceError) return error;
  const code = error?.code ?? "backend_projection_failed";
  const statusCode = code === "request_invalid"
    ? 400
    : code === "packet_stale" || code === "accepted_draft_stale"
      ? 409
      : error?.retryable
        ? 503
        : 502;
  return new RefinementServiceError(code, error.message, {
    correlationId,
    retryable: error?.retryable === true,
    statusCode,
  });
}

function runtimeFailure(error, correlationId) {
  if (!(error instanceof RefinementRuntimeError)) return error;
  return new RefinementServiceError(error.code, error.message, {
    correlationId,
    retryable: error.retryable,
    statusCode: error.code === "run_not_found" ? 404 : error.code === "apply_conflict" ? 409 : 503,
  });
}

function assertAcceptedDraft(request, packet) {
  const draft = request.accepted_draft;
  if (
    request.delivery_id !== packet.source.delivery_id ||
    request.package_ref !== packet.source.package_ref ||
    request.source_ref !== packet.source.source_ref ||
    request.source_revision !== packet.source.source_revision ||
    draft.packet_id !== packet.packet_id ||
    draft.packet_revision !== packet.packet_revision ||
    draft.source_work_design_receipt_id !== packet.source.source_work_design_receipt_id ||
    canonicalDigest(draft.apply_plan) !== canonicalDigest(packet.apply_plan)
  ) {
    throw new RefinementServiceError(
      "accepted_draft_stale",
      "The accepted Refinement draft no longer matches the canonical packet.",
      { correlationId: request.correlation_id, statusCode: 409 },
    );
  }
  if (draft.draft_digest !== refinementAcceptedDraftDigest(draft)) {
    throw new RefinementServiceError(
      "request_invalid",
      "accepted_draft.draft_digest does not match the accepted Refinement values.",
      { correlationId: request.correlation_id },
    );
  }
  const fields = allPacketFields(packet);
  for (const field of fields.filter((candidate) => candidate.required)) {
    const values = (field.target_node_ids ?? []).map((nodeId) => {
      const specific = `${field.backend_field}:${nodeId}`;
      return Object.hasOwn(draft.metadata_values, specific)
        ? draft.metadata_values[specific]
        : draft.metadata_values[field.backend_field] ?? field.target_values?.[nodeId] ?? field.value;
    });
    if (values.some((value) => String(value).trim().length === 0)) {
      throw new RefinementServiceError(
        "request_invalid",
        `Required Refinement field ${field.label} is unresolved.`,
        { correlationId: request.correlation_id },
      );
    }
  }
}

export function createRefinementService({
  audit,
  clock = () => new Date(),
  contextCallerId = "operator-orchestration-service",
  contextClient,
  gatewayClient,
  runAdapter,
  sourceAdapter,
}) {
  async function packetFor({ correlationId, packageRef, sourceRef }) {
    try {
      return await sourceAdapter.projectPacket({ packageRef, sourceRef });
    } catch (error) {
      throw sourceFailure(error, correlationId);
    }
  }

  return {
    async project({ callerId, correlationId, packageId, sourceRef }) {
      const packet = await packetFor({ correlationId, packageRef: packageId, sourceRef });
      let history;
      try {
        history = await runAdapter.listRuns({ packageRef: packageId, limit: 100 });
      } catch (error) {
        throw runtimeFailure(error, correlationId);
      }
      const activeRun = history.find((run) => ["accepted", "running"].includes(run.state)) ?? null;
      const result = assertRefinementProjectionResult({
        schema_version: 1,
        package_ref: packageId,
        source_revision: packet.source.source_revision,
        packet,
        active_run: activeRun,
        latest_run: history[0] ?? null,
        history,
        projected_at: clock().toISOString(),
      });
      audit?.emit?.({
        caller: { id: callerId },
        correlation_id: correlationId,
        event_type: "delivery.refinement.projected",
        outcome: "success",
        package_ref: packageId,
        packet_revision: packet.packet_revision,
      });
      return result;
    },

    async assist({ callerId, packageId, request: rawRequest }) {
      const request = validateRequest(assertRefinementAssistRequest, rawRequest);
      if (request.package_ref !== packageId) {
        throw new RefinementServiceError(
          "request_invalid",
          "Route package identity does not match package_ref.",
          { correlationId: request.correlation_id },
        );
      }
      const packet = await packetFor({
        correlationId: request.correlation_id,
        packageRef: request.package_ref,
        sourceRef: request.source_ref,
      });
      assertPacketBinding(request, packet);
      const field = assertAssistTarget(request, packet);
      const requestedAt = clock().toISOString();
      const projectionRequest = {
        schema_version: 1,
        idempotency_key: stableId("refinement-projection", request),
        workflow_session_id: stableId("refinement-session", {
          delivery_id: request.delivery_id,
          operator_id: request.operator.id,
          package_ref: request.package_ref,
        }),
        execution_id: stableId("refinement-execution", request),
        requested_at: requestedAt,
        assist_request: request,
        assist_request_digest: canonicalDigest(request),
        budget_tokens: 8000,
      };
      let projection;
      try {
        projection = assertProjection(
          request,
          await contextClient.project(projectionRequest),
          projectionRequest,
          contextCallerId,
        );
      } catch (error) {
        if (error instanceof RefinementServiceError) throw error;
        if (!(error instanceof RefinementUpstreamError)) throw error;
        const upstreamCode = error.payload?.detail?.code ?? error.payload?.code;
        throw new RefinementServiceError(
          upstreamCode === "context_projection_unsafe"
            ? "context_admission_denied"
            : "context_projection_failed",
          error.message,
          {
            correlationId: request.correlation_id,
            retryable: error.retryable,
            statusCode: error.statusCode,
          },
        );
      }
      let gateway;
      try {
        gateway = await gatewayClient.invoke({
          profile_id: PROFILE_ID,
          caller_identity: {
            caller_id: GATEWAY_CALLER_ID,
            caller_repo: "operator-orchestration-service",
            caller_workflow: "refinement-assist",
            decision_or_correlation_id: request.correlation_id,
            requested_profile_id: PROFILE_ID,
          },
          operator_identity: { operator_id: request.operator.id },
          operator_acceptance_state: "not-recorded",
          task: request.task,
          provider_output_schema_ref: OUTPUT_SCHEMA_REF,
          input: {
            task_instruction:
              "Suggest one bounded value for the selected Refinement metadata field. Do not approve or apply it.",
            operator_prompt: request.operator_prompt,
            model_safe_packet: {
              packet_ref: projection.packet_ref,
              redaction_receipt_ref: projection.redaction_receipt_ref,
              projection_receipt_ref: projection.projection_receipt_ref,
              content: projection.content,
            },
          },
        });
      } catch (error) {
        if (error instanceof RefinementUpstreamError) {
          throw gatewayFailure(error, request.correlation_id);
        }
        throw error;
      }
      const output = gateway?.output;
      if (
        gateway?.policy_decision !== "allow" ||
        gateway?.policy_status !== "active" ||
        gateway?.profile_id !== PROFILE_ID ||
        gateway?.decision_id !== request.correlation_id ||
        gateway?.caller_id !== GATEWAY_CALLER_ID ||
        gateway?.invocation_path !== "governed-ai-gateway" ||
        gateway?.task?.kind !== request.task.kind ||
        gateway?.task?.contract_ref !== CONTRACT_REF ||
        gateway?.task?.version !== CONTRACT_VERSION ||
        output?.field_key !== field.field_key ||
        output?.required_operator_action !== "review" ||
        typeof gateway?.audit_ref !== "string" ||
        (
          output?.value !== null &&
          request.target.allowed_values.length > 0 &&
          !request.target.allowed_values.includes(output?.value)
        )
      ) {
        throw new RefinementServiceError(
          "ai_output_invalid",
          "The governed AI gateway returned invalid Refinement advice.",
          {
            auditRef: gateway?.audit_ref ?? null,
            correlationId: request.correlation_id,
            statusCode: 502,
          },
        );
      }
      let result;
      try {
        result = assertRefinementAssistResult({
          schema_version: 1,
          request_id: request.request_id,
          correlation_id: request.correlation_id,
          response_id: stableId("refinement-response", {
            audit_ref: gateway.audit_ref,
            request_id: request.request_id,
          }),
          status: "ready",
          confidence: output.confidence,
          required_operator_action: output.required_operator_action,
          suggestion: {
            field_key: output.field_key,
            value: output.value,
            summary: output.summary,
            rationale: output.rationale,
            resolution: "ai_drafted",
          },
          evidence: {
            generated_at: gateway.generated_at,
            model_profile_id: PROFILE_ID,
            task_contract_ref: CONTRACT_REF,
            output_schema_ref: OUTPUT_SCHEMA_REF,
            cgg_packet_ref: projection.packet_ref,
            redaction_receipt_ref: projection.redaction_receipt_ref,
            gateway_audit_ref: gateway.audit_ref,
          },
        });
      } catch (error) {
        if (!(error instanceof HttpError)) throw error;
        throw new RefinementServiceError(
          "ai_output_invalid",
          "The governed AI gateway returned malformed Refinement advice.",
          {
            auditRef: gateway.audit_ref,
            correlationId: request.correlation_id,
            statusCode: 502,
          },
        );
      }
      audit?.emit?.({
        caller: { id: callerId },
        correlation_id: request.correlation_id,
        event_type: "delivery.refinement.advice_ready",
        gateway_audit_ref: gateway.audit_ref,
        outcome: "success",
        package_ref: request.package_ref,
      });
      return result;
    },

    async apply({ callerId, packageId, request: rawRequest }) {
      const request = validateRequest(assertRefinementApplyRequest, rawRequest);
      if (request.package_ref !== packageId) {
        throw new RefinementServiceError(
          "request_invalid",
          "Route package identity does not match package_ref.",
          { correlationId: request.correlation_id },
        );
      }
      const packet = await packetFor({
        correlationId: request.correlation_id,
        packageRef: request.package_ref,
        sourceRef: request.source_ref,
      });
      assertAcceptedDraft(request, packet);
      try {
        return await runAdapter.startRun({ callerId, packet, request });
      } catch (error) {
        throw runtimeFailure(error, request.correlation_id);
      }
    },

    async getRun({ callerId, correlationId, packageId, runId }) {
      let run;
      try {
        run = await runAdapter.getRun(runId);
      } catch (error) {
        throw runtimeFailure(error, correlationId);
      }
      const expectedPrefix = `/v1/delivery-refinement/${encodeURIComponent(packageId)}/runs/`;
      if (!run.poll_ref.startsWith(expectedPrefix)) {
        throw new RefinementServiceError(
          "run_not_found",
          "Refinement run not found.",
          { correlationId, statusCode: 404 },
        );
      }
      audit?.emit?.({
        caller: { id: callerId },
        correlation_id: correlationId,
        event_type: "delivery.refinement.run_projected",
        outcome: "success",
        package_ref: packageId,
        run_id: run.run_id,
        state: run.state,
      });
      return run;
    },
  };
}
