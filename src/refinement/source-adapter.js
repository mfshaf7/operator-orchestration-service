import { canonicalDigest } from "../delivery-art/canonical-json.js";
import { OpenProjectError } from "../errors.js";
import { createWorkDesignApplicationAdapter } from "../work-design/application-adapter.js";
import { buildRefinementPacket } from "./packet-model.js";
import {
  assertRefinementReceiptEvent,
  buildRefinementReceiptEvent,
  decodeRefinementReceiptEvent,
  encodeRefinementReceiptEvent,
  isRefinementReceiptEventComment,
} from "./receipt-event.js";
import { buildRefinementReceipt } from "./run-model.js";

const ACTIVITY_PAGE_SIZE = 100;
const MAX_ACTIVITY_PAGES = 20;

export class RefinementSourceError extends Error {
  constructor(code, message, { cause = null, retryable = false } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = "RefinementSourceError";
    this.code = code;
    this.retryable = retryable;
  }
}

function recordIdFromRef(value) {
  const match = String(value ?? "").match(/^openproject:\/\/work_packages\/([1-9][0-9]*)$/);
  return match ? Number.parseInt(match[1], 10) : null;
}

function latestCompletion(applications) {
  return [...applications.values()]
    .map((application) => application.completion)
    .filter(Boolean)
    .sort((left, right) => right.event.recorded_at.localeCompare(left.event.recorded_at))[0] ?? null;
}

