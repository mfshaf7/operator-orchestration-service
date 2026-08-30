import { canonicalDigest } from "../delivery-art/canonical-json.js";
import { HttpError } from "../errors.js";
import {
  assertRepositoryLifecycleAudit,
  assertRepositoryLifecycleDecision,
  assertRepositoryLifecycleReceipt,
  assertRepositoryLifecycleRequest,
  assertRepositoryLifecycleWorkflowResult,
  lifecycleArtifactReference,
  repositoryLifecycleAuthority,
  withRepositoryLifecycleIntegrity,
} from "./contracts.js";
import { RepositoryLifecycleStoreError } from "./store.js";

const PROVIDER_ACTIONS = new Set(["archive-provider", "unarchive-provider"]);
const COMMAND_BY_ACTION = Object.freeze({
  "transfer-workspace-custody": "apply-workspace-custody",
  "archive-provider": "archive-provider",
  "unarchive-provider": "unarchive-provider",
  "retire-workspace-record": "retire-workspace-record",
  "restore-workspace-record": "restore-workspace-record",
});

const same = (left, right) => canonicalDigest(left) === canonicalDigest(right);
const requestRef = (request) => ({
  uri: `wgcf://requests/repository-lifecycle/${request.request_digest.slice(7)}.json`,
  digest: request.request_digest,
});
const providerRef = (readback) => readback
  ? lifecycleArtifactReference(
      `oos://readbacks/repository-lifecycle/${readback.readback_id.split(":").at(-1)}-${readback.integrity.content_digest.slice(7)}.json`,
      readback,
    )
  : null;
const receiptRef = (receipt) => lifecycleArtifactReference(
  `oos://receipts/repository-lifecycle/${receipt.receipt_id.split(":").at(-1)}-${receipt.integrity.content_digest.slice(7)}.json`,
  receipt,
);

function storeFailure(error) {
  if (!(error instanceof RepositoryLifecycleStoreError)) throw error;
  throw new HttpError(
    error.code === "repository_lifecycle_idempotency_conflict" ? 409 : 503,
    error.code,
    error.message,
  );
}

function assertAuthority(request) {
  const authority = repositoryLifecycleAuthority();
  if (
    request.authority.policy_profile_ref.uri !== authority.uri ||
    request.authority.policy_profile_ref.digest !== authority.digest
  ) {
    throw new HttpError(
      409,
      "repository_lifecycle_policy_stale",
      "Repository lifecycle request is not bound to the current authority.",
    );
  }
}

function assertAllowedDecision(decision, request) {
  const expectedGates = {
    "transfer-workspace-custody": ["exact-operator-approval", "source-owner-acceptance", "target-owner-acceptance"],
    "archive-provider": ["exact-operator-approval", "governed-provider-credential-binding"],
    "unarchive-provider": ["exact-operator-approval", "governed-provider-credential-binding"],
    "retire-workspace-record": ["exact-operator-approval"],
    "restore-workspace-record": ["exact-operator-approval"],
  }[request.action];
  if (
    decision.outcome !== "allowed" ||
    decision.action !== request.action ||
    decision.request_ref.digest !== request.request_digest ||
    decision.next_action !== COMMAND_BY_ACTION[request.action] ||
    !same(decision.current_state, request.current_state) ||
    !same(decision.approved_target, request.target) ||
    !same(decision.required_human_gates, expectedGates) ||
    decision.impact.downstream_mutation !== "none" ||
    decision.impact.impact_assessment_ref.digest !== request.impact.impact_assessment_ref.digest
  ) {
    throw new HttpError(
      409,
      "repository_lifecycle_decision_mismatch",
      "WGCF did not authorize the exact lifecycle request, target, impact, and gates.",
    );
  }
}

function operationFor(request, existing = null) {
  return {
    command: COMMAND_BY_ACTION[request.action],
    state: "not-started",
    attempt_count: existing?.operation?.attempt_count ?? 0,
    completion_path: null,
  };
}

