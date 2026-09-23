import {
  assertPrototypeMaturityArtifact,
  prototypeMaturityReference,
} from "../prototype-maturity/contracts.js";
import { closureError } from "./contracts.js";

const BASELINE_RECEIPT = /^oos:\/\/receipts\/prototype-maturity\/(prototype-maturity-receipt:[a-z0-9][a-z0-9._-]*:[0-9]+)$/;

export function prototypeClosureBaselineReceiptRef(receipt) {
  assertPrototypeMaturityArtifact(receipt);
  if (receipt.decision !== "approve-baseline" || receipt.outcome !== "succeeded") {
    throw closureError("baseline_receipt_invalid", "Closure requires an accepted baseline receipt.", 409);
  }
  return `oos://receipts/prototype-maturity/${receipt.receipt_id}`;
}

export function createPrototypeClosureBaselineOwnerReader({ maturityStore, studioSourceClient }) {
  if (typeof maturityStore?.get !== "function" ||
      typeof studioSourceClient?.readBaselineAt !== "function") {
    throw closureError("baseline_reader_missing", "Closure requires maturity and Studio readback.", 503);
  }
  return {
    async read({ field, ref, prototype_id: prototypeId }) {
      const match = field === "accepted_baseline_receipt_ref" && BASELINE_RECEIPT.exec(ref);
      if (!match || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(prototypeId)) {
        throw closureError("baseline_lookup_invalid", "Closure baseline lookup is invalid.", 400);
      }
      const requestId = match[1].replace("prototype-maturity-receipt:", "prototype-maturity-request:");
      const record = await maturityStore.get(requestId);
      if (!record || record.status !== "succeeded" || !record.receipt || !record.readback) {
        throw closureError("baseline_receipt_missing", "Accepted baseline receipt was not found.", 404);
      }
      const receipt = assertPrototypeMaturityArtifact(record.receipt);
      const readback = assertPrototypeMaturityArtifact(record.readback);
      if (prototypeClosureBaselineReceiptRef(receipt) !== ref ||
          receipt.prototype_id !== `prototype:${prototypeId}` ||
          receipt.transition !== "baseline-promotion" ||
          receipt.resulting_lifecycle !== "baseline-approved" ||
          receipt.readback_ref.id !== prototypeMaturityReference(readback).id ||
          receipt.readback_ref.digest !== readback.readback_digest ||
          readback.prototype_id !== receipt.prototype_id ||
          readback.authority_state !== "merged-authority" ||
          readback.observed_lifecycle !== "baseline-approved") {
        throw closureError("baseline_receipt_binding_invalid", "Baseline receipt differs from its merged Studio readback.", 503);
      }
      const source = await studioSourceClient.readBaselineAt(readback.source_revision, prototypeId);
      if (source.record_digest !== readback.record_digest ||
          source.lifecycle !== "baseline-approved" || !source.design_baseline_ref) {
        throw closureError("baseline_source_invalid", "Merged Studio source does not prove the accepted baseline.", 503);
      }
      return {
        ref, owner_ref: "operator-orchestration-service", digest: receipt.receipt_digest,
        state: "accepted", subject_ref: source.design_baseline_ref,
        source_revision: readback.source_revision,
        source_packet_ref: null, prototype_id: prototypeId,
      };
    },
  };
}
