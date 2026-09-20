import assert from "node:assert/strict";
import test from "node:test";
import { createPrototypeClosureDeliveryOwnerReader } from "../src/prototype-closure/delivery-owner-reader.js";
import { createPrototypeClosureOwnerEvidenceReader } from "../src/prototype-closure/owner-evidence.js";

const targetRef = "openproject://work_packages/901";
const packetRef = "record://delivery-packets/sample-packet";
const receiptRef = `oos://receipts/prototype-delivery-application/${"a".repeat(64)}`;
const result = {
  source: { prototype_id: "sample", packet_ref: packetRef },
  target: { record_ref: targetRef, record_project: "workspace-delivery-art", record_version: 3 },
  receipt: { receipt_ref: receiptRef, content_digest: `sha256:${"b".repeat(64)}`,
    custody: { state: "durable" } },
  readiness: { outcome: "allow" },
  operator_decision: { decision: "apply" },
};

test("Delivery owner reader binds target and receipt to one current application", async () => {
  const calls = [];
  const reader = createPrototypeClosureDeliveryOwnerReader({
    deliveryApplicationService: {
      async readAcceptedReceipt(input) { calls.push(input); return structuredClone(result); },
    },
  });
  const lookup = {
    prototype_id: "sample", source_packet_ref: packetRef,
    target_delivery_ref: targetRef, accepted_delivery_target_receipt_ref: receiptRef,
  };
  const target = await reader.read({ ...lookup, field: "target_delivery_ref", ref: targetRef });
  const receipt = await reader.read({ ...lookup, field: "accepted_delivery_target_receipt_ref", ref: receiptRef });
  assert.equal(target.owner_ref, "workspace-delivery-art");
  assert.equal(target.ref, targetRef);
  assert.match(target.digest, /^sha256:[a-f0-9]{64}$/);
  assert.equal(receipt.owner_ref, "operator-orchestration-service");
  assert.equal(receipt.subject_ref, targetRef);
  assert.equal(receipt.source_packet_ref, packetRef);
  assert.equal(receipt.prototype_id, "sample");
  assert.equal(calls.length, 2);
  assert.equal(calls[0].receiptRef, receiptRef);
});

test("Delivery owner reader rejects mismatched owner readback", async () => {
  const reader = createPrototypeClosureDeliveryOwnerReader({
    deliveryApplicationService: {
      async readAcceptedReceipt() { return { ...structuredClone(result), source: { prototype_id: "other", packet_ref: packetRef } }; },
    },
  });
  await assert.rejects(reader.read({
    field: "accepted_delivery_target_receipt_ref", ref: receiptRef,
    prototype_id: "sample", source_packet_ref: packetRef,
    target_delivery_ref: targetRef, accepted_delivery_target_receipt_ref: receiptRef,
  }), /does not prove this Prototype target/);
});

test("Closure owner routing supplies the committed packet and accepted receipt", async () => {
  const delivery = createPrototypeClosureDeliveryOwnerReader({
    deliveryApplicationService: {
      async readAcceptedReceipt() { return structuredClone(result); },
    },
  });
  const readEvidence = createPrototypeClosureOwnerEvidenceReader({
    "workspace-prototype-studio": { read: async () => null },
    "workspace-delivery-art": delivery,
    "platform-engineering": { read: async () => null },
    "operator-orchestration-service": delivery,
  });
  const request = {
    prototype_id: "sample", expected_source_revision: "a".repeat(40),
    target_delivery_ref: targetRef, accepted_delivery_target_receipt_ref: receiptRef,
  };
  const observed = await readEvidence({
    field: "accepted_delivery_target_receipt_ref", ref: receiptRef,
    ownerRef: "operator-orchestration-service", request,
    source: { delivery_packet_ref: packetRef },
  });
  assert.equal(observed.subject_ref, targetRef);
});
