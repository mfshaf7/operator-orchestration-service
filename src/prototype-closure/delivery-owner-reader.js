import { canonicalDigest } from "../delivery-art/canonical-json.js";
import { closureError } from "./contracts.js";

export function createPrototypeClosureDeliveryOwnerReader({ deliveryApplicationService }) {
  if (typeof deliveryApplicationService?.readAcceptedReceipt !== "function") {
    throw closureError("delivery_reader_missing", "Closure requires the Delivery application receipt reader.", 503);
  }

  return {
    async read({ field, ref, prototype_id: prototypeId, source_packet_ref: packetRef,
      target_delivery_ref: targetRef, accepted_delivery_target_receipt_ref: receiptRef }) {
      if (!["target_delivery_ref", "accepted_delivery_target_receipt_ref"].includes(field) ||
          !prototypeId || !packetRef || !receiptRef ||
          (field === "target_delivery_ref" && (!targetRef || ref !== targetRef)) ||
          (field === "accepted_delivery_target_receipt_ref" && ref !== receiptRef)) {
        throw closureError("delivery_lookup_invalid", "Closure Delivery evidence lookup is incomplete.", 400);
      }
      const result = await deliveryApplicationService.readAcceptedReceipt({
        prototypeId, packetRef, receiptRef, targetRef: targetRef ?? null,
      });
      if (result.receipt.receipt_ref !== receiptRef ||
          result.receipt.custody?.state !== "durable" ||
          result.source.prototype_id !== prototypeId ||
          result.source.packet_ref !== packetRef ||
          (targetRef && result.target.record_ref !== targetRef) ||
          result.target.record_project !== "workspace-delivery-art" ||
          result.readiness.outcome !== "allow" ||
          result.operator_decision.decision !== "apply") {
        throw closureError("delivery_readback_invalid", "Delivery readback does not prove this Prototype target.", 503);
      }
      if (field === "target_delivery_ref") {
        return {
          ref: result.target.record_ref,
          owner_ref: "workspace-delivery-art",
          digest: canonicalDigest({ target: result.target, receipt_digest: result.receipt.content_digest }),
          state: "accepted", subject_ref: result.target.record_ref, source_revision: null,
          source_packet_ref: packetRef, prototype_id: prototypeId,
        };
      }
      return {
        ref: receiptRef,
        owner_ref: "operator-orchestration-service",
        digest: result.receipt.content_digest,
        state: "accepted", subject_ref: result.target.record_ref, source_revision: null,
        source_packet_ref: packetRef, prototype_id: prototypeId,
      };
    },
  };
}
