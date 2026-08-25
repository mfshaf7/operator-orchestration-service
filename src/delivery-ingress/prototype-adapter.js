import { canonicalDigest, canonicalStringify } from "../delivery-art/canonical-json.js";
import { HttpError, OpenProjectError } from "../errors.js";
import { assertPrototypeDeliveryApplicationEvent } from "./contracts.js";
import { assertPrototypeDeliveryApplicationEventIntegrity } from
  "./prototype-application-model.js";
import {
  decodePrototypeDeliveryApplicationEvent,
  encodePrototypeDeliveryApplicationEvent,
  isPrototypeDeliveryApplicationEventComment,
} from "./prototype-event-codec.js";

const MARKER_PREFIX = "OOS_PROTOTYPE_DELIVERY_APPLICATION_V1 ";
const MAX_ACTIVITY_PAGES = 20;
const ACTIVITY_PAGE_SIZE = 100;

function encodeMarker(marker) {
  return Buffer.from(canonicalStringify(marker), "utf8").toString("base64url");
}

export function prototypeDeliveryTargetMarker({
  envelope,
  operatorDecision,
  readiness,
}) {
  return {
    schema_version: 1,
    application_id: envelope.application_id,
    ingress_id: envelope.ingress_id,
    source_record_ref: envelope.source.record_ref,
    source_record_version: envelope.source.record_version,
    packet_ref: envelope.source.packet_ref,
    packet_digest: envelope.source.packet_digest,
    baseline_ref: envelope.evidence.baseline_ref,
    operator_decision: {
      decision: operatorDecision.decision,
      operator_id: operatorDecision.operator_id,
      decision_ref: operatorDecision.decision_ref,
    },
    readiness_receipt_ref: readiness.reference,
  };
}

export function encodePrototypeDeliveryTargetMarker(marker) {
  return `<!-- ${MARKER_PREFIX}${encodeMarker(marker)} -->`;
}

export function decodePrototypeDeliveryTargetMarker(description) {
  if (typeof description !== "string") {
    return null;
  }
  const start = description.indexOf(`<!-- ${MARKER_PREFIX}`);
  if (start < 0) {
    return null;
  }
  const encodedStart = start + `<!-- ${MARKER_PREFIX}`.length;
  const end = description.indexOf(" -->", encodedStart);
  if (end < 0) {
    throw new HttpError(
      502,
      "prototype_delivery_target_marker_invalid",
      "A Prototype Delivery target contains an invalid application marker.",
    );
  }
  try {
    const marker = JSON.parse(
      Buffer.from(description.slice(encodedStart, end), "base64url").toString("utf8"),
    );
    const requiredStrings = [
      "application_id",
      "ingress_id",
      "source_record_ref",
      "source_record_version",
      "packet_ref",
      "packet_digest",
      "baseline_ref",
    ];
    if (
      marker?.schema_version !== 1 ||
      requiredStrings.some(
        (field) => typeof marker?.[field] !== "string" || !marker[field],
      ) ||
      marker?.operator_decision?.decision !== "apply" ||
      typeof marker?.operator_decision?.operator_id !== "string" ||
      typeof marker?.operator_decision?.decision_ref !== "string" ||
      typeof marker?.readiness_receipt_ref?.uri !== "string" ||
      typeof marker?.readiness_receipt_ref?.digest !== "string"
    ) {
      throw new Error("marker contract invalid");
    }
    return marker;
  } catch {
    throw new HttpError(
      502,
      "prototype_delivery_target_marker_invalid",
      "A Prototype Delivery target contains an invalid application marker.",
    );
  }
}

function markdownList(values, emptyText) {
  return values.length > 0
    ? values.map((value) => `- ${value}`).join("\n")
    : `- ${emptyText}`;
}

