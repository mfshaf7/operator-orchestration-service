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
  return { code, message, retryable };
}

function decisionFailureMessage(decision) {
  const message = decision.findings
    .map((finding) => finding.summary.trim())
    .filter(Boolean)
    .join(" ");
  return message || "Repository custody readiness denied the request.";
}

function providerOperation({
  attemptCount = 0,
  command,
  completionPath = null,
  providerRepositoryId = null,
  state = "not-started",
}) {
  return {
    command,
    state,
    attempt_count: attemptCount,
    completion_path: completionPath,
    provider_repository_id: providerRepositoryId,
  };
}

function resultRecord({
  decision,
  decisionRef,
  failure = null,
  operation,
  providerReadback = null,
  receipt = null,
  request,
  status,
}) {
  return assertRepositoryCustodyWorkflowResult({
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
    provider_operation: operation,
    provider_readback: providerReadback,
    provider_readback_ref: providerReadback ? readbackReference(providerReadback) : null,
    receipt,
    receipt_ref: receipt ? receiptReference(receipt) : null,
    failure,
    next_action: status === "applying"
      ? "await-provider"
      : status === "succeeded"
        ? "complete"
        : status === "failed" && failure?.retryable === true
          ? "retry-provider"
          : "request-correction",
  });
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
  const after = succeeded
    ? request.action === "provision-new"
      ? "provisioned"
      : "linked"
    : "unrecorded";
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
      after,
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
  const decision = assertRepositoryCustodyDecision(record?.decision);
  if (record.provider_readback) {
    assertRepositoryProviderReadback(record.provider_readback);
  }
  if (record.receipt) assertRepositoryCustodyReceipt(record.receipt);
  const decisionDigest = decision.integrity.content_digest;
  const readbackDigest = record.provider_readback?.integrity.content_digest;
  const receiptDigest = record.receipt?.integrity.content_digest;
  const expectedReadbackRef = record.provider_readback
    ? readbackReference(record.provider_readback)
    : null;
  const expectedReceiptRef = record.receipt ? receiptReference(record.receipt) : null;
  const terminal = ["succeeded", "denied", "failed"].includes(record.status);
  if (
    record.execution_id !== request.workflow.execution_id ||
    decision.request_ref.digest !== request.request_digest ||
    decision.action !== request.action ||
    (terminal && !record.receipt) ||
    (!terminal && record.receipt !== null) ||
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
    (["denied", "failed"].includes(record.status) && record.failure === null) ||
    (record.status === "applying" && record.failure !== null)
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

function exactMatch(left, right) {
  return canonicalDigest(left) === canonicalDigest(right);
}

function assertAllowedDecision(decision, request) {
  if (
    decision.outcome !== "allowed" ||
    decision.action !== request.action ||
    decision.request_ref.digest !== request.request_digest
  ) {
    throw new HttpError(
      409,
      "repository_custody_decision_mismatch",
      "WGCF did not authorize the exact repository custody request.",
    );
  }
  if (request.action === "link-existing") {
    if (
      decision.next_action !== "read-provider" ||
      decision.approved_provisioning !== null ||
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
    return;
  }
  const expectedProvisioning = {
    provider: request.target.provider,
    provider_host: request.target.provider_host,
    owner: request.target.owner,
    owner_scope: request.target.owner_scope,
    name: request.target.name,
    settings: request.provisioning,
  };
  if (
    decision.next_action !== "create-provider" ||
    decision.resolved_identity !== null ||
    !exactMatch(decision.approved_provisioning, expectedProvisioning)
  ) {
    throw new HttpError(
      409,
      "repository_custody_decision_mismatch",
      "WGCF did not authorize the exact provider target and provisioning settings.",
    );
  }
}

function readbackMatches(request, readback) {
  if (
    readback.request_ref.digest !== request.request_digest ||
    readback.action !== request.action ||
    readback.repository_identity.provider !== request.target.provider ||
    readback.provider_lifecycle_state !== "active"
  ) {
    return false;
  }
  if (request.action === "link-existing") {
    return readback.repository_identity.provider_repository_id ===
      request.target.provider_repository_id;
  }
  return (
    readback.canonical_owner.toLowerCase() === request.target.owner.toLowerCase() &&
    readback.canonical_name.toLowerCase() === request.target.name.toLowerCase() &&
    readback.applied_provisioning?.owner_scope === "organization" &&
    readback.applied_provisioning?.initialization_state === "initialized" &&
    exactMatch(readback.applied_provisioning?.settings, request.provisioning)
  );
}

function providerFailureRecord({
  clock,
  decision,
  decisionRef,
  error,
  operation,
  providerReadback = null,
  request,
}) {
  const failure = failureDetails({
    code: error?.code ?? "repository_provider_unavailable",
    message: error?.message ?? "Repository provider operation failed.",
    retryable: error?.statusCode >= 500,
  });
  const receipt = custodyReceipt({
    clock,
    decisionRef,
    findings: [failure.message],
    outcome: "failed",
    providerReadback,
    request,
  });
  return resultRecord({
    decision,
    decisionRef,
    failure,
    operation,
    providerReadback,
    receipt,
    request,
    status: "failed",
  });
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

  async function execute({ callerId, input }) {
    const request = assertRepositoryCustodyRequest(input);
    if (!["link-existing", "provision-new"].includes(request.action)) {
      throw new HttpError(
        409,
        "repository_custody_action_not_active",
        "Only existing-repository linkage and organization repository provisioning are supported.",
      );
    }

    try {
      return await store.transact(request.request_id, async ({ current, put }) => {
        if (current?.request?.request_digest !== undefined &&
            current.request.request_digest !== request.request_digest) {
          throw new HttpError(
            409,
            "repository_custody_idempotency_conflict",
            "Repository custody request id is already bound to different content.",
          );
        }
        const existing = current ? validateStored(current) : null;
        if (existing && existing.status !== "applying" && existing.retryable !== true) {
          return { ...existing, replayed: true };
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
            operation: existing?.provider_operation ?? providerOperation({
              command: request.action === "provision-new"
                ? "create-provider"
                : "read-provider",
            }),
            receipt,
            request,
            status: "denied",
          });
        } else {
          assertAllowedDecision(readiness.decision, request);
          record = request.action === "provision-new"
            ? await provision({
                clock,
                decision: readiness.decision,
                decisionRef: readiness.decisionRef,
                existing,
                providerClient,
                put,
                request,
              })
            : await linkExisting({
                clock,
                decision: readiness.decision,
                decisionRef: readiness.decisionRef,
                existing,
                providerClient,
                put,
                request,
              });
        }

        const persisted = put(record, { replaceMutable: true });
        audit?.emit({
          actor: callerId,
          correlation_id: request.correlation.correlation_id,
          event_type: "repository.custody.workflow.completed",
          outcome: persisted.status,
          request_id: request.request_id,
          repository_identity:
            persisted.provider_readback?.repository_identity.provider_repository_id ??
            request.target.provider_repository_id,
          receipt_ref: persisted.receipt_ref?.uri,
        });
        return validateStored(persisted);
      });
    } catch (error) {
      storeFailure(error);
    }
  }

  return {
    execute,
    project,
  };
}

async function linkExisting({
  clock,
  decision,
  decisionRef,
  existing,
  providerClient,
  put,
  request,
}) {
  const attemptCount = (existing?.provider_operation.attempt_count ?? 0) + 1;
  const operation = providerOperation({
    attemptCount,
    command: "read-provider",
    providerRepositoryId: request.target.provider_repository_id,
    state: "command-issued",
  });
  put(resultRecord({
    decision,
    decisionRef,
    operation,
    request,
    status: "applying",
  }), { replaceMutable: existing !== null });

  let readback;
  try {
    readback = await providerClient.read(request);
  } catch (error) {
    return providerFailureRecord({
      clock,
      decision,
      decisionRef,
      error,
      operation: {
        ...operation,
        state: error?.statusCode >= 500 ? "recovery-required" : "command-issued",
      },
      request,
    });
  }
  if (!readbackMatches(request, readback)) {
    return providerFailureRecord({
      clock,
      decision,
      decisionRef,
      error: new HttpError(
        409,
        "repository_provider_readback_stale",
        "Provider readback is stale, unavailable, or mismatched.",
      ),
      operation: {
        ...operation,
        provider_repository_id: readback.repository_identity.provider_repository_id,
        state: "provider-acknowledged",
      },
      providerReadback: readback,
      request,
    });
  }
  const receipt = custodyReceipt({
    clock,
    decisionRef,
    findings: [
      "WGCF readiness allowed the exact request.",
      "Provider readback matched the immutable repository identity.",
      "Repository custody was linked without downstream admission mutation.",
    ],
    outcome: "succeeded",
    providerReadback: readback,
    request,
  });
  return resultRecord({
    decision,
    decisionRef,
    operation: {
      ...operation,
      completion_path: "read-existing",
      state: "verified",
    },
    providerReadback: readback,
    receipt,
    request,
    status: "succeeded",
  });
}

async function provision({
  clock,
  decision,
  decisionRef,
  existing,
  providerClient,
  put,
  request,
}) {
  let operation = providerOperation({
    attemptCount: existing?.provider_operation.attempt_count ?? 0,
    command: "create-provider",
    providerRepositoryId: existing?.provider_operation.provider_repository_id ?? null,
    state: existing ? "recovery-required" : "not-started",
  });

  if (existing) {
    put(resultRecord({
      decision,
      decisionRef,
      operation,
      request,
      status: "applying",
    }), { replaceMutable: true });
    try {
      const recovered = operation.provider_repository_id
        ? await providerClient.read(request, {
            providerRepositoryId: operation.provider_repository_id,
          })
        : await providerClient.find(request);
      if (recovered) {
        if (!readbackMatches(request, recovered)) {
          return providerFailureRecord({
            clock,
            decision,
            decisionRef,
            error: new HttpError(
              409,
              "repository_provider_readback_stale",
              "Recovered provider truth does not match the approved provisioning settings.",
            ),
            operation: {
              ...operation,
              provider_repository_id: recovered.repository_identity.provider_repository_id,
              state: "provider-acknowledged",
            },
            providerReadback: recovered,
            request,
          });
        }
        return successfulProvision({
          clock,
          decision,
          decisionRef,
          operation: {
            ...operation,
            completion_path: "recovered",
            provider_repository_id: recovered.repository_identity.provider_repository_id,
            state: "verified",
          },
          readback: recovered,
          request,
        });
      }
    } catch (error) {
      return providerFailureRecord({
        clock,
        decision,
        decisionRef,
        error,
        operation,
        request,
      });
    }
  } else {
    try {
      const collision = await providerClient.find(request);
      if (collision) {
        return providerFailureRecord({
          clock,
          decision,
          decisionRef,
          error: new HttpError(
            409,
            "repository_provider_name_conflict",
            "The approved organization and repository name already resolve to provider state.",
          ),
          operation: {
            ...operation,
            provider_repository_id: collision.repository_identity.provider_repository_id,
          },
          providerReadback: collision,
          request,
        });
      }
    } catch (error) {
      return providerFailureRecord({
        clock,
        decision,
        decisionRef,
        error,
        operation,
        request,
      });
    }
  }

  operation = {
    ...operation,
    attempt_count: operation.attempt_count + 1,
    state: "command-issued",
  };
  put(resultRecord({
    decision,
    decisionRef,
    operation,
    request,
    status: "applying",
  }), { replaceMutable: existing !== null });

  let acknowledgement;
  try {
    acknowledgement = await providerClient.create(request, decision.approved_provisioning);
  } catch (error) {
    return providerFailureRecord({
      clock,
      decision,
      decisionRef,
      error,
      operation: {
        ...operation,
        state: error?.statusCode >= 500 ? "recovery-required" : "command-issued",
      },
      request,
    });
  }

  operation = {
    ...operation,
    provider_repository_id: acknowledgement.providerRepositoryId,
    state: "provider-acknowledged",
  };
  put(resultRecord({
    decision,
    decisionRef,
    operation,
    request,
    status: "applying",
  }), { replaceMutable: true });

  let readback;
  try {
    readback = await providerClient.read(request, {
      providerRepositoryId: acknowledgement.providerRepositoryId,
    });
  } catch (error) {
    return providerFailureRecord({
      clock,
      decision,
      decisionRef,
      error,
      operation: {
        ...operation,
        state: error?.statusCode >= 500 ? "recovery-required" : "provider-acknowledged",
      },
      request,
    });
  }
  if (!readbackMatches(request, readback)) {
    return providerFailureRecord({
      clock,
      decision,
      decisionRef,
      error: new HttpError(
        409,
        "repository_provider_readback_stale",
        "Provider readback does not match the approved provisioning settings.",
      ),
      operation,
      providerReadback: readback,
      request,
    });
  }
  return successfulProvision({
    clock,
    decision,
    decisionRef,
    operation: {
      ...operation,
      completion_path: "created",
      state: "verified",
    },
    readback,
    request,
  });
}

function successfulProvision({ clock, decision, decisionRef, operation, readback, request }) {
  const receipt = custodyReceipt({
    clock,
    decisionRef,
    findings: [
      "WGCF readiness allowed the exact organization and baseline settings.",
      "The provider repository exists once with immutable identity and current readback.",
      "Applied initialization, visibility, feature, and merge settings match the decision.",
      "Repository custody was provisioned without downstream admission mutation.",
    ],
    outcome: "succeeded",
    providerReadback: readback,
    request,
  });
  return resultRecord({
    decision,
    decisionRef,
    operation,
    providerReadback: readback,
    receipt,
    request,
    status: "succeeded",
  });
}
