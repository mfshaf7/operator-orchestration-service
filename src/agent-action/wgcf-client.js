import { canonicalStringify } from "../delivery-art/canonical-json.js";
import { HttpError } from "../errors.js";
import { createWgcfAuthenticatedJsonTransport } from "../wgcf-transport.js";

const MAX_AGENT_ACTION_REQUEST_BYTES = 64 * 1024;
const MAX_AGENT_ACTION_RESPONSE_BYTES = 128 * 1024;

export function createWgcfAgentActionClient({
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
    errorPrefix: "wgcf_agent_action",
    fetchImpl,
    label: "WGCF agent-action evaluation",
    maxResponseBytes: MAX_AGENT_ACTION_RESPONSE_BYTES,
    statusDetailKey: "evaluation_status",
  });

  return {
    async evaluate({ request, current }) {
      const body = canonicalStringify({ request, current });
      if (Buffer.byteLength(body, "utf8") > MAX_AGENT_ACTION_REQUEST_BYTES) {
        throw new HttpError(
          413,
          "wgcf_agent_action_request_oversized",
          "WGCF agent-action evaluation request exceeds the bounded payload limit.",
        );
      }
      const response = await transport.request("/v1/agent-actions/evaluate", {
        body,
        method: "POST",
      });
      if (
        !response?.evaluation?.decision ||
        typeof response.evaluation.decision !== "object" ||
        Array.isArray(response.evaluation.decision)
      ) {
        throw new HttpError(
          502,
          "wgcf_agent_action_invalid_response",
          "WGCF agent-action evaluation returned an incomplete decision.",
        );
      }
      return structuredClone(response.evaluation);
    },
  };
}
