import { closureError } from "./contracts.js";

const FIELDS = new Set([
  "accepted_baseline_receipt_ref",
  "target_delivery_ref",
  "accepted_delivery_target_receipt_ref",
  "prior_retirement_receipt_ref",
  "runtime_disposition_plan_ref",
  "runtime_disposition_proof_ref",
]);
const REF = /^[a-z][a-z0-9+.-]*:\/\/[A-Za-z0-9][A-Za-z0-9._~:/%+=-]*$/;
const SHA = /^[0-9a-f]{40}$/;
const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const OPTIONAL = [
  "owner_ref", "subject_ref", "source_packet_ref", "target_delivery_ref",
  "accepted_delivery_target_receipt_ref", "retirement_ref", "operator_id", "retirement_reason",
];
const OWNER_DISCOVERED_FIELDS = new Set(["runtime_disposition_proof_ref"]);

export function createPrototypeClosureOwnerReadbackService({ baselineReader, deliveryReader, platformReader, retirementStore }) {
  if (typeof baselineReader?.read !== "function" || typeof deliveryReader?.read !== "function") {
    throw closureError("owner_readback_unavailable", "Closure owner readback requires baseline and Delivery readers.", 503);
  }
  return {
    async read(input) {
      if (!input || Object.getPrototypeOf(input) !== Object.prototype ||
          Object.keys(input).some((key) => ![
            "field", "ref", "prototype_id", "source_revision", ...OPTIONAL,
          ].includes(key)) || !FIELDS.has(input.field) ||
          (!OWNER_DISCOVERED_FIELDS.has(input.field) && !REF.test(input.ref)) ||
          (input.ref != null && !REF.test(input.ref)) ||
          !ID.test(input.prototype_id) || !SHA.test(input.source_revision) ||
          (input.owner_ref != null && !ID.test(input.owner_ref)) ||
          ["subject_ref", "source_packet_ref", "target_delivery_ref",
            "accepted_delivery_target_receipt_ref", "retirement_ref"]
            .some((field) => input[field] != null && !REF.test(input[field]))) {
        throw closureError("owner_readback_request_invalid", "Closure owner readback lookup is invalid.", 400);
      }
      if (["runtime_disposition_plan_ref", "runtime_disposition_proof_ref"].includes(input.field)) {
        if (input.owner_ref !== "platform-engineering" || typeof platformReader?.read !== "function") {
          throw closureError("owner_readback_unavailable", "Platform Closure evidence is unavailable.", 503);
        }
        return platformReader.read(input);
      }
      if (input.field === "prior_retirement_receipt_ref") {
        if (!input.retirement_ref) {
          throw closureError("owner_readback_request_invalid", "Retirement readback requires the exact Studio event.", 400);
        }
        if (typeof retirementStore?.readRetirementReceipt !== "function") {
          throw closureError("owner_readback_unavailable", "Closure retirement receipt custody is unavailable.", 503);
        }
        return retirementStore.readRetirementReceipt({
          ref: input.ref, prototypeId: input.prototype_id, retirementRef: input.retirement_ref,
        });
      }
      if (input.field !== "accepted_baseline_receipt_ref" &&
          (!input.source_packet_ref || !input.accepted_delivery_target_receipt_ref)) {
        throw closureError("owner_readback_request_invalid", "Delivery readback requires packet and accepted receipt refs.", 400);
      }
      if (input.field === "target_delivery_ref" && input.target_delivery_ref !== input.ref) {
        throw closureError("owner_readback_request_invalid", "Delivery target lookup must bind its exact requested ref.", 400);
      }
      const reader = input.field === "accepted_baseline_receipt_ref" ? baselineReader : deliveryReader;
      return reader.read(input);
    },
  };
}
