import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createWorkspaceInventoryRuntime } from "../src/workspace-inventory/runtime.js";
import { instanceSourceProof } from "./fixtures/instance-source-authority.js";

async function runtime(t, fetchImpl) {
  const root = await mkdtemp(path.join(tmpdir(), "oos-native-readiness-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return createWorkspaceInventoryRuntime({
    config: {
      enabled: true, profile: "dev-integration", stateRoot: root,
      authorityRoot: path.join(root, "no-public-authority"), tokenFile: path.join(root, "no-public-token"),
      owner: "example", repositoryId: "123", wgcfBaseUrl: "http://wgcf.test",
      wgcfCallerId: "operator-orchestration-service", wgcfCallerSecret: "s".repeat(32),
      instanceRecords: { enabled: true, instanceId: "synthetic-installation", baseUrl: "http://wgcf.test" },
    },
    fetchImpl,
  });
}

test("composed Inventory supplies Delivery's exact current internal authority without a public Git entry", async t => {
  const calls = [];
  const proof = instanceSourceProof().source_authority;
  const service = await runtime(t, async (url, init) => {
    calls.push({ url, init });
    return Response.json(instanceSourceProof());
  });
  const value = await service.repositoryReadinessAuthority({ repoName: proof.owner_repo });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.method, "GET");
  assert.equal(calls[0].url, `http://wgcf.test/v1/instance-records/repositories/${proof.owner_repo}/source-authority?operation=ordinary-source`);
  assert.deepEqual(value, {
    repo_name: proof.owner_repo, repo_ref: `repo://${proof.owner_repo}`, expected_owner_repo: proof.owner_repo,
    catalog_value_key: proof.owner_repo, expected_authority_digest: proof.record_ref.digest,
    expected_instance_record: Object.fromEntries(["canonical_authority", "record_ref", "policy_ref"].map(key => [key, proof[key]])),
  });
});

test("Delivery never falls back to public authority when internal eligibility is unavailable or belongs to another installation", async t => {
  for (const mode of ["unavailable", "foreign", "not-active"]) {
    const calls = [];
    const service = await runtime(t, async (url, init) => {
      calls.push({ url, init });
      if (mode === "unavailable") return Response.json({ error: "unavailable" }, { status: 503 });
      return Response.json(instanceSourceProof(mode === "foreign" ? { instanceId: "different-installation" } : { operation: "bootstrap" }));
    });
    await assert.rejects(service.repositoryReadinessAuthority({ repoName: "canonical-project-key" }));
    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /source-authority\?operation=ordinary-source$/);
  }
});
