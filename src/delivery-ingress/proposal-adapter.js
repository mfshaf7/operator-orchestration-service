import { HttpError } from "../errors.js";

export function createProposalDeliveryIngressAdapter({ openProjectClient }) {
  return {
    async apply({ envelope, sourceContext }) {
      const { currentRecord, recordId } = sourceContext ?? {};
      if (
        !currentRecord ||
        currentRecord.recordRef !== envelope.source.record_ref ||
        currentRecord.ideaId !== envelope.evidence.proposal_id ||
        !Number.isInteger(recordId)
      ) {
        throw new HttpError(
          409,
          "delivery_ingress_source_context_mismatch",
          "Proposal runtime context does not match the Delivery ingress envelope.",
        );
      }

      const target = await openProjectClient.consumeAcceptedIdea({
        currentRecord,
        ownerRepo: envelope.target.owner_repo,
        recordId,
        targetPi: envelope.target.target_pi,
      });
      if (target.sourceRecord.deliveryRef !== target.deliveryRecord.recordRef) {
        throw new HttpError(
          502,
          "delivery_ingress_source_backlink_missing",
          "Delivery target application did not confirm the source backlink.",
        );
      }

      return {
        sourceRecord: target.sourceRecord,
        target: {
          record_ref: target.deliveryRecord.recordRef,
          record_system: "openproject",
          record_project: "workspace-delivery-art",
          record_type: "delivery-epic",
          application_state: target.deliveryCreated === true ? "created" : "reused",
          source_backlink_state: "recorded",
        },
      };
    },
  };
}
