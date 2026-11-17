import { createWorkDesignJsonClient } from "./http-client.js";

export function createWorkDesignContextClient({ baseUrl, callerId, callerSecret, fetchImpl }) {
  const client = createWorkDesignJsonClient({
    baseUrl,
    fetchImpl,
    headers: {
      "x-cgg-caller-id": callerId,
      "x-cgg-caller-secret": callerSecret,
    },
  });
  return {
    project(request, options) {
      return client.post("/v1/context/work-design/projections", request, options);
    },
  };
}

export function createWorkDesignGatewayClient({ baseUrl, fetchImpl }) {
  const client = createWorkDesignJsonClient({ baseUrl, fetchImpl, timeoutMs: 630_000 });
  return {
    invoke(request, options) {
      return client.post("/v1/governed-ai/invoke", { ...request, selection_evidence_version: 1 }, options);
    },
  };
}
