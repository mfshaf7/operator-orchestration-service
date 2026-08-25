import { canonicalStringify } from "../delivery-art/canonical-json.js";
import { HttpError } from "../errors.js";
import {
  assertCatalogError,
  assertCatalogMutationRequest,
  assertCatalogMutationResult,
  assertCatalogProjectionResult,
} from "./contracts.js";
import { CatalogUpstreamError } from "./http-client.js";

export class CatalogServiceError extends Error {
  constructor(code, message, {
    correlationId = "unknown",
    readinessReceiptRef = null,
    receiptRef = null,
    retryable = false,
    statusCode = 400,
  } = {}) {
    super(message);
    this.name = "CatalogServiceError";
    this.code = code;
    this.correlationId = correlationId;
    this.readinessReceiptRef = readinessReceiptRef;
    this.receiptRef = receiptRef;
    this.retryable = retryable;
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
    if (this.receiptRef) response.receipt_ref = this.receiptRef;
    if (this.readinessReceiptRef) {
      response.readiness_receipt_ref = this.readinessReceiptRef;
    }
    return assertCatalogError(response);
  }
}

function correlationOf(request, fallback = "unknown") {
  return typeof request?.correlation_id === "string" && request.correlation_id
    ? request.correlation_id
    : fallback;
}

function requestFailure(error, request) {
  if (!(error instanceof HttpError)) throw error;
  const operatorMissing = (error.details ?? []).some((detail) =>
    String(detail.path ?? "").startsWith("/operator"),
  );
  return new CatalogServiceError(
    operatorMissing ? "operator_identity_required" : "request_invalid",
    error.message,
    { correlationId: correlationOf(request) },
  );
}

function sourceFailure(error, code, correlationId) {
  if (error instanceof CatalogServiceError) return error;
  if (error instanceof HttpError && error.code.startsWith("repository_readiness")) {
    return new CatalogServiceError(
      error.code === "repository_readiness_stale"
        ? "repository_readiness_stale"
        : "repository_readiness_blocked",
      error.message,
      { correlationId, retryable: error.statusCode >= 500, statusCode: error.statusCode },
    );
  }
  const upstream = error instanceof CatalogUpstreamError ? error : null;
  const conflict = upstream?.statusCode === 409;
  const retryable = upstream?.retryable === true;
  const exposedCode = conflict ? "catalog_conflict" : code;
  const message = conflict
    ? "Canonical Catalog state conflicts with the accepted mutation."
    : code === "backend_projection_failed"
      ? "Canonical Catalog state could not be projected safely."
      : "Canonical Catalog mutation or readback failed.";
  return new CatalogServiceError(
    exposedCode,
    message,
    {
      correlationId,
      retryable,
      statusCode: conflict ? 409 : retryable ? 503 : 502,
    },
  );
}

function isOwnerRepo(item) {
  return item?.value_key === "owner_repo" || item?.catalog_item_id === "owner-repo" ||
    item?.catalog_item_id === "catalog-owner-repo";
}

function assertMutationAllowed(request, projection) {
  if (request.source_revision !== projection.source_revision) {
    throw new CatalogServiceError(
      "source_revision_stale",
      "Catalog source changed after this request was prepared.",
      { correlationId: request.correlation_id, statusCode: 409 },
    );
  }
  const item = projection.items.find(
    (candidate) => candidate.catalog_item_id === request.catalog_item_id,
  );
  if (!item) {
    throw new CatalogServiceError(
      "request_invalid",
      "The requested Catalog item does not exist in the canonical projection.",
      { correlationId: request.correlation_id },
    );
  }
  if (
    ["read_only", "owner_routed"].includes(item.console_capability) ||
    ["read_only", "retired", "stale"].includes(item.lifecycle_state)
  ) {
    throw new CatalogServiceError(
      "catalog_read_only",
      "The requested Catalog item is not mutable through this workflow.",
      { correlationId: request.correlation_id, statusCode: 409 },
    );
  }
  const target = request.target_value_id
    ? projection.values.find(
        (value) =>
          value.catalog_item_id === request.catalog_item_id &&
          value.catalog_value_id === request.target_value_id,
      )
    : null;
  if (request.mode !== "add" && !target) {
    throw new CatalogServiceError(
      "catalog_conflict",
      "The requested Catalog value no longer exists.",
      { correlationId: request.correlation_id, statusCode: 409 },
    );
  }
  if (target && ["read_only", "retired"].includes(target.lifecycle_state)) {
    throw new CatalogServiceError(
      "catalog_read_only",
      "The requested Catalog value is not mutable.",
      { correlationId: request.correlation_id, statusCode: 409 },
    );
  }
  if (request.mode === "retire" && target.usage_count > 0) {
    throw new CatalogServiceError(
      "catalog_value_in_use",
      "Catalog values still used by Delivery records cannot be retired.",
      { correlationId: request.correlation_id, statusCode: 409 },
    );
  }
  const repositoryBindingRequired = isOwnerRepo(item) && request.mode !== "retire";
  if (
    (repositoryBindingRequired && !request.draft.repository_binding) ||
    (!isOwnerRepo(item) && request.draft.repository_binding)
  ) {
    throw new CatalogServiceError(
      "request_invalid",
      isOwnerRepo(item)
        ? "Owner Repo mutations require an exact repository-readiness reference."
        : "Repository-readiness evidence is only valid for Owner Repo mutations.",
      { correlationId: request.correlation_id },
    );
  }
  return item;
}

