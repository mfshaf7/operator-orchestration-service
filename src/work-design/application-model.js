import { canonicalDigest } from "../delivery-art/canonical-json.js";
import {
  assertWorkDesignApplicationEvent,
  assertWorkDesignApplyResult,
} from "./contracts.js";

export const WORK_DESIGN_APPLY_WORKFLOW_ID = "delivery-work-design-apply";

function digestId(prefix, value) {
  return `${prefix}:${canonicalDigest(value).slice("sha256:".length, 40)}`;
}

export function workDesignApplicationId(request) {
  return digestId("work-design-application", {
    idempotency_key: request.idempotency_key,
    draft_digest: request.accepted_draft.draft_digest,
  });
}

function eventId(applicationId, eventType) {
  return digestId("work-design-application-event", {
    application_id: applicationId,
    event_type: eventType,
  });
}

export function buildWorkDesignApplicationEvent({
  eventType,
  recordedAt,
  request,
  requestDigest,
  result = null,
}) {
  const applicationId = workDesignApplicationId(request);
  const core = {
    schema_version: 1,
    event_type: eventType,
    event_id: eventId(applicationId, eventType),
    workflow_id: WORK_DESIGN_APPLY_WORKFLOW_ID,
    application_id: applicationId,
    request_digest: requestDigest,
    idempotency_key: request.idempotency_key,
    delivery_id: request.delivery_id,
    package_ref: request.package_ref,
    source_ref: request.source_ref,
    source_revision: request.source_revision,
    operator_id: request.operator.id,
    accepted_draft_digest: request.accepted_draft.draft_digest,
    recorded_at: recordedAt,
    result,
  };
  return assertWorkDesignApplicationEvent({
    ...core,
    content_digest: canonicalDigest(core),
  });
}

export function assertWorkDesignApplicationEventIntegrity(event) {
  const { content_digest: contentDigest, ...core } = event;
  if (contentDigest !== canonicalDigest(core)) {
    throw new Error("Work Design application event digest does not match its content.");
  }
  return event;
}

export function assertWorkDesignApplicationBinding({ event, request, requestDigest }) {
  if (
    event.application_id !== workDesignApplicationId(request) ||
    event.request_digest !== requestDigest ||
    event.idempotency_key !== request.idempotency_key ||
    event.delivery_id !== request.delivery_id ||
    event.package_ref !== request.package_ref ||
    event.source_ref !== request.source_ref ||
    event.source_revision !== request.source_revision ||
    event.operator_id !== request.operator.id ||
    event.accepted_draft_digest !== request.accepted_draft.draft_digest
  ) {
    throw new Error("Work Design application identity is bound to different input.");
  }
  return event;
}

export function workDesignResultFromEvent({ activityId, event, replayed = false }) {
  if (
    event.event_type !== "apply-completed" ||
    !event.result ||
    !Number.isInteger(activityId) ||
    activityId < 1
  ) {
    throw new Error("Work Design completion event is missing durable activity evidence.");
  }
  const recordId = Number.parseInt(event.source_ref.split("/").at(-1), 10);
  return assertWorkDesignApplyResult({
    ...event.result,
    status: replayed ? "reconciled" : event.result.status,
    receipt: {
      ref: `openproject://work_packages/${recordId}/activities/${activityId}`,
      digest: event.content_digest,
    },
  });
}
