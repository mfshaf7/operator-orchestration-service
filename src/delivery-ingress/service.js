import { canonicalDigest } from "../delivery-art/canonical-json.js";
import { HttpError } from "../errors.js";
import {
  assertDeliveryIngressApplicationEnvelope,
  assertDeliveryIngressTargetApplicationResult,
} from "./contracts.js";

export function deliveryIngressId({ packetRef, sourceKind, sourceRecordRef }) {
  const digest = canonicalDigest({
    packet_ref: packetRef,
    source_kind: sourceKind,
    source_record_ref: sourceRecordRef,
    target: "workspace-delivery-art",
  }).slice("sha256:".length);
  return `delivery-ingress:${sourceKind}:${digest}`;
}

export function createDeliveryIngressService({ adapters, clock = () => new Date() }) {
  const sourceAdapters = new Map(Object.entries(adapters ?? {}));

  async function apply({ envelope, sourceContext = null }) {
    assertDeliveryIngressApplicationEnvelope(envelope);
    const expectedIngressId = deliveryIngressId({
      packetRef: envelope.source.packet_ref,
      sourceKind: envelope.source.kind,
      sourceRecordRef: envelope.source.record_ref,
    });
    if (envelope.ingress_id !== expectedIngressId) {
      throw new HttpError(
        409,
        "delivery_ingress_identity_mismatch",
        "Delivery ingress identity does not match the bound source packet.",
        { expected_ingress_id: expectedIngressId },
      );
    }

    const adapter = sourceAdapters.get(envelope.source.kind);
    if (!adapter) {
      throw new HttpError(
        501,
        "delivery_ingress_source_not_implemented",
        `Delivery ingress target application is not implemented for source kind ${envelope.source.kind}.`,
      );
    }

    const applied = await adapter.apply({ envelope, sourceContext });
    const result = assertDeliveryIngressTargetApplicationResult({
      schema_version: 1,
      ingress_id: envelope.ingress_id,
      application_id: envelope.application_id,
      source: {
        kind: envelope.source.kind,
        record_ref: envelope.source.record_ref,
        record_version: envelope.source.record_version,
        packet_ref: envelope.source.packet_ref,
        packet_digest: envelope.source.packet_digest,
      },
      target: applied.target,
      receipt: {
        receipt_ref: envelope.receipt_ref,
        owner: "operator-orchestration-service",
        recorded_at: clock().toISOString(),
      },
    });
    return {
      result,
      sourceRecord: applied.sourceRecord,
    };
  }

  return { apply };
}
