import { canonicalStringify } from "../delivery-art/canonical-json.js";
import { HttpError } from "../errors.js";

const MAX_RESPONSE_BYTES = 512 * 1024;

async function responseJson(response, label, modelOutcome = false) {
  const text = await response.text();
  if (Buffer.byteLength(text, "utf8") > MAX_RESPONSE_BYTES) {
    throw new HttpError(502, "agent_console_upstream_oversized", `${label} response exceeded the bounded limit.`);
  }
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new HttpError(502, "agent_console_upstream_invalid", `${label} returned invalid JSON.`);
  }
  if (!response.ok) {
    if (modelOutcome && payload && typeof payload === "object" && payload.policy_decision !== "deny") {
      const outcomes = (Array.isArray(payload.effective_selection?.attempts) ? payload.effective_selection.attempts : []).map(attempt => attempt.outcome);
      const reasons = Array.isArray(payload.reasons) ? payload.reasons : [];
      // A completed policy-allowed routing attempt is not an access denial.
      // Unknown completion stays non-retryable and must never start a replay.
      if (outcomes.includes("provider-completion-unknown") || reasons.includes("provider-completion-unknown"))
        throw new HttpError(503, "agent_console_ai_completion_unknown", "The original advisor response was not confirmed. Your draft is retained; the provider may still finish. No request was automatically repeated.", payload);
      if (outcomes.length && outcomes.every(outcome => outcome === "provider-busy"))
        throw new HttpError(429, "agent_console_ai_provider_busy", "The selected AI account is busy with another request. Your draft is retained; wait for that request to finish before asking again.", payload);
      if (outcomes.includes("provider-context-exceeded") || reasons.includes("provider-context-exceeded"))
        throw new HttpError(413, "agent_console_ai_context_capacity_exceeded", "The selected model cannot fit this complete request. Choose a suitable model or a smaller scope; no context was silently removed.", payload);
    }
    throw new HttpError(
      response.status >= 500 ? 503 : response.status,
      "agent_console_upstream_rejected",
      `${label} rejected the request.`,
      payload,
    );
  }
  return payload;
}

function postClient({ baseUrl, fetchImpl, headers, label, modelOutcome = false }) {
  return async (path, body, { signal } = {}) => {
    if (!baseUrl) {
      throw new HttpError(503, "agent_console_upstream_not_configured", `${label} is not configured.`);
    }
    const response = await fetchImpl(new URL(path, baseUrl), {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: canonicalStringify(body),
      signal,
    });
    return responseJson(response, label, modelOutcome);
  };
}

export function createAgentConsoleContextClient({ baseUrl, callerId, callerSecret, fetchImpl = globalThis.fetch }) {
  const post = postClient({
    baseUrl,
    fetchImpl,
    headers: {
      "x-cgg-caller-id": callerId,
      "x-cgg-caller-secret": callerSecret,
    },
    label: "CGG Agent Console projection",
  });
  return { project: (request, options) => post("/v1/context/agent-console/projections", request, options) };
}

export function createAgentConsoleGatewayClient({ baseUrl, fetchImpl = globalThis.fetch }) {
  const post = postClient({ baseUrl, fetchImpl, headers: {}, label: "governed Agent Console model access", modelOutcome: true });
  return { invoke: (request, options) => post("/v1/governed-ai/invoke", { ...request, selection_evidence_version: 1 }, options) };
}
