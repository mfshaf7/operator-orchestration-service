import {
  agentActionArtifactDigest,
  agentActionDecisionRef,
  agentActionRequestRef,
  assertAgentActionArtifact,
  assertAgentActionReference,
  sameAgentActionValue,
} from "./contracts.js";
import { canonicalDigest } from "../delivery-art/canonical-json.js";

const BASE_OBLIGATIONS = [
  "record-terminal-action-receipt",
  "require-current-source-version",
  "deny-raw-context-projection",
];
const MUTATE_OBLIGATIONS = [
  "require-exact-operator-approval",
  "require-owner-receipt-after-invocation",
];

export class AgentActionEnforcementError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "AgentActionEnforcementError";
    this.code = code;
  }
}

export class AgentActionOwnerNotInvokedError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "AgentActionOwnerNotInvokedError";
    this.code = code;
  }
}

export function createAgentActionEnforcer({
  audit = null,
  clock = () => new Date().toISOString(),
  evaluatorClient,
  recordReceipt,
} = {}) {
  if (typeof evaluatorClient?.evaluate !== "function") {
    throw new TypeError("evaluatorClient.evaluate is required");
  }
  if (typeof recordReceipt !== "function") {
    throw new TypeError("recordReceipt is required");
  }

  return {
    async execute({ execute, request, resolveCurrent }) {
      if (typeof resolveCurrent !== "function") {
        throw new TypeError("resolveCurrent is required");
      }
      if (typeof execute !== "function") {
        throw new TypeError("execute is required");
      }

      const canonicalRequest = assertAgentActionArtifact(
        "agent_action_request",
        request,
      );
      const acknowledgedAt = timestamp(clock());
      const initialCurrent = await resolveCurrent(canonicalRequest);
      const evaluation = await evaluatorClient.evaluate({
        current: initialCurrent,
        request: canonicalRequest,
      });
      const decision = assertAgentActionArtifact(
        "agent_action_policy_decision",
        evaluation.decision,
      );
      assertDecisionMatchesRequest(canonicalRequest, decision);

      if (decision.outcome !== "allow") {
        return finish({
          audit,
          decision,
          ownerReceipt: null,
          receipt: terminalReceipt({
            acknowledgedAt,
            backendExecutorId: "not-invoked",
            completedAt: timestamp(clock()),
            decision,
            failureCode: decision.outcome === "deny"
              ? "agent-action-policy-denied"
              : "agent-action-policy-review-required",
            mutationState: canonicalRequest.action_class === "mutate"
              ? "not-attempted"
              : "not-applicable",
            outcome: "denied",
            ownerReceiptRef: null,
            request: canonicalRequest,
            resultRef: null,
            startedAt: null,
            targetAfterVersion: null,
          }),
          recordReceipt,
        });
      }

      let dispatchTime = timestamp(clock());
      let currentFailure = decisionCurrentFailure(
        canonicalRequest,
        decision,
        dispatchTime,
      );
      if (currentFailure) {
        return finish({
          audit,
          decision,
          ownerReceipt: null,
          receipt: terminalReceipt({
            acknowledgedAt,
            backendExecutorId: "not-invoked",
            completedAt: timestamp(clock()),
            decision,
            failureCode: currentFailure,
            mutationState: canonicalRequest.action_class === "mutate"
              ? "not-attempted"
              : "not-applicable",
            outcome: "denied",
            ownerReceiptRef: null,
            request: canonicalRequest,
            resultRef: null,
            startedAt: null,
            targetAfterVersion: null,
          }),
          recordReceipt,
        });
      }
      const currentBeforeExecution = await resolveCurrent(canonicalRequest);
      dispatchTime = timestamp(clock());
      currentFailure = decisionCurrentFailure(
        canonicalRequest,
        decision,
        dispatchTime,
      );
      if (currentFailure) {
        return finish({
          audit,
          decision,
          ownerReceipt: null,
          receipt: terminalReceipt({
            acknowledgedAt,
            backendExecutorId: "not-invoked",
            completedAt: timestamp(clock()),
            decision,
            failureCode: currentFailure,
            mutationState: canonicalRequest.action_class === "mutate"
              ? "not-attempted"
              : "not-applicable",
            outcome: "denied",
            ownerReceiptRef: null,
            request: canonicalRequest,
            resultRef: null,
            startedAt: null,
            targetAfterVersion: null,
          }),
          recordReceipt,
        });
      }
      const driftCode = currentBindingDrift(
        canonicalRequest,
        currentBeforeExecution,
        dispatchTime,
      );
      if (driftCode) {
        return finish({
          audit,
          decision,
          ownerReceipt: null,
          receipt: terminalReceipt({
            acknowledgedAt,
            backendExecutorId: "not-invoked",
            completedAt: timestamp(clock()),
            decision,
            failureCode: driftCode,
            mutationState: canonicalRequest.action_class === "mutate"
              ? "not-attempted"
              : "not-applicable",
            outcome: "denied",
            ownerReceiptRef: null,
            request: canonicalRequest,
            resultRef: null,
            startedAt: null,
            targetAfterVersion: null,
          }),
          recordReceipt,
        });
      }

      const startedAt = timestamp(clock());
      let execution;
      try {
        execution = await execute({
          decision: structuredClone(decision),
          request: structuredClone(canonicalRequest),
        });
      } catch (error) {
        if (!(error instanceof AgentActionOwnerNotInvokedError)) {
          throw error;
        }
        return finish({
          audit,
          decision,
          ownerReceipt: null,
          receipt: terminalReceipt({
            acknowledgedAt,
            backendExecutorId: "not-invoked",
            completedAt: timestamp(clock()),
            decision,
            failureCode: error.code,
            mutationState: canonicalRequest.action_class === "mutate"
              ? "not-attempted"
              : "not-applicable",
            outcome: "failed",
            ownerReceiptRef: null,
            request: canonicalRequest,
            resultRef: null,
            startedAt,
            targetAfterVersion: null,
          }),
          recordReceipt,
        });
      }

      return finishExecution({
        acknowledgedAt,
        audit,
        completedAt: timestamp(clock()),
        decision,
        execution,
        recordReceipt,
        request: canonicalRequest,
        startedAt,
      });
    },
  };
}

