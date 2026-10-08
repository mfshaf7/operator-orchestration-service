import { canonicalStringify } from "../delivery-art/canonical-json.js";
import { HttpError } from "../errors.js";

const MAX_RESPONSE_BYTES = 512 * 1024;

async function responseJson(response, label) {
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
    throw new HttpError(
      response.status >= 500 ? 503 : response.status,
      "agent_console_upstream_rejected",
      `${label} rejected the request.`,
      payload,
    );
  }
  return payload;
}

function postClient({ baseUrl, fetchImpl, headers, label }) {
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
    return responseJson(response, label);
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
  const post = postClient({ baseUrl, fetchImpl, headers: {}, label: "governed Agent Console model access" });
  return { invoke: (request, options) => post("/v1/governed-ai/invoke", request, options) };
}
