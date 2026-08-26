import assert from "node:assert/strict";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const profileRoot = path.join(
  repoRoot,
  "dev-integration/profiles/accepted-idea-delivery",
);
const commonScript = path.join(profileRoot, "scripts/common.sh");
const downScript = path.join(profileRoot, "scripts/down.sh");
const smokeScript = path.join(profileRoot, "scripts/smoke.sh");
const statusScript = path.join(profileRoot, "scripts/status.sh");
const upScript = path.join(profileRoot, "scripts/up.sh");

const namespace = "devint-accepted-idea-delivery-test";
const contextBaseUrl =
  "http://context-governance-gateway-api.devint-context-governance-gateway-test.svc.cluster.local:8080";
const gatewayBaseUrl =
  "http://governed-ai-gateway.devint-governed-ai-gateway-test.svc.cluster.local:8080";
const wgcfBaseUrl =
  "http://workspace-governance-control-fabric-api.devint-governance-control-fabric-test.svc.cluster.local:8080";
const catalogBaseUrl = `http://openproject.${namespace}.svc.cluster.local:8080`;
const temporalAddress =
  "temporal-frontend.devint-temporal-test.svc.cluster.local:7233";
const temporalNamespace = "governance-test-operator";
const refinementSecret = "refinement-cgg-secret-0123456789abcdef";
const wgcfSecret = "catalog-wgcf-secret-0123456789abcdef";
const catalogSecret = "catalog-control-secret-0123456789abcdef";

function encode(value) {
  return Buffer.from(value).toString("base64");
}