export function createRefinementSourceAdapter({ openProjectClient }) {
  const workDesignStore = createWorkDesignApplicationAdapter({ openProjectClient });
  let automationUserRefPromise = null;

  async function automationUserRef() {
    automationUserRefPromise ??= openProjectClient.getRefinementAutomationUserRef();
    try {
      return await automationUserRefPromise;
    } catch (error) {
      automationUserRefPromise = null;
      throw sourceFailure("backend_projection_failed", error);
    }
  }

  async function readReceiptEvents(recordId) {
    const trustedUserRef = await automationUserRef();
    const events = [];
    for (let page = 1; page <= MAX_ACTIVITY_PAGES; page += 1) {
      let activities;
      try {
        activities = await openProjectClient.listRefinementActivities({
          offset: page,
          pageSize: ACTIVITY_PAGE_SIZE,
          recordId,
        });
      } catch (error) {
        throw sourceFailure("backend_projection_failed", error);
      }
      for (const activity of activities.items) {
        if (activity.userRef !== trustedUserRef) continue;
        const decoded = decodeRefinementReceiptEvent(activity.comment);
        if (!decoded) {
          if (isRefinementReceiptEventComment(activity.comment)) {
            throw new RefinementSourceError(
              "backend_projection_failed",
              "A trusted Refinement receipt event is malformed.",
            );
          }
          continue;
        }
        try {
          events.push({
            activityId: activity.id,
            event: assertRefinementReceiptEvent(decoded),
          });
        } catch (error) {
          throw new RefinementSourceError(
            "backend_projection_failed",
            "A trusted Refinement receipt event violates its integrity contract.",
            { cause: error },
          );
        }
      }
      if (page * activities.pageSize >= activities.total) return events;
    }
    throw new RefinementSourceError(
      "backend_projection_failed",
      "Refinement receipt history exceeds the bounded scan limit.",
    );
  }

  async function projectPacket({ packageRef, sourceRef }) {
    const sourceRecordId = recordIdFromRef(sourceRef);
    if (!sourceRecordId) {
      throw new RefinementSourceError(
        "request_invalid",
        "source_ref must identify one OpenProject work package.",
      );
    }
    let source;
    let applications;
    try {
      source = await openProjectClient.getWorkDesignSourceRevision({
        recordId: sourceRecordId,
      });
      ({ applications } = await workDesignStore.inspect({
        packageRef,
        recordId: sourceRecordId,
        sourceRef,
      }));
    } catch (error) {
      throw sourceFailure("backend_projection_failed", error);
    }
    const completion = latestCompletion(applications);
    if (!completion) {
      throw new RefinementSourceError(
        "backend_projection_failed",
        "Refinement requires a trusted completed Work Design handoff.",
      );
    }
    const deliveryRecordId = recordIdFromRef(
      completion.event.result?.target?.delivery_ref,
    );
    if (!deliveryRecordId) {
      throw new RefinementSourceError(
        "backend_projection_failed",
        "The Work Design receipt does not identify a canonical Delivery initiative.",
      );
    }
    let deliverySnapshot;
    try {
      deliverySnapshot = await openProjectClient.getRefinementDeliveryTree({
        recordId: deliveryRecordId,
      });
    } catch (error) {
      throw sourceFailure("backend_projection_failed", error);
    }
    return buildRefinementPacket({
      deliveryTree: deliverySnapshot.tree,
      packageRef,
      source,
      workDesignCompletion: completion,
    });
  }

  async function readCanonicalState({ packet, operationResults = [] }) {
    const snapshot = await readDeliverySnapshot({ packet });
    const refs = operationResults.flatMap((result) => result?.target_refs ?? []);
    return {
      delivery_ref: snapshot.deliveryRef,
      created_refs: uniqueRefs(operationResults, "created_refs"),
      updated_refs: uniqueRefs(operationResults, "updated_refs"),
      reused_refs: uniqueRefs(operationResults, "reused_refs"),
      observed_refs: [...new Set(refs)],
      source_revision: canonicalDigest(snapshot.tree),
    };
  }

  async function readDeliverySnapshot({ packet }) {
    const deliveryRecordId = recordIdFromRef(
      packet.apply_plan.operations.find((operation) => operation.kind === "governance")?.target,
    );
    if (!deliveryRecordId) {
      throw new RefinementSourceError(
        "backend_readback_incomplete",
        "The Refinement packet does not identify its canonical Delivery initiative.",
      );
    }
    let snapshot;
    try {
      snapshot = await openProjectClient.getRefinementDeliveryTree({
        recordId: deliveryRecordId,
      });
    } catch (error) {
      throw sourceFailure("backend_readback_incomplete", error);
    }
    return snapshot;
  }

  async function persistReceipt({ appliedAt, readback, request, runId }) {
    const recordId = recordIdFromRef(request.source_ref);
    const event = buildRefinementReceiptEvent({ appliedAt, readback, request, runId });
    const existing = (await readReceiptEvents(recordId)).find(
      (entry) => entry.event.run_id === runId,
    );
    if (existing) {
      if (existing.event.content_digest !== event.content_digest) {
        throw new RefinementSourceError(
          "apply_conflict",
          "The Refinement run already has a receipt bound to different output.",
        );
      }
      return receiptFromEvent(existing, request);
    }
    let activity;
    try {
      activity = await openProjectClient.addRefinementReceiptEvent({
        raw: encodeRefinementReceiptEvent(event),
        recordId,
      });
    } catch (error) {
      if (error instanceof OpenProjectError && error.errorClass === "backend_unavailable") {
        const recovered = (await readReceiptEvents(recordId)).find(
          (entry) => entry.event.run_id === runId,
        );
        if (recovered?.event.content_digest === event.content_digest) {
          return receiptFromEvent(recovered, request);
        }
      }
      throw sourceFailure("apply_recovery_required", error);
    }
    return receiptFromEvent({ activityId: activity.id, event }, request);
  }

  return {
    persistReceipt,
    projectPacket,
    readCanonicalState,
    readDeliverySnapshot,
    readReceiptEvents,
  };
}

function uniqueRefs(results, key) {
  return [...new Set(results.flatMap((result) => result?.[key] ?? []))];
}

function receiptFromEvent(entry, request) {
  return buildRefinementReceipt({
    appliedAt: entry.event.applied_at,
    readback: entry.event.target,
    receiptRef: `${request.source_ref}/activities/${entry.activityId}`,
    request,
    runId: entry.event.run_id,
  });
}

function sourceFailure(code, error) {
  if (error instanceof RefinementSourceError) return error;
  return new RefinementSourceError(
    code,
    error instanceof Error ? error.message : "Refinement source operation failed.",
    {
      cause: error,
      retryable:
        error instanceof OpenProjectError &&
        error.errorClass === "backend_unavailable",
    },
  );
}
