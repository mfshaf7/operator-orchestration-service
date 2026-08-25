import assert from "node:assert/strict";
import test from "node:test";

import { loadConfig } from "../src/config.js";
import {
  createRefinementContextClient,
  createRefinementGatewayClient,
} from "../src/refinement/clients.js";
import { RefinementUpstreamError } from "../src/refinement/http-client.js";

function response(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() { return body === null ? "" : JSON.stringify(body); },
  };
}

test("Refinement context client uses the admitted CGG route and caller identity", async () => {
  let captured;
  const client = createRefinementContextClient({
    baseUrl: "http://cgg.test",
    callerId: "operator-orchestration-service",
    callerSecret: "secret",
    async fetchImpl(url, options) {
      captured = { url: String(url), options };
      return response(200, { status: "ready" });
    },
  });
  await client.project({ request_id: "request-1" });
  assert.equal(captured.url, "http://cgg.test/v1/context/refinement/projections");
  assert.equal(captured.options.headers["x-cgg-caller-id"], "operator-orchestration-service");
  assert.equal(captured.options.headers["x-cgg-caller-secret"], "secret");
});

test("Refinement gateway client preserves bounded denial details", async () => {
  const client = createRefinementGatewayClient({
    baseUrl: "http://gateway.test",
    async fetchImpl() {
      return response(403, {
        policy_decision: "deny",
        reasons: ["profile-not-active"],
        audit_ref: "local-ledger:denied-1",
      });
    },
  });
  await assert.rejects(
    client.invoke({ profile_id: "delivery-refinement-advisor-v1" }),
    (error) =>
      error instanceof RefinementUpstreamError &&
      error.payload.audit_ref === "local-ledger:denied-1",
  );
});

test("Refinement runtime and upstream activation are denied by default", () => {
  const unset = loadConfig({});
  assert.deepEqual(unset.refinement, {
    contextBaseUrl: "",
    contextCallerId: "operator-orchestration-service",
    contextCallerSecret: "",
    gatewayBaseUrl: "",
    runtimeEnabled: false,
    workerEnabled: false,
    executionAuthorized: false,
  });

  const configured = loadConfig({
    CGG_REFINEMENT_BASE_URL: "http://cgg.test",
    CGG_REFINEMENT_CALLER_ID: "oos-refinement",
    CGG_REFINEMENT_CALLER_SECRET: "secret",
    GOVERNED_AI_GATEWAY_BASE_URL: "http://gateway.test",
    OOS_REFINEMENT_RUNTIME_ENABLED: "true",
    OOS_REFINEMENT_WORKER_ENABLED: "true",
    OOS_REFINEMENT_EXECUTION_AUTHORIZED: "true",
  });
  assert.equal(configured.refinement.contextCallerId, "oos-refinement");
  assert.equal(configured.refinement.runtimeEnabled, true);
  assert.equal(configured.refinement.workerEnabled, true);
  assert.equal(configured.refinement.executionAuthorized, true);
});