function createHarness(overrides = {}) {
  const root = mkdtempSync(
    path.join(os.tmpdir(), "oos-refinement-catalog-composition-"),
  );
  const bin = path.join(root, "bin");
  const stateRoot = path.join(root, "state");
  mkdirSync(bin, { recursive: true });
  mkdirSync(stateRoot, { recursive: true });
  const k3s = path.join(bin, "k3s");
  writeFileSync(
    k3s,
    `#!/usr/bin/env bash
printf '%s\n' "$*" >> "\${TEST_K3S_LOG}"
query="$*"
case "$query" in
  *"get secret operator-orchestration-service-refinement-bindings -o name"*) printf 'secret/operator-orchestration-service-refinement-bindings' ;;
  *"get secret delivery-catalog-control-caller -o name"*) printf 'secret/delivery-catalog-control-caller' ;;
  *"additional_environment"*) printf 'require extension' ;;
  *"openproject_delivery_catalog_control"*) printf 'catalog extension' ;;
  *"catalog-control-contract"*) printf '{"schema_version":1}' ;;
  *"get service openproject"*) printf 'devint-accepted-idea-delivery-openproject.${namespace}.svc.cluster.local' ;;
  *"get deployment operator-orchestration-service-refinement-worker"*) printf '%s' "\${TEST_WORKER_AVAILABLE:-1}" ;;
  *"data.CGG_REFINEMENT_CALLER_SECRET"*) printf '%s' "\${TEST_REFINEMENT_SECRET_ENCODED:-}" ;;
  *"data.WGCF_REPOSITORY_READINESS_CALLER_SECRET"*) printf '%s' "\${TEST_WGCF_SECRET_ENCODED:-}" ;;
  *"data.OPENPROJECT_CATALOG_CONTROL_TOKEN"*) printf '%s' "\${TEST_CATALOG_TOKEN_ENCODED:-}" ;;
  *"data.OPENPROJECT_CATALOG_CONTROL_SHARED_SECRET"*) printf '%s' "\${TEST_CATALOG_SHARED_ENCODED:-}" ;;
  *"data.CGG_REFINEMENT_BASE_URL"*) printf '%s' "\${TEST_CGG_BASE_ENCODED:-}" ;;
  *"data.CGG_REFINEMENT_CALLER_ID"*) printf '%s' "\${TEST_CGG_CALLER_ID_ENCODED:-}" ;;
  *"data.GOVERNED_AI_GATEWAY_BASE_URL"*) printf '%s' "\${TEST_GATEWAY_ENCODED:-}" ;;
  *"data.WGCF_REPOSITORY_READINESS_BASE_URL"*) printf '%s' "\${TEST_WGCF_BASE_ENCODED:-}" ;;
  *"data.WGCF_REPOSITORY_READINESS_CALLER_ID"*) printf '%s' "\${TEST_WGCF_CALLER_ID_ENCODED:-}" ;;
  *"data.OPENPROJECT_CATALOG_CONTROL_BASE_URL"*) printf '%s' "\${TEST_CATALOG_BASE_ENCODED:-}" ;;
  *"data.OOS_REFINEMENT_RUNTIME_ENABLED"*) printf '%s' "\${TEST_TRUE_ENCODED:-}" ;;
  *"data.OOS_REFINEMENT_WORKER_ENABLED"*) printf '%s' "\${TEST_TRUE_ENCODED:-}" ;;
  *"data.OOS_REFINEMENT_EXECUTION_AUTHORIZED"*) printf '%s' "\${TEST_TRUE_ENCODED:-}" ;;
  *"data.OOS_TEMPORAL_ADDRESS"*) printf '%s' "\${TEST_TEMPORAL_ADDRESS_ENCODED:-}" ;;
  *"data.OOS_TEMPORAL_NAMESPACE"*) printf '%s' "\${TEST_TEMPORAL_NAMESPACE_ENCODED:-}" ;;
esac
`,
  );
  chmodSync(k3s, 0o700);
  const env = {
    ...process.env,
    CGG_REFINEMENT_BASE_URL: contextBaseUrl,
    CGG_REFINEMENT_CALLER_ID: "operator-orchestration-service",
    CGG_REFINEMENT_CALLER_SECRET: refinementSecret,
    DEVINT_COMPOSITION_ID: "refinement-catalog",
    DEVINT_NAMESPACE: namespace,
    DEVINT_OPERATOR: "test-operator",
    DEVINT_PROFILE_FILE: path.join(profileRoot, "profile.yaml"),
    DEVINT_PROFILE_ID: "accepted-idea-delivery",
    DEVINT_PROFILE_JSON: JSON.stringify({
      runtime: { state_model: "persistent" },
      stage_handoff: { required_checks: [] },
      summary: "test profile",
      testing: { smoke: {} },
    }),
    DEVINT_PROMOTION_REPORT: path.join(stateRoot, "promotion-report.yaml"),
    DEVINT_REPO_PATHS_JSON: "{}",
    DEVINT_REPO_STATES_JSON: "{}",
    DEVINT_SESSION_FILE: path.join(stateRoot, "current-session.yaml"),
    DEVINT_STATE_ROOT: stateRoot,
    DEVINT_WORKSPACE_ROOT: root,
    GOVERNED_AI_GATEWAY_BASE_URL: gatewayBaseUrl,
    OPENPROJECT_CATALOG_CONTROL_BASE_URL: catalogBaseUrl,
    OPENPROJECT_CATALOG_CONTROL_SHARED_SECRET: catalogSecret,
    OPENPROJECT_CATALOG_CONTROL_TOKEN: catalogSecret,
    OOS_REFINEMENT_EXECUTION_AUTHORIZED: "true",
    OOS_REFINEMENT_RUNTIME_ENABLED: "true",
    OOS_REFINEMENT_WORKER_ENABLED: "true",
    OOS_TEMPORAL_ADDRESS: temporalAddress,
    OOS_TEMPORAL_NAMESPACE: temporalNamespace,
    PATH: `${bin}:${process.env.PATH}`,
    TEST_CATALOG_BASE_ENCODED: encode(catalogBaseUrl),
    TEST_CATALOG_SHARED_ENCODED: encode(catalogSecret),
    TEST_CATALOG_TOKEN_ENCODED: encode(catalogSecret),
    TEST_CGG_BASE_ENCODED: encode(contextBaseUrl),
    TEST_CGG_CALLER_ID_ENCODED: encode("operator-orchestration-service"),
    TEST_GATEWAY_ENCODED: encode(gatewayBaseUrl),
    TEST_K3S_LOG: path.join(stateRoot, "k3s.log"),
    TEST_REFINEMENT_SECRET_ENCODED: encode(refinementSecret),
    TEST_TEMPORAL_ADDRESS_ENCODED: encode(temporalAddress),
    TEST_TEMPORAL_NAMESPACE_ENCODED: encode(temporalNamespace),
    TEST_TRUE_ENCODED: encode("true"),
    TEST_WGCF_BASE_ENCODED: encode(wgcfBaseUrl),
    TEST_WGCF_CALLER_ID_ENCODED: encode("operator-orchestration-service"),
    TEST_WGCF_SECRET_ENCODED: encode(wgcfSecret),
    WGCF_REPOSITORY_READINESS_BASE_URL: wgcfBaseUrl,
    WGCF_REPOSITORY_READINESS_CALLER_ID: "operator-orchestration-service",
    WGCF_REPOSITORY_READINESS_CALLER_SECRET: wgcfSecret,
    ...overrides,
  };
  return {
    cleanup: () => rmSync(root, { force: true, recursive: true }),
    env,
  };
}