function afterState(request, current, providerReadback = null) {
  const after = structuredClone(current);
  if (request.action === "transfer-workspace-custody") {
    after.workspace_owner_ref = request.target.workspace_owner_ref;
    after.custody_version = `oos-${request.request_digest.slice(7, 23)}`;
  } else if (request.action === "retire-workspace-record") {
    after.workspace_record_state = "retired";
    after.custody_version = `oos-${request.request_digest.slice(7, 23)}`;
  } else if (request.action === "restore-workspace-record") {
    after.workspace_record_state = "active";
    after.custody_version = `oos-${request.request_digest.slice(7, 23)}`;
  } else {
    after.provider_lifecycle_state = request.target.provider_lifecycle_state;
    after.provider_version = providerReadback.provider_version;
  }
  return after;
}

function failure(code, message, retryable) {
  return { code, message, retryable };
}

function terminalArtifacts({
  aggregate,
  clock,
  decision,
  decisionRef,
  failureValue,
  operation,
  outcome,
  providerReadback,
  request,
  stateAfter,
}) {
  const completedAt = clock().toISOString();
  const historyEventRef = {
    uri: `oos://events/repository-lifecycle/${request.request_id.split(":").at(-1)}-${operation.attempt_count}.json`,
    digest: canonicalDigest({
      action: request.action,
      attempt_count: operation.attempt_count,
      completed_at: completedAt,
      decision_digest: decision.integrity.content_digest,
      outcome,
      request_digest: request.request_digest,
    }),
  };
  const receipt = assertRepositoryLifecycleReceipt(withRepositoryLifecycleIntegrity({
    schema_version: 1,
    artifact_type: "repository_lifecycle_receipt",
    receipt_id: `repository-lifecycle-receipt:${request.request_id.split(":").at(-1)}:${operation.attempt_count}`,
    request_ref: requestRef(request),
    decision_ref: decisionRef,
    provider_readback_ref: providerRef(providerReadback),
    completed_at: completedAt,
    action: request.action,
    outcome,
    repository_identity: structuredClone(request.repository_identity),
    before: structuredClone(decision.current_state),
    after: structuredClone(stateAfter),
    impact_assessment_ref: structuredClone(request.impact.impact_assessment_ref),
    blocker_disposition: structuredClone(request.impact.blocker_disposition),
    confirmations: {
      operator_approval_ref: structuredClone(request.authority.approval_ref),
      source_owner_acceptance_ref: structuredClone(request.authority.source_owner_acceptance_ref),
      target_owner_acceptance_ref: structuredClone(request.authority.target_owner_acceptance_ref),
      provider_credential_binding_ref: structuredClone(request.authority.provider_credential_binding_ref),
    },
    reversal_of_receipt_ref: structuredClone(request.reversal_of_receipt_ref),
    history_event_ref: historyEventRef,
    downstream_mutation: "none",
    workflow_status: outcome,
    findings: failureValue
      ? [failureValue.message]
      : ["WGCF authorized the exact lifecycle action and the resulting state was read back."],
  }));
  const reference = receiptRef(receipt);
  const history = [
    ...(aggregate?.history ?? []),
    {
      action: request.action,
      outcome,
      completed_at: completedAt,
      receipt_ref: reference,
      reversal_of_receipt_ref: structuredClone(request.reversal_of_receipt_ref),
    },
  ];
  const nextAggregate = {
    repository_identity: structuredClone(request.repository_identity),
    current_state: structuredClone(stateAfter),
    impact_summary: {
      latest_assessment_ref: structuredClone(request.impact.impact_assessment_ref),
      finding_count: request.impact.finding_count,
      blocking_finding_count: request.impact.blocking_finding_count,
      blocker_disposition: request.impact.blocker_disposition?.decision ?? null,
    },
    latest_terminal_receipt_ref: reference,
    history,
  };
  const audit = assertRepositoryLifecycleAudit(withRepositoryLifecycleIntegrity({
    schema_version: 1,
    artifact_type: "repository_lifecycle_audit",
    audit_id: `repository-lifecycle-audit:${request.repository_identity.provider}:${request.repository_identity.provider_repository_id}`,
    projected_at: completedAt,
    source_authority: "operator-orchestration-service",
    mutation: false,
    ...structuredClone(nextAggregate),
  }));
  return { audit, nextAggregate, receipt, receiptReference: reference };
}

