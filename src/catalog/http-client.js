import http from "node:http";
import https from "node:https";

const MAX_RESPONSE_BYTES = 1_048_576;

export class CatalogUpstreamError extends Error {
  constructor(code, message, { payload = null, retryable = false, statusCode = 502 } = {}) {
    super(message);
    this.name = "CatalogUpstreamError";
    this.code = code;
    this.payload = payload;
    this.retryable = retryable;
    this.statusCode = statusCode;
  }
}

function normalizeBaseUrl(value) {
  return typeof value === "string" ? value.trim().replace(/\/+$/, "") : "";
}

function normalizeHostHeader(value) {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized && !/[\s/@?#\\]/u.test(normalized) ? normalized : "";
}

export function createCatalogNodeRequestImpl({
  httpImpl = http,
  httpsImpl = https,
} = {}) {
  return function nodeRequestImpl(url, options = {}) {
    return new Promise((resolve, reject) => {
      const parsedUrl = new URL(url);
      const transport = parsedUrl.protocol === "https:" ? httpsImpl : httpImpl;
      const request = transport.request(
        parsedUrl,
        {
          agent: false,
          headers: options.headers,
          method: options.method ?? "GET",
        },
        (response) => {
          resolve({
            body: response,
            headers: {
              get(name) {
                const value = response.headers?.[String(name).toLowerCase()];
                return Array.isArray(value) ? value.join(", ") : value ?? null;
              },
            },
            ok:
              typeof response.statusCode === "number" &&
              response.statusCode >= 200 &&
              response.statusCode < 300,
            status: response.statusCode ?? 0,
            text: async () => {
              const chunks = [];
              for await (const chunk of response) chunks.push(Buffer.from(chunk));
              return Buffer.concat(chunks).toString("utf8");
            },
          });
        },
      );

      request.on("error", reject);
      if (options.body) request.write(options.body);
      request.end();
    });
  };
}

function oversizedResponse() {
  return new CatalogUpstreamError(
    "upstream_response_oversized",
    "Catalog backend returned an oversized response.",
  );
}

async function readJson(response) {
  const contentLength = Number.parseInt(
    response?.headers?.get?.("content-length") ?? "",
    10,
  );
  if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) {
    throw oversizedResponse();
  }

  const chunks = [];
  let totalBytes = 0;
  if (response?.body && typeof response.body[Symbol.asyncIterator] === "function") {
    for await (const chunk of response.body) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      totalBytes += buffer.byteLength;
      if (totalBytes > MAX_RESPONSE_BYTES) throw oversizedResponse();
      chunks.push(buffer);
    }
  } else {
    const buffer = Buffer.from(await response.text());
    totalBytes = buffer.byteLength;
    if (totalBytes > MAX_RESPONSE_BYTES) throw oversizedResponse();
    chunks.push(buffer);
  }
  const text = Buffer.concat(chunks, totalBytes).toString("utf8");
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    throw new CatalogUpstreamError(
      "upstream_response_invalid",
      "Catalog backend returned invalid JSON.",
    );
  }
}

export function createCatalogBackendClient({
  baseUrl,
  fetchImpl,
  hostHeader,
  requestImpl,
  token,
}) {
  const target = normalizeBaseUrl(baseUrl);
  const boundHost = normalizeHostHeader(hostHeader);
  const executeRequest = requestImpl ?? fetchImpl ?? createCatalogNodeRequestImpl();

  async function request(path, { body, method = "GET" } = {}) {
    if (!target || !boundHost || typeof token !== "string" || token.length < 32) {
      throw new CatalogUpstreamError(
        "upstream_not_configured",
        "The OpenProject Catalog control route is not configured.",
        { statusCode: 503 },
      );
    }
    if (typeof executeRequest !== "function") {
      throw new CatalogUpstreamError(
        "upstream_not_configured",
        "The OpenProject Catalog control route requires a request implementation.",
        { statusCode: 503 },
      );
    }
    let response;
    try {
      response = await executeRequest(`${target}${path}`, {
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${token}`,
          Host: boundHost,
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        method,
      });
    } catch {
      throw new CatalogUpstreamError(
        "upstream_unavailable",
        "The OpenProject Catalog control route is unavailable.",
        { retryable: true, statusCode: 503 },
      );
    }
    const payload = await readJson(response);
    if (!response.ok) {
      const detail = payload?.detail;
      throw new CatalogUpstreamError(
        payload?.code ?? detail?.code ?? "upstream_rejected",
        payload?.message ?? detail?.message ?? "Catalog backend rejected the request.",
        {
          payload,
          retryable: payload?.retryable === true || response.status >= 500,
          statusCode: response.status,
        },
      );
    }
    return payload;
  }

  return {
    mutate(catalogItemId, mutation) {
      return request(`/v1/delivery-catalog/${encodeURIComponent(catalogItemId)}/mutations`, {
        body: mutation,
        method: "POST",
      });
    },
    project() {
      return request("/v1/delivery-catalog/projection");
    },
  };
}