async function finishExecution({
  acknowledgedAt,
  audit,
  completedAt,
  decision,
  execution,
  recordReceipt,
  request,
  startedAt,
}) {
  if (!execution || typeof execution !== "object" || Array.isArray(execution)) {
    throw new AgentActionEnforcementError(
      "agent_action_execution_result_invalid",
      "The admitted workflow returned an invalid execution result.",
    );
  }
  const backendExecutorId = nonEmptyString(
    execution.backend_executor_id,
    "backend_executor_id",
  );

  if (request.action_class !== "mutate") {
    const outcome = execution.outcome ?? "succeeded";
    if (!new Set(["succeeded", "failed", "cancelled"]).has(outcome)) {
      throw new AgentActionEnforcementError(
        "agent_action_execution_result_invalid",
        "The admitted workflow returned an unsupported outcome.",
      );
    }
    const resultRef = outcome === "succeeded"
      ? assertAgentActionReference(execution.result_ref, "result_ref")
      : null;
    const failureCode = outcome === "succeeded"
      ? null
      : nonEmptyString(execution.failure?.code, "failure.code");
    return finish({
      audit,
      decision,
      ownerReceipt: null,
      receipt: terminalReceipt({
        acknowledgedAt,
        backendExecutorId,
        completedAt,
        decision,
        failureCode,
        failureRetryable: execution.failure?.retryable === true,
        mutationState: "not-applicable",
        outcome,
        ownerReceiptRef: null,
        request,
        resultRef,
        startedAt,
        targetAfterVersion: null,
      }),
      recordReceipt,
    });
  }

  const ownerReceipt = assertAgentActionArtifact(
    "agent_action_owner_receipt",
    execution.owner_receipt,
  );
  const ownerReceiptRef = assertAgentActionReference(
    execution.owner_receipt_ref,
    "owner_receipt_ref",
  );
  assertOwnerReceiptMatches({ decision, ownerReceipt, ownerReceiptRef, request });
  const applied = ownerReceipt.mutation_outcome === "applied";
  return finish({
    audit,
    decision,
    ownerReceipt,
    receipt: terminalReceipt({
      acknowledgedAt,
      backendExecutorId,
      completedAt,
      decision,
      failureCode: applied ? null : ownerReceipt.failure.code,
      failureRetryable: applied ? false : ownerReceipt.failure.retryable,
      mutationState: ownerReceipt.mutation_outcome,
      outcome: applied ? "succeeded" : "failed",
      ownerReceiptRef,
      request,
      resultRef: ownerReceipt.result_ref,
      startedAt,
      targetAfterVersion: ownerReceipt.target.after_version,
    }),
    recordReceipt,
  });
}

