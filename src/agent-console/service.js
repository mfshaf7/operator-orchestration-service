import { createHash } from "node:crypto";

import { createAgentActionEnforcer } from "../agent-action/enforcement.js";
import { assertAgentActionArtifact } from "../agent-action/contracts.js";
import { canonicalDigest } from "../delivery-art/canonical-json.js";
import { HttpError } from "../errors.js";
import {
  agentConsoleDigest,
  agentConsoleError,
  agentConsoleManifest,
  agentConsoleReceiptRef,
  assertAgentConsoleContract,
} from "./contracts.js";

const MODEL = agentConsoleManifest.governed_ai;

function sessionReference(record) {
  return {
    uri: `oos://agent-console/sessions/${encodeURIComponent(record.request.session_id)}`,
    digest: record.session_binding_digest,
  };
}

function project(record, replayed = false) {
  const invocation = record.latest_invocation
    ? { ...structuredClone(record.latest_invocation), replayed }
    : null;
  return assertAgentConsoleContract("session-projection.schema.json", {
    schema_version: 1,
    workflow_id: "agent-console",
    session_id: record.request.session_id,
    session_ref: sessionReference(record),
    revision: record.revision,
    state: record.state,
    operator_id: record.request.operator_id,
    caller_id: record.caller_id,
    agent: structuredClone(record.request.agent),
    interaction_mode: record.request.interaction_mode,
    opened_at: record.request.opened_at,
    closed_at: record.closed_at,
    current_invocation_id: record.current_invocation_id,
    current_action_id: record.current_action_id,
    invocation_count: record.invocation_count,
    latest_invocation: invocation,
    latest_action_receipt_ref: structuredClone(record.latest_action_receipt_ref),
  });
}

function assertOwned(record, callerId, operatorId) {
  if (!record || record.caller_id !== callerId || record.request.operator_id !== operatorId) {
    throw agentConsoleError("session_not_found", "Agent Console session was not found.", 404);
  }
}

function assertActive(record) {
  if (record.state !== "active") {
    throw agentConsoleError("session_closed", "Agent Console session is closed.", 409);
  }
}

function assertOperatorBinding(bindings, callerId, operatorId) {
  if (!bindings[callerId] || bindings[callerId] !== operatorId) {
    throw agentConsoleError(
      "operator_binding_invalid",
      "Caller identity is not bound to the supplied Agent Console operator.",
      403,
    );
  }
}

function currentTime(clock) {
  const value = clock();
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw agentConsoleError("clock_invalid", "Agent Console runtime clock is invalid.", 503);
  }
  return value.toISOString();
}

