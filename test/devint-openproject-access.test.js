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
const accessScript = path.join(profileRoot, "scripts/access.sh");
const upScript = path.join(profileRoot, "scripts/up.sh");

function createHarness(stateModel) {
  const root = mkdtempSync(path.join(os.tmpdir(), "oos-devint-access-"));
  const bin = path.join(root, "bin");
  const calls = path.join(root, "k3s-calls.log");
  const stateRoot = path.join(root, "state");
  mkdirSync(bin, { recursive: true });

  const k3s = path.join(bin, "k3s");
  writeFileSync(
    k3s,
    `#!/usr/bin/env bash
printf '%s\\n' "$*" >>"${calls}"
if [[ "$*" == *"get service"*"jsonpath="* ]]; then
  printf '32183'
fi
`,
  );
  chmodSync(k3s, 0o700);

  const curl = path.join(bin, "curl");
  writeFileSync(curl, "#!/usr/bin/env bash\nexit 0\n");
  chmodSync(curl, 0o700);

  const powershell = path.join(bin, "powershell.exe");
  writeFileSync(powershell, "#!/usr/bin/env bash\nexit 0\n");
  chmodSync(powershell, 0o700);

  const env = {
    ...process.env,
    DEVINT_NAMESPACE: "devint-test",
    DEVINT_OPERATOR: "test-operator",
    DEVINT_OWNER_REPO_ROOT: repoRoot,
    DEVINT_PROFILE_FILE: path.join(profileRoot, "profile.yaml"),
    DEVINT_PROFILE_ID: "accepted-idea-delivery",
    DEVINT_PROFILE_JSON: JSON.stringify({
      runtime: { state_model: stateModel },
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
    PATH: `${bin}:${process.env.PATH}`,
  };

  return {
    calls,
    cleanup: () => rmSync(root, { force: true, recursive: true }),
    env,
  };
}

test("persistent OpenProject access reports the managed NodePort path", () => {
  const harness = createHarness("persistent");
  try {
    const result = spawnSync("bash", [accessScript], {
      encoding: "utf8",
      env: harness.env,
    });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Kubernetes access: ready on NodePort 32183/);
    assert.match(result.stdout, /Windows localhost access: ready/);
    assert.match(result.stdout, /managed by PlatformCoreHostStack/);
    assert.doesNotMatch(readFileSync(harness.calls, "utf8"), /port-forward/);
  } finally {
    harness.cleanup();
  }
});

test("disposable OpenProject access retains the foreground tunnel", () => {
  const harness = createHarness("disposable");
  try {
    const result = spawnSync("bash", [accessScript], {
      encoding: "utf8",
      env: harness.env,
    });

    assert.equal(result.status, 0, result.stderr);
    assert.match(readFileSync(harness.calls, "utf8"), /port-forward/);
  } finally {
    harness.cleanup();
  }
});

test("persistent OpenProject runtime declares NodePort without pod hostPort", () => {
  const source = readFileSync(upScript, "utf8");

  assert.match(source, /type: NodePort/);
  assert.match(source, /nodePort: \$\{OPENPROJECT_NODE_PORT\}/);
  assert.doesNotMatch(source, /hostPort|hostIP/);
});
