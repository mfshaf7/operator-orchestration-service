import { canonicalDigest } from "../delivery-art/canonical-json.js";
import { OpenProjectError } from "../errors.js";
import { assertWorkDesignApplicationEvent } from "./contracts.js";
import {
  decodeWorkDesignApplicationEvent,
  encodeWorkDesignApplicationEvent,
  isWorkDesignApplicationEventComment,
} from "./application-event-codec.js";
import { assertWorkDesignApplicationEventIntegrity } from "./application-model.js";

const ACTIVITY_PAGE_SIZE = 100;
const MAX_ACTIVITY_PAGES = 20;

export class WorkDesignApplicationStoreError extends Error {
  constructor(code, message, { cause = null, retryable = false } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = "WorkDesignApplicationStoreError";
    this.code = code;
    this.retryable = retryable;
  }
}

function sameEvent(left, right) {
  return canonicalDigest(left) === canonicalDigest(right);
}

export function createWorkDesignApplicationAdapter({ openProjectClient }) {
  let automationUserRefPromise = null;

  async function automationUserRef() {
    automationUserRefPromise ??= openProjectClient.getWorkDesignAutomationUserRef();
    let userRef;
    try {
      userRef = await automationUserRefPromise;
    } catch (error) {
      automationUserRefPromise = null;
      throw new WorkDesignApplicationStoreError(
        "backend_projection_failed",
        "Work Design receipt authority identity could not be read.",
        {
          cause: error,
          retryable:
            error instanceof OpenProjectError &&
            error.errorClass === "backend_unavailable",
        },
      );
    }
    if (!/^\/api\/v3\/users\/[1-9][0-9]*$/.test(userRef ?? "")) {
      throw new WorkDesignApplicationStoreError(
        "backend_projection_failed",
        "Work Design receipt authority identity could not be verified.",
      );
    }
    return userRef;
  }

  async function readEvents(recordId) {
    const trustedUserRef = await automationUserRef();
    const events = [];
    for (let page = 1; page <= MAX_ACTIVITY_PAGES; page += 1) {
      let activities;
      try {
        activities = await openProjectClient.listWorkDesignApplicationActivities({
          offset: page,
          pageSize: ACTIVITY_PAGE_SIZE,
          recordId,
        });
      } catch (error) {
        throw new WorkDesignApplicationStoreError(
          "backend_projection_failed",
          "Work Design application history could not be read.",
          {
            cause: error,
            retryable:
              error instanceof OpenProjectError &&
              error.errorClass === "backend_unavailable",
          },
        );
      }
      for (const activity of activities.items) {
        if (activity.userRef !== trustedUserRef) {
          continue;
        }
        const decoded = decodeWorkDesignApplicationEvent(activity.comment);
        if (!decoded) {
          if (isWorkDesignApplicationEventComment(activity.comment)) {
            throw new WorkDesignApplicationStoreError(
              "receipt_history_invalid",
              "A trusted Work Design application event is malformed.",
            );
          }
          continue;
        }
        try {
          events.push({
            activityId: activity.id,
            createdAt: activity.createdAt,
            event: assertWorkDesignApplicationEventIntegrity(
              assertWorkDesignApplicationEvent(decoded),
            ),
          });
        } catch {
          throw new WorkDesignApplicationStoreError(
            "receipt_history_invalid",
            "A trusted Work Design application event violates its contract.",
          );
        }
      }
      if (page * activities.pageSize >= activities.total) {
        return events;
      }
    }
    throw new WorkDesignApplicationStoreError(
      "receipt_history_invalid",
      "Work Design application history exceeds the bounded scan limit.",
    );
  }

  async function inspect({ applicationId = null, packageRef, recordId, sourceRef }) {
    const events = (await readEvents(recordId)).filter(({ event }) => {
      if (event.source_ref !== sourceRef) {
        throw new WorkDesignApplicationStoreError(
          "receipt_history_invalid",
          "A trusted Work Design event is attached to the wrong source record.",
        );
      }
      return event.package_ref === packageRef;
    });
    const byApplication = new Map();
    for (const entry of events) {
      const group = byApplication.get(entry.event.application_id) ?? {
        completion: null,
        intent: null,
      };
      const field = entry.event.event_type === "apply-intent" ? "intent" : "completion";
      if (group[field] && !sameEvent(group[field].event, entry.event)) {
        throw new WorkDesignApplicationStoreError(
          "receipt_history_invalid",
          "Conflicting trusted Work Design events share one application identity.",
        );
      }
      group[field] ??= entry;
      byApplication.set(entry.event.application_id, group);
    }
    return {
      applications: byApplication,
      application: applicationId ? byApplication.get(applicationId) ?? null : null,
    };
  }

  async function record({ event, recordId }) {
    try {
      const activity = await openProjectClient.addWorkDesignApplicationEvent({
        raw: encodeWorkDesignApplicationEvent(event),
        recordId,
      });
      if (!Number.isInteger(activity.id) || activity.id < 1) {
        throw new WorkDesignApplicationStoreError(
          "receipt_persistence_failed",
          "OpenProject did not return durable Work Design activity custody.",
        );
      }
      return { activityId: activity.id, createdAt: activity.createdAt, event };
    } catch (error) {
      if (error instanceof WorkDesignApplicationStoreError) {
        throw error;
      }
      if (
        error instanceof OpenProjectError &&
        error.errorClass === "backend_unavailable"
      ) {
        try {
          const recovered = (await readEvents(recordId)).filter(
            (candidate) => candidate.event.event_id === event.event_id,
          );
          if (
            recovered.length > 0 &&
            recovered.every((candidate) => sameEvent(candidate.event, event))
          ) {
            return recovered.sort((left, right) => right.activityId - left.activityId)[0];
          }
        } catch (recoveryError) {
          if (!(recoveryError instanceof WorkDesignApplicationStoreError)) {
            throw recoveryError;
          }
        }
      }
      throw new WorkDesignApplicationStoreError(
        "receipt_persistence_failed",
        "Work Design application evidence could not be persisted.",
        {
          cause: error,
          retryable:
            error instanceof OpenProjectError &&
            error.errorClass === "backend_unavailable",
        },
      );
    }
  }

  return { inspect, record };
}
