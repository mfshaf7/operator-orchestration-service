import { canonicalDigest } from "../delivery-art/canonical-json.js";
import { HttpError } from "../errors.js";
import {
  artifactReference,
  assertRepositoryCustodyDecision,
  assertRepositoryCustodyReceipt,
  assertRepositoryCustodyRequest,
  assertRepositoryCustodyWorkflowResult,
  assertRepositoryProviderReadback,
  repositoryCustodyAuthority,
  withArtifactIntegrity,
} from "./contracts.js";
import { RepositoryCustodyStoreError } from "./store.js";

function tokenFor(request) {
  return canonicalDigest({
    request_id: request.request_id,
    request_digest: request.request_digest,
  }).slice(7, 31);
}

function readbackReference(readback) {
  const digest = readback.integrity.content_digest;
  return artifactReference(
    `oos://readbacks/repository-provider/${readback.readback_id.split(":").at(-1)}-${digest.slice(7)}.json`,
    readback,
  );
}

function receiptReference(receipt) {
  const digest = receipt.integrity.content_digest;
  return artifactReference(
    `oos://receipts/repository-custody/${receipt.receipt_id.split(":").at(-1)}-${digest.slice(7)}.json`,
    receipt,
  );
}

function failureDetails({ code, message, retryable }) {
  return {
    code,
    message,
    retryable,
  };
}

function decisionFailureMessage(decision) {
  const message = decision.findings
    .map((finding) => finding.summary.trim())
    .filter(Boolean)
    .join(" ");
  return message || "Repository custody readiness denied the request.";
}

function resultRecord({
  decision = null,
  decisionRef = null,
  failure = null,
  providerReadback = null,
  receipt = null,
  request,
  status,
}) {
  return {
    schema_version: 1,
    workflow_id: "repository-custody",
    workflow_version: "1",
    execution_id: request.workflow.execution_id,
    request,
    status,
    replayed: false,
    retryable: failure?.retryable === true,
    decision,
    decision_ref: decisionRef,
    provider_readback: providerReadback,
    provider_readback_ref: providerReadback ? readbackReference(providerReadback) : null,
    receipt,
    receipt_ref: receipt ? receiptReference(receipt) : null,
    failure,
    next_action: status === "succeeded"
      ? "complete"
      : status === "failed" && failure?.retryable === true
        ? "retry-provider"
        : "request-correction",
  };
}

function custodyReceipt({
  clock,
  decisionRef,
  findings,
  outcome,
  providerReadback,
  request,
}) {
  const succeeded = outcome === "succeeded";
  const readbackRef = providerReadback ? readbackReference(providerReadback) : null;
  return assertRepositoryCustodyReceipt(withArtifactIntegrity({
    schema_version: 1,
    artifact_type: "repository_custody_receipt",
    receipt_id: `repository-custody-receipt:${tokenFor(request)}`,
    request_ref: {
      uri: `wgcf://requests/repository-custody/${request.request_digest.slice(7)}.json`,
      digest: request.request_digest,
    },
    decision_ref: decisionRef,
    provider_readback_ref: readbackRef,
    completed_at: clock().toISOString(),
    action: request.action,
    outcome,
    repository_identity: succeeded ? providerReadback.repository_identity : null,
    custody: {
      before: "unrecorded",
      after: succeeded ? "linked" : "unrecorded",
      workspace_owner_ref: request.requested_custody.workspace_owner_ref,
    },
    workflow_status: outcome,
    findings,
    downstream_handoffs: {
      workspace_intake: succeeded ? "request-available" : "not-requested",
      active_inventory: succeeded ? "separate-action-required" : "not-requested",
      delivery_catalog: succeeded ? "separate-action-required" : "not-requested",
      product_admission: succeeded ? "separate-action-required" : "not-requested",
    },
  }));
}

function validateStored(record) {
  const request = assertRepositoryCustodyRequest(record?.request);
  if (record.decision) assertRepositoryCustodyDecision(record.decision);
  if (record.provider_readback) {
    assertRepositoryProviderReadback(record.provider_readback);
  }
  if (record.receipt) assertRepositoryCustodyReceipt(record.receipt);
  const decisionDigest = record.decision?.integrity.content_digest;
  const readbackDigest = record.provider_readback?.integrity.content_digest;
  const receiptDigest = record.receipt?.integrity.content_digest;
  const expectedReadbackRef = record.provider_readback
    ? readbackReference(record.provider_readback)
    : null;
  const expectedReceiptRef = record.receipt ? receiptReference(record.receipt) : null;
  if (
    record.execution_id !== request.workflow.execution_id ||
    (["succeeded", "denied", "failed"].includes(record.status) && !record.receipt) ||
    record.decision_ref?.digest !== decisionDigest ||
    record.receipt?.request_ref.digest !== request.request_digest ||
    record.receipt?.decision_ref.digest !== decisionDigest ||
    record.receipt?.decision_ref.uri !== record.decision_ref?.uri ||
    record.receipt?.outcome !== record.status ||
    record.receipt?.workflow_status !== record.status ||
    record.receipt_ref?.digest !== receiptDigest ||
    record.receipt_ref?.uri !== expectedReceiptRef?.uri ||
    record.provider_readback_ref?.digest !== readbackDigest ||
    record.provider_readback_ref?.uri !== expectedReadbackRef?.uri ||
    record.receipt?.provider_readback_ref?.digest !== readbackDigest ||
    record.receipt?.provider_readback_ref?.uri !== expectedReadbackRef?.uri ||
    (record.status === "succeeded" && record.failure !== null) ||
    (record.status !== "succeeded" && record.failure === null)
  ) {
    throw new HttpError(
      503,
      "repository_custody_state_invalid",
      "Stored repository custody state failed integrity validation.",
    );
  }
  return assertRepositoryCustodyWorkflowResult(record);
}