function assertMutationReadback({ projection, request, result }) {
  if (
    result.request_id !== request.request_id ||
    result.correlation_id !== request.correlation_id ||
    result.applied_by !== request.operator.id ||
    result.value.catalog_item_id !== request.catalog_item_id ||
    result.source_revision !== projection.source_revision
  ) {
    throw new CatalogServiceError(
      "backend_readback_incomplete",
      "Catalog backend readback does not match the accepted mutation.",
      {
        correlationId: request.correlation_id,
        receiptRef: result.receipt?.ref ?? null,
        statusCode: 502,
      },
    );
  }
  const readback = projection.values.find(
    (value) => value.catalog_value_id === result.value.catalog_value_id,
  );
  if (!readback || canonicalStringify(readback) !== canonicalStringify(result.value)) {
    throw new CatalogServiceError(
      "backend_readback_incomplete",
      "Catalog mutation result is not present in the canonical projection.",
      {
        correlationId: request.correlation_id,
        receiptRef: result.receipt.ref,
        statusCode: 502,
      },
    );
  }
  for (const related of result.related_values) {
    const projected = projection.values.find(
      (value) => value.catalog_value_id === related.catalog_value_id,
    );
    if (!projected || canonicalStringify(projected) !== canonicalStringify(related)) {
      throw new CatalogServiceError(
        "backend_readback_incomplete",
        "A related Catalog mutation value is missing from canonical readback.",
        {
          correlationId: request.correlation_id,
          receiptRef: result.receipt.ref,
          statusCode: 502,
        },
      );
    }
  }
}

export function createCatalogService({ audit, backendClient, readinessClient }) {
  async function project({ callerId, correlationId }) {
    let projection;
    try {
      projection = assertCatalogProjectionResult(await backendClient.project());
    } catch (error) {
      throw sourceFailure(error, "backend_projection_failed", correlationId);
    }
    audit?.emit({
      event_type: "delivery.catalog.projected",
      actor: callerId,
      correlation_id: correlationId,
      source_revision: projection.source_revision,
    });
    return projection;
  }

  return {
    project,

    async mutate({ callerId, catalogItemId, request }) {
      let accepted;
      try {
        accepted = assertCatalogMutationRequest(request);
      } catch (error) {
        throw requestFailure(error, request);
      }
      if (catalogItemId !== accepted.catalog_item_id) {
        throw new CatalogServiceError(
          "request_invalid",
          "Catalog route and request item do not match.",
          { correlationId: accepted.correlation_id },
        );
      }
      const before = await project({ callerId, correlationId: accepted.correlation_id });
      const item = assertMutationAllowed(accepted, before);
      let verifiedRequest = accepted;
      if (verifiedRequest.draft.repository_binding) {
        try {
          const repositoryBinding = await readinessClient.verifyCurrent(
            accepted.draft.repository_binding,
          );
          verifiedRequest = {
            ...accepted,
            draft: { ...accepted.draft, repository_binding: repositoryBinding },
          };
        } catch (error) {
          const failure = sourceFailure(
            error,
            "repository_readiness_blocked",
            accepted.correlation_id,
          );
          failure.readinessReceiptRef = accepted.draft.repository_binding?.receipt?.uri ?? null;
          throw failure;
        }
      }
      let result;
      try {
        result = assertCatalogMutationResult(
          await backendClient.mutate(catalogItemId, verifiedRequest),
        );
      } catch (error) {
        throw sourceFailure(error, "backend_mutation_failed", accepted.correlation_id);
      }
      const after = await project({ callerId, correlationId: accepted.correlation_id });
      assertMutationReadback({ projection: after, request: verifiedRequest, result });
      audit?.emit({
        event_type: result.replayed
          ? "delivery.catalog.mutation.replayed"
          : "delivery.catalog.mutation.applied",
        actor: callerId,
        catalog_item_id: catalogItemId,
        correlation_id: accepted.correlation_id,
        mutation_id: result.mutation_id,
        receipt_ref: result.receipt.ref,
      });
      return result;
    },
  };
}
