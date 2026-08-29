import assert from "node:assert/strict";
import test from "node:test";

import { loadConfig } from "../src/config.js";
import { createRepositoryCustodyRuntime } from "../src/repository-custody/runtime.js";

test("repository custody runtime is absent by default and blocked before activation", () => {
  assert.equal(createRepositoryCustodyRuntime({ config: { enabled: false } }), null);
  assert.throws(
    () => createRepositoryCustodyRuntime({ config: { enabled: true } }),
    (error) => error.code === "repository_custody_runtime_not_activated",
  );
});

test("repository custody configuration keeps provider credentials out of defaults", () => {
  const config = loadConfig({
    OOS_REPOSITORY_CUSTODY_STATE_ROOT: "/tmp/repository-custody-state",
    WGCF_REPOSITORY_CUSTODY_BASE_URL: "http://wgcf.local",
  }).repositoryCustody;
  assert.equal(config.enabled, false);
  assert.equal(config.stateRoot, "/tmp/repository-custody-state");
  assert.equal(config.wgcfBaseUrl, "http://wgcf.local");
  assert.equal(config.providerInstallationToken, "");
});
