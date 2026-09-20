import { closureError } from "./contracts.js";

const REQUIRED_OWNERS = [
  "workspace-prototype-studio",
  "workspace-delivery-art",
  "platform-engineering",
  "operator-orchestration-service",
];

export function createPrototypeClosureOwnerEvidenceReader(readers) {
  if (!readers || Object.getPrototypeOf(readers) !== Object.prototype) {
    throw closureError("owner_reader_missing", "Closure requires explicit owner evidence readers.", 503);
  }
  const registered = new Map(Object.entries(readers));
  for (const owner of REQUIRED_OWNERS) {
    if (typeof registered.get(owner)?.read !== "function") {
      throw closureError("owner_reader_missing", `Closure requires the ${owner} evidence reader.`, 503);
    }
  }

  return async ({ field, ref, ownerRef, request, source }) => {
    const reader = registered.get(ownerRef);
    if (typeof reader?.read !== "function") {
      throw closureError("owner_reader_missing", `Closure has no reader for ${ownerRef}.`, 503);
    }
    const lookup = {
      field, ref, owner_ref: ownerRef,
      prototype_id: request.prototype_id,
      source_revision: request.expected_source_revision,
    };
    if (field === "retention_plan_ref") {
      lookup.operator_id = request.operator_id;
      lookup.retirement_reason = request.retirement_reason;
    }
    if (field === "prior_retirement_receipt_ref") {
      lookup.retirement_ref = source?.retirement_ref ?? null;
    }
    if (["target_delivery_ref", "accepted_delivery_target_receipt_ref"].includes(field)) {
      lookup.source_packet_ref = source?.delivery_packet_ref ?? null;
      lookup.target_delivery_ref = request.target_delivery_ref ?? null;
      lookup.accepted_delivery_target_receipt_ref = request.accepted_delivery_target_receipt_ref ??
        source?.accepted_delivery_target_receipt_ref ?? null;
    }
    const observed = await reader.read(lookup);
    if (!observed || observed.ref !== ref || observed.owner_ref !== ownerRef) {
      throw closureError("owner_readback_invalid", `Closure ${field} was not confirmed by ${ownerRef}.`, 503);
    }
    return observed;
  };
}
