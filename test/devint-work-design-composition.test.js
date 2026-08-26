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
const upScript = path.join(profileRoot, "scripts/up.sh");
const contextBaseUrl =
  "http://context-governance-gateway-api.devint-context-governance-gateway-test.svc.cluster.local:8080";
const gatewayBaseUrl =
  "http://governed-ai-gateway.devint-governed-ai-gateway-test.svc.cluster.local:8080";
const callerSecret = "work-design-composition-secret";

function createHarness(overrides = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), "oos-work-design-composition-"));
  const bin = path.join(root, "bin");
  const stateRoot = path.join(root, "state");
  mkdirSync(bin, { recursive: true });
  mkdirSync(stateRoot, { recursive: true });
  const k3s = path.join(bin, "k3s");
  writeFileSync(
    k3s,
    `#!/usr/bin/env bash
printf '%s\n' "$*" >> "\${TEST_K3S_LOG}"
if [[ "$*" == *"data.CGG_WORK_DESIGN_BASE_URL"* ]]; then
  printf '%s' "\${TEST_CONTEXT_ENCODED:-}"
elif [[ "$*" == *"data.GOVERNED_AI_GATEWAY_BASE_URL"* ]]; then
  printf '%s' "\${TEST_GATEWAY_ENCODED:-}"
elif [[ "$*" == *"data.CGG_WORK_DESIGN_CALLER_ID"* ]]; then
  printf '%s' "\${TEST_CALLER_ID_ENCODED:-}"
elif [[ "$*" == *"data.CGG_WORK_DESIGN_CALLER_SECRET"* ]]; then
  printf '%s' "\${TEST_CALLER_ENCODED:-}"
fi
`,
  );
  chmodSync(k3s, 0o700);
  const env = {
    ...process.env,
    CGG_WORK_DESIGN_BASE_URL: contextBaseUrl,
    CGG_WORK_DESIGN_CALLER_ID: "operator-orchestration-service",
    CGG_WORK_DESIGN_CALLER_SECRET: callerSecret,
    DEVINT_COMPOSITION_ID: "work-design-advice",
    DEVINT_NAMESPACE: "devint-accepted-idea-delivery-test",
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
    PATH: `${bin}:${process.env.PATH}`,
    TEST_CALLER_ENCODED: Buffer.from(callerSecret).toString("base64"),
    TEST_CALLER_ID_ENCODED: Buffer.from(
      "operator-orchestration-service",
    ).toString("base64"),
    TEST_CONTEXT_ENCODED: Buffer.from(contextBaseUrl).toString("base64"),
    TEST_GATEWAY_ENCODED: Buffer.from(gatewayBaseUrl).toString("base64"),
    TEST_K3S_LOG: path.join(stateRoot, "k3s.log"),
    ...overrides,
  };
  return {
    cleanup: () => rmSync(root, { force: true, recursive: true }),
    env,
    root,
  };
}

function runCommon(command, overrides = {}) {
  const harness = createHarness(overrides);
  try {
    return spawnSync(
      "bash",
      ["-c", 'source "$1"; eval "$2"', "bash", commonScript, command],
      { encoding: "utf8", env: harness.env },
    );
  } finally {
    harness.cleanup();
  }
}

test("accepted-idea-delivery accepts only the complete registered composition", () => {
  const accepted = runCommon("validate_work_design_composition_context");
  assert.equal(accepted.status, 0, accepted.stderr);

  const partial = runCommon("validate_work_design_composition_context", {
    CGG_WORK_DESIGN_CALLER_SECRET: "",
  });
  assert.equal(partial.status, 2);
  assert.match(partial.stderr, /did not supply every required OOS projection/);

  const foreign = runCommon("validate_work_design_composition_context", {
    DEVINT_COMPOSITION_ID: "foreign-composition",
  });
  assert.equal(foreign.status, 2);
  assert.match(foreign.stderr, /require the registered work-design-advice composition/);
});

test("Work Design runtime readiness compares all projected values without disclosure", () => {
  const ready = runCommon("work_design_runtime_state");
  assert.equal(ready.status, 0, ready.stderr);
  assert.equal(ready.stdout, "ready");
  assert.doesNotMatch(ready.stdout + ready.stderr, new RegExp(callerSecret));

  const mismatch = runCommon("work_design_runtime_state", {
    TEST_CALLER_ENCODED: Buffer.from("incorrect-secret").toString("base64"),
  });
  assert.equal(mismatch.status, 0, mismatch.stderr);
  assert.equal(mismatch.stdout, "mismatch");

  const stale = runCommon("work_design_runtime_state", {
    CGG_WORK_DESIGN_BASE_URL: "",
    CGG_WORK_DESIGN_CALLER_ID: "",
    CGG_WORK_DESIGN_CALLER_SECRET: "",
    DEVINT_COMPOSITION_ID: "",
    GOVERNED_AI_GATEWAY_BASE_URL: "",
  });
  assert.equal(stale.status, 0, stale.stderr);
  assert.equal(stale.stdout, "stale");
});

test("OOS keeps the composition caller credential ephemeral and teardown-owned", () => {
  const upSource = readFileSync(upScript, "utf8");
  const downSource = readFileSync(downScript, "utf8");

  assert.match(upSource, /validate_work_design_composition_context/);
  assert.match(upSource, /reconcile_work_design_binding/);
  assert.match(upSource, /name: \$\{WORK_DESIGN_CALLER_SECRET_KEY\}/);
  assert.match(upSource, /optional: true/);
  assert.doesNotMatch(upSource, /"CGG_WORK_DESIGN_CALLER_SECRET=/);
  assert.match(downSource, /remove_work_design_binding/);
});

test("teardown removes the caller binding even when composition projections are partial", () => {
  const harness = createHarness({ CGG_WORK_DESIGN_CALLER_SECRET: "" });
  try {
    const result = spawnSync("bash", [downScript], {
      encoding: "utf8",
      env: harness.env,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(
      readFileSync(harness.env.TEST_K3S_LOG, "utf8"),
      /delete secret operator-orchestration-service-work-design-cgg-caller/,
    );
  } finally {
    harness.cleanup();
  }
});

test("startup requires a ready live binding before it can report success", () => {
  const upSource = readFileSync(upScript, "utf8");
  assert.match(upSource, /work_design_state="\$\(work_design_runtime_state\)"/);
  assert.match(upSource, /composed Work Design runtime is \$\{work_design_state\}/);
  assert.match(upSource, /exit 3/);
});
