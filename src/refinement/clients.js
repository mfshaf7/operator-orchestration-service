import { createRefinementJsonClient } from "./http-client.js";

export function createRefinementContextClient({
  baseUrl,
  callerId,
  callerSecret,
  fetchImpl,
}) {
  const client = createRefinementJsonClient({
    baseUrl,
    fetchImpl,
    headers: {
      "x-cgg-caller-id": callerId,
      "x-cgg-caller-secret": callerSecret,
    },
  });
  return {
    project(request) {
      return client.post("/v1/context/refinement/projections", request);
    },
  };
}

export function createRefinementGatewayClient({ baseUrl, fetchImpl }) {
  const client = createRefinementJsonClient({ baseUrl, fetchImpl });
  return {
    invoke(request) {
      return client.post("/v1/governed-ai/invoke", request);
    },
  };
}
