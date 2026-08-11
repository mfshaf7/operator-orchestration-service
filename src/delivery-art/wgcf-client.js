import { HttpError } from "../errors.js";
import { canonicalDigest, canonicalStringify } from "./canonical-json.js";

const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;
const MAX_ARTIFACT_CONTENT_BYTES = 1_048_576;
const MAX_REGISTRY_REQUEST_BYTES = MAX_ARTIFACT_CONTENT_BYTES + 8_192;
const MAX_REGISTRY_RESPONSE_BYTES = 2_228_224;
const ALLOWED_RESOLUTIONS = new Set(["created", "read", "reused"]);

function normalizeBaseUrl(baseUrl) {
  if (typeof baseUrl !== "string" || !baseUrl.trim()) {
    return "";
  }
  return baseUrl.trim().replace(/\/+$/, "");
}

function assertDigest(contentDigest) {
  if (!DIGEST_PATTERN.test(String(contentDigest ?? ""))) {
    throw new HttpError(
      400,
      "wgcf_artifact_registry_digest_invalid",
      "Delivery ART registry operations require a lowercase SHA-256 digest.",
    );
  }
}

function assertConfigured({ baseUrl, callerId, callerSecret, fetchImpl }) {
  const missing = [];
  if (!baseUrl) {
    missing.push("WGCF_ARTIFACT_REGISTRY_BASE_URL");
  }
  if (!callerId) {
    missing.push("WGCF_ARTIFACT_REGISTRY_CALLER_ID");
  }
  if (typeof callerSecret !== "string" || callerSecret.length < 32) {
    missing.push("WGCF_ARTIFACT_REGISTRY_CALLER_SECRET");
  }
  if (missing.length > 0) {
    throw new HttpError(
      503,
      "wgcf_artifact_registry_not_configured",
      `WGCF Delivery ART custody is not configured: ${missing.join(", ")}.`,
    );
  }
  if (typeof fetchImpl !== "function") {
    throw new HttpError(
      503,
      "wgcf_artifact_registry_fetch_unavailable",
      "WGCF Delivery ART custody requires a fetch implementation.",
    );
  }
}

function oversizedResponseError() {
  return new HttpError(
    502,
    "wgcf_artifact_registry_response_oversized",
    "WGCF Delivery ART custody returned an oversized response.",
  );
}

async function readBoundedJson(response) {
  const contentLength = Number.parseInt(
    response?.headers?.get?.("content-length") ?? "",
    10,
  );
  if (Number.isFinite(contentLength) && contentLength > MAX_REGISTRY_RESPONSE_BYTES) {
    throw oversizedResponseError();
  }

  let raw;
  if (
    response?.body &&
    typeof response.body[Symbol.asyncIterator] === "function"
  ) {
    const chunks = [];
    let totalBytes = 0;
    for await (const chunk of response.body) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      totalBytes += buffer.byteLength;
      if (totalBytes > MAX_REGISTRY_RESPONSE_BYTES) {
        throw oversizedResponseError();
      }
      chunks.push(buffer);
    }
    raw = Buffer.concat(chunks, totalBytes).toString("utf8");
  } else if (typeof response?.text === "function") {
    raw = await response.text();
    if (Buffer.byteLength(raw, "utf8") > MAX_REGISTRY_RESPONSE_BYTES) {
      throw oversizedResponseError();
    }
  } else {
    return null;
  }

  try {
    return JSON.parse(raw);
  } catch {
    return null;
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
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  const normalizedCallerId = typeof callerId === "string" ? callerId.trim() : "";

  async function request(path, { body, method }) {
    assertConfigured({
      baseUrl: normalizedBaseUrl,
      callerId: normalizedCallerId,
      callerSecret,
      fetchImpl,
    });
    let response;
    try {
      response = await fetchImpl(`${normalizedBaseUrl}${path}`, {
        ...(body === undefined ? {} : { body }),
        headers: {
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
          "x-wgcf-caller-id": normalizedCallerId,
          "x-wgcf-caller-secret": callerSecret,
        },
        method,
      });
    } catch {
      throw new HttpError(
        503,
        "wgcf_artifact_registry_unavailable",
        "WGCF Delivery ART custody request failed.",
      );
    }
    const responseBody = await readBoundedJson(response);
    if (!response.ok) {
      const statusCode = Number.isInteger(response.status) ? response.status : 502;
      throw new HttpError(
        statusCode,
        statusCode === 401
          ? "wgcf_artifact_registry_unauthorized"
          : statusCode === 403
            ? "wgcf_artifact_registry_forbidden"
            : statusCode === 404
              ? "wgcf_artifact_registry_not_found"
              : statusCode === 409
                ? "wgcf_artifact_registry_conflict"
                : statusCode < 500
                  ? "wgcf_artifact_registry_rejected"
                  : "wgcf_artifact_registry_unavailable",
        "WGCF Delivery ART custody request was rejected.",
        {
          registry_status: statusCode,
        },
      );
    }
    return responseBody;
  }

  return {
    async read({ contentDigest }) {
      assertDigest(contentDigest);
      const digestHex = contentDigest.slice("sha256:".length);
      return assertRegistryResponse(
        await request(`/v1/artifacts/delivery-art/${digestHex}`, {
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
        await request("/v1/artifacts/delivery-art", {
          body: requestBody,
          method: "POST",
        }),
        contentDigest,
      );
    },
  };
}