function storeFailure(error) {
  if (!(error instanceof RepositoryCustodyStoreError)) throw error;
  const statusCode = error.code === "repository_custody_idempotency_conflict" ? 409 : 503;
  throw new HttpError(statusCode, error.code, error.message);
}

function assertAllowedDecisionIdentity(decision, request) {
  if (
    decision.outcome !== "allowed" ||
    decision.next_action !== "read-provider" ||
    decision.resolved_identity?.provider !== request.target.provider ||
    decision.resolved_identity?.provider_repository_id !==
      request.target.provider_repository_id
  ) {
    throw new HttpError(
      409,
      "repository_custody_decision_mismatch",
      "WGCF did not authorize provider readback for the exact repository identity.",
    );
  }
}

export function createRepositoryCustodyService({
  audit,
  clock = () => new Date(),
  providerClient,
  readinessClient,
  store,
}) {
  async function project(requestId) {
    let record;
    try {
      record = store.get(requestId);
    } catch (error) {
      storeFailure(error);
    }
    if (!record) {
      throw new HttpError(
        404,
        "repository_custody_request_not_found",
        "Repository custody request was not found.",
      );
    }
    return { ...validateStored(record), replayed: true };
  }

  return {
    project,

    async link({ callerId, input }) {
      const request = assertRepositoryCustodyRequest(input);
      if (request.action !== "link-existing") {
        throw new HttpError(
          409,
          "repository_custody_action_not_active",
          "Only existing-repository linkage is active in this workflow.",
        );
      }
      let existing;
      try {
        existing = store.get(request.request_id);
      } catch (error) {
        storeFailure(error);
      }
      if (existing) {
        if (existing.request.request_digest !== request.request_digest) {
          throw new HttpError(
            409,
            "repository_custody_idempotency_conflict",
            "Repository custody request id is already bound to different content.",
          );
        }
        if (existing.retryable !== true) {
          return { ...validateStored(existing), replayed: true };
        }
      }

      const authority = repositoryCustodyAuthority();
      if (
        request.authority.policy_profile_ref.uri !== authority.uri ||
        request.authority.policy_profile_ref.digest !== authority.digest
      ) {
        throw new HttpError(
          409,
          "repository_custody_policy_stale",
          "Repository custody request is not bound to the current authority.",
        );
      }

      const readiness = await readinessClient.evaluate(request);
      let record;
      if (readiness.decision.outcome !== "allowed") {
        const message = decisionFailureMessage(readiness.decision);
        const failure = failureDetails({
          code: "repository_custody_denied",
          message,
          retryable: false,
        });
        const receipt = custodyReceipt({
          clock,
          decisionRef: readiness.decisionRef,
          findings: [message],
          outcome: "denied",
          providerReadback: null,
          request,
        });
        record = resultRecord({
          decision: readiness.decision,
          decisionRef: readiness.decisionRef,
          failure,
          receipt,
          request,
          status: "denied",
        });
      } else {
        assertAllowedDecisionIdentity(readiness.decision, request);
        let readback;
        try {
          readback = await providerClient.read(request);
        } catch (error) {
          const failure = failureDetails({
            code: error?.code ?? "repository_provider_unavailable",
            message: error?.message ?? "Repository provider readback failed.",
            retryable: error?.statusCode >= 500,
          });
          const receipt = custodyReceipt({
            clock,
            decisionRef: readiness.decisionRef,
            findings: [failure.message],
            outcome: "failed",
            providerReadback: null,
            request,
          });
          record = resultRecord({
            decision: readiness.decision,
            decisionRef: readiness.decisionRef,
            failure,
            receipt,
            request,
            status: "failed",
          });
        }
        if (readback) {
          if (
            readback.request_ref.digest !== request.request_digest ||
            readback.repository_identity.provider !== request.target.provider ||
            readback.repository_identity.provider_repository_id !==
              request.target.provider_repository_id ||
            readback.provider_lifecycle_state !== "active"
          ) {
            const failure = failureDetails({
              code: "repository_provider_readback_stale",
              message: "Provider readback is stale, unavailable, or mismatched.",
              retryable: false,
            });
            const receipt = custodyReceipt({
              clock,
              decisionRef: readiness.decisionRef,
              findings: [failure.message],
              outcome: "failed",
              providerReadback: readback,
              request,
            });
            record = resultRecord({
              decision: readiness.decision,
              decisionRef: readiness.decisionRef,
              failure,
              providerReadback: readback,
              receipt,
              request,
              status: "failed",
            });
          } else {
            const receipt = custodyReceipt({
              clock,
              decisionRef: readiness.decisionRef,
              findings: [
                "WGCF readiness allowed the exact request.",
                "Provider readback matched the immutable repository identity.",
                "Repository custody was linked without downstream admission mutation.",
              ],
              outcome: "succeeded",
              providerReadback: readback,
              request,
            });
            record = resultRecord({
              decision: readiness.decision,
              decisionRef: readiness.decisionRef,
              providerReadback: readback,
              receipt,
              request,
              status: "succeeded",
            });
          }
        }
      }

      let persisted;
      try {
        persisted = store.put(record, { replaceRetryable: existing?.retryable === true });
      } catch (error) {
        storeFailure(error);
      }
      audit?.emit({
        actor: callerId,
        correlation_id: request.correlation.correlation_id,
        event_type: "repository.custody.workflow.completed",
        outcome: persisted.status,
        request_id: request.request_id,
        repository_identity: request.target.provider_repository_id,
        receipt_ref: persisted.receipt_ref?.uri,
      });
      return validateStored(persisted);
    },
  };
}
