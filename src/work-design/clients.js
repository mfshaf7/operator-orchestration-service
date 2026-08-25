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
    project(request) {
      return client.post("/v1/context/work-design/projections", request);
    },
  };
}

export function createWorkDesignGatewayClient({ baseUrl, fetchImpl }) {
  const client = createWorkDesignJsonClient({ baseUrl, fetchImpl });
  return {
    invoke(request) {
      return client.post("/v1/governed-ai/invoke", request);
    },
  };
}