function workflowResult({
  audit = null,
  decision,
  decisionRef,
  failureValue = null,
  operation,
  providerReadback = null,
  receipt = null,
  request,
  state,
  status,
}) {
  return assertRepositoryLifecycleWorkflowResult({
    schema_version: 1,
    workflow_id: "repository-lifecycle",
    workflow_version: "1",
    execution_id: request.workflow.execution_id,
    request,
    status,
    replayed: false,
    retryable: failureValue?.retryable === true,
    decision,
    decision_ref: decisionRef,
    operation,
    provider_readback: providerReadback,
    provider_readback_ref: providerRef(providerReadback),
    current_state: state,
    receipt,
    receipt_ref: receipt ? receiptRef(receipt) : null,
    audit,
    failure: failureValue,
    next_action: status === "applying"
      ? PROVIDER_ACTIONS.has(request.action) ? "await-provider" : "await-workspace"
      : status === "succeeded" ? "complete"
      : failureValue?.retryable ? "retry"
      : "request-correction",
  });
}

function validateStored(record) {
  const result = assertRepositoryLifecycleWorkflowResult(record);
  assertRepositoryLifecycleRequest(result.request);
  assertRepositoryLifecycleDecision(result.decision);
  if (result.receipt) assertRepositoryLifecycleReceipt(result.receipt);
  if (result.audit) assertRepositoryLifecycleAudit(result.audit);
  if (
    result.decision.request_ref.digest !== result.request.request_digest ||
    result.decision_ref.digest !== result.decision.integrity.content_digest ||
    result.receipt_ref?.digest !== result.receipt?.integrity.content_digest ||
    (result.receipt_ref?.uri ?? null) !== (result.receipt ? receiptRef(result.receipt).uri : null) ||
    result.provider_readback_ref?.digest !== result.provider_readback?.integrity.content_digest ||
    (result.provider_readback_ref?.uri ?? null) !== (result.provider_readback ? providerRef(result.provider_readback).uri : null) ||
    result.receipt?.decision_ref.digest !== result.decision_ref.digest ||
    result.receipt?.request_ref.digest !== result.request.request_digest
  ) {
    throw new HttpError(503, "repository_lifecycle_state_invalid", "Stored lifecycle state failed integrity validation.");
  }
  return result;
}