async function finish({ audit, decision, ownerReceipt, receipt, recordReceipt }) {
  const validatedReceipt = assertAgentActionArtifact(
    "agent_action_receipt",
    receipt,
  );
  await recordReceipt(structuredClone(validatedReceipt));
  audit?.emit?.({
    action: "agent-action.execution.completed",
    action_class: validatedReceipt.action_class,
    decision_id: decision.decision_id,
    outcome: validatedReceipt.outcome,
    receipt_id: validatedReceipt.receipt_id,
    target: `${validatedReceipt.target.owner_repo}:${validatedReceipt.target.resource_id}`,
  });
  return {
    action_receipt: validatedReceipt,
    decision: structuredClone(decision),
    owner_receipt: ownerReceipt ? structuredClone(ownerReceipt) : null,
  };
}

function terminalReceipt({
  acknowledgedAt,
  backendExecutorId,
  completedAt,
  decision,
  failureCode,
  failureRetryable = false,
  mutationState,
  outcome,
  ownerReceiptRef,
  request,
  resultRef,
  startedAt,
  targetAfterVersion,
}) {
  const identity = {
    request_ref: agentActionRequestRef(request),
    decision_ref: agentActionDecisionRef(decision),
    action_class: request.action_class,
    outcome,
    execution: {
      workflow_execution_id: request.workflow.execution_id,
      backend_executor_id: backendExecutorId,
      acknowledged_at: acknowledgedAt,
      started_at: startedAt,
      completed_at: completedAt,
    },
    target: {
      owner_repo: request.target.owner_repo,
      resource_id: request.target.resource_id,
      before_version: request.target.source_version,
      after_version: targetAfterVersion,
    },
    approval_ref: request.action_class === "mutate"
      ? structuredClone(request.authority.approval_ref)
      : null,
    result_ref: resultRef ? structuredClone(resultRef) : null,
    owner_receipt_ref: ownerReceiptRef ? structuredClone(ownerReceiptRef) : null,
    mutation_state: mutationState,
    failure: failureCode
      ? { code: failureCode, retryable: failureRetryable }
      : null,
    correlation: structuredClone(request.correlation),
    idempotency_key: request.idempotency_key,
  };
  const token = canonicalDigest(identity).slice("sha256:".length).slice(0, 24);
  const receipt = {
    schema_version: 1,
    artifact_type: "agent_action_receipt",
    receipt_id: `agent-action-receipt:${token}`,
    ...identity,
    integrity: {
      canonicalization: "RFC8785",
      algorithm: "sha256",
      content_digest: "",
    },
  };
  receipt.integrity.content_digest = agentActionArtifactDigest(receipt);
  return receipt;
}

function assertDecisionMatchesRequest(request, decision) {
  const expectedRequestRef = agentActionRequestRef(request);
  if (
    !sameAgentActionValue(decision.request_ref, expectedRequestRef) ||
    decision.action_class !== request.action_class
  ) {
    throw new AgentActionEnforcementError(
      "agent_action_decision_request_mismatch",
      "The policy decision does not bind the exact action request.",
    );
  }

  const bindings = decision.bindings;
  const expected = {
    operator_principal_id: request.operator.principal_id,
    operator_session_ref: request.operator.session_ref,
    caller_workload_id: request.caller.workload_id,
    agent_instance_id: request.agent.instance_id,
    workflow_execution_id: request.workflow.execution_id,
    target_owner_repo: request.target.owner_repo,
    target_resource_id: request.target.resource_id,
    source_version: request.target.source_version,
    approval_ref: request.authority.approval_ref,
  };
  if (!sameAgentActionValue(bindings, expected)) {
    throw new AgentActionEnforcementError(
      "agent_action_decision_binding_mismatch",
      "The policy decision bindings do not match the action request.",
    );
  }

  const required = new Set([
    ...BASE_OBLIGATIONS,
    ...(request.action_class === "mutate" ? MUTATE_OBLIGATIONS : []),
  ]);
  if ([...required].some((entry) => !decision.obligations.includes(entry))) {
    throw new AgentActionEnforcementError(
      "agent_action_decision_obligation_missing",
      "The policy decision omits a required execution obligation.",
    );
  }
}