function rawContentDigest(value) {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function contextRequest(record, request) {
  return {
    schema_version: 1,
    request_id: `agent-console-context:${request.invocation_id}`,
    correlation_id: request.correlation_id,
    idempotency_key: `agent-console-context:${agentConsoleDigest({
      session_id: record.request.session_id,
      invocation_id: request.invocation_id,
      request_digest: agentConsoleDigest(request),
    }).slice(7, 47)}`,
    session_id: record.request.session_id,
    invocation_id: request.invocation_id,
    operator_id: record.request.operator_id,
    interaction_mode: record.request.interaction_mode,
    requested_at: request.requested_at,
    candidate: structuredClone(request.candidate),
    budget_tokens: request.budget_tokens,
  };
}

function assertContextProjection(record, request, projected, projection, contextCallerId) {
  assertAgentConsoleContract(
    "cgg-projection-result.schema.json",
    structuredClone(projection),
  );
  const binding = projection?.binding;
  const candidate = binding?.candidate;
  const requestedAt = Date.parse(request.requested_at);
  const projectedAt = Date.parse(projection?.timeline?.projected_at ?? "");
  if (
    projection?.status !== "ready" ||
    projection?.request_id !== projected.request_id ||
    projection?.correlation_id !== request.correlation_id ||
    projection?.idempotency_key !== projected.idempotency_key ||
    binding?.request_id !== projected.request_id ||
    binding?.correlation_id !== request.correlation_id ||
    binding?.idempotency_key !== projected.idempotency_key ||
    binding?.session_id !== record.request.session_id ||
    binding?.invocation_id !== request.invocation_id ||
    binding?.operator_id !== record.request.operator_id ||
    binding?.caller_id !== contextCallerId ||
    binding?.interaction_mode !== record.request.interaction_mode ||
    binding?.requested_at !== request.requested_at ||
    binding?.budget_tokens !== request.budget_tokens ||
    candidate?.candidate_id !== request.candidate.candidate_id ||
    candidate?.scope !== request.candidate.scope ||
    candidate?.source_authority !== request.candidate.source_authority ||
    candidate?.source_mode !== request.candidate.source_mode ||
    candidate?.source_ref !== request.candidate.source_ref ||
    candidate?.source_revision !== request.candidate.source_revision ||
    candidate?.captured_at !== request.candidate.captured_at ||
    candidate?.content_digest !== request.candidate.content_digest ||
    projection?.timeline?.requested_at !== request.requested_at ||
    !Number.isFinite(projectedAt) ||
    projectedAt < requestedAt ||
    projection?.agent_context?.session_id !== record.request.session_id ||
    projection?.agent_context?.invocation_id !== request.invocation_id ||
    projection?.agent_context?.interaction_mode !== record.request.interaction_mode ||
    projection?.admission_decision?.redaction_safe !== true ||
    !["not_requested", "denied"].includes(projection?.admission_decision?.raw_projection) ||
    projection?.projection_safety?.raw_context_exposed !== false ||
    projection?.projection_safety?.custody_bound !== true ||
    projection?.agent_context_authority?.may_select_or_invoke_model !== false ||
    projection?.agent_context_authority?.may_authorize_action !== false ||
    typeof projection?.content !== "string" ||
    !projection.content ||
    typeof projection?.packet_ref !== "string" ||
    typeof projection?.redaction_receipt_ref !== "string" ||
    typeof projection?.projection_receipt_ref !== "string" ||
    !/^sha256:[0-9a-f]{64}$/.test(projection?.artifact_digest ?? "")
  ) {
    throw agentConsoleError(
      "context_projection_invalid",
      "CGG returned Agent Console context that does not match the exact session invocation.",
      502,
    );
  }
  return projection;
}

function gatewayRequest(record, request, projection) {
  return {
    profile_id: MODEL.profile_id,
    caller_identity: {
      caller_id: MODEL.caller_id,
      caller_repo: "operator-orchestration-service",
      caller_workflow: "agent-console",
      decision_or_correlation_id: request.correlation_id,
      requested_profile_id: MODEL.profile_id,
    },
    operator_identity: { operator_id: record.request.operator_id },
    task: {
      kind: MODEL.task_kind,
      contract_ref: MODEL.contract_ref,
      version: MODEL.contract_version,
    },
    provider_output_schema_ref: MODEL.provider_output_schema_ref,
    input: {
      task_instruction: "Answer the operator request using only the admitted model-safe packet. Do not authorize or execute workspace mutations.",
      operator_prompt: request.prompt,
      interaction_mode: record.request.interaction_mode,
      model_safe_packet: {
        content: projection.content,
        packet_ref: projection.packet_ref,
        redaction_receipt_ref: projection.redaction_receipt_ref,
        projection_receipt_ref: projection.projection_receipt_ref,
        artifact_digest: projection.artifact_digest,
      },
      session_binding: {
        session_ref: sessionReference(record),
        invocation_id: request.invocation_id,
        agent_instance_id: record.request.agent.instance_id,
      },
    },
  };
}

function assertGatewayResult(request, response, projection) {
  const generatedAt = Date.parse(response?.generated_at ?? "");
  if (
    response?.policy_decision !== "allow" ||
    response?.policy_status !== "active" ||
    response?.profile_id !== MODEL.profile_id ||
    response?.decision_id !== request.correlation_id ||
    response?.caller_id !== MODEL.caller_id ||
    response?.invocation_path !== "governed-ai-gateway" ||
    response?.task?.kind !== MODEL.task_kind ||
    response?.task?.contract_ref !== MODEL.contract_ref ||
    response?.task?.version !== MODEL.contract_version ||
    !Number.isFinite(generatedAt) ||
    generatedAt < Date.parse(projection.timeline.projected_at) ||
    !response?.output ||
    typeof response.output !== "object" ||
    Array.isArray(response.output) ||
    typeof response?.binding_selection_ref !== "string" ||
    typeof response?.audit_ref !== "string"
  ) {
    throw agentConsoleError(
      "model_result_invalid",
      "Governed AI returned an Agent Console result with incomplete or mismatched bindings.",
      502,
    );
  }
  assertAgentConsoleContract(
    "model-response.schema.json",
    structuredClone(response.output),
  );
  return response;
}

function failureFor(error) {
  if (error?.name === "AbortError") {
    return { state: "cancelled", code: "invocation_cancelled", message: "Agent Console invocation was cancelled.", retryable: true };
  }
  if (error instanceof HttpError) {
    return {
      state: "failed",
      code: error.code,
      message: error.message,
      retryable: error.statusCode >= 500,
    };
  }
  return {
    state: "failed",
    code: "upstream_unavailable",
    message: "Agent Console upstream processing was unavailable.",
    retryable: true,
  };
}

function invocationReceipt(record, request, invocation, recordedAt) {
  const base = {
    schema_version: 1,
    receipt_id: "agent-console-invocation-receipt:pending",
    session_ref: sessionReference(record),
    invocation_id: request.invocation_id,
    correlation_id: request.correlation_id,
    request_digest: invocation.request_digest,
    outcome: invocation.state,
    context: structuredClone(invocation.context),
    model: structuredClone(invocation.model),
    failure: structuredClone(invocation.failure),
    recorded_at: recordedAt,
  };
  const token = canonicalDigest({ ...base, receipt_id: null }).slice(7, 31);
  const receipt = { ...base, receipt_id: `agent-console-invocation-receipt:${token}` };
  return { receipt, digest: canonicalDigest(receipt) };
}

export function createAgentConsoleService({
  actionAdapter = null,
  audit = null,
  clock = () => new Date(),
  contextCallerId = "operator-orchestration-service",
  contextClient,
  evaluatorClient,
  gatewayClient,
  operatorBindings,
  store,
}) {
  const enforcer = evaluatorClient
    ? createAgentActionEnforcer({
        audit,
        clock: () => clock().toISOString(),
        evaluatorClient,
        recordReceipt: async (receipt) => store.transact(async (state) => {
          state.action_receipts[receipt.receipt_id] = structuredClone(receipt);
          return receipt;
        }),
      })
    : null;

  return {
    async createSession({ callerId, operatorId, input }) {
      assertOperatorBinding(operatorBindings, callerId, operatorId);
      const request = assertAgentConsoleContract("session-request.schema.json", structuredClone(input));
      if (request.operator_id !== operatorId) {
        throw agentConsoleError("operator_mismatch", "Session operator does not match the authenticated operator.", 403);
      }
      if (Date.parse(request.opened_at) > Date.parse(currentTime(clock))) {
        throw agentConsoleError("timeline_invalid", "Session open time cannot be in the future.", 409);
      }
      const digest = agentConsoleDigest(request);
      return store.transact(async (state) => {
        const key = `${callerId}:${request.idempotency_key}`;
        const existingId = state.session_keys[key];
        const existing = state.sessions[request.session_id] ?? (existingId ? state.sessions[existingId] : null);
        if (existing) {
          assertOwned(existing, callerId, operatorId);
          if (existing.request_digest !== digest) {
            throw agentConsoleError("idempotency_conflict", "Session identity is bound to different input.", 409);
          }
          return project(existing);
        }
        const record = {
          caller_id: callerId,
          request,
          request_digest: digest,
          session_binding_digest: canonicalDigest({ caller_id: callerId, request }),
          revision: 1,
          state: "active",
          closed_at: null,
          current_invocation_id: null,
          current_action_id: null,
          invocation_count: 0,
          latest_invocation: null,
          latest_action_receipt_ref: null,
          invocations: {},
          action_keys: {},
          actions: {},
        };
        state.sessions[request.session_id] = record;
        state.session_keys[key] = request.session_id;
        audit?.emit?.({ event_type: "agent-console.session.created", outcome: "active", session_id: request.session_id, operator_id: operatorId });
        return project(record);
      });
    },

    async readSession({ callerId, operatorId, sessionId }) {
      assertOperatorBinding(operatorBindings, callerId, operatorId);
      const record = await store.read(sessionId);
      assertOwned(record, callerId, operatorId);
      return project(record);
    },

    async invoke({ callerId, operatorId, sessionId, input, signal = null }) {
      assertOperatorBinding(operatorBindings, callerId, operatorId);
      const request = assertAgentConsoleContract("invocation-request.schema.json", structuredClone(input));
      if (request.candidate.content_digest !== rawContentDigest(request.candidate.content)) {
        throw agentConsoleError("candidate_digest_mismatch", "Context candidate content digest does not match its content.", 400);
      }
      const acceptedAt = currentTime(clock);
      const requestDigest = agentConsoleDigest(request);
      const reservation = await store.transact(async (state) => {
        const record = state.sessions[sessionId];
        assertOwned(record, callerId, operatorId);
        assertActive(record);
        if (Date.parse(request.requested_at) < Date.parse(record.request.opened_at)) {
          throw agentConsoleError("timeline_invalid", "Invocation precedes the Agent Console session.", 409);
        }
        if (Date.parse(request.requested_at) > Date.parse(acceptedAt)) {
          throw agentConsoleError("timeline_invalid", "Invocation request time cannot be in the future.", 409);
        }
        const key = `${sessionId}:${request.idempotency_key}`;
        const existingId = state.invocation_keys[key];
        const existing = record.invocations[request.invocation_id] ?? (existingId ? record.invocations[existingId] : null);
        if (existing) {
          if (existing.request_digest !== requestDigest) {
            throw agentConsoleError("idempotency_conflict", "Invocation identity is bound to different input.", 409);
          }
          if (existing.state === "running") {
            throw agentConsoleError("invocation_in_progress", "Invocation is already running.", 409);
          }
          record.latest_invocation = existing;
          return { replay: project(record, true), record: null };
        }
        if (record.current_invocation_id || record.current_action_id) {
          throw agentConsoleError("session_busy", "One invocation is already active for this Agent Console session.", 409);
        }
        const running = {
          invocation_id: request.invocation_id,
          correlation_id: request.correlation_id,
          state: "running",
          requested_at: request.requested_at,
          completed_at: null,
          request_digest: requestDigest,
          context: null,
          model: null,
          result: null,
          failure: null,
          receipt_ref: null,
        };
        record.current_invocation_id = request.invocation_id;
        record.invocations[request.invocation_id] = running;
        state.invocation_keys[key] = request.invocation_id;
        return { replay: null, record: structuredClone(record) };
      });
      if (reservation.replay) return reservation.replay;

      let context = null;
      let model = null;
      let modelGeneratedAt = null;
      let result = null;
      let failure = null;
      let terminalState = "completed";
      try {
        const projected = assertAgentConsoleContract(
          "cgg-projection-request.schema.json",
          contextRequest(reservation.record, request),
        );
        const projection = assertContextProjection(
          reservation.record,
          request,
          projected,
          await contextClient.project(projected, { signal }),
          contextCallerId,
        );
        context = {
          packet_ref: projection.packet_ref,
          redaction_receipt_ref: projection.redaction_receipt_ref,
          projection_receipt_ref: projection.projection_receipt_ref,
          artifact_digest: projection.artifact_digest,
        };
        const response = assertGatewayResult(
          request,
          await gatewayClient.invoke(gatewayRequest(reservation.record, request, projection), { signal }),
          projection,
        );
        model = {
          profile_id: response.profile_id,
          binding_selection_ref: response.binding_selection_ref,
          audit_ref: response.audit_ref,
        };
        modelGeneratedAt = response.generated_at;
        result = structuredClone(response.output);
      } catch (error) {
        const mapped = failureFor(error);
        terminalState = mapped.state;
        failure = { code: mapped.code, message: mapped.message, retryable: mapped.retryable };
      }

      let completedAt;
      try {
        completedAt = currentTime(clock);
      } catch {
        completedAt = acceptedAt;
        terminalState = "failed";
        result = null;
        failure = {
          code: "clock_invalid",
          message: "Agent Console runtime clock is invalid.",
          retryable: true,
        };
      }
      if (
        Date.parse(completedAt) < Date.parse(request.requested_at) ||
        (modelGeneratedAt && Date.parse(completedAt) < Date.parse(modelGeneratedAt))
      ) {
        completedAt = acceptedAt;
        terminalState = "failed";
        result = null;
        failure = {
          code: "timeline_invalid",
          message: "Invocation settlement time is invalid.",
          retryable: true,
        };
      }

      return store.transact(async (state) => {
        const record = state.sessions[sessionId];
        assertOwned(record, callerId, operatorId);
        if (record.current_invocation_id !== request.invocation_id) {
          throw agentConsoleError("invocation_binding_changed", "Active invocation binding changed before settlement.", 409);
        }
        const invocation = {
          invocation_id: request.invocation_id,
          correlation_id: request.correlation_id,
          state: terminalState,
          requested_at: request.requested_at,
          completed_at: completedAt,
          request_digest: requestDigest,
          context,
          model,
          result,
          failure,
          receipt_ref: null,
        };
        const sealed = invocationReceipt(record, request, invocation, completedAt);
        invocation.receipt_ref = agentConsoleReceiptRef({
          digest: sealed.digest,
          receiptId: sealed.receipt.receipt_id,
        });
        record.invocations[request.invocation_id] = invocation;
        record.current_invocation_id = null;
        record.invocation_count += 1;
        record.latest_invocation = invocation;
        record.revision += 1;
        state.invocation_receipts[sealed.receipt.receipt_id] = sealed.receipt;
        audit?.emit?.({ event_type: "agent-console.invocation.completed", outcome: terminalState, session_id: sessionId, invocation_id: request.invocation_id });
        return project(record);
      });
    },

    async executeAction({ callerId, operatorId, sessionId, request }) {
      assertOperatorBinding(operatorBindings, callerId, operatorId);
      if (!enforcer || typeof actionAdapter?.resolveCurrent !== "function" || typeof actionAdapter?.execute !== "function") {
        throw agentConsoleError("action_runtime_unavailable", "Agent Console action execution is not activated.", 503);
      }
      let canonicalRequest;
      try {
        canonicalRequest = assertAgentActionArtifact("agent_action_request", request);
      } catch (error) {
        throw agentConsoleError("action_contract_invalid", error.message, 400);
      }
      const requestDigest = canonicalRequest.integrity.content_digest;
      const record = await store.read(sessionId);
      assertOwned(record, callerId, operatorId);
      assertActive(record);
      const suppliedSessionRef = request?.operator?.session_ref;
      const modelInvocationRef = canonicalRequest.model_invocation_ref;
      const context = record.latest_invocation?.context ?? null;
      if (
        canonicalRequest.operator.principal_id !== operatorId ||
        !suppliedSessionRef ||
        typeof suppliedSessionRef !== "object" ||
        Array.isArray(suppliedSessionRef) ||
        canonicalDigest(suppliedSessionRef) !== canonicalDigest(sessionReference(record)) ||
        canonicalRequest.agent.instance_id !== record.request.agent.instance_id ||
        canonicalRequest.caller.workload_id !== callerId ||
        (modelInvocationRef !== null && (
          !record.latest_invocation ||
          record.latest_invocation.state !== "completed" ||
          canonicalDigest(modelInvocationRef) !== canonicalDigest(record.latest_invocation.receipt_ref) ||
          canonicalRequest.context.packet_ref?.uri !== context?.packet_ref ||
          canonicalRequest.context.packet_ref?.digest !== context?.artifact_digest ||
          canonicalRequest.context.receipt_ref?.uri !== context?.projection_receipt_ref ||
          canonicalRequest.context.receipt_ref?.digest !== context?.artifact_digest
        ))
      ) {
        throw agentConsoleError("action_binding_invalid", "Agent action is not bound to the current Console session.", 403);
      }
      const reservation = await store.transact(async (state) => {
        const current = state.sessions[sessionId];
        assertOwned(current, callerId, operatorId);
        assertActive(current);
        const existingId = current.action_keys[canonicalRequest.idempotency_key];
        const existing = current.actions[canonicalRequest.request_id] ??
          (existingId ? current.actions[existingId] : null);
        if (existing) {
          if (existing.request_digest !== requestDigest) {
            throw agentConsoleError("idempotency_conflict", "Action identity is bound to different input.", 409);
          }
          if (existing.state === "completed") return { replay: structuredClone(existing.outcome), record: null };
          if (existing.state === "running") {
            throw agentConsoleError("action_in_progress", "Agent action is already running.", 409);
          }
          throw agentConsoleError(
            "action_outcome_unknown",
            "A prior action attempt did not produce a safely replayable terminal receipt.",
            409,
            { failure_code: existing.failure_code },
          );
        }
        if (current.current_invocation_id || current.current_action_id) {
          throw agentConsoleError("session_busy", "One Agent Console operation is already active.", 409);
        }
        current.current_action_id = canonicalRequest.request_id;
        current.action_keys[canonicalRequest.idempotency_key] = canonicalRequest.request_id;
        current.actions[canonicalRequest.request_id] = {
          request_digest: requestDigest,
          state: "running",
          outcome: null,
          failure_code: null,
        };
        return { replay: null, record: structuredClone(current) };
      });
      if (reservation.replay) return reservation.replay;
      let outcome;
      try {
        outcome = await enforcer.execute({
          request: canonicalRequest,
          resolveCurrent: (candidate) => actionAdapter.resolveCurrent({ candidate, session: project(reservation.record) }),
          execute: (input) => actionAdapter.execute({ ...input, session: project(reservation.record) }),
        });
      } catch (error) {
        const mapped = error?.name === "AgentActionContractError"
          ? agentConsoleError("action_contract_invalid", error.message, 400)
          : error?.name === "AgentActionEnforcementError"
            ? agentConsoleError("action_enforcement_failed", error.message, 502)
            : error instanceof HttpError
              ? error
              : agentConsoleError(
                  "action_outcome_unknown",
                  "Agent action execution ended without safely replayable terminal evidence.",
                  503,
                );
        await store.transact(async (state) => {
          const current = state.sessions[sessionId];
          assertOwned(current, callerId, operatorId);
          const action = current.actions[canonicalRequest.request_id];
          if (current.current_action_id !== canonicalRequest.request_id || action?.state !== "running") {
            throw agentConsoleError("action_binding_changed", "Active action binding changed before settlement.", 409);
          }
          action.state = "failed";
          action.failure_code = mapped.code;
          current.current_action_id = null;
          current.revision += 1;
          return null;
        });
        throw mapped;
      }
      await store.transact(async (state) => {
        const current = state.sessions[sessionId];
        assertOwned(current, callerId, operatorId);
        const action = current.actions[canonicalRequest.request_id];
        if (current.current_action_id !== canonicalRequest.request_id || action?.state !== "running") {
          throw agentConsoleError("action_binding_changed", "Active action binding changed before settlement.", 409);
        }
        action.state = "completed";
        action.outcome = structuredClone(outcome);
        current.latest_action_receipt_ref = {
          uri: `oos://agent-actions/receipts/${outcome.action_receipt.receipt_id.split(":", 2)[1]}`,
          digest: outcome.action_receipt.integrity.content_digest,
        };
        current.current_action_id = null;
        current.revision += 1;
        return null;
      });
      return outcome;
    },

    async closeSession({ callerId, operatorId, sessionId, expectedRevision, closedAt }) {
      assertOperatorBinding(operatorBindings, callerId, operatorId);
      return store.transact(async (state) => {
        const record = state.sessions[sessionId];
        assertOwned(record, callerId, operatorId);
        if (record.state === "closed") {
          if (
            record.closed_at === closedAt &&
            [record.revision, record.revision - 1].includes(expectedRevision)
          ) {
            return project(record);
          }
          throw agentConsoleError("close_replay_conflict", "Session close replay does not match the terminal record.", 409);
        }
        if (record.revision !== expectedRevision) {
          throw agentConsoleError("revision_conflict", "Agent Console session revision changed.", 409);
        }
        if (record.current_invocation_id || record.current_action_id) {
          throw agentConsoleError("session_busy", "Settle the active Agent Console operation before closing the session.", 409);
        }
        const latestCompletedAt = record.latest_invocation?.completed_at ?? record.request.opened_at;
        if (
          !closedAt ||
          Date.parse(closedAt) < Date.parse(latestCompletedAt) ||
          Date.parse(closedAt) > Date.parse(currentTime(clock))
        ) {
          throw agentConsoleError("timeline_invalid", "Session close time is invalid.", 400);
        }
        record.state = "closed";
        record.closed_at = closedAt;
        record.revision += 1;
        audit?.emit?.({ event_type: "agent-console.session.closed", outcome: "closed", session_id: sessionId, operator_id: operatorId });
        return project(record);
      });
    },
  };
}
