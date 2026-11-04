import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  assertWorkspaceOperationActivation,
  isWorkspaceOperationRuntimeEnabled,
  workspaceOperationActivation,
  workspaceInventoryOperationActivation,
} from "../src/workspace-operation-activation.js";

function manifest(name) {
  return JSON.parse(readFileSync(new URL(`../contracts/${name}/manifest.json`, import.meta.url), "utf8"));
}

const cases = [
  ["workspace-intake", "Workspace Intake", "wgcf.workspace-intake-readiness.v1", "contracts/workspace-intake/manifest.json", workspaceOperationActivation],
  ["workspace-inventory", "Workspace Inventory", "wgcf.workspace-active-inventory-readiness.v1", "contracts/workspace-active-inventory/manifest.json", workspaceInventoryOperationActivation],
];

for (const [bundle, domain, readinessContractId, readinessManifestPath, activation] of cases) {
  test(`${domain} pins the exact operation activation chain`, () => {
    const value = manifest(bundle);
    assert.equal(
      assertWorkspaceOperationActivation(value, { domain, readinessContractId, readinessManifestPath, activation }),
      value,
    );
    assert.equal(value.source_activation.authority.commit, activation.authorityCommit);
    assert.equal(value.source_activation.readiness_authority.commit, activation.readinessCommit);
    assert.equal(
      value.source_activation.architecture_packet.digest,
      "sha256:34022576c3cbcff6e3bf09d2ac0f5689e1b2255e82cc02a1233970b7fdc03bbe",
    );
    assert.equal(value.runtime_activation.eligible, true);
    assert.equal(value.runtime_activation.next_work_ref, "openproject://work_packages/1209");
  });

  test(`${domain} rejects stale or prematurely activated evidence`, () => {
    const stale = manifest(bundle);
    stale.source_activation.authority.commit = "0".repeat(40);
    assert.throws(
      () => assertWorkspaceOperationActivation(stale, { domain, readinessContractId, readinessManifestPath, activation }),
      /activation manifest is invalid/,
    );

    const premature = manifest(bundle);
    premature.runtime_activation.profile = "stage";
    assert.throws(
      () => assertWorkspaceOperationActivation(premature, { domain, readinessContractId, readinessManifestPath, activation }),
      /activation manifest is invalid/,
    );
  });
}

test("Inventory rejects retained Intake pins or mixed readiness commits", () => {
  const value = manifest("workspace-inventory");
  const options = { domain: "Workspace Inventory", readinessContractId: "wgcf.workspace-active-inventory-readiness.v1",
    readinessManifestPath: "contracts/workspace-active-inventory/manifest.json" };
  assert.throws(() => assertWorkspaceOperationActivation(value, options), /activation manifest is invalid/);
  value.source_activation.readiness_authority.commit = workspaceOperationActivation.readinessCommit;
  assert.throws(() => assertWorkspaceOperationActivation(value, { ...options, activation: workspaceInventoryOperationActivation }), /activation manifest is invalid/);
});

test("runtime enablement requires both manifest activation and the admitted profile", () => {
  const value = manifest("workspace-intake");
  assert.equal(isWorkspaceOperationRuntimeEnabled(value, "stage"), false);
  assert.equal(isWorkspaceOperationRuntimeEnabled(value, "dev-integration"), true);
});