export function createRepositoryLifecycleService({
  audit,
  clock = () => new Date(),
  providerClient,
  readinessClient,
  store,
}) {
  async function project(requestId) {
    try {
      const record = store.getRequest(requestId);
      if (!record) throw new HttpError(404, "repository_lifecycle_request_not_found", "Repository lifecycle request was not found.");
      return { ...validateStored(record), replayed: true };
    } catch (error) { storeFailure(error); }
  }

  async function projectRepository(identity) {
    try {
      const aggregate = store.getRepository(identity);
      if (!aggregate?.audit) {
        throw new HttpError(404, "repository_lifecycle_repository_not_found", "Repository lifecycle projection was not found.");
      }
      return assertRepositoryLifecycleAudit(aggregate.audit);
    } catch (error) { storeFailure(error); }
  }

  async function execute({ callerId, input }) {
    const request = assertRepositoryLifecycleRequest(input);
    assertAuthority(request);
    try {
      return await store.transact(request, async ({ aggregate, currentRequest, putAggregate, putRequest }) => {
        const existing = currentRequest ? validateStored(currentRequest) : null;
        if (existing && existing.status !== "applying" && existing.retryable !== true) {
          return { ...existing, replayed: true };
        }
        const readiness = await readinessClient.evaluate(request);
        const decision = assertRepositoryLifecycleDecision(readiness.decision);
        const decisionRef = readiness.decisionRef;
        const operation = operationFor(request, existing);
        const baseline = aggregate?.current_state ?? decision.current_state;

        if (decision.outcome !== "allowed") {
          if (!same(decision.current_state, request.current_state)) {
            throw new HttpError(409, "repository_lifecycle_decision_mismatch", "WGCF decision does not match current request state.");
          }
          const failureValue = failure(
            decision.outcome === "denied" ? "repository_lifecycle_denied" : "repository_lifecycle_correction_required",
            decision.findings.map((item) => item.summary).join(" ") || "Lifecycle request requires correction.",
            false,
          );
          const terminal = terminalArtifacts({
            aggregate,
            clock,
            decision,
            decisionRef,
            failureValue,
            operation,
            outcome: "denied",
            providerReadback: null,
            request,
            stateAfter: baseline,
          });
          const result = workflowResult({
            audit: terminal.audit,
            decision,
            decisionRef,
            failureValue,
            operation,
            receipt: terminal.receipt,
            request,
            state: baseline,
            status: "denied",
          });
          putAggregate({ ...terminal.nextAggregate, audit: terminal.audit });
          putRequest(result);
          return result;
        }

        assertAllowedDecision(decision, request);
        if (!same(baseline, decision.current_state)) {
          throw new HttpError(409, "repository_lifecycle_state_stale", "Persisted lifecycle state no longer matches the approved request.");
        }

        const applyingOperation = {
          ...operation,
          attempt_count: operation.attempt_count + 1,
          state: "command-issued",
        };
        putRequest(workflowResult({
          decision,
          decisionRef,
          operation: applyingOperation,
          request,
          state: baseline,
          status: "applying",
        }));

        let providerReadback = null;
        let stateAfter;
        let completionPath = "workspace";
        try {
          if (PROVIDER_ACTIONS.has(request.action)) {
            const observed = await providerClient.read(request);
            const targetProviderState = request.target.provider_lifecycle_state;
            if (
              existing !== null &&
              observed.provider_lifecycle_state === targetProviderState
            ) {
              providerReadback = observed;
              completionPath = "recovered";
            } else {
              if (
                observed.provider_lifecycle_state !== baseline.provider_lifecycle_state ||
                observed.provider_version !== baseline.provider_version
              ) {
                throw new HttpError(409, "repository_lifecycle_state_stale", "Fresh provider truth no longer matches the approved state and version.");
              }
              providerReadback = await providerClient.setArchived(
                request,
                request.action === "archive-provider",
              );
              if (providerReadback.provider_lifecycle_state !== targetProviderState) {
                throw new HttpError(409, "repository_provider_readback_stale", "Provider mutation readback did not match the approved lifecycle target.");
              }
            }
            stateAfter = afterState(request, baseline, providerReadback);
            completionPath = completionPath === "recovered" ? completionPath : "provider";
          } else {
            stateAfter = afterState(request, baseline);
            if (existing !== null && same(aggregate?.current_state, stateAfter)) {
              completionPath = "recovered";
            }
          }
        } catch (error) {
          const failureValue = failure(
            error?.code ?? "repository_lifecycle_operation_failed",
            error?.message ?? "Repository lifecycle operation failed.",
            error?.statusCode >= 500,
          );
          const terminal = terminalArtifacts({
            aggregate,
            clock,
            decision,
            decisionRef,
            failureValue,
            operation: { ...applyingOperation, state: failureValue.retryable ? "recovery-required" : "command-issued" },
            outcome: "failed",
            providerReadback,
            request,
            stateAfter: baseline,
          });
          const result = workflowResult({
            audit: terminal.audit,
            decision,
            decisionRef,
            failureValue,
            operation: { ...applyingOperation, state: failureValue.retryable ? "recovery-required" : "command-issued" },
            providerReadback,
            receipt: terminal.receipt,
            request,
            state: baseline,
            status: "failed",
          });
          putAggregate({ ...terminal.nextAggregate, audit: terminal.audit });
          putRequest(result);
          return result;
        }

        const completedOperation = {
          ...applyingOperation,
          completion_path: completionPath,
          state: PROVIDER_ACTIONS.has(request.action) ? "verified" : "workspace-acknowledged",
        };
        const terminal = terminalArtifacts({
          aggregate,
          clock,
          decision,
          decisionRef,
          failureValue: null,
          operation: completedOperation,
          outcome: "succeeded",
          providerReadback,
          request,
          stateAfter,
        });
        const result = workflowResult({
          audit: terminal.audit,
          decision,
          decisionRef,
          operation: completedOperation,
          providerReadback,
          receipt: terminal.receipt,
          request,
          state: stateAfter,
          status: "succeeded",
        });
        putAggregate({ ...terminal.nextAggregate, audit: terminal.audit });
        putRequest(result);
        audit?.emit({
          actor: callerId,
          correlation_id: request.correlation.correlation_id,
          event_type: "repository.lifecycle.workflow.completed",
          outcome: result.status,
          request_id: request.request_id,
          repository_identity: `${request.repository_identity.provider}:${request.repository_identity.provider_repository_id}`,
          receipt_ref: result.receipt_ref.uri,
        });
        return result;
      });
    } catch (error) { storeFailure(error); }
  }

  return { execute, project, projectRepository };
}
