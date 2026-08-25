import { createHash } from "node:crypto";

import {
  canonicalDigest,
  canonicalStringify,
} from "../delivery-art/canonical-json.js";
import { HttpError, OpenProjectError } from "../errors.js";
import {
  assertWorkDesignApplyRequest,
  assertWorkDesignAssistRequest,
  assertWorkDesignAssistResult,
  assertWorkDesignError,
  assertWorkDesignProjectionResult,
} from "./contracts.js";
import {
  createWorkDesignApplicationAdapter,
  WorkDesignApplicationStoreError,
} from "./application-adapter.js";
import {
  assertWorkDesignApplicationBinding,
  buildWorkDesignApplicationEvent,
  workDesignApplicationId,
  workDesignResultFromEvent,
} from "./application-model.js";
import { WorkDesignUpstreamError } from "./http-client.js";

const PROFILE_ID = "delivery-work-design-advisor-v1";
const CONTRACT_REF = "oos.delivery-work-design.v1";
const CONTRACT_VERSION = "1.0";
const OUTPUT_SCHEMA_REF =
  "platform-engineering/security/schemas/delivery-work-design-advice.schema.json";
const CALLER_ID = "operator-orchestration-service/work-design-assist";

export class WorkDesignServiceError extends Error {
  constructor(code, message, {
    auditRef = null,
    correlationId,
    receiptRef = null,
    retryable = false,
    statusCode = 400,
  } = {}) {
    super(message);
    this.name = "WorkDesignServiceError";
    this.auditRef = auditRef;
    this.code = code;
    this.correlationId = correlationId ?? "unknown";
    this.receiptRef = receiptRef;
    this.retryable = retryable;
    this.statusCode = statusCode;
  }

  toResponse() {
    return assertWorkDesignError({
      schema_version: 1,
      correlation_id: this.correlationId,
      code: this.code,
      message: this.message,
      retryable: this.retryable,
      audit_ref: this.auditRef,
      receipt_ref: this.receiptRef,
    });
  }
}

function stableId(prefix, value) {
  return `${prefix}:${canonicalDigest(value).slice("sha256:".length, 40)}`;
}

function textDigest(value) {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function requestCorrelation(request) {
  return typeof request?.correlation_id === "string" &&
    /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(request.correlation_id)
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
    throw new WorkDesignServiceError(
      operatorMissing ? "operator_identity_required" : "request_invalid",
      error.message,
      { correlationId: requestCorrelation(request), statusCode: 400 },
    );
  }
}

function sourceRecordId(sourceRef) {
  const match = String(sourceRef ?? "").match(/^openproject:\/\/work_packages\/(\d+)$/);
  return match ? Number.parseInt(match[1], 10) : null;
}

function assertSourceCurrent(request, source) {
  if (!source || source.recordRef !== request.source_ref) {
    throw new WorkDesignServiceError(
      "accepted_draft_stale",
      "The Work Design source no longer matches the accepted draft.",
      { correlationId: request.correlation_id, statusCode: 409 },
    );
  }
  if (source.sourceRevision !== request.source_revision) {
    throw new WorkDesignServiceError(
      "accepted_draft_stale",
      "The Work Design source changed after this draft was created.",
      { correlationId: request.correlation_id, statusCode: 409 },
    );
  }
}

function taskInstruction(kind) {
  return kind === "context_advice"
    ? "Review the current Work Design context decision. Return bounded advice only; do not approve or apply changes."
    : "Review the current Work Design draft tree. Return bounded advice only; do not approve or apply changes.";
}

