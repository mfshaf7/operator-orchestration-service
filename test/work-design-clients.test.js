import assert from "node:assert/strict";
import test from "node:test";

import {
  createWorkDesignContextClient,
  createWorkDesignGatewayClient,
} from "../src/work-design/clients.js";
import { loadConfig } from "../src/config.js";
import { WorkDesignUpstreamError } from "../src/work-design/http-client.js";

function response(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return body === null ? "" : JSON.stringify(body);
    },
  };
}

test("Work Design context client uses the admitted CGG route and caller identity", async () => {
  let captured;
  const client = createWorkDesignContextClient({
    baseUrl: "http://cgg.test",
    callerId: "operator-orchestration-service",
    callerSecret: "secret",
    async fetchImpl(url, options) {
      captured = { url: String(url), options };
      return response(200, { status: "ready" });
    },
  });

  await client.project({ request_id: "request-1" });
  assert.equal(captured.url, "http://cgg.test/v1/context/work-design/projections");
  assert.equal(captured.options.headers["x-cgg-caller-id"], "operator-orchestration-service");
  assert.equal(captured.options.headers["x-cgg-caller-secret"], "secret");
});

test("Work Design gateway client preserves bounded denial details", async () => {
  const client = createWorkDesignGatewayClient({
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
    client.invoke({ profile_id: "delivery-work-design-advisor-v1" }),
    (error) =>
      error instanceof WorkDesignUpstreamError &&
      error.payload.audit_ref === "local-ledger:denied-1",
  );
});

test("Work Design upstream configuration is optional and caller-bound", () => {
  const unset = loadConfig({});
  assert.deepEqual(unset.workDesign, {
    contextBaseUrl: "",
    contextCallerId: "operator-orchestration-service",
    contextCallerSecret: "",
    gatewayBaseUrl: "",
  });

  const configured = loadConfig({
    CGG_WORK_DESIGN_BASE_URL: "http://cgg.test",
    CGG_WORK_DESIGN_CALLER_ID: "oos-test",
    CGG_WORK_DESIGN_CALLER_SECRET: "secret",
    GOVERNED_AI_GATEWAY_BASE_URL: "http://gateway.test",
  });
  assert.equal(configured.workDesign.contextCallerId, "oos-test");
  assert.equal(configured.workDesign.contextCallerSecret, "secret");
  assert.equal(configured.workDesign.gatewayBaseUrl, "http://gateway.test");
});
