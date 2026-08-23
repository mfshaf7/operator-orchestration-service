import { HttpError } from "../errors.js";
import { canonicalStringify } from "./canonical-json.js";
import { createWgcfAuthenticatedJsonTransport } from "../wgcf-transport.js";

const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;
const READINESS_RECEIPT_URI_PATTERN =
  /^wgcf:\/\/receipts\/art-readiness\/art-readiness-receipt-([0-9a-f]{24})-([0-9a-f]{64})\.json$/;
const MAX_READINESS_REQUEST_BYTES = 1_081_344;
const MAX_READINESS_RESPONSE_BYTES = 1_114_112;
const ALLOWED_RESOLUTIONS = new Set(["created", "read", "reused"]);

function invalidResponse(message = "WGCF Delivery ART readiness returned an invalid response.") {
  return new HttpError(
    502,
    "wgcf_delivery_art_readiness_invalid_response",
    message,
  );
}

function assertObject(value, code, message) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(400, code, message);
  }
  return value;
}

function parseReference(reference) {
  if (!reference || typeof reference !== "object" || Array.isArray(reference)) {
    return null;
  }
  const match = String(reference.uri ?? "").match(READINESS_RECEIPT_URI_PATTERN);
  if (
    !match ||
    !DIGEST_PATTERN.test(String(reference.digest ?? "")) ||
    match[2] !== reference.digest.slice("sha256:".length)
  ) {
    return null;
  }
  return {
    digest: reference.digest,
    token: match[1],
    uri: reference.uri,
  };
}

function assertReference(reference) {
  const parsed = parseReference(reference);
  if (!parsed) {
    throw new HttpError(
      400,
      "wgcf_delivery_art_readiness_reference_invalid",
      "The WGCF readiness receipt reference is not content-addressed.",
    );
  }
  return parsed;
}

function assertIssueInput({ finalizationCandidate, readinessRequest }) {
  assertObject(
    finalizationCandidate,
    "wgcf_delivery_art_readiness_candidate_invalid",
    "Operating readiness requires a finalization candidate.",
  );
  assertObject(
    readinessRequest,
    "wgcf_delivery_art_readiness_request_invalid",
    "Operating readiness requires a readiness request.",
  );
  if (
    readinessRequest.artifact_type !== "art_review_packet" ||
    readinessRequest.digest_kind !== "readiness-subject" ||
    readinessRequest.readiness_level !== "operating-ready" ||
    !DIGEST_PATTERN.test(String(readinessRequest.digest ?? ""))
  ) {
    throw new HttpError(
      400,
      "wgcf_delivery_art_readiness_request_invalid",
      "Operating-readiness request fields do not match the Delivery ART contract.",
    );
  }
}

function assertReadinessResponse(
  body,
  { expectedReference = null, profileId, readinessRequest = null } = {},
) {
  const artifact = body?.artifact;
  const receipt = body?.receipt;
  if (
    !artifact || typeof artifact !== "object" || Array.isArray(artifact) ||
    !receipt || typeof receipt !== "object" || Array.isArray(receipt)
  ) {
    throw invalidResponse();
  }

  const reference = parseReference({
    digest: artifact.integrity?.content_digest,
    uri: artifact.custody?.uri,
  });
  if (
    !reference ||
    artifact.artifact_type !== "delivery_art_readiness_receipt" ||
    artifact.receipt_id !== `art-readiness-receipt:${reference.token}` ||
    artifact.custody?.state !== "durable" ||
    receipt.state !== "durable" ||
    !Number.isInteger(receipt.generation) ||
    receipt.generation < 1 ||
    !ALLOWED_RESOLUTIONS.has(receipt.resolution) ||
    receipt.ref?.uri !== reference.uri ||
    receipt.ref?.digest !== reference.digest ||
    artifact.readiness?.profile_id !== profileId ||
    (artifact.readiness?.outcome === "ready") !==
      (artifact.readiness?.mutation_allowed === true)
  ) {
    throw invalidResponse(
      "WGCF Delivery ART readiness returned inconsistent receipt metadata.",
    );
  }

  if (
    expectedReference &&
    (reference.uri !== expectedReference.uri ||
      reference.digest !== expectedReference.digest)
  ) {
    throw invalidResponse(
      "WGCF Delivery ART readiness returned a receipt that does not match its requested reference.",
    );
  }

  if (
    readinessRequest &&
    (artifact.delivery_id !== readinessRequest.delivery_id ||
      artifact.subject?.artifact_type !== readinessRequest.artifact_type ||
      artifact.subject?.artifact_id !== readinessRequest.artifact_id ||
      artifact.subject?.digest_kind !== readinessRequest.digest_kind ||
      artifact.subject?.digest !== readinessRequest.digest ||
      artifact.readiness?.level !== readinessRequest.readiness_level ||
      canonicalStringify(artifact.covered_work_item_ids) !==
        canonicalStringify([...readinessRequest.covered_work_item_ids].sort()))
  ) {
    throw invalidResponse(
      "WGCF Delivery ART readiness returned a receipt for a different subject.",
    );
  }

  return body;
}

export function createWgcfDeliveryArtReadinessClient({
  baseUrl,
  callerId = "operator-orchestration-service",
  callerSecret,
  fetchImpl = globalThis.fetch,
  profileId = "dev-integration",
} = {}) {
  const transport = createWgcfAuthenticatedJsonTransport({
    baseUrl,
    callerId,
    callerSecret,
    configNames: {
      baseUrl: "WGCF_DELIVERY_ART_BASE_URL",
      callerId: "WGCF_DELIVERY_ART_CALLER_ID",
      callerSecret: "WGCF_DELIVERY_ART_CALLER_SECRET",
    },
    errorPrefix: "wgcf_delivery_art_readiness",
    fetchImpl,
    label: "WGCF Delivery ART readiness",
    maxResponseBytes: MAX_READINESS_RESPONSE_BYTES,
    statusDetailKey: "readiness_status",
  });

  return {
    async issue({ finalizationCandidate, readinessRequest }) {
      assertIssueInput({ finalizationCandidate, readinessRequest });
      const requestBody = canonicalStringify({
        finalization_candidate: finalizationCandidate,
        profile_id: profileId,
        readiness_request: readinessRequest,
        schema_version: 1,
      });
      if (Buffer.byteLength(requestBody, "utf8") > MAX_READINESS_REQUEST_BYTES) {
        throw new HttpError(
          413,
          "wgcf_delivery_art_readiness_request_oversized",
          "WGCF Delivery ART readiness request exceeds the bounded payload limit.",
        );
      }
      return assertReadinessResponse(
        await transport.request("/v1/readiness/delivery-art", {
          body: requestBody,
          method: "POST",
        }),
        { profileId, readinessRequest },
      );
    },

    async read({ reference }) {
      const expectedReference = assertReference(reference);
      return assertReadinessResponse(
        await transport.request(
          `/v1/readiness/delivery-art/${expectedReference.token}`,
          { method: "GET" },
        ),
        { expectedReference, profileId },
      );
    },
  };
}
