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
    platformEvidenceFile: path.join(stateRoot, "platform-evidence.json"),
    authorityRoot: "/not-mounted/studio", tokenFile: "/not-mounted/closure-token",
    owner: "example", repositoryId: "123", python: "python3",
    wgcfBaseUrl: "http://127.0.0.1:1", wgcfCallerId: "operator-orchestration-service",
    wgcfCallerSecret: "isolated-test-only", wgcfImplementationRef: "test-implementation",
    wgcfServiceIdentityRef: "test-identity",
  };
}

test("Closure normal runtime requires its owner readback dependencies", () => {
  assert.equal(createPrototypeClosureRuntime({ config: { enabled: false } }), null);
  assert.throws(
    () => createPrototypeClosureRuntime({ config: config("/not-mounted/state") }),
    { code: "prototype_closure_owner_readback_unavailable" },
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
    subject_ref: undefined, operator_id: undefined, source_packet_ref: null,
    accepted_delivery_target_receipt_ref: null, durable_owner_acceptance_ref: null,
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

test("isolated composition constructs its Platform reader from configured evidence", async () => {
  const stateRoot = await mkdtemp(path.join(tmpdir(), "oos-closure-runtime-"));
  try {
    const base = { config: config(stateRoot), ownerReaders: readers(async () => null) };
    assert.throws(
      () => createPrototypeClosureComposition({ ...base, config: { ...base.config, profile: "stage" }, platformClient: { readDisposition() {} } }),
      { code: "prototype_closure_profile_invalid" },
    );
    const service = createPrototypeClosureComposition(base);
    assert.equal(typeof service.prepare, "function");
    assert.equal(typeof service.advance, "function");
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
  }
});

test("owner-backed composition supplies local owner readers including Platform", async () => {
  const stateRoot = await mkdtemp(path.join(tmpdir(), "oos-closure-owner-runtime-"));
  try {
    const inputs = {
      config: config(stateRoot), maturityStateRoot: stateRoot,
      deliveryApplicationService: { readAcceptedReceipt: async () => { throw new Error("not read during construction"); } },
    };
    const service = createPrototypeClosureComposition(inputs);
    assert.equal(typeof service.ownerReadback.read, "function");
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
  }
});

test("normal runtime wires the native durable owner reader without injecting a fixture owner", async (t) => {
  const stateRoot = await mkdtemp(path.join(tmpdir(), "oos-closure-normal-owner-runtime-"));
  t.after(() => rm(stateRoot, { recursive: true, force: true }));
  const service = createPrototypeClosureRuntime({
    config: config(stateRoot), maturityStateRoot: stateRoot,
    deliveryApplicationService: { async readAcceptedReceipt() { throw new Error("unexpected before Inventory admission"); } },
    artifactService: { async resolveArtifact() { throw new Error("unexpected before Inventory admission"); } },
    inventoryAuthorityRoot: path.join(stateRoot, "missing-wg-authority"),
    callerOperatorBindings: { "console-caller": "operator:reviewer" },
  });
  await assert.rejects(service.ownerReadback.read({ field: "durable_owner_acceptance_ref",
    ref: `wgcf://artifacts/delivery-art/sha256/${"a".repeat(64)}`, prototype_id: "sample-tool",
    owner_ref: "sample-app", source_revision: "b".repeat(40), subject_ref: "repo://sample-org/sample-app",
    source_packet_ref: "record://delivery-packets/sample-tool", operator_id: "console-caller",
    accepted_delivery_target_receipt_ref: `oos://receipts/prototype-delivery-application/${"c".repeat(64)}`,
  }), { code: "record_authority_unavailable" }, "Normal composition must reach canonical Inventory, not a missing owner seam");
});
