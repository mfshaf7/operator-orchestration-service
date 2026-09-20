import assert from "node:assert/strict";
import test from "node:test";

import { createPrototypeClosureOwnerReadbackService } from
  "../src/prototype-closure/owner-readback-service.js";

const revision = "a".repeat(40);
const receiptRef = `oos://receipts/prototype-delivery-application/${"b".repeat(64)}`;

test("owner readback dispatches only baseline and Delivery lookups", async () => {
  const observed = [];
  const service = createPrototypeClosureOwnerReadbackService({
    baselineReader: { async read(input) { observed.push(["baseline", input]); return { ref: input.ref }; } },
    deliveryReader: { async read(input) { observed.push(["delivery", input]); return { ref: input.ref }; } },
  });
  const common = { prototype_id: "sample-tool", source_revision: revision };
  await service.read({ ...common, field: "accepted_baseline_receipt_ref", ref: "oos://receipts/baseline/1" });
  await service.read({ ...common, field: "target_delivery_ref",
    ref: "openproject://work_packages/100", target_delivery_ref: "openproject://work_packages/100",
    source_packet_ref: "record://delivery-packets/sample-tool", accepted_delivery_target_receipt_ref: receiptRef });
  assert.deepEqual(observed.map(([owner]) => owner), ["baseline", "delivery"]);
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
    { field: "accepted_baseline_receipt_ref", ref: "oos://receipts/baseline/1", admin: true },
  ]) {
    await assert.rejects(service.read({ prototype_id: "sample-tool", source_revision: revision, ...input }),
      { code: "prototype_closure_owner_readback_request_invalid" });
  }
});
