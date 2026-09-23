import assert from "node:assert/strict";
import test from "node:test";

import { createPrototypeClosureOwnerReadbackService } from
  "../src/prototype-closure/owner-readback-service.js";

const revision = "a".repeat(40);
const receiptRef = `oos://receipts/prototype-delivery-application/${"b".repeat(64)}`;

test("owner readback dispatches baseline, Delivery, and completed retirement lookups", async () => {
  const observed = [];
  const service = createPrototypeClosureOwnerReadbackService({
    baselineReader: { async read(input) { observed.push(["baseline", input]); return { ref: input.ref }; } },
    deliveryReader: { async read(input) { observed.push(["delivery", input]); return { ref: input.ref }; } },
    retirementStore: { async readRetirementReceipt(input) { observed.push(["retirement", input]); return { ref: input.ref }; } },
  });
  const common = { prototype_id: "sample-tool", source_revision: revision };
  await service.read({ ...common, field: "accepted_baseline_receipt_ref", ref: "oos://receipts/baseline/1" });
  await service.read({ ...common, field: "target_delivery_ref",
    ref: "openproject://work_packages/100", target_delivery_ref: "openproject://work_packages/100",
    source_packet_ref: "record://delivery-packets/sample-tool", accepted_delivery_target_receipt_ref: receiptRef });
  await service.read({ ...common, field: "prior_retirement_receipt_ref",
    ref: `receipt://prototype-closure/${"c".repeat(64)}`,
    retirement_ref: "record://prototype-closure/sample-tool/history/prototype-closure:sample-tool:0001" });
  assert.deepEqual(observed.map(([owner]) => owner), ["baseline", "delivery", "retirement"]);
});

test("owner readback rejects missing receipt context and unsupported fields", async () => {
  const service = createPrototypeClosureOwnerReadbackService({
    baselineReader: { async read() { throw new Error("unexpected read"); } },
    deliveryReader: { async read() { throw new Error("unexpected read"); } },
  });
  for (const input of [
    { field: "target_delivery_ref", ref: "openproject://work_packages/100" },
    { field: "target_delivery_ref", ref: "openproject://work_packages/100",
      target_delivery_ref: "openproject://work_packages/101",
      source_packet_ref: "record://delivery-packets/sample-tool",
      accepted_delivery_target_receipt_ref: receiptRef },
    { field: "retained_source_readback_ref", ref: "studio://sample-tool/1" },
    { field: "prior_retirement_receipt_ref", ref: `receipt://prototype-closure/${"c".repeat(64)}` },
    { field: "accepted_baseline_receipt_ref", ref: "oos://receipts/baseline/1", admin: true },
  ]) {
    await assert.rejects(service.read({ prototype_id: "sample-tool", source_revision: revision, ...input }),
      { code: "prototype_closure_owner_readback_request_invalid" });
  }
});

test("owner readback resolves Platform-generated proof without a caller-supplied proof ref", async () => {
  const observed = [];
  const service = createPrototypeClosureOwnerReadbackService({
    baselineReader: { async read() { throw new Error("unexpected read"); } },
    deliveryReader: { async read() { throw new Error("unexpected read"); } },
    platformReader: { async read(input) { observed.push(input); return { ref: `proof://platform/${"d".repeat(64)}` }; } },
  });
  const result = await service.read({
    field: "runtime_disposition_proof_ref",
    owner_ref: "platform-engineering",
    prototype_id: "sample-tool",
    source_revision: revision,
    subject_ref: "plan://runtime/sample-tool",
    operator_id: "agent-gary",
  });
  assert.equal(result.ref, `proof://platform/${"d".repeat(64)}`);
  assert.equal(observed[0].subject_ref, "plan://runtime/sample-tool");
});
