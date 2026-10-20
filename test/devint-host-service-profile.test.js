import assert from "node:assert/strict";
import {
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
const scriptsRoot = path.join(profileRoot, "scripts");

test("native source runner selects existing composed record custody without changing standalone recovery or launching services", t => {
  const root = mkdtempSync(path.join(os.tmpdir(), "source-admission-runner-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const runner = path.join(root, "run_delivery_source_executor.sh");
  writeFileSync(runner, readFileSync(path.join(scriptsRoot, "run_delivery_source_executor.sh")));
  const oos = path.join(root, "oos");
  const platform = path.join(root, "platform");
  const policy = path.join(platform, "products/governance-operations-console/complete-runtime-policy.yaml");
  mkdirSync(path.dirname(policy), { recursive: true });
  mkdirSync(path.join(oos, "src/delivery-art"), { recursive: true });
  writeFileSync(path.join(oos, "src/delivery-art/source-executor-server.js"), `console.log(JSON.stringify({
    freshness: process.env.OOS_RECORD_AUTHORITY_FRESHNESS_REQUIRED ?? null,
    authority: process.env.OOS_WORKSPACE_INVENTORY_AUTHORITY_ROOT ?? null,
    identity: process.env.OOS_AGENT_SOURCE_IDENTITY_ENABLED,
    contract: process.env.OOS_AGENT_SOURCE_IDENTITY_CONTRACT_PATH
  }));`);
  writeFileSync(path.join(root, "common.sh"), `
ensure_state_dirs() { :; }
ensure_local_secrets() { :; }
load_local_secrets() { :; }
repo_path() {
  case "$1" in
    operator-orchestration-service) printf '%s\\n' "$SOURCE_ADMISSION_TEST_OOS_ROOT" ;;
    platform-engineering) printf '%s\\n' "$SOURCE_ADMISSION_TEST_PLATFORM_ROOT" ;;
    *) return 1 ;;
  esac
}
DELIVERY_SOURCE_EXECUTOR_SOCKET="$SOURCE_ADMISSION_TEST_ROOT/socket"
DELIVERY_SOURCE_EXECUTOR_ID=synthetic-executor
DELIVERY_SOURCE_EXECUTOR_SECRET=synthetic-test-only
DELIVERY_SOURCE_EXECUTOR_RESULT_STORE="$SOURCE_ADMISSION_TEST_ROOT/results"
WORKSPACE_ROOT="$SOURCE_ADMISSION_TEST_ROOT"
AGENT_SOURCE_IDENTITY_ROOT="$SOURCE_ADMISSION_TEST_ROOT/identity"
REFINEMENT_CATALOG_COMPOSITION_ID=refinement-catalog
`);
  const env = { PATH: process.env.PATH, SOURCE_ADMISSION_TEST_ROOT: root,
    SOURCE_ADMISSION_TEST_OOS_ROOT: oos, SOURCE_ADMISSION_TEST_PLATFORM_ROOT: platform };
  const state = path.join(root, "existing-platform-state");
  writeFileSync(policy, JSON.stringify({ runtime_state_root: state, record_authority: { enabled: true } }));
  const standalone = spawnSync("bash", [runner], { env, encoding: "utf8" });
  assert.equal(standalone.status, 0, standalone.stderr);
  assert.equal(JSON.parse(standalone.stdout).freshness, null);
  const composed = spawnSync("bash", [runner], { env: { ...env, DEVINT_COMPOSITION_ID: "refinement-catalog" }, encoding: "utf8" });
  assert.equal(composed.status, 0, composed.stderr);
  const actual = JSON.parse(composed.stdout);
  assert.equal(actual.freshness, "true");
  assert.equal(actual.authority, path.join(state, "record-authority/workspace-governance"));
  assert.equal(actual.identity, "true");
  assert.equal(actual.contract, path.join(oos, "contracts/delivery-art-work-session/agent-source-identity.json"));
  writeFileSync(policy, JSON.stringify({ runtime_state_root: "relative-path", record_authority: { enabled: true } }));
  const invalid = spawnSync("bash", [runner], { env: { ...env, DEVINT_COMPOSITION_ID: "refinement-catalog" }, encoding: "utf8" });
  assert.notEqual(invalid.status, 0);
  assert.match(invalid.stderr, /refused: composed source admission/);
  assert.equal(invalid.stdout, "");
});

test("accepted-idea-delivery delegates reconciler supervision to the shared runner", () => {
  const profile = readFileSync(path.join(profileRoot, "profile.yaml"), "utf8");
  const common = readFileSync(path.join(scriptsRoot, "common.sh"), "utf8");
  const up = readFileSync(path.join(scriptsRoot, "up.sh"), "utf8");
  const down = readFileSync(path.join(scriptsRoot, "down.sh"), "utf8");
  const reset = readFileSync(path.join(scriptsRoot, "reset.sh"), "utf8");
  const sourceExecutor = readFileSync(
    path.join(scriptsRoot, "run_delivery_source_executor.sh"),
    "utf8",
  );

  assert.match(profile, /host_services:\n  - id: delivery-art-view-sync/);
  assert.match(profile, /resume_policy: operator-login/);
  assert.match(profile, /command: .*reconcile_delivery_art_views_loop\.sh/);
  assert.match(profile, /mode: command\n      command: .*reconcile_delivery_art_views_ready\.sh/);
  assert.match(profile, /  - id: delivery-source-executor/);
  assert.match(profile, /command: .*run_delivery_source_executor\.sh/);
  assert.match(profile, /command: .*delivery_source_executor_ready\.sh/);
  assert.match(up, /OOS_DELIVERY_ART_MUTATION_ENABLED", "false"/);
  assert.doesNotMatch(up, /OOS_DELIVERY_ART_MUTATION_ENABLED=true/);
  assert.match(up, /WGCF_REPOSITORY_READINESS_BASE_URL/);
  assert.match(up, /WGCF_REPOSITORY_READINESS_CALLER_SECRET/);
  assert.match(common, /readonly DELIVERY_ART_OPERATOR_CALLER_ID="operator:workspace-owner"/);
  assert.match(
    common,
    /DELIVERY_ART_OPERATOR_CALLER_SECRET=%s\\n'.*generate_random_hex/,
  );
  assert.match(up, /delivery_art_operator_caller_id: delivery_art_operator_caller_secret/);
  assert.match(up, /caller_id: caller_secret/);
  assert.match(
    common,
    /BROKER_SHARED_SECRET=%s\\n'.*generate_random_hex/,
  );
  assert.match(up, /CALLER_AUTH_SHARED_SECRET=\{shared_caller_secret\}/);
  assert.match(up, /validate_local_caller_auth_secrets/);
  assert.match(
    common,
    /local caller-specific secrets must differ from the compatibility shared secret/,
  );
  assert.match(
    common,
    /readonly PROTOTYPE_CLOSURE_WGCF_CALLER_ID="workspace-governance-control-fabric"/,
  );
  assert.match(
    common,
    /PROTOTYPE_CLOSURE_WGCF_CALLER_SECRET=%s\\n'.*generate_random_hex/,
  );
  assert.match(
    common,
    /prototype-closure-wgcf-caller-secret\.txt/,
  );
  assert.match(
    up,
    /prototype_closure_wgcf_caller_id: prototype_closure_wgcf_caller_secret/,
  );
  assert.match(
    up,
    /delivery_art_operator_caller_id: delivery_art_operator_caller_id/,
  );
  assert.match(
    up,
    /governance-operations-console,\{delivery_art_operator_caller_id\}/,
  );
  assert.match(common, /XDG_RUNTIME_DIR:-\/tmp/);
  assert.match(
    common,
    /readonly AGENT_SOURCE_IDENTITY_ROOT="\$\{XDG_RUNTIME_DIR:-\/tmp\}\/platform-engineering\/agent-source-identity"/,
  );
  assert.match(sourceExecutor, /OOS_AGENT_SOURCE_IDENTITY_ENABLED=true/);
  assert.match(sourceExecutor, /OOS_AGENT_SOURCE_IDENTITY_ROOT="\$\{AGENT_SOURCE_IDENTITY_ROOT\}"/);
  assert.match(sourceExecutor, /OOS_AGENT_SOURCE_IDENTITY_CONTRACT_PATH="\$\{agent_source_identity_contract\}"/);
  assert.match(sourceExecutor, /DEVINT_COMPOSITION_ID:-.*REFINEMENT_CATALOG_COMPOSITION_ID/);
  assert.match(sourceExecutor, /OOS_RECORD_AUTHORITY_FRESHNESS_REQUIRED=true/);
  assert.match(sourceExecutor, /OOS_WORKSPACE_INVENTORY_AUTHORITY_ROOT=/);
  assert.match(sourceExecutor, /complete-runtime-policy\.yaml/);
  assert.match(sourceExecutor, /record-authority.*workspace-governance/);
  assert.doesNotMatch(sourceExecutor, /PRIVATE_KEY|GITHUB_TOKEN|GH_TOKEN/);
  assert.doesNotMatch(common, /STATE_ROOT}\/delivery-source-executor/);
  assert.match(
    common,
    /DELIVERY_SOURCE_EXECUTOR_RESULT_STORE="\$\{STATE_ROOT\}\/delivery-work-session-state\/owner-evidence-results"/,
  );
  assert.match(
    sourceExecutor,
    /OOS_DELIVERY_SOURCE_EXECUTOR_RESULT_STORE_ROOT="\$\{DELIVERY_SOURCE_EXECUTOR_RESULT_STORE\}"/,
  );
  assert.match(
    up,
    /set env deployment\/\$\{BROKER_DEPLOYMENT\}[\s\\]+CALLER_ALLOWED_IDS- CALLER_AUTH_SECRETS_JSON-/,
  );
  assert.doesNotMatch(common, /nohup|setsid|delivery-art-view-sync\.pid/);
  assert.doesNotMatch(up, /start_delivery_art_view_sync_loop/);
  assert.doesNotMatch(down, /stop_delivery_art_view_sync_loop/);
  assert.doesNotMatch(reset, /stop_delivery_art_view_sync_loop/);
});

test("accepted-idea-delivery starts the API with its required source toolchain", () => {
  const common = readFileSync(path.join(scriptsRoot, "common.sh"), "utf8");
  const up = readFileSync(path.join(scriptsRoot, "up.sh"), "utf8");

  assert.match(
    common,
    /readonly BROKER_RUNTIME_IMAGE="ghcr\.io\/mfshaf7\/operator-orchestration-service@sha256:[0-9a-f]{64}"/,
  );
  assert.match(up, /image: \$\{BROKER_RUNTIME_IMAGE\}/);
  assert.match(up, /command -v git >\/dev\/null/);
  assert.match(up, /command -v python3 >\/dev\/null/);
  assert.match(up, /exec node src\/server\.js/);
  assert.match(up, /cp -R \/source\/src \/source\/contracts \/runtime\//);
  assert.match(
    up,
    /install -m 0644 [\\\s]+\/source\/scripts\/workspace_intake_source\.py [\\\s]+\/source\/scripts\/workspace_inventory_source\.py [\\\s]+\/runtime\/scripts\//,
  );
  assert.match(up, /workingDir: \/runtime/);
  assert.match(up, /chown -R 1000:1000 \/work-session-state/);
  assert.match(
    up,
    /name: delivery-work-session-state\n\s+mountPath: \/work-session-state/,
  );
});

test("reconciler readiness requires a live service identity and success marker", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "oos-devint-host-service-"));
  const stateRoot = path.join(root, "state");
  mkdirSync(stateRoot, { recursive: true });
  const marker = path.join(stateRoot, "delivery-art-view-sync.ready");
  const readinessScript = path.join(
    scriptsRoot,
    "reconcile_delivery_art_views_ready.sh",
  );
  const env = {
    ...process.env,
    DEVINT_NAMESPACE: "devint-test",
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
  };

  try {
    writeFileSync(marker, `pid=${process.pid}\nlast_success_at=2026-08-24T00:00:00Z\n`);
    const ready = spawnSync("bash", [readinessScript], { encoding: "utf8", env });
    assert.equal(ready.status, 0, ready.stderr);

    writeFileSync(marker, "pid=99999999\nlast_success_at=2026-08-24T00:00:00Z\n");
    const stale = spawnSync("bash", [readinessScript], { encoding: "utf8", env });
    assert.notEqual(stale.status, 0);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});