export function buildPrototypeDeliveryDescription({ envelope, marker, packet }) {
  return [
    "## What This Enables",
    "",
    packet.content.work.objective,
    "",
    "## Why This Matters Now",
    "",
    packet.content.rationale,
    "",
    "## Evidence Expectation",
    "",
    `- approved baseline: \`${packet.content.baseline.record_ref}\``,
    `- baseline version: \`${packet.content.baseline.version}\``,
    `- source packet: \`${packet.packet_ref}\``,
    ...packet.content.evidence_refs.map((reference) => `- evidence: \`${reference}\``),
    "",
    "## Execution Context",
    "",
    `- Prototype: \`${packet.content.source.prototype_id}\``,
    `- source record: \`${packet.content.source.record_ref}\``,
    `- source revision: \`${packet.content.source.record_version}\``,
    `- source custody: ${packet.content.custody.classification}`,
    `- application: \`${envelope.application_id}\``,
    "",
    "### Included scope",
    "",
    markdownList(packet.content.work.included_scope, "No included scope recorded."),
    "",
    "### Excluded scope",
    "",
    markdownList(packet.content.work.excluded_scope, "No excluded scope recorded."),
    "",
    "### Remaining work",
    "",
    markdownList(packet.content.work.remaining_work, "No remaining work recorded."),
    "",
    encodePrototypeDeliveryTargetMarker(marker),
  ].join("\n");
}

function sameValue(left, right) {
  return canonicalDigest(left) === canonicalDigest(right);
}

