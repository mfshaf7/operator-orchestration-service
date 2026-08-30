import assert from "node:assert/strict";
import test from "node:test";

import { loadConfig } from "../src/config.js";
import { createRepositoryLifecycleRuntime } from "../src/repository-lifecycle/runtime.js";

test("repository lifecycle runtime is absent by default and blocked before activation", () => {
  assert.equal(createRepositoryLifecycleRuntime({ config: { enabled: false } }), null);
  assert.throws(
    () => createRepositoryLifecycleRuntime({ config: { enabled: true } }),
    (error) => error.code === "repository_lifecycle_runtime_not_activated",
  );
});

test("repository lifecycle configuration has separate provider identity and no secret defaults", () => {
  const config = loadConfig({
    OOS_REPOSITORY_LIFECYCLE_STATE_ROOT: "/tmp/repository-lifecycle-state",
    WGCF_REPOSITORY_LIFECYCLE_BASE_URL: "http://wgcf.local",
    OOS_REPOSITORY_LIFECYCLE_INSTALLATION_TOKEN: "lifecycle-token",
  }).repositoryLifecycle;
  assert.equal(config.enabled, false);
  assert.equal(config.stateRoot, "/tmp/repository-lifecycle-state");
  assert.equal(config.wgcfBaseUrl, "http://wgcf.local");
  assert.equal(config.providerInstallationToken, "lifecycle-token");
  assert.equal(config.providerSandbox, false);
});
