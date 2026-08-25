import { HttpError } from "../errors.js";
import { canonicalStringify } from "../delivery-art/canonical-json.js";
import { createWgcfAuthenticatedJsonTransport } from "../wgcf-transport.js";
import { assertPrototypeIngressReadinessReceipt } from "./contracts.js";

const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;
const RECEIPT_URI_PATTERN =
  /^wgcf:\/\/receipts\/prototype-ingress-readiness\/prototype-ingress-readiness-receipt-([0-9a-f]{24})-([0-9a-f]{64})\.json$/;
const MAX_REQUEST_BYTES = 262_144;
const MAX_RESPONSE_BYTES = 393_216;
const ALLOWED_RESOLUTIONS = new Set(["created", "read", "reused"]);

function invalidResponse(message) {
  return new HttpError(
    502,
    "wgcf_prototype_ingress_readiness_invalid_response",
    message,
  );
}

function parseReference(reference) {
  const uri = String(reference?.uri ?? "");
  const digest = String(reference?.digest ?? "");
  const match = uri.match(RECEIPT_URI_PATTERN);
  if (!match || !DIGEST_PATTERN.test(digest) || match[2] !== digest.slice(7)) {
    return null;
  }
  return { digest, token: match[1], uri };
}

function assertResponse(body, { expectedPacket = null, expectedReference = null } = {}) {
  const receipt = body?.receipt;
  const ledger = body?.ledger;
  if (
    !receipt || typeof receipt !== "object" || Array.isArray(receipt) ||
    !ledger || typeof ledger !== "object" || Array.isArray(ledger)
  ) {
    throw invalidResponse("WGCF Prototype ingress readiness returned an incomplete response.");
  }

  try {
    assertPrototypeIngressReadinessReceipt(receipt);
  } catch {
    throw invalidResponse(
      "WGCF Prototype ingress readiness receipt does not satisfy the admitted contract.",
    );
  }

  const reference = parseReference({
    digest: receipt.integrity?.content_digest,
    uri: receipt.custody?.uri,
  });
  if (
    !reference ||
    receipt.artifact_type !== "prototype_ingress_readiness_receipt" ||
    receipt.receipt_id !== `prototype-ingress-readiness-receipt:${reference.token}` ||
    receipt.custody?.state !== "durable" ||
    receipt.decision?.mutation_authority !== "none" ||
    ledger.state !== "durable" ||
    !Number.isInteger(ledger.generation) ||
    ledger.generation < 1 ||
    !ALLOWED_RESOLUTIONS.has(ledger.resolution) ||
    ledger.ref?.uri !== reference.uri ||
    ledger.ref?.digest !== reference.digest
  ) {
    throw invalidResponse("WGCF Prototype ingress readiness returned inconsistent receipt metadata.");
  }

  if (
    expectedReference &&
    (reference.uri !== expectedReference.uri || reference.digest !== expectedReference.digest)
  ) {
    throw invalidResponse("WGCF returned a different Prototype readiness receipt.");
  }

  if (expectedPacket) {
    const source = expectedPacket.content?.source;
    const subject = receipt.subject;
    if (
      subject?.source_kind !== "prototype" ||
      subject?.prototype_id !== source?.prototype_id ||
      subject?.record_ref !== source?.record_ref ||
      subject?.record_version !== source?.record_version ||
      subject?.packet_ref !== expectedPacket.packet_ref ||
      subject?.packet_digest !== expectedPacket.packet_digest
    ) {
      throw invalidResponse("WGCF Prototype readiness receipt is bound to a different source packet.");
    }
  }

  return { body, receipt, reference };
}

export function createWgcfPrototypeIngressReadinessClient({
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
    errorPrefix: "wgcf_prototype_ingress_readiness",
    fetchImpl,
    label: "WGCF Prototype ingress readiness",
    maxResponseBytes: MAX_RESPONSE_BYTES,
    statusDetailKey: "prototype_ingress_readiness_status",
  });

  return {
    async issue({ packet }) {
      const requestBody = canonicalStringify({
        packet,
        profile_id: profileId,
        schema_version: 1,
      });
      if (Buffer.byteLength(requestBody, "utf8") > MAX_REQUEST_BYTES) {
        throw new HttpError(
          413,
          "wgcf_prototype_ingress_readiness_request_oversized",
          "Prototype ingress readiness request exceeds the bounded payload limit.",
        );
      }
      return assertResponse(
        await transport.request("/v1/readiness/prototype-ingress", {
          body: requestBody,
          method: "POST",
        }),
        { expectedPacket: packet },
      );
    },

    async read({ packet = null, reference }) {
      const expectedReference = parseReference(reference);
      if (!expectedReference) {
        throw new HttpError(
          400,
          "wgcf_prototype_ingress_readiness_reference_invalid",
          "The Prototype readiness receipt reference is not content-addressed.",
        );
      }
      return assertResponse(
        await transport.request(
          `/v1/readiness/prototype-ingress/${expectedReference.token}`,
          { method: "GET" },
        ),
        { expectedPacket: packet, expectedReference },
      );
    },
  };
}