function runCommon(command, overrides = {}) {
  const harness = createHarness(overrides);
  try {
    const result = spawnSync(
      "bash",
      ["-c", 'source "$1"; eval "$2"', "bash", commonScript, command],
      { encoding: "utf8", env: harness.env },
    );
    result.k3sLog = readFileSync(harness.env.TEST_K3S_LOG, {
      encoding: "utf8",
      flag: "a+",
    });
    return result;
  } finally {
    harness.cleanup();
  }
}

test("the exact Refinement and Catalog composition is accepted", () => {
  const accepted = runCommon("validate_refinement_catalog_composition_context");
  assert.equal(accepted.status, 0, accepted.stderr);

  const missing = runCommon("validate_refinement_catalog_composition_context", {
    WGCF_REPOSITORY_READINESS_CALLER_SECRET: "",
  });
  assert.equal(missing.status, 2);
  assert.match(missing.stderr, /did not supply WGCF_REPOSITORY_READINESS_CALLER_SECRET/);

  const foreign = runCommon("validate_refinement_catalog_composition_context", {
    DEVINT_COMPOSITION_ID: "foreign-composition",
  });
  assert.equal(foreign.status, 2);
  assert.match(foreign.stderr, /require the registered refinement-catalog composition/);
});

test("shared gateway projection does not make registered compositions conflict", () => {
  const refinement = runCommon(
    "validate_work_design_composition_context; validate_refinement_catalog_composition_context",
  );
  assert.equal(refinement.status, 0, refinement.stderr);

  const workDesignState = runCommon("work_design_runtime_state");
  assert.equal(workDesignState.status, 0, workDesignState.stderr);
  assert.equal(workDesignState.stdout, "absent");

  const workDesign = runCommon(
    "validate_work_design_composition_context; validate_refinement_catalog_composition_context",
    {
      CGG_REFINEMENT_BASE_URL: "",
      CGG_REFINEMENT_CALLER_ID: "",
      CGG_REFINEMENT_CALLER_SECRET: "",
      DEVINT_COMPOSITION_ID: "work-design-advice",
      OPENPROJECT_CATALOG_CONTROL_BASE_URL: "",
      OPENPROJECT_CATALOG_CONTROL_SHARED_SECRET: "",
      OPENPROJECT_CATALOG_CONTROL_TOKEN: "",
      OOS_REFINEMENT_EXECUTION_AUTHORIZED: "",
      OOS_REFINEMENT_RUNTIME_ENABLED: "",
      OOS_REFINEMENT_WORKER_ENABLED: "",
      WGCF_REPOSITORY_READINESS_BASE_URL: "",
      WGCF_REPOSITORY_READINESS_CALLER_ID: "",
      WGCF_REPOSITORY_READINESS_CALLER_SECRET: "",
      CGG_WORK_DESIGN_BASE_URL: contextBaseUrl,
      CGG_WORK_DESIGN_CALLER_ID: "operator-orchestration-service",
      CGG_WORK_DESIGN_CALLER_SECRET: refinementSecret,
    },
  );
  assert.equal(workDesign.status, 0, workDesign.stderr);
});

