import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { loadConfig } from "../src/config.js";
import { createRepositoryCustodyRuntime } from "../src/repository-custody/runtime.js";

test("repository custody runtime is absent by default and denied outside the reviewed profile", () => {
  assert.equal(createRepositoryCustodyRuntime({ config: { enabled: false } }), null);
  assert.throws(
    () => createRepositoryCustodyRuntime({ config: { enabled: true, profile: "stage" } }),
    (error) => error.code === "repository_custody_runtime_profile_not_admitted",
  );
});

test("repository custody runtime constructs only in reviewed dev-integration", (t) => {
  const stateRoot = mkdtempSync(path.join(tmpdir(), "oos-repository-custody-runtime-"));
  t.after(() => rmSync(stateRoot, { recursive: true, force: true }));
  const runtime = createRepositoryCustodyRuntime({
    config: {
      enabled: true,
      profile: "dev-integration",
      stateRoot,
      wgcfBaseUrl: "http://wgcf.local",
      wgcfCallerId: "operator-orchestration-service",
      wgcfCallerSecret: "test-secret",
      providerApiBaseUrl: "https://api.github.com",
      providerReadInstallationToken: "read-token",
      providerProvisioningInstallationToken: "provision-token",
      providerSandbox: false,
    },
  });
  assert.equal(typeof runtime.execute, "function");
  assert.equal(typeof runtime.project, "function");
});

test("repository custody configuration keeps provider credentials out of defaults", () => {
  const config = loadConfig({
    OOS_REPOSITORY_CUSTODY_STATE_ROOT: "/tmp/repository-custody-state",
    WGCF_REPOSITORY_CUSTODY_BASE_URL: "http://wgcf.local",
  }).repositoryCustody;
  assert.equal(config.enabled, false);
  assert.equal(config.profile, undefined);
  assert.equal(config.stateRoot, "/tmp/repository-custody-state");
  assert.equal(config.wgcfBaseUrl, "http://wgcf.local");
  assert.equal(config.providerReadInstallationToken, "");
  assert.equal(config.providerProvisioningInstallationToken, "");
  assert.equal(config.providerSandbox, false);
});
