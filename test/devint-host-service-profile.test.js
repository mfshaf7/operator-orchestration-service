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

test("accepted-idea-delivery delegates reconciler supervision to the shared runner", () => {
  const profile = readFileSync(path.join(profileRoot, "profile.yaml"), "utf8");
  const common = readFileSync(path.join(scriptsRoot, "common.sh"), "utf8");
  const up = readFileSync(path.join(scriptsRoot, "up.sh"), "utf8");
  const down = readFileSync(path.join(scriptsRoot, "down.sh"), "utf8");
  const reset = readFileSync(path.join(scriptsRoot, "reset.sh"), "utf8");

  assert.match(profile, /host_services:\n  - id: delivery-art-view-sync/);
  assert.match(profile, /command: .*reconcile_delivery_art_views_loop\.sh/);
  assert.match(profile, /mode: command\n      command: .*reconcile_delivery_art_views_ready\.sh/);
  assert.match(profile, /  - id: delivery-source-executor/);
  assert.match(profile, /command: .*run_delivery_source_executor\.sh/);
  assert.match(profile, /command: .*delivery_source_executor_ready\.sh/);
  assert.match(up, /OOS_DELIVERY_ART_MUTATION_ENABLED", "false"/);
  assert.doesNotMatch(up, /OOS_DELIVERY_ART_MUTATION_ENABLED=true/);
  assert.match(up, /WGCF_REPOSITORY_READINESS_BASE_URL/);
  assert.match(up, /WGCF_REPOSITORY_READINESS_CALLER_SECRET/);
  assert.match(common, /XDG_RUNTIME_DIR:-\/tmp/);
  assert.doesNotMatch(common, /STATE_ROOT}\/delivery-source-executor/);
  assert.match(
    up,
    /set env deployment\/\$\{BROKER_DEPLOYMENT\}[\s\\]+CALLER_ALLOWED_IDS- CALLER_AUTH_SECRETS_JSON-/,
  );
  assert.doesNotMatch(common, /nohup|setsid|delivery-art-view-sync\.pid/);
  assert.doesNotMatch(up, /start_delivery_art_view_sync_loop/);
  assert.doesNotMatch(down, /stop_delivery_art_view_sync_loop/);
  assert.doesNotMatch(reset, /stop_delivery_art_view_sync_loop/);
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
