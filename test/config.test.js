import test from "node:test";
import assert from "node:assert/strict";

import {
  getAcceptedIdeaDeliveryMissingConfig,
  getDeliveryWorkItemCreateMissingConfig,
  getProposalWorkflowMissingConfig,
  getWgcfArtReadinessMissingConfig,
  loadConfig,
} from "../src/config.js";
import { getOrchestrationActivationMissingConfig } from "../src/orchestration/catalog.js";

test("service binds all interfaces by default for container and cluster reachability", () => {
  const config = loadConfig({});

  assert.equal(config.service.host, "0.0.0.0");
  assert.equal(config.service.port, 8080);
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

test("Proposal workflow reports its machine-state persistence dependency", () => {
  const config = loadConfig({
    OPENPROJECT_API_TOKEN: "test-token",
    OPENPROJECT_BASE_URL: "http://openproject.test",
    OPENPROJECT_IDEA_TYPE_ID: "41",
    OPENPROJECT_CAPTURED_STATUS_ID: "81",
    OPENPROJECT_TRIAGED_STATUS_ID: "82",
    OPENPROJECT_PARKED_STATUS_ID: "83",
    OPENPROJECT_ACCEPTED_STATUS_ID: "85",
    OPENPROJECT_REJECTED_STATUS_ID: "80",
    OPENPROJECT_CUSTOM_FIELD_SOURCE_SURFACE_ID: "1",
    OPENPROJECT_CUSTOM_FIELD_SOURCE_REFERENCE_ID: "2",
  });

  assert.deepEqual(getProposalWorkflowMissingConfig(config), [
    "OPENPROJECT_CUSTOM_FIELD_PROPOSAL_WORKFLOW_STATE_ID",
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

test("Delivery ART runtime config separates caller binding from WGCF service identity", () => {
  const config = loadConfig({
    CALLER_AUTH_SECRETS_JSON: JSON.stringify({
      "operator:workspace-owner": "operator-specific-secret",
    }),
    OOS_DELIVERY_ART_MUTATION_ENABLED: "true",
    OOS_DELIVERY_ART_WRITER_TOPOLOGY: "single-writer",
    WGCF_DELIVERY_ART_BASE_URL: "http://wgcf.local",
    WGCF_DELIVERY_ART_CALLER_ID: "operator-orchestration-service",
    WGCF_DELIVERY_ART_CALLER_SECRET: "s".repeat(32),
  });

  assert.deepEqual(config.callerAuth.callerSecrets, {
    "operator:workspace-owner": "operator-specific-secret",
  });
  assert.deepEqual(config.deliveryArt, {
    mutationEnabled: true,
    writerTopology: "single-writer",
  });
  assert.deepEqual(config.wgcf, {
    artReadinessBaseUrl: "",
    artReadinessMode: "off",
    deliveryArtBaseUrl: "http://wgcf.local",
    deliveryArtCallerId: "operator-orchestration-service",
    deliveryArtCallerSecret: "s".repeat(32),
  });
});

test("Catalog runtime is inactive by default and reuses admitted WGCF caller binding", () => {
  const config = loadConfig({
    WGCF_DELIVERY_ART_BASE_URL: "http://wgcf.local",
    WGCF_DELIVERY_ART_CALLER_ID: "operator-orchestration-service",
    WGCF_DELIVERY_ART_CALLER_SECRET: "s".repeat(32),
  });

  assert.deepEqual(config.catalog, {
    backendBaseUrl: "",
    backendToken: "",
    readinessBaseUrl: "http://wgcf.local",
    readinessCallerId: "operator-orchestration-service",
    readinessCallerSecret: "s".repeat(32),
  });
});

test("Catalog runtime accepts an independently composed readiness caller", () => {
  const config = loadConfig({
    OPENPROJECT_CATALOG_CONTROL_BASE_URL: "http://catalog-control.local",
    OPENPROJECT_CATALOG_CONTROL_TOKEN: "t".repeat(32),
    WGCF_REPOSITORY_READINESS_BASE_URL: "http://readiness.local",
    WGCF_REPOSITORY_READINESS_CALLER_ID: "oos-catalog",
    WGCF_REPOSITORY_READINESS_CALLER_SECRET: "r".repeat(32),
  });

  assert.deepEqual(config.catalog, {
    backendBaseUrl: "http://catalog-control.local",
    backendToken: "t".repeat(32),
    readinessBaseUrl: "http://readiness.local",
    readinessCallerId: "oos-catalog",
    readinessCallerSecret: "r".repeat(32),
  });
});

test("caller-specific auth rejects ambiguous or shared secret material", () => {
  assert.throws(
    () => loadConfig({
      CALLER_AUTH_SECRETS_JSON: JSON.stringify({
        "operator:a": "same-secret",
        "operator:b": "same-secret",
      }),
    }),
    /distinct secrets/,
  );
  assert.throws(
    () => loadConfig({
      CALLER_AUTH_SECRETS_JSON: JSON.stringify({
        "operator:a": "shared-secret",
      }),
      CALLER_AUTH_SHARED_SECRET: "shared-secret",
    }),
    /distinct secrets/,
  );
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