test("invalid endpoint, identity, activation, and credential bindings fail closed", () => {
  const endpoint = runCommon("validate_refinement_catalog_composition_context", {
    OPENPROJECT_CATALOG_CONTROL_BASE_URL: "http://example.invalid:8080",
  });
  assert.notEqual(endpoint.status, 0);
  assert.match(endpoint.stderr, /declared cluster-local HTTP service endpoint/);

  const identity = runCommon("validate_refinement_catalog_composition_context", {
    WGCF_REPOSITORY_READINESS_CALLER_ID: "another-service",
  });
  assert.equal(identity.status, 2);
  assert.match(identity.stderr, /caller identities/);

  const activation = runCommon("validate_refinement_catalog_composition_context", {
    OOS_REFINEMENT_WORKER_ENABLED: "false",
  });
  assert.equal(activation.status, 2);
  assert.match(activation.stderr, /activation settings/);

  const legacyNamespace = runCommon(
    "validate_refinement_catalog_composition_context",
    { OOS_TEMPORAL_NAMESPACE: "default" },
  );
  assert.equal(legacyNamespace.status, 2);
  assert.match(legacyNamespace.stderr, /activation settings/);

  const foreignNamespace = runCommon(
    "validate_refinement_catalog_composition_context",
    { OOS_TEMPORAL_NAMESPACE: "governance-another-operator" },
  );
  assert.equal(foreignNamespace.status, 2);
  assert.match(foreignNamespace.stderr, /activation settings/);

  const credential = runCommon("validate_refinement_catalog_composition_context", {
    OPENPROJECT_CATALOG_CONTROL_SHARED_SECRET: `${catalogSecret}-different`,
  });
  assert.equal(credential.status, 2);
  assert.match(credential.stderr, /not bound to the OpenProject shared secret/);
});

test("runtime readiness compares every binding without disclosing credentials", () => {
  const ready = runCommon("refinement_catalog_runtime_state");
  assert.equal(ready.status, 0, ready.stderr);
  assert.equal(ready.stdout, "ready", `${ready.stderr}\n${ready.k3sLog}`);
  assert.doesNotMatch(
    ready.stdout + ready.stderr,
    new RegExp(`${refinementSecret}|${wgcfSecret}|${catalogSecret}`),
  );

  const mismatch = runCommon("refinement_catalog_runtime_state", {
    TEST_CATALOG_SHARED_ENCODED: encode("wrong-secret"),
  });
  assert.equal(mismatch.status, 0, mismatch.stderr);
  assert.equal(mismatch.stdout, "mismatch");
});

test("startup mounts canonical Catalog source and keeps credentials ephemeral", () => {
  const source = readFileSync(upScript, "utf8");
  assert.match(source, /products\/openproject\/catalog-control\/additional_environment\.rb/);
  assert.match(source, /products\/openproject\/catalog-control\/openproject_delivery_catalog_control\.rb/);
  assert.match(source, /products\/openproject\/catalog-control\/catalog-control-contract\.json/);
  assert.match(source, /mountPath: \/app\/config\/additional_environment\.rb/);
  assert.match(source, /command: \["node", "src\/refinement-worker\.js"\]/);
  assert.match(source, /if is_refinement_catalog_composition; then/);
  assert.doesNotMatch(source, /f"CGG_REFINEMENT_CALLER_SECRET=/);
  assert.doesNotMatch(source, /f"WGCF_REPOSITORY_READINESS_CALLER_SECRET=/);
  assert.doesNotMatch(source, /f"OPENPROJECT_CATALOG_CONTROL_TOKEN=/);
});

test("teardown removes every composition-owned resource", () => {
  const harness = createHarness();
  try {
    const result = spawnSync("bash", [downScript], {
      encoding: "utf8",
      env: harness.env,
    });
    assert.equal(result.status, 0, result.stderr);
    const log = readFileSync(harness.env.TEST_K3S_LOG, "utf8");
    assert.match(log, /delete deployment operator-orchestration-service-refinement-worker/);
    assert.match(log, /operator-orchestration-service-refinement-bindings delivery-catalog-control-caller/);
    assert.match(log, /delete configmap delivery-catalog-control/);
    assert.match(log, /delete service openproject/);
  } finally {
    harness.cleanup();
  }
});

test("status owns active readiness and inactive stale detection", () => {
  const source = readFileSync(statusScript, "utf8");
  assert.match(source, /validate_refinement_catalog_composition_context/);
  assert.match(source, /composed Refinement and Catalog runtime/);
  assert.match(source, /stale Refinement or Catalog projections/);
});

test("read-only smoke proves the composed worker and Catalog projection", () => {
  const source = readFileSync(smokeScript, "utf8");
  assert.match(source, /refinement_catalog_state="\$\(refinement_catalog_runtime_state\)"/);
  assert.match(source, /refinement_worker_replicas/);
  assert.match(source, /\/v1\/delivery-catalog\/projection/);
  assert.match(source, /Delivery Catalog authorization and canonical readback failed/);
  assert.doesNotMatch(source, /delivery-catalog\/[^\s]+\/mutations/);
});