export function createPrototypeDeliveryIngressAdapter({ openProjectClient }) {
  let automationUserRefPromise = null;

  async function automationUserRef() {
    automationUserRefPromise ??=
      openProjectClient.getPrototypeDeliveryAutomationUserRef();
    return automationUserRefPromise;
  }

  async function findTarget(applicationId) {
    const candidates = [];
    for (const target of await openProjectClient.listPrototypeDeliveryApplicationTargets()) {
      const marker = decodePrototypeDeliveryTargetMarker(target.description);
      if (marker?.application_id === applicationId) {
        candidates.push({ marker, target });
      }
    }
    if (candidates.length > 1) {
      throw new HttpError(
        502,
        "prototype_delivery_duplicate_targets",
        "More than one Delivery Epic is bound to the same Prototype application.",
      );
    }
    return candidates[0] ?? null;
  }

  async function readEvents(recordId) {
    const trustedUserRef = await automationUserRef();
    const events = [];
    let page = 1;
    for (let scanned = 0; scanned < MAX_ACTIVITY_PAGES; scanned += 1) {
      const activities =
        await openProjectClient.listPrototypeDeliveryApplicationActivities({
          offset: page,
          pageSize: ACTIVITY_PAGE_SIZE,
          recordId,
        });
      for (const activity of activities.items) {
        if (activity.userRef !== trustedUserRef) {
          continue;
        }
        const decoded = decodePrototypeDeliveryApplicationEvent(activity.comment);
        if (!decoded) {
          if (isPrototypeDeliveryApplicationEventComment(activity.comment)) {
            throw new HttpError(
              502,
              "prototype_delivery_event_invalid",
              "An OOS-authored Prototype Delivery event is malformed.",
            );
          }
          continue;
        }
        try {
          events.push({
            activityId: activity.id,
            event: assertPrototypeDeliveryApplicationEventIntegrity(
              assertPrototypeDeliveryApplicationEvent(decoded),
            ),
          });
        } catch {
          throw new HttpError(
            502,
            "prototype_delivery_event_invalid",
            "An OOS-authored Prototype Delivery event violates its contract.",
          );
        }
      }
      if (page * activities.pageSize >= activities.total) {
        return events;
      }
      page += 1;
    }
    throw new HttpError(
      502,
      "prototype_delivery_activity_limit_exceeded",
      "Prototype Delivery target history exceeds the bounded OOS scan limit.",
    );
  }

  async function inspect(applicationId) {
    const found = await findTarget(applicationId);
    if (!found) {
      return null;
    }
    const matchingEvents = (await readEvents(found.target.recordId)).filter(
      ({ event }) => event.application_id === applicationId,
    );
    if (matchingEvents.length > 1) {
      throw new HttpError(
        502,
        "prototype_delivery_duplicate_events",
        "More than one trusted event is bound to the same Prototype application.",
      );
    }
    return {
      ...found,
      appliedEvent: matchingEvents[0] ?? null,
    };
  }

  async function apply({ envelope, sourceContext }) {
    const { marker, operatorDecision, packet, readiness } = sourceContext ?? {};
    if (!marker || !operatorDecision || !packet || !readiness) {
      throw new HttpError(
        409,
        "delivery_ingress_source_context_mismatch",
        "Prototype runtime context does not match the Delivery ingress envelope.",
      );
    }
    const expectedMarker = prototypeDeliveryTargetMarker({
      envelope,
      operatorDecision,
      readiness,
    });
    if (
      !sameValue(marker, expectedMarker) ||
      packet.packet_ref !== envelope.source.packet_ref
    ) {
      throw new HttpError(
        409,
        "delivery_ingress_source_context_mismatch",
        "Prototype runtime context does not match the Delivery ingress envelope.",
      );
    }

    let found = await findTarget(envelope.application_id);
    let created = false;
    if (found && !sameValue(found.marker, expectedMarker)) {
      throw new HttpError(
        409,
        "prototype_delivery_target_conflict",
        "The existing Delivery target is bound to different Prototype application evidence.",
      );
    }
    if (!found) {
      try {
        const target = await openProjectClient.createPrototypeDeliveryApplicationTarget({
          description: buildPrototypeDeliveryDescription({ envelope, marker, packet }),
          ownerRepo: envelope.target.owner_repo,
          title: packet.content.work.title.trim(),
        });
        found = { marker, target };
        created = true;
      } catch (error) {
        if (
          !(error instanceof OpenProjectError) ||
          error.errorClass !== "backend_unavailable"
        ) {
          throw error;
        }
        found = await findTarget(envelope.application_id);
        if (!found || !sameValue(found.marker, expectedMarker)) {
          throw error;
        }
      }
    }

    const target = found.target;
    if (target.ownerRepo !== envelope.target.owner_repo) {
      throw new HttpError(
        502,
        "prototype_delivery_target_custody_mismatch",
        "The Delivery target owner does not match the resolved Prototype custody.",
      );
    }
    if (!Number.isInteger(target.recordVersion) || target.recordVersion < 1) {
      throw new HttpError(
        502,
        "prototype_delivery_target_version_missing",
        "OpenProject did not return a target record version.",
      );
    }
    return {
      sourceRecord: null,
      detailedTarget: {
        application_state: created ? "created" : "reused",
        owner_repo: target.ownerRepo,
        record_id: target.recordId,
        record_ref: target.recordRef,
        record_version: target.recordVersion,
      },
      target: {
        record_ref: target.recordRef,
        record_system: "openproject",
        record_project: "workspace-delivery-art",
        record_type: "delivery-epic",
        application_state: created ? "created" : "reused",
        source_backlink_state: "recorded",
      },
    };
  }

  async function recordEvent({ event, recordId }) {
    try {
      const activity = await openProjectClient.addPrototypeDeliveryApplicationEvent({
        raw: encodePrototypeDeliveryApplicationEvent(event),
        recordId,
      });
      return { activityId: activity.id, event };
    } catch (error) {
      if (
        !(error instanceof OpenProjectError) ||
        error.errorClass !== "backend_unavailable"
      ) {
        throw error;
      }
      const recovered = (await readEvents(recordId)).filter(
        (candidate) => candidate.event.event_id === event.event_id,
      );
      if (recovered.length === 1 && sameValue(recovered[0].event, event)) {
        return recovered[0];
      }
      throw error;
    }
  }

  return { apply, inspect, recordEvent };
}
