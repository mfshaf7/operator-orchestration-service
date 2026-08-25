export class RefinementUpstreamError extends Error {
  constructor(code, message, {
    payload = null,
    retryable = false,
    statusCode = 502,
  } = {}) {
    super(message);
    this.name = "RefinementUpstreamError";
    this.code = code;
    this.payload = payload;
    this.retryable = retryable;
    this.statusCode = statusCode;
  }
}

export function createRefinementJsonClient({
  baseUrl,
  fetchImpl = globalThis.fetch,
  headers = {},
}) {
  async function post(path, body) {
    if (!baseUrl) {
      throw new RefinementUpstreamError(
        "upstream_not_configured",
        "Refinement upstream is not configured.",
        { statusCode: 503 },
      );
    }

    let response;
    try {
      response = await fetchImpl(new URL(path, baseUrl), {
        body: JSON.stringify(body),
        headers: { "Content-Type": "application/json", ...headers },
        method: "POST",
      });
    } catch (error) {
      throw new RefinementUpstreamError(
        "upstream_unavailable",
        error instanceof Error ? error.message : "Refinement upstream failed.",
        { retryable: true, statusCode: 503 },
      );
    }

    const text = await response.text();
    let payload = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      throw new RefinementUpstreamError(
        "upstream_response_invalid",
        "Refinement upstream returned invalid JSON.",
      );
    }

    if (!response.ok) {
      const detail = payload?.detail;
      throw new RefinementUpstreamError(
        "upstream_rejected",
        payload?.message ??
          detail?.message ??
          (typeof detail === "string" ? detail : null) ??
          "Refinement upstream rejected the request.",
        {
          payload,
          retryable:
            payload?.retryable === true ||
            detail?.retryable === true ||
            response.status >= 500,
          statusCode: response.status,
        },
      );
    }
    return payload;
  }

  return { post };
}
