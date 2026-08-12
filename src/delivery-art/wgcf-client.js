import { HttpError } from "../errors.js";
import { canonicalDigest, canonicalStringify } from "./canonical-json.js";
import { createWgcfAuthenticatedJsonTransport } from "./wgcf-transport.js";

const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;
const MAX_ARTIFACT_CONTENT_BYTES = 1_048_576;
const MAX_REGISTRY_REQUEST_BYTES = MAX_ARTIFACT_CONTENT_BYTES + 8_192;
const MAX_REGISTRY_RESPONSE_BYTES = 2_228_224;
const ALLOWED_RESOLUTIONS = new Set(["created", "read", "reused"]);

function assertDigest(contentDigest) {
  if (!DIGEST_PATTERN.test(String(contentDigest ?? ""))) {
    throw new HttpError(
      400,
      "wgcf_artifact_registry_digest_invalid",
      "Delivery ART registry operations require a lowercase SHA-256 digest.",
    );
  }
}

function assertRegistryResponse(body, requestedDigest) {
  const artifact = body?.artifact;
  const receipt = body?.custody_receipt;
  const registry = body?.registry;
  if (
    !artifact || typeof artifact !== "object" || Array.isArray(artifact) ||
    !receipt || typeof receipt !== "object" || Array.isArray(receipt) ||
    !registry || typeof registry !== "object" || Array.isArray(registry)
  ) {
    throw new HttpError(
      502,
      "wgcf_artifact_registry_invalid_response",
      "WGCF Delivery ART custody returned an incomplete response.",
    );
  }
  if (
    registry.state !== "durable" ||
    !Number.isInteger(registry.generation) ||
    registry.generation < 1 ||
    !ALLOWED_RESOLUTIONS.has(registry.resolution) ||
    artifact.integrity?.content_digest !== requestedDigest ||
    registry.artifact_ref?.digest !== requestedDigest ||
    registry.artifact_ref?.uri !== artifact.custody?.uri ||
    registry.custody_receipt_ref?.uri !== artifact.custody?.receipt_ref?.uri ||
    registry.custody_receipt_ref?.digest !== artifact.custody?.receipt_ref?.digest ||
    registry.custody_receipt_ref?.uri !== receipt.custody?.uri ||
    registry.custody_receipt_ref?.digest !== receipt.integrity?.content_digest ||
    artifact.custody?.uri !==
      `wgcf://artifacts/delivery-art/sha256/${requestedDigest.slice("sha256:".length)}` ||
    !String(receipt.custody?.uri ?? "").includes(
      receipt.integrity?.content_digest?.slice("sha256:".length) ?? "<missing>",
    )
  ) {
    throw new HttpError(
      502,
      "wgcf_artifact_registry_invalid_response",
      "WGCF Delivery ART custody returned inconsistent references.",
    );
  }
  return body;
}

export function createWgcfArtifactRegistryClient({
  baseUrl,
  callerId = "operator-orchestration-service",
  callerSecret,
  fetchImpl = globalThis.fetch,
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
    errorPrefix: "wgcf_artifact_registry",
    fetchImpl,
    label: "WGCF Delivery ART custody",
    maxResponseBytes: MAX_REGISTRY_RESPONSE_BYTES,
    statusDetailKey: "registry_status",
  });

  return {
    async read({ contentDigest }) {
      assertDigest(contentDigest);
      const digestHex = contentDigest.slice("sha256:".length);
      return assertRegistryResponse(
        await transport.request(`/v1/artifacts/delivery-art/${digestHex}`, {
          method: "GET",
        }),
        contentDigest,
      );
    },

    async register({ artifactContent, contentDigest }) {
      assertDigest(contentDigest);
      if (!artifactContent || typeof artifactContent !== "object" || Array.isArray(artifactContent)) {
        throw new HttpError(
          400,
          "wgcf_artifact_registry_content_invalid",
          "Delivery ART registry content must be an object.",
        );
      }
      const canonicalContent = canonicalStringify(artifactContent);
      if (Buffer.byteLength(canonicalContent, "utf8") > MAX_ARTIFACT_CONTENT_BYTES) {
        throw new HttpError(
          413,
          "wgcf_artifact_registry_content_oversized",
          "Delivery ART registry content exceeds the bounded payload limit.",
        );
      }
      if (canonicalDigest(artifactContent) !== contentDigest) {
        throw new HttpError(
          400,
          "wgcf_artifact_registry_digest_mismatch",
          "Delivery ART registry content does not match its declared digest.",
        );
      }
      const requestBody = canonicalStringify({
        artifact_content: artifactContent,
        content_digest: contentDigest,
      });
      if (Buffer.byteLength(requestBody, "utf8") > MAX_REGISTRY_REQUEST_BYTES) {
        throw new HttpError(
          413,
          "wgcf_artifact_registry_request_oversized",
          "Delivery ART registry request exceeds the bounded payload limit.",
        );
      }
      return assertRegistryResponse(
        await transport.request("/v1/artifacts/delivery-art", {
          body: requestBody,
          method: "POST",
        }),
        contentDigest,
      );
    },
  };
}