function assertProjection(request, projection, projectedRequest, contextCallerId) {
  const binding = projection?.binding;
  const task = binding?.task;
  if (
    projection?.status !== "ready" ||
    projection?.request_id !== projectedRequest.request_id ||
    projection?.correlation_id !== projectedRequest.correlation_id ||
    projection?.idempotency_key !== projectedRequest.idempotency_key ||
    projection?.admission_decision?.redaction_safe !== true ||
    !["not_requested", "denied"].includes(projection?.admission_decision?.raw_projection) ||
    binding?.correlation_id !== request.correlation_id ||
    binding?.request_id !== projectedRequest.request_id ||
    binding?.idempotency_key !== projectedRequest.idempotency_key ||
    binding?.workflow_session_id !== projectedRequest.workflow_session_id ||
    binding?.execution_id !== projectedRequest.execution_id ||
    binding?.delivery_id !== request.delivery_id ||
    binding?.package_ref !== request.package_ref ||
    binding?.source_ref !== request.source_ref ||
    binding?.source_revision !== request.source_revision ||
    binding?.operator_id !== request.operator.id ||
    binding?.caller_id !== contextCallerId ||
    binding?.requested_at !== projectedRequest.requested_at ||
    binding?.context_digest !== projectedRequest.context_digest ||
    binding?.budget_tokens !== projectedRequest.budget_tokens ||
    task?.kind !== request.task.kind ||
    task?.contract_ref !== CONTRACT_REF ||
    task?.version !== CONTRACT_VERSION ||
    task?.model_profile_id !== PROFILE_ID ||
    task?.output_schema_ref !== OUTPUT_SCHEMA_REF ||
    typeof projection?.packet_ref !== "string" ||
    typeof projection?.redaction_receipt_ref !== "string" ||
    typeof projection?.projection_receipt_ref !== "string" ||
    typeof projection?.content !== "string" ||
    !projection.content ||
    projection?.authority?.may_select_or_invoke_model !== false ||
    projection?.authority?.may_approve_suggestion !== false ||
    projection?.authority?.may_mutate_delivery !== false
  ) {
    throw new WorkDesignServiceError(
      "context_projection_failed",
      "CGG returned a projection that does not match the Work Design request.",
      { correlationId: request.correlation_id, statusCode: 502 },
    );
  }
  return projection;
}

function gatewayFailure(error, correlationId) {
  const reasons = Array.isArray(error.payload?.reasons)
    ? error.payload.reasons
    : [];
  if (
    error.code === "upstream_not_configured" ||
    reasons.some((reason) =>
      String(reason).includes("profile-not-active") ||
      String(reason).includes("activation"),
    )
  ) {
    return new WorkDesignServiceError(
      "ai_profile_inactive",
      "The governed Work Design profile is not active.",
      { auditRef: error.payload?.audit_ref ?? null, correlationId, statusCode: 503 },
    );
  }
  if (reasons.some((reason) => String(reason).includes("provider")) || error.retryable) {
    return new WorkDesignServiceError(
      "ai_provider_unavailable",
      "The governed Work Design provider is unavailable.",
      { auditRef: error.payload?.audit_ref ?? null, correlationId, retryable: true, statusCode: 503 },
    );
  }
  return new WorkDesignServiceError(
    "ai_invocation_denied",
    "The governed AI gateway denied the Work Design request.",
    { auditRef: error.payload?.audit_ref ?? null, correlationId, statusCode: 403 },
  );
}

function applicationStoreFailure(error, correlationId) {
  if (!(error instanceof WorkDesignApplicationStoreError)) {
    return error;
  }
  return new WorkDesignServiceError(error.code, error.message, {
    correlationId,
    retryable: error.retryable,
    statusCode: error.retryable ? 503 : 502,
  });
}

function toPlanNode(node) {
  return {
    type: node.kind,
    subject: node.title,
    description: node.draft_body,
    children: (node.children ?? []).map(toPlanNode),
  };
}

function toDeliveryPlan(tree) {
  if (tree.kind === "Epic") {
    return {
      schema_version: 1,
      epic_updates: { description: tree.draft_body },
      items: (tree.children ?? []).map(toPlanNode),
    };
  }
  return { schema_version: 1, items: [toPlanNode(tree)] };
}

function resultRefs(entries) {
  return [...new Set((entries ?? []).map((entry) => entry.record_ref).filter(Boolean))];
}

