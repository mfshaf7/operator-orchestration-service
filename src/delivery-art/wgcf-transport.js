import { HttpError } from "../errors.js";

function normalizeBaseUrl(baseUrl) {
  if (typeof baseUrl !== "string" || !baseUrl.trim()) {
    return "";
  }
  return baseUrl.trim().replace(/\/+$/, "");
}

function assertConfigured({
  baseUrl,
  callerId,
  callerSecret,
  configNames,
  errorPrefix,
  fetchImpl,
  label,
}) {
  const missing = [];
  if (!baseUrl) {
    missing.push(configNames.baseUrl);
  }
  if (!callerId) {
    missing.push(configNames.callerId);
  }
  if (typeof callerSecret !== "string" || callerSecret.length < 32) {
    missing.push(configNames.callerSecret);
  }
  if (missing.length > 0) {
    throw new HttpError(
      503,
      `${errorPrefix}_not_configured`,
      `${label} is not configured: ${missing.join(", ")}.`,
    );
  }
  if (typeof fetchImpl !== "function") {
    throw new HttpError(
      503,
      `${errorPrefix}_fetch_unavailable`,
      `${label} requires a fetch implementation.`,
    );
  }
}

function oversizedResponseError({ errorPrefix, label }) {
  return new HttpError(
    502,
    `${errorPrefix}_response_oversized`,
    `${label} returned an oversized response.`,
  );
}

async function readBoundedJson(response, options) {
  const contentLength = Number.parseInt(
    response?.headers?.get?.("content-length") ?? "",
    10,
  );
  if (
    Number.isFinite(contentLength) &&
    contentLength > options.maxResponseBytes
  ) {
    throw oversizedResponseError(options);
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
      if (totalBytes > options.maxResponseBytes) {
        throw oversizedResponseError(options);
      }
      chunks.push(buffer);
    }
    raw = Buffer.concat(chunks, totalBytes).toString("utf8");
  } else if (typeof response?.text === "function") {
    raw = await response.text();
    if (Buffer.byteLength(raw, "utf8") > options.maxResponseBytes) {
      throw oversizedResponseError(options);
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

function responseErrorCode(errorPrefix, statusCode) {
  if (statusCode === 401) {
    return `${errorPrefix}_unauthorized`;
  }
  if (statusCode === 403) {
    return `${errorPrefix}_forbidden`;
  }
  if (statusCode === 404) {
    return `${errorPrefix}_not_found`;
  }
  if (statusCode === 409) {
    return `${errorPrefix}_conflict`;
  }
  return statusCode < 500
    ? `${errorPrefix}_rejected`
    : `${errorPrefix}_unavailable`;
}

export function createWgcfAuthenticatedJsonTransport({
  baseUrl,
  callerId = "operator-orchestration-service",
  callerSecret,
  configNames,
  errorPrefix,
  fetchImpl = globalThis.fetch,
  label,
  maxResponseBytes,
  statusDetailKey = "upstream_status",
}) {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  const normalizedCallerId = typeof callerId === "string" ? callerId.trim() : "";

  return {
    async request(path, { body, method }) {
      assertConfigured({
        baseUrl: normalizedBaseUrl,
        callerId: normalizedCallerId,
        callerSecret,
        configNames,
        errorPrefix,
        fetchImpl,
        label,
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
          `${errorPrefix}_unavailable`,
          `${label} request failed.`,
        );
      }
      const responseBody = await readBoundedJson(response, {
        errorPrefix,
        label,
        maxResponseBytes,
      });
      if (!response.ok) {
        const statusCode = Number.isInteger(response.status) ? response.status : 502;
        throw new HttpError(
          statusCode,
          responseErrorCode(errorPrefix, statusCode),
          `${label} request was rejected.`,
          {
            [statusDetailKey]: statusCode,
          },
        );
      }
      return responseBody;
    },
  };
}
