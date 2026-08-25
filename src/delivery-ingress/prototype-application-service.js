import { canonicalDigest } from "../delivery-art/canonical-json.js";
import { HttpError } from "../errors.js";
import { assertPrototypeDeliveryApplicationRequest } from "./contracts.js";
import {
  assertPrototypeApplicationReplayBinding,
  buildPrototypeDeliveryApplicationEvent,
  prototypeDeliveryApplicationId,
  prototypeDeliveryIngressEnvelope,
  prototypeDeliveryResultFromEvent,
} from "./prototype-application-model.js";
import { prototypeDeliveryTargetMarker } from "./prototype-adapter.js";

function assertPacketIdentity(packet) {
  const expectedDigest = canonicalDigest(packet.content);
  const expectedId =
    `${packet.content.source.prototype_id}-${expectedDigest.slice("sha256:".length)}`;
  if (
    packet.packet_digest !== expectedDigest ||
    packet.packet_id !== expectedId ||
    packet.packet_ref !== `record://delivery-packets/${expectedId}`
  ) {
    throw new HttpError(
      409,
      "prototype_delivery_packet_identity_mismatch",
      "Prototype Delivery packet identity does not match its canonical content.",
    );
  }
}

function assertReadinessAllowed(readiness) {
  const decision = readiness.receipt.decision;
  if (
    decision.outcome !== "allow" ||
    decision.target_application_allowed !== true ||
    decision.reason_codes.length !== 1 ||
    decision.reason_codes[0] !== "eligible"
  ) {
    throw new HttpError(
      409,
      "prototype_delivery_readiness_denied",
      "WGCF did not authorize this Prototype packet for Delivery application.",
      { reason_codes: decision.reason_codes },
    );
  }
}

function markerMatchesRequest({ applicationId, marker, request }) {
  return marker.application_id === applicationId &&
    marker.source_record_ref === request.packet.content.source.record_ref &&
    marker.source_record_version === request.packet.content.source.record_version &&
    marker.packet_ref === request.packet.packet_ref &&
    marker.packet_digest === request.packet.packet_digest &&
    marker.baseline_ref === request.packet.content.baseline.record_ref &&
    canonicalDigest(marker.operator_decision) ===
      canonicalDigest(request.operator_decision);
}

function createKeyedExecutor() {
  const active = new Map();
  return async function run(key, operation) {
    const preceding = active.get(key) ?? Promise.resolve();
    let release;
    const current = new Promise((resolve) => {
      release = resolve;
    });
    const tail = preceding.then(() => current);
    active.set(key, tail);
    await preceding;
    try {
      return await operation();
    } finally {
      release();
      if (active.get(key) === tail) {
        active.delete(key);
      }
    }
  };
}

export function createPrototypeDeliveryApplicationService({
  adapter,
  audit = null,
  clock = () => new Date(),
  deliveryIngressService,
  readinessClient,
}) {
  const runExclusive = createKeyedExecutor();

  async function apply({ callerId, correlationId, request }) {
    assertPrototypeDeliveryApplicationRequest(request);
    assertPacketIdentity(request.packet);
    if (request.operator_decision.operator_id !== callerId) {
      throw new HttpError(
        403,
        "prototype_delivery_operator_binding_mismatch",
        "Prototype Delivery application operator must match the authenticated caller.",
      );
    }
    const applicationId = prototypeDeliveryApplicationId(request.packet);

    return runExclusive(applicationId, async () => {
      const existing = await adapter.inspect(applicationId);
      if (existing?.appliedEvent) {
        assertPrototypeApplicationReplayBinding({
          event: existing.appliedEvent.event,
          request,
        });
        return prototypeDeliveryResultFromEvent({
          activityId: existing.appliedEvent.activityId,
          event: existing.appliedEvent.event,
          resolution: "reused",
        });
      }

      let readiness;
      if (existing) {
        if (!markerMatchesRequest({ applicationId, marker: existing.marker, request })) {
          throw new HttpError(
            409,
            "prototype_delivery_application_conflict",
            "The existing Delivery target is bound to different application input.",
          );
        }
        readiness = await readinessClient.read({
          packet: request.packet,
          reference: existing.marker.readiness_receipt_ref,
        });
      } else {
        readiness = await readinessClient.issue({ packet: request.packet });
      }
      assertReadinessAllowed(readiness);

      const envelope = prototypeDeliveryIngressEnvelope({
        applicationId,
        operatorDecision: request.operator_decision,
        packet: request.packet,
      });
      const marker = prototypeDeliveryTargetMarker({
        envelope,
        operatorDecision: request.operator_decision,
        readiness,
      });
      const applied = await deliveryIngressService.apply({
        envelope,
        sourceContext: {
          marker,
          operatorDecision: request.operator_decision,
          packet: request.packet,
          readiness,
        },
      });
      const target = applied.adapterResult?.detailedTarget;
      if (!target) {
        throw new HttpError(
          502,
          "prototype_delivery_target_evidence_missing",
          "Delivery target application did not return versioned target evidence.",
        );
      }
      const event = buildPrototypeDeliveryApplicationEvent({
        applicationId,
        ingressId: envelope.ingress_id,
        operatorDecision: request.operator_decision,
        packet: request.packet,
        readiness,
        recordedAt: clock().toISOString(),
        target,
      });
      const recorded = await adapter.recordEvent({
        event,
        recordId: target.record_id,
      });
      const result = prototypeDeliveryResultFromEvent({
        activityId: recorded.activityId,
        event: recorded.event,
        resolution: target.application_state,
      });
      audit?.emit({
        application_id: applicationId,
        caller: { id: callerId },
        correlation_id: correlationId,
        event: "prototype_delivery_application_applied",
        source_ref: request.packet.content.source.record_ref,
        target_ref: result.target.record_ref,
      });
      return result;
    });
  }

  async function get({ applicationId, callerId, correlationId }) {
    if (!/^prototype-delivery-application:[a-f0-9]{64}$/.test(applicationId)) {
      throw new HttpError(
        400,
        "prototype_delivery_application_id_invalid",
        "Prototype Delivery application id is invalid.",
      );
    }
    const existing = await adapter.inspect(applicationId);
    if (!existing?.appliedEvent) {
      throw new HttpError(
        404,
        "prototype_delivery_application_not_found",
        "Prototype Delivery application was not found.",
      );
    }
    const result = prototypeDeliveryResultFromEvent({
      activityId: existing.appliedEvent.activityId,
      event: existing.appliedEvent.event,
      resolution: "read",
    });
    audit?.emit({
      application_id: applicationId,
      caller: { id: callerId },
      correlation_id: correlationId,
      event: "prototype_delivery_application_read",
    });
    return result;
  }

  return { apply, get };
}
