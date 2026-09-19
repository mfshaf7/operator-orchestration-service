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

  return async ({ field, ref, ownerRef, request }) => {
    const reader = registered.get(ownerRef);
    if (typeof reader?.read !== "function") {
      throw closureError("owner_reader_missing", `Closure has no reader for ${ownerRef}.`, 503);
    }
    const observed = await reader.read({
      field, ref, owner_ref: ownerRef,
      prototype_id: request.prototype_id,
      source_revision: request.expected_source_revision,
    });
    if (!observed || observed.ref !== ref || observed.owner_ref !== ownerRef) {
      throw closureError("owner_readback_invalid", `Closure ${field} was not confirmed by ${ownerRef}.`, 503);
    }
    return observed;
  };
}
