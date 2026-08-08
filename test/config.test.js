import test from "node:test";
import assert from "node:assert/strict";

import {
  getAcceptedIdeaDeliveryMissingConfig,
  getDeliveryWorkItemCreateMissingConfig,
  getWgcfArtReadinessMissingConfig,
  loadConfig,
} from "../src/config.js";
import { getOrchestrationActivationMissingConfig } from "../src/orchestration/catalog.js";

test("service binds all interfaces by default for container and cluster reachability", () => {
  const config = loadConfig({});

  assert.equal(config.service.host, "0.0.0.0");
  assert.equal(config.service.port, 8080);
});

test("caller-specific credentials are parsed without weakening shared compatibility", () => {
  const config = loadConfig({
    CALLER_ALLOWED_IDS: "operator,workspace-governance-control-fabric",
    CALLER_AUTH_SECRETS_JSON: JSON.stringify({
      operator: "operator-secret",
      "workspace-governance-control-fabric": "wgcf-secret",
    }),
    CALLER_AUTH_SHARED_SECRET: "legacy-shared-secret",
  });

  assert.deepEqual(config.callerAuth.callerSecrets, {
    operator: "operator-secret",
    "workspace-governance-control-fabric": "wgcf-secret",
  });
});

test("caller-specific credential configuration fails closed when invalid", () => {
  for (const value of [
    "{",
    "[]",
    JSON.stringify({ operator: "" }),
    JSON.stringify({ "": "operator-secret" }),
    JSON.stringify({ operator: 42 }),
  ]) {
    assert.throws(
      () => loadConfig({ CALLER_AUTH_SECRETS_JSON: value }),
      (error) =>
        error instanceof TypeError &&
        error.message.includes("CALLER_AUTH_SECRETS_JSON"),
    );
  }
});

test("accepted idea delivery reports missing delivery-art configuration when unset", () => {
  const config = loadConfig({});

  assert.deepEqual(getAcceptedIdeaDeliveryMissingConfig(config), [
    "OPENPROJECT_DELIVERY_PROJECT_IDENTIFIER",
    "OPENPROJECT_DELIVERY_TOP_LEVEL_TYPE_ID",
    "OPENPROJECT_DELIVERY_NEW_STATUS_ID",
    "OPENPROJECT_CUSTOM_FIELD_DELIVERY_REF_ID",
    "OPENPROJECT_DELIVERY_CUSTOM_FIELD_ORIGIN_IDEA_REF_ID",
    "OPENPROJECT_DELIVERY_CUSTOM_FIELD_PM2_PHASE_ID",
    "OPENPROJECT_DELIVERY_CUSTOM_FIELD_TARGET_PI_ID",
  ]);
});

test("delivery work-item create requires only the bounded delivery execution config", () => {
  const config = loadConfig({});

  assert.deepEqual(getDeliveryWorkItemCreateMissingConfig(config), [
    "OPENPROJECT_BASE_URL",
    "OPENPROJECT_API_TOKEN",
    "OPENPROJECT_DELIVERY_PROJECT_IDENTIFIER",
  ]);
});

test("WGCF ART readiness config is required only in required mode", () => {
  assert.deepEqual(getWgcfArtReadinessMissingConfig(loadConfig({})), []);

  const requiredConfig = loadConfig({
    WGCF_ART_READINESS_MODE: "required",
  });
  assert.deepEqual(getWgcfArtReadinessMissingConfig(requiredConfig), [
    "WGCF_ART_READINESS_BASE_URL",
  ]);

  const configured = loadConfig({
    WGCF_ART_READINESS_BASE_URL: "http://wgcf.local",
    WGCF_ART_READINESS_MODE: "required",
  });
  assert.deepEqual(getWgcfArtReadinessMissingConfig(configured), []);
  assert.equal(configured.wgcf.artReadinessMode, "required");
});

test("durable orchestration activation is denied by default", () => {
  const config = loadConfig({});

  assert.equal(config.orchestration.runtimeEnabled, false);
  assert.equal(config.orchestration.workerEnabled, false);
  assert.deepEqual(config.orchestration.retirementEvidence, {
    manifestPath: "",
    manifestDigest: "",
  });
  assert.deepEqual(getOrchestrationActivationMissingConfig(config), [
    "OOS_ORCHESTRATION_ACTIVATION_EVIDENCE_PATH",
    "OOS_ORCHESTRATION_ACTIVATION_EVIDENCE_DIGEST",
    "CALLER_AUTH_SHARED_SECRET",
    "CALLER_ALLOWED_IDS",
    "OOS_ORCHESTRATION_RUNTIME_ENABLED",
    "OOS_ORCHESTRATION_WORKER_ENABLED",
    "OOS_ORCHESTRATION_EXECUTION_AUTHORIZED",
  ]);
});