function decisionCurrentFailure(request, decision, now) {
  if (
    Date.parse(now) >= Date.parse(request.expires_at) ||
    (decision.expires_at && Date.parse(now) >= Date.parse(decision.expires_at))
  ) {
    return "agent-action-decision-expired";
  }
  return null;
}

function currentBindingDrift(request, current, now) {
  if (!current || typeof current !== "object" || Array.isArray(current)) {
    return "agent-action-current-bindings-unavailable";
  }
  const pairs = [
    [request.operator.principal_id, current.operator_principal_id],
    [request.operator.session_ref, current.operator_session_ref],
    [request.operator.acceptance_ref, current.operator_acceptance_ref],
    [request.caller.workload_id, current.caller_workload_id],
    [request.caller.credential_binding_ref, current.caller_credential_binding_ref],
    [request.agent.instance_id, current.agent_instance_id],
    [request.model_invocation_ref, current.model_invocation_ref],
    [request.workflow.workflow_id, current.workflow_id],
    [request.workflow.workflow_version, current.workflow_version],
    [request.target.owner_repo, current.target_owner_repo],
    [request.target.resource_id, current.target_resource_id],
    [request.target.source_version, current.source_version],
    [request.context.packet_ref, current.context_packet_ref],
    [request.context.receipt_ref, current.context_receipt_ref],
    [request.authority.delegation_ref, current.delegation_ref],
    [request.authority.policy_profile_ref, current.policy_profile_ref],
    [request.authority.approval_ref, current.approval_ref],
  ];
  if (pairs.some(([expected, actual]) => !sameAgentActionValue(expected, actual))) {
    return "agent-action-current-binding-changed";
  }
  if (!Array.isArray(current.admitted_commands) ||
      !current.admitted_commands.includes(request.workflow.command)) {
    return "agent-action-workflow-command-not-admitted";
  }
  if (
    request.action_class === "mutate"
  ) {
    const approvalExpiry = Date.parse(current.approval_expires_at ?? "");
    if (!Number.isFinite(approvalExpiry)) {
      return "agent-action-approval-expiry-invalid";
    }
    if (approvalExpiry <= Date.parse(now)) {
      return "agent-action-approval-expired";
    }
  }
  if (
    !Array.isArray(current.consumed_idempotency) ||
    current.consumed_idempotency.some(
      (entry) => entry?.idempotency_key === request.idempotency_key,
    )
  ) {
    return "agent-action-idempotency-unverified-or-consumed";
  }
  return null;
}

function assertOwnerReceiptMatches({
  decision,
  ownerReceipt,
  ownerReceiptRef,
  request,
}) {
  if (
    ownerReceiptRef.digest !== ownerReceipt.integrity.content_digest ||
    !sameAgentActionValue(ownerReceipt.request_ref, agentActionRequestRef(request)) ||
    !sameAgentActionValue(ownerReceipt.decision_ref, agentActionDecisionRef(decision)) ||
    ownerReceipt.owner.repo !== request.target.owner_repo ||
    ownerReceipt.target.resource_id !== request.target.resource_id ||
    ownerReceipt.target.before_version !== request.target.source_version ||
    ownerReceipt.idempotency_key !== request.idempotency_key
  ) {
    throw new AgentActionEnforcementError(
      "agent_action_owner_receipt_mismatch",
      "The owner receipt does not bind the exact admitted mutation.",
    );
  }
}

function nonEmptyString(value, fieldName) {
  if (typeof value !== "string" || !value.trim()) {
    throw new AgentActionEnforcementError(
      "agent_action_execution_result_invalid",
      `${fieldName} must be a non-empty string.`,
    );
  }
  return value.trim();
}

function timestamp(value) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new TypeError("clock must return a valid timestamp");
  }
  return parsed.toISOString();
}