export function createWorkDesignService({
  applicationAdapter = null,
  audit,
  clock = () => new Date(),
  contextClient,
  contextCallerId = "operator-orchestration-service",
  deliveryService,
  gatewayClient,
  openProjectClient,
}) {
  const applicationStore = applicationAdapter ??
    createWorkDesignApplicationAdapter({ openProjectClient });
  const inFlightApplications = new Map();

  async function readSource({
    correlationId,
    failureCode = "backend_readback_incomplete",
    sourceRef,
  }) {
    const recordId = sourceRecordId(sourceRef);
    if (!recordId) {
      throw new WorkDesignServiceError(
        "request_invalid",
        "source_ref must identify one OpenProject work package.",
        { correlationId },
      );
    }
    let source;
    try {
      source = await openProjectClient.getWorkDesignSourceRevision({ recordId });
    } catch (error) {
      if (!(error instanceof OpenProjectError)) throw error;
      if (error.errorClass === "not_found") {
        throw new WorkDesignServiceError(
          "accepted_draft_stale",
          "The Work Design source no longer exists.",
          { correlationId, statusCode: 409 },
        );
      }
      throw new WorkDesignServiceError(
        failureCode,
        "The current Work Design source revision could not be verified.",
        {
          correlationId,
          retryable: error.errorClass === "backend_unavailable",
          statusCode: error.errorClass === "backend_unavailable" ? 503 : 502,
        },
      );
    }
    return source;
  }

  async function readCurrentSource(request) {
    const source = await readSource({
      correlationId: request.correlation_id,
      sourceRef: request.source_ref,
    });
    assertSourceCurrent(request, source);
    return source;
  }

  async function inspectApplications({ applicationId = null, packageRef, sourceRef, correlationId }) {
    const recordId = sourceRecordId(sourceRef);
    if (!recordId) {
      throw new WorkDesignServiceError(
        "request_invalid",
        "source_ref must identify one OpenProject work package.",
        { correlationId },
      );
    }
    try {
      return await applicationStore.inspect({
        applicationId,
        packageRef,
        recordId,
        sourceRef,
      });
    } catch (error) {
      throw applicationStoreFailure(error, correlationId);
    }
  }

  async function recordApplicationEvent({ event, sourceRef, correlationId }) {
    try {
      return await applicationStore.record({
        event,
        recordId: sourceRecordId(sourceRef),
      });
    } catch (error) {
      throw applicationStoreFailure(error, correlationId);
    }
  }

  return {
    async project({ callerId, correlationId, packageId, sourceRef }) {
      if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(packageId)) {
        throw new WorkDesignServiceError(
          "request_invalid",
          "Route package identity is not valid.",
          { correlationId },
        );
      }
      const source = await readSource({
        correlationId,
        failureCode: "backend_projection_failed",
        sourceRef,
      });
      if (
        source?.recordRef !== sourceRef ||
        !/^version-(0|[1-9][0-9]*)$/.test(source?.sourceRevision ?? "")
      ) {
        throw new WorkDesignServiceError(
          "backend_projection_failed",
          "The current Work Design source projection does not match the request.",
          { correlationId, statusCode: 502 },
        );
      }
      const { applications } = await inspectApplications({
        correlationId,
        packageRef: packageId,
        sourceRef,
      });
      const completed = [...applications.values()]
        .filter((application) => application.completion)
        .sort((left, right) =>
          right.completion.event.recorded_at.localeCompare(
            left.completion.event.recorded_at,
          ),
        );
      const pending = [...applications.values()]
        .filter((application) => application.intent && !application.completion)
        .sort((left, right) =>
          right.intent.event.recorded_at.localeCompare(left.intent.event.recorded_at),
        );
      let result;
      try {
        const history = completed.slice(0, 100).map(({ completion }) =>
          workDesignResultFromEvent({
            activityId: completion.activityId,
            event: completion.event,
          }),
        );
        result = assertWorkDesignProjectionResult({
          schema_version: 1,
          package_ref: packageId,
          source: {
            ref: source.recordRef,
            revision: source.sourceRevision,
          },
          state: history.length > 0
            ? "applied"
            : pending.length > 0
              ? "apply-pending"
              : "not-applied",
          pending_application_id: pending[0]?.intent.event.application_id ?? null,
          latest_application: history[0] ?? null,
          history,
          projected_at: clock().toISOString(),
        });
      } catch (error) {
        if (!(error instanceof HttpError)) throw error;
        throw new WorkDesignServiceError(
          "backend_projection_failed",
          "Durable Work Design application history could not be projected.",
          { correlationId, statusCode: 502 },
        );
      }
      audit?.emit?.({
        caller: { id: callerId },
        correlation_id: correlationId,
        event_type: "delivery.work_design.projected",
        outcome: "success",
        package_ref: packageId,
        source_ref: source.recordRef,
        status: result.state,
      });
      return result;
    },

    async assist({ callerId, packageId, request: rawRequest }) {
      const request = validateRequest(assertWorkDesignAssistRequest, rawRequest);
      if (request.package_ref !== packageId) {
        throw new WorkDesignServiceError(
          "request_invalid",
          "Route package identity does not match package_ref.",
          { correlationId: request.correlation_id },
        );
      }
      if (
        request.tree_draft &&
        request.tree_draft.tree_digest !== canonicalDigest(request.tree_draft.tree)
      ) {
        throw new WorkDesignServiceError(
          "request_invalid",
          "tree_draft.tree_digest does not match the submitted tree.",
          { correlationId: request.correlation_id },
        );
      }
      await readCurrentSource(request);
      const context = canonicalStringify({
        context_draft: request.context_draft ?? null,
        tree_draft: request.tree_draft ?? null,
      });
      const requestedAt = clock().toISOString();
      const projectionRequest = {
        schema_version: 1,
        request_id: stableId("cgg-work-design-request", request),
        correlation_id: request.correlation_id,
        idempotency_key: stableId("work-design-projection", request),
        workflow_session_id: stableId("work-design-session", {
          delivery_id: request.delivery_id,
          package_ref: request.package_ref,
          operator_id: request.operator.id,
        }),
        execution_id: stableId("work-design-execution", request),
        delivery_id: request.delivery_id,
        package_ref: request.package_ref,
        source_ref: request.source_ref,
        source_revision: request.source_revision,
        operator: { id: request.operator.id },
        task: {
          ...request.task,
          output_schema_ref: OUTPUT_SCHEMA_REF,
          model_profile_id: PROFILE_ID,
        },
        requested_at: requestedAt,
        context,
        context_digest: textDigest(context),
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
        if (error instanceof WorkDesignServiceError) throw error;
        if (!(error instanceof WorkDesignUpstreamError)) throw error;
        const upstreamCode = error.payload?.detail?.code ?? error.payload?.code;
        throw new WorkDesignServiceError(
          upstreamCode === "context_projection_unsafe"
            ? "context_admission_denied"
            : "context_projection_failed",
          error.message,
          { correlationId: request.correlation_id, retryable: error.retryable, statusCode: error.statusCode },
        );
      }
      let gateway;
      try {
        gateway = await gatewayClient.invoke({
          profile_id: PROFILE_ID,
          caller_identity: {
            caller_id: CALLER_ID,
            caller_repo: "operator-orchestration-service",
            caller_workflow: "work-design-assist",
            decision_or_correlation_id: request.correlation_id,
            requested_profile_id: PROFILE_ID,
          },
          operator_identity: { operator_id: request.operator.id },
          operator_acceptance_state: "not-recorded",
          task: request.task,
          provider_output_schema_ref: OUTPUT_SCHEMA_REF,
          input: {
            task_instruction: taskInstruction(request.task.kind),
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
        if (error instanceof WorkDesignUpstreamError) {
          throw gatewayFailure(error, request.correlation_id);
        }
        throw error;
      }
      if (
        gateway?.policy_decision !== "allow" ||
        gateway?.policy_status !== "active" ||
        gateway?.profile_id !== PROFILE_ID ||
        gateway?.decision_id !== request.correlation_id ||
        gateway?.caller_id !== CALLER_ID ||
        gateway?.invocation_path !== "governed-ai-gateway" ||
        gateway?.task?.kind !== request.task.kind ||
        gateway?.task?.contract_ref !== CONTRACT_REF ||
        gateway?.task?.version !== CONTRACT_VERSION ||
        !gateway?.output ||
        typeof gateway?.audit_ref !== "string"
      ) {
        throw new WorkDesignServiceError(
          "ai_output_invalid",
          "The governed AI gateway returned invalid Work Design advice.",
          { auditRef: gateway?.audit_ref ?? null, correlationId: request.correlation_id, statusCode: 502 },
        );
      }
      let result;
      try {
        result = assertWorkDesignAssistResult({
          schema_version: 1,
          request_id: request.request_id,
          correlation_id: request.correlation_id,
          response_id: stableId("work-design-response", {
            request_id: request.request_id,
            audit_ref: gateway.audit_ref,
          }),
          task_kind: request.task.kind,
          status: "ready",
          ...gateway.output,
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
        throw new WorkDesignServiceError(
          "ai_output_invalid",
          "The governed AI gateway returned malformed Work Design advice.",
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
        cgg_packet_ref: projection.packet_ref,
        event_type: "delivery.work_design.advice_ready",
        gateway_audit_ref: gateway.audit_ref,
        outcome: "success",
        redaction_receipt_ref: projection.redaction_receipt_ref,
        status: "ready",
        task_kind: request.task.kind,
      });
      return result;
    },

    async apply({ callerId, packageId, request: rawRequest }) {
      const request = validateRequest(assertWorkDesignApplyRequest, rawRequest);
      if (request.package_ref !== packageId) {
        throw new WorkDesignServiceError(
          "request_invalid",
          "Route package identity does not match package_ref.",
          { correlationId: request.correlation_id },
        );
      }
      const expectedDraftDigest = canonicalDigest(request.accepted_draft.tree);
      if (request.accepted_draft.draft_digest !== expectedDraftDigest) {
        throw new WorkDesignServiceError(
          "request_invalid",
          "accepted_draft.draft_digest does not match the accepted tree.",
          { correlationId: request.correlation_id },
        );
      }
      const requestDigest = canonicalDigest(request);
      const applicationId = workDesignApplicationId(request);

      const executeApplication = async () => {
        const inspected = await inspectApplications({
          applicationId,
          correlationId: request.correlation_id,
          packageRef: request.package_ref,
          sourceRef: request.source_ref,
        });
        const prior = inspected.application;
        for (const entry of [prior?.intent, prior?.completion].filter(Boolean)) {
          try {
            assertWorkDesignApplicationBinding({
              event: entry.event,
              request,
              requestDigest,
            });
          } catch {
            throw new WorkDesignServiceError(
              "apply_conflict",
              "The Work Design application identity is already bound to another request.",
              {
                correlationId: request.correlation_id,
                receiptRef: prior?.completion
                  ? workDesignResultFromEvent({
                      activityId: prior.completion.activityId,
                      event: prior.completion.event,
                    }).receipt.ref
                  : null,
                statusCode: 409,
              },
            );
          }
        }
        if (prior?.completion) {
          return workDesignResultFromEvent({
            activityId: prior.completion.activityId,
            event: prior.completion.event,
            replayed: true,
          });
        }
        if (!prior?.intent) {
          await readCurrentSource(request);
          await recordApplicationEvent({
            correlationId: request.correlation_id,
            event: buildWorkDesignApplicationEvent({
              eventType: "apply-intent",
              recordedAt: clock().toISOString(),
              request,
              requestDigest,
            }),
            sourceRef: request.source_ref,
          });
        }

        let applied;
        try {
          applied = await deliveryService.applyDeliveryPlan({
            callerId,
            correlationId: request.correlation_id,
            plan: toDeliveryPlan(request.accepted_draft.tree),
            recordId: request.delivery_id,
            reconcileMissing: "ignore",
          });
        } catch (error) {
          const conflict =
            error instanceof OpenProjectError && error.errorClass === "update_conflict";
          const operatorResolvable =
            error instanceof OpenProjectError &&
            ["not_found", "validation_failure"].includes(error.errorClass);
          throw new WorkDesignServiceError(
            conflict ? "apply_conflict" : "backend_application_failed",
            error.message,
            {
              correlationId: request.correlation_id,
              retryable:
                error instanceof OpenProjectError &&
                error.errorClass === "backend_unavailable",
              statusCode: conflict ? 409 : operatorResolvable ? 422 : 502,
            },
          );
        }
        if (
          !applied?.plan_result ||
          applied.delivery_id !== request.delivery_id ||
          typeof applied.delivery_record_ref !== "string" ||
          applied.delivery_record_ref.length === 0
        ) {
          throw new WorkDesignServiceError(
            "backend_readback_incomplete",
            "Canonical Delivery readback did not match the Work Design application.",
            { correlationId: request.correlation_id, retryable: true, statusCode: 502 },
          );
        }
        const planResult = applied.plan_result;
        const resultBase = {
          schema_version: 1,
          request_id: request.request_id,
          correlation_id: request.correlation_id,
          application_id: applicationId,
          status:
            (planResult.created?.length ?? 0) === 0 &&
            (planResult.updated?.length ?? 0) === 0 &&
            (planResult.retired?.length ?? 0) === 0
              ? "reconciled"
              : "applied",
          applied_at: request.acceptance.accepted_at,
          applied_by: request.operator.id,
          accepted_draft_digest: request.accepted_draft.draft_digest,
          target: {
            delivery_ref: applied.delivery_record_ref,
            created_refs: resultRefs(planResult.created),
            updated_refs: resultRefs(planResult.updated),
            reused_refs: resultRefs(planResult.reused),
            readback_complete: true,
          },
        };
        const completion = await recordApplicationEvent({
          correlationId: request.correlation_id,
          event: buildWorkDesignApplicationEvent({
            eventType: "apply-completed",
            recordedAt: clock().toISOString(),
            request,
            requestDigest,
            result: resultBase,
          }),
          sourceRef: request.source_ref,
        });
        const result = workDesignResultFromEvent({
          activityId: completion.activityId,
          event: completion.event,
        });
        audit?.emit?.({
          accepted_draft_digest: request.accepted_draft.draft_digest,
          application_id: result.application_id,
          caller: { id: callerId },
          correlation_id: request.correlation_id,
          event_type: "delivery.work_design.applied",
          outcome: "success",
          status: result.status,
          receipt_ref: result.receipt.ref,
        });
        return result;
      };

      const active = inFlightApplications.get(applicationId);
      if (active) {
        try {
          await active;
        } catch {
          // The durable event stream, not the prior process promise, decides replay.
        }
        return executeApplication();
      }
      const operation = executeApplication();
      inFlightApplications.set(applicationId, operation);
      try {
        return await operation;
      } finally {
        if (inFlightApplications.get(applicationId) === operation) {
          inFlightApplications.delete(applicationId);
        }
      }
    },
  };
}
