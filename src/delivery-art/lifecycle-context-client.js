export class DeliveryArtLifecycleContextUpstreamError extends Error {
  constructor(code, message, {
    payload = null,
    retryable = false,
    statusCode = 502,
  } = {}) {
    super(message);
    this.name = "DeliveryArtLifecycleContextUpstreamError";
    this.code = code;
    this.payload = payload;
    this.retryable = retryable;
    this.statusCode = statusCode;
  }

  toResponse() {
    return {
      error: this.code,
      message: this.message,
      details: { retryable: this.retryable },
    };
  }
}

export function createDeliveryArtLifecycleContextClient({
  baseUrl,
  callerId = "operator-orchestration-service",
  callerSecret,
  fetchImpl = globalThis.fetch,
} = {}) {
  const configured = Boolean(baseUrl && callerId && callerSecret);

  async function project(request) {
    if (!configured) {
      throw new DeliveryArtLifecycleContextUpstreamError(
        "lifecycle_context_not_configured",
        "Lifecycle context projection is not commissioned.",
        { statusCode: 503 },
      );
    }
    let response;
    try {
      response = await fetchImpl(
        new URL("/v1/context/lifecycle/projections", baseUrl),
        {
          body: JSON.stringify(request),
          headers: {
            "Content-Type": "application/json",
            "x-cgg-caller-id": callerId,
            "x-cgg-caller-secret": callerSecret,
          },
          method: "POST",
        },
      );
    } catch (error) {
      throw new DeliveryArtLifecycleContextUpstreamError(
        "lifecycle_context_unavailable",
        error instanceof Error ? error.message : "CGG lifecycle projection failed.",
        { retryable: true, statusCode: 503 },
      );
    }

    const text = await response.text();
    let payload = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      throw new DeliveryArtLifecycleContextUpstreamError(
        "lifecycle_context_response_invalid",
        "CGG lifecycle projection returned invalid JSON.",
      );
    }
    if (!response.ok) {
      throw new DeliveryArtLifecycleContextUpstreamError(
        payload?.code ?? "lifecycle_context_rejected",
        payload?.message ?? payload?.detail?.message ?? "CGG rejected lifecycle context.",
        {
          payload,
          retryable: payload?.retryable === true || response.status >= 500,
          statusCode: response.status,
        },
      );
    }
    return payload;
  }

  return { callerId, configured, project };
}
