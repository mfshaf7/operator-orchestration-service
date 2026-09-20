import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { createPrototypeClosureOwnerEvidenceReader } from "../src/prototype-closure/owner-evidence.js";
import { createPrototypeClosureComposition, createPrototypeClosureRuntime } from "../src/prototype-closure/runtime.js";

const requiredOwners = [
  "workspace-prototype-studio", "workspace-delivery-art",
  "platform-engineering", "operator-orchestration-service",
];

function readers(read) {
  return Object.fromEntries(requiredOwners.map((owner) => [owner, { read }]));
}

function config(stateRoot) {
  return {
    enabled: true, profile: "dev-integration", stateRoot,
    authorityRoot: "/not-mounted/studio", tokenFile: "/not-mounted/closure-token",
    owner: "example", repositoryId: "123", python: "python3",
    wgcfBaseUrl: "http://127.0.0.1:1", wgcfCallerId: "operator-orchestration-service",
    wgcfCallerSecret: "isolated-test-only", wgcfImplementationRef: "test-implementation",
    wgcfServiceIdentityRef: "test-identity",
  };
}

test("Closure remains inactive through the normal runtime entrypoint", () => {
  assert.equal(createPrototypeClosureRuntime({ config: { enabled: false } }), null);
  assert.throws(
    () => createPrototypeClosureRuntime({ config: config("/not-mounted/state") }),
    { code: "prototype_closure_activation_required" },
  );
});

test("owner evidence dispatch uses the exact owner and denies missing readers", async () => {
  const observed = [];
  const ownerReaders = readers(async (lookup) => {
    observed.push(lookup);
    return { ref: lookup.ref, owner_ref: lookup.owner_ref };
  });
  ownerReaders["durable-owner"] = { read: ownerReaders["workspace-prototype-studio"].read };
  const readEvidence = createPrototypeClosureOwnerEvidenceReader(ownerReaders);
  const request = { prototype_id: "sample", expected_source_revision: "a".repeat(40) };
  assert.deepEqual(
    await readEvidence({ field: "source_transfer_receipt_ref", ref: "owner://transfer/1", ownerRef: "durable-owner", request }),
    { ref: "owner://transfer/1", owner_ref: "durable-owner" },
  );
  assert.deepEqual(observed, [{
    field: "source_transfer_receipt_ref", ref: "owner://transfer/1",
    owner_ref: "durable-owner", prototype_id: "sample", source_revision: "a".repeat(40),
  }]);
  await assert.rejects(
    readEvidence({ field: "source_transfer_receipt_ref", ref: "owner://transfer/1", ownerRef: "unconfigured-owner", request }),
    { code: "prototype_closure_owner_reader_missing" },
  );
  assert.throws(
    () => createPrototypeClosureOwnerEvidenceReader({ ...ownerReaders, "workspace-delivery-art": null }),
    { code: "prototype_closure_owner_reader_missing" },
  );
});

test("owner evidence rejects a cross-owner or wrong-reference readback", async () => {
  const request = { prototype_id: "sample", expected_source_revision: "a".repeat(40) };
  for (const proof of [
    null,
    { ref: "owner://other/1", owner_ref: "workspace-prototype-studio" },
    { ref: "owner://baseline/1", owner_ref: "workspace-delivery-art" },
  ]) {
    const readEvidence = createPrototypeClosureOwnerEvidenceReader(readers(async () => proof));
    await assert.rejects(
      readEvidence({ field: "accepted_baseline_receipt_ref", ref: "owner://baseline/1", ownerRef: "workspace-prototype-studio", request }),
      { code: "prototype_closure_owner_readback_invalid" },
    );
  }
});

test("isolated composition requires every authority before constructing the service", async () => {
  const stateRoot = await mkdtemp(path.join(tmpdir(), "oos-closure-runtime-"));
  try {
    const base = { config: config(stateRoot), ownerReaders: readers(async () => null) };
    assert.throws(() => createPrototypeClosureComposition(base), { code: "prototype_closure_platform_reader_missing" });
    assert.throws(
      () => createPrototypeClosureComposition({ ...base, config: { ...base.config, profile: "stage" }, platformClient: { readDisposition() {} } }),
      { code: "prototype_closure_profile_invalid" },
    );
    const service = createPrototypeClosureComposition({ ...base, platformClient: { readDisposition() {} } });
    assert.equal(typeof service.prepare, "function");
    assert.equal(typeof service.advance, "function");
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
  }
});

test("owner-backed composition supplies local owner readers but requires Platform authority", async () => {
  const stateRoot = await mkdtemp(path.join(tmpdir(), "oos-closure-owner-runtime-"));
  try {
    const inputs = {
      config: config(stateRoot), maturityStateRoot: stateRoot,
      deliveryApplicationService: { readAcceptedReceipt: async () => { throw new Error("not read during construction"); } },
      platformClient: { readDisposition: async () => { throw new Error("not read during construction"); } },
    };
    assert.throws(() => createPrototypeClosureComposition(inputs),
      { code: "prototype_closure_owner_reader_missing" });
    const service = createPrototypeClosureComposition({
      ...inputs,
      ownerReaders: { "platform-engineering": { read: async () => null } },
    });
    assert.equal(typeof service.ownerReadback.read, "function");
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
  }
});
