import { canonicalDigest } from "../delivery-art/canonical-json.js";
import { HttpError } from "../errors.js";
import {
  assertPrototypeDeliveryApplicationEvent,
  assertPrototypeDeliveryApplicationResult,
} from "./contracts.js";
import { deliveryIngressId } from "./service.js";

export const PROTOTYPE_DELIVERY_WORKFLOW_ID =
  "prototype-delivery-application";

function digestHex(value) {
  return canonicalDigest(value).slice("sha256:".length);
}

export function prototypeDeliveryApplicationId(packet) {
  return `prototype-delivery-application:${digestHex({
    packet_digest: packet.packet_digest,
    packet_ref: packet.packet_ref,
    source_record_ref: packet.content.source.record_ref,
    target: "workspace-delivery-art",
  })}`;
}

export function prototypeDeliveryEventId(applicationId) {
  return `prototype-delivery-application-event:${digestHex({ application_id: applicationId })}`;
}

export function prototypeDeliverySource(packet) {
  return {
    prototype_id: packet.content.source.prototype_id,
    record_ref: packet.content.source.record_ref,
    record_version: packet.content.source.record_version,
    packet_ref: packet.packet_ref,
    packet_digest: packet.packet_digest,
    baseline_ref: packet.content.baseline.record_ref,
    custody: packet.content.custody,
  };
}

export function prototypeReadinessProjection(readiness) {
  return {
    outcome: readiness.receipt.decision.outcome,
    receipt_id: readiness.receipt.receipt_id,
    receipt_ref: readiness.reference,
    evaluated_at: readiness.receipt.decision.evaluated_at,
  };
}

export function prototypeTargetOwnerRepo(packet) {
  return packet.content.custody.repository_mode === "not-required"
    ? null
    : packet.content.custody.owner;
}

export function prototypeDeliveryIngressEnvelope({
  applicationId,
  operatorDecision,
  packet,
}) {
  const source = packet.content.source;
  const ingressId = deliveryIngressId({
    packetRef: packet.packet_ref,
    sourceKind: "prototype",
    sourceRecordRef: source.record_ref,
  });
  return {
    schema_version: 1,
    ingress_id: ingressId,
    application_id: applicationId,
    authority: {
      record_system: "openproject",
      record_project: "workspace-delivery-art",
      mutation_adapter: "operator-orchestration-service",
    },
    source: {
      kind: "prototype",
      record_ref: source.record_ref,
      record_version: source.record_version,
      status: source.lifecycle,
      packet_ref: packet.packet_ref,
      packet_digest: packet.packet_digest,
      custody: packet.content.custody,
    },
    operator: {
      id: operatorDecision.operator_id,
      handle: null,
    },
    target: {
      record_type: "delivery-epic",
      owner_repo: prototypeTargetOwnerRepo(packet),
      target_pi: null,
    },
    evidence: {
      source_kind: "prototype",
      prototype_id: source.prototype_id,
      title: packet.content.work.title,
      objective: packet.content.work.objective,
      included_scope: packet.content.work.included_scope,
      excluded_scope: packet.content.work.excluded_scope,
      remaining_work: packet.content.work.remaining_work,
      baseline_ref: packet.content.baseline.record_ref,
      baseline_version: packet.content.baseline.version,
      evidence_refs: packet.content.evidence_refs,
    },
    receipt_ref: `prototype-delivery-ingress-receipt:${digestHex({
      application_id: applicationId,
      packet_digest: packet.packet_digest,
    })}`,
  };
}

export function buildPrototypeDeliveryApplicationEvent({
  applicationId,
  ingressId,
  operatorDecision,
  packet,
  readiness,
  recordedAt,
  target,
}) {
  const eventCore = {
    schema_version: 1,
    event_type: "prototype-delivery-application-applied",
    event_id: prototypeDeliveryEventId(applicationId),
    workflow_id: PROTOTYPE_DELIVERY_WORKFLOW_ID,
    application_id: applicationId,
    ingress_id: ingressId,
    source: prototypeDeliverySource(packet),
    readiness: prototypeReadinessProjection(readiness),
    operator_decision: operatorDecision,
    target: {
      record_ref: target.record_ref,
      record_version: target.record_version,
      record_system: "openproject",
      record_project: "workspace-delivery-art",
      record_type: "delivery-epic",
      application_state: target.application_state,
      prototype_backlink_state: "recorded",
      baseline_backlink_state: "recorded",
      source_receipt_state: "emitted",
      owner_repo: target.owner_repo,
    },
  };
  const contentDigest = canonicalDigest({
    ...eventCore,
    recorded_at: recordedAt,
  });
  return assertPrototypeDeliveryApplicationEvent({
    ...eventCore,
    receipt: {
      receipt_ref:
        `oos://receipts/prototype-delivery-application/${contentDigest.slice("sha256:".length)}`,
      owner: "operator-orchestration-service",
      recorded_at: recordedAt,
      content_digest: contentDigest,
    },
  });
}

export function prototypeDeliveryResultFromEvent({
  activityId,
  event,
  resolution,
}) {
  const recordId = Number.parseInt(event.target.record_ref.split("/").at(-1), 10);
  if (!Number.isInteger(activityId) || activityId < 1 || !Number.isInteger(recordId)) {
    throw new HttpError(
      502,
      "prototype_delivery_receipt_custody_invalid",
      "Prototype Delivery application evidence is missing durable OpenProject custody.",
    );
  }
  return assertPrototypeDeliveryApplicationResult({
    schema_version: 1,
    workflow_id: PROTOTYPE_DELIVERY_WORKFLOW_ID,
    application_id: event.application_id,
    ingress_id: event.ingress_id,
    resolution,
    source: event.source,
    readiness: event.readiness,
    operator_decision: event.operator_decision,
    target: event.target,
    receipt: {
      ...event.receipt,
      custody: {
        state: "durable",
        backend: "openproject-activity",
        uri: `openproject://work_packages/${recordId}/activities/${activityId}`,
      },
    },
  });
}

export function assertPrototypeDeliveryApplicationEventIntegrity(event) {
  const { receipt, ...eventCore } = event;
  const expectedDigest = canonicalDigest({
    ...eventCore,
    recorded_at: receipt.recorded_at,
  });
  const expectedReceiptRef =
    `oos://receipts/prototype-delivery-application/${expectedDigest.slice("sha256:".length)}`;
  if (
    receipt.content_digest !== expectedDigest ||
    receipt.receipt_ref !== expectedReceiptRef
  ) {
    throw new HttpError(
      502,
      "prototype_delivery_event_integrity_invalid",
      "Prototype Delivery application event integrity does not match its content.",
    );
  }
  return event;
}

export function assertPrototypeApplicationReplayBinding({ event, request }) {
  const expectedApplicationId = prototypeDeliveryApplicationId(request.packet);
  if (
    event.application_id !== expectedApplicationId ||
    event.source.packet_ref !== request.packet.packet_ref ||
    event.source.packet_digest !== request.packet.packet_digest ||
    canonicalDigest(event.operator_decision) !==
      canonicalDigest(request.operator_decision)
  ) {
    throw new HttpError(
      409,
      "prototype_delivery_application_conflict",
      "Prototype Delivery application identity is already bound to different input.",
    );
  }
}
