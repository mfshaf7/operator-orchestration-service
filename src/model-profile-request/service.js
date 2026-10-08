import {
  assertModelProfileContract,
  createModelProfileReceipt,
  modelProfileDigest,
  modelProfileRequestError,
} from "./contracts.js";

const TRANSITIONS = {
  revise: new Set(["draft", "changes-required"]),
  submit: new Set(["draft", "changes-required"]),
  "start-review": new Set(["submitted"]),
  "request-changes": new Set(["under-review"]),
  approve: new Set(["under-review"]),
  reject: new Set(["under-review"]),
  withdraw: new Set(["draft", "submitted", "under-review", "changes-required"]),
};

const AFTER = {
  revise: (state) => state,
  submit: () => "submitted",
  "start-review": () => "under-review",
  "request-changes": () => "changes-required",
  approve: () => "approved",
  reject: () => "rejected",
  withdraw: () => "withdrawn",
};

function assertOperatorBinding(bindings, callerId, operatorId) {
  if (!bindings[callerId] || bindings[callerId] !== operatorId) {
    throw modelProfileRequestError(
      "operator_binding_invalid",
      "Caller identity is not bound to the supplied operator identity.",
      403,
    );
  }
}

function assertOwner(record, callerId) {
  if (!record || record.owner_caller_id !== callerId) {
    throw modelProfileRequestError("not_found", "Model-profile request was not found.", 404);
  }
}

function receiptRef(receipt) {
  return {
    uri: `oos://model-profile-receipts/${receipt.receipt_id}`,
    digest: receipt.digest,
  };
}

function nextAction(record) {
  if (record.review_state === "draft") return "revise-or-submit";
  if (record.review_state === "submitted") return "start-review";
  if (record.review_state === "under-review") return "record-review-decision";
  if (record.review_state === "changes-required") return "revise-and-resubmit";
  if (["rejected", "withdrawn"].includes(record.review_state)) return "complete";
  if (record.fulfillment_state === "not-started") return "begin-platform-fulfillment";
  if (record.fulfillment_state === "implementing") return "await-platform-fulfillment";
  if (record.fulfillment_state === "failed") return "retry-or-correct-fulfillment";
  return "refresh-authoritative-projections";
}

function project(record) {
  const projection = {
    schema_version: 1,
    workflow_id: "model-profile-request",
    request_id: record.request.request_id,
    revision: record.revision,
    request: structuredClone(record.request),
    review_state: record.review_state,
    fulfillment_state: record.fulfillment_state,
    requirements: structuredClone(record.requirements),
    decision_ref: structuredClone(record.decision_ref),
    fulfillment: structuredClone(record.fulfillment),
    latest_receipt: structuredClone(record.latest_receipt),
    history: structuredClone(record.history),
    next_action: nextAction(record),
    profile_lifecycle_changed: false,
  };
  return assertModelProfileContract("projection.schema.json", projection);
}

function appendEvent(record, {
  actorId,
  commandId,
  eventType,
  fulfillmentBefore,
  occurredAt,
  reviewBefore,
  summary,
}) {
  const receipt = createModelProfileReceipt({
    actor: { caller_id: actorId.callerId, operator_id: actorId.operatorId },
    deliveryRef: record.request.delivery_ref,
    fulfillmentState: record.fulfillment_state,
    intent: record.request.intent,
    priorReceipt: record.latest_receipt,
    profileId: record.request.profile_intent.profile_id,
    recordedAt: occurredAt,
    requestId: record.request.request_id,
    requestRevision: record.revision,
    reviewState: record.review_state,
    sourceRef: record.fulfillment?.source?.review_ref ?? record.request.profile_intent.source?.registry_ref ?? null,
  });
  record.latest_receipt = receipt;
  record.history.push({
    sequence: record.history.length + 1,
    event_type: eventType,
    occurred_at: occurredAt,
    actor_id: actorId.operatorId ?? actorId.callerId,
    command_id: commandId,
    review_state_before: reviewBefore,
    review_state_after: record.review_state,
    fulfillment_state_before: fulfillmentBefore,
    fulfillment_state_after: record.fulfillment_state,
    summary,
    receipt_ref: receiptRef(receipt),
  });
  if (record.history.length > 128) {
    throw modelProfileRequestError("history_limit", "Model-profile request history limit was reached.", 409);
  }
}

function assertRevision(record, expected) {
  if (record.revision !== expected) {
    throw modelProfileRequestError(
      "revision_conflict",
      `Expected revision ${expected}, but authoritative revision is ${record.revision}.`,
      409,
    );
  }
}

function assertReplay(record, keys, digest) {
  const replays = keys.map((key) => record.operation_keys[key]).filter(Boolean);
  if (!replays.length) return false;
  if (replays.length !== keys.length || replays.some((replay) => replay !== digest)) {
    throw modelProfileRequestError(
      "idempotency_conflict",
      "Command or idempotency identity is bound to different input.",
      409,
    );
  }
  return true;
}

function bindOperation(record, keys, digest) {
  for (const key of keys) record.operation_keys[key] = digest;
}

function assertTimestampOrder(record, timestamp) {
  const prior = record.history.at(-1)?.occurred_at;
  if (prior && Date.parse(timestamp) < Date.parse(prior)) {
    throw modelProfileRequestError(
      "timestamp_out_of_order",
      "Mutation timestamp precedes the latest durable request event.",
      409,
    );
  }
}

function assertProfileIntentSemantics(profileIntent) {
  const callerIds = profileIntent.registered_callers.map((entry) => entry.caller_id);
  if (new Set(callerIds).size !== callerIds.length) {
    throw modelProfileRequestError(
      "registered_caller_ambiguous",
      "Registered caller identities must be unique within one profile request.",
      400,
    );
  }
}

export function createModelProfileRequestService({
  audit,
  clock = () => new Date(),
  fulfillmentCallerIds,
  operatorBindings,
  store,
}) {
  async function create({ callerId, input, operatorId }) {
    assertOperatorBinding(operatorBindings, callerId, operatorId);
    const request = assertModelProfileContract("request.schema.json", structuredClone(input));
    assertProfileIntentSemantics(request.profile_intent);
    if (request.operator_id !== operatorId) {
      throw modelProfileRequestError("operator_mismatch", "Request operator does not match authenticated operator.", 403);
    }
    const digest = modelProfileDigest(request);
    const createKey = `${callerId}:${request.idempotency_key}`;
    return store.transact(async (transaction) => {
      const existingById = transaction.get(request.request_id);
      const existingKey = transaction.idempotency(callerId, request.idempotency_key);
      const existing = existingById ?? (existingKey ? transaction.get(existingKey.request_id) : null);
      if (existing) {
        assertOwner(existing, callerId);
        if (existing.request_digest !== digest || existingKey?.digest && existingKey.digest !== digest) {
          throw modelProfileRequestError(
            "idempotency_conflict",
            "Request identity or idempotency key is bound to different input.",
            409,
          );
        }
        return project(existing);
      }
      const now = clock().toISOString();
      const record = {
        owner_caller_id: callerId,
        request,
        request_digest: digest,
        revision: 1,
        review_state: "draft",
        fulfillment_state: "not-started",
        requirements: [],
        decision_ref: null,
        fulfillment: null,
        latest_receipt: null,
        history: [],
        operation_keys: {},
      };
      appendEvent(record, {
        actorId: { callerId, operatorId },
        commandId: request.idempotency_key,
        eventType: "request-created",
        fulfillmentBefore: null,
        occurredAt: now,
        reviewBefore: null,
        summary: "Model-profile request recorded as a draft; no profile lifecycle state changed.",
      });
      await transaction.put(record, { createKey });
      audit?.emit({
        actor: operatorId,
        event_type: "model.profile.request.created",
        outcome: "draft",
        request_id: request.request_id,
      });
      return project(record);
    });
  }

  async function command({ callerId, input, operatorId, requestId }) {
    assertOperatorBinding(operatorBindings, callerId, operatorId);
    const commandInput = assertModelProfileContract("command.schema.json", structuredClone(input));
    if (commandInput.request_id !== requestId || commandInput.operator_id !== operatorId) {
      throw modelProfileRequestError("command_binding_invalid", "Command request or operator binding is invalid.", 403);
    }
    const digest = modelProfileDigest(commandInput);
    const operationKeys = [
      `command-id:${commandInput.command_id}`,
      `command-idempotency:${commandInput.idempotency_key}`,
    ];
    return store.transact(async (transaction) => {
      const record = transaction.get(requestId);
      assertOwner(record, callerId);
      if (assertReplay(record, operationKeys, digest)) return project(record);
      assertRevision(record, commandInput.expected_revision);
      assertTimestampOrder(record, commandInput.issued_at);
      if (!TRANSITIONS[commandInput.action].has(record.review_state)) {
        throw modelProfileRequestError(
          "transition_invalid",
          `Action ${commandInput.action} is not allowed from ${record.review_state}.`,
          409,
        );
      }
      const reviewBefore = record.review_state;
      const fulfillmentBefore = record.fulfillment_state;
      if (commandInput.action === "revise") {
        const revisedRequest = {
          ...record.request,
          profile_intent: structuredClone(commandInput.revised_profile_intent),
        };
        assertModelProfileContract("request.schema.json", revisedRequest);
        assertProfileIntentSemantics(revisedRequest.profile_intent);
        record.request = revisedRequest;
        record.request_digest = modelProfileDigest(revisedRequest);
      }
      record.review_state = AFTER[commandInput.action](record.review_state);
      if (commandInput.action === "request-changes") {
        record.requirements = structuredClone(commandInput.requirements);
      } else if (["submit", "approve", "reject", "withdraw"].includes(commandInput.action)) {
        record.requirements = [];
      }
      if (["approve", "reject"].includes(commandInput.action)) {
        record.decision_ref = structuredClone(commandInput.decision_ref);
      }
      record.revision += 1;
      appendEvent(record, {
        actorId: { callerId, operatorId },
        commandId: commandInput.command_id,
        eventType: `review-${commandInput.action}`,
        fulfillmentBefore,
        occurredAt: commandInput.issued_at,
        reviewBefore,
        summary: commandInput.reason ?? `Review action ${commandInput.action} recorded.`,
      });
      bindOperation(record, operationKeys, digest);
      await transaction.put(record);
      audit?.emit({
        actor: operatorId,
        event_type: `model.profile.request.${commandInput.action}`,
        outcome: record.review_state,
        request_id: requestId,
      });
      return project(record);
    });
  }

  async function fulfill({ callerId, input, requestId }) {
    if (!fulfillmentCallerIds.has(callerId)) {
      throw modelProfileRequestError(
        "fulfillment_forbidden",
        "Caller is not an admitted Platform fulfillment writer.",
        403,
      );
    }
    const fulfillment = assertModelProfileContract("fulfillment.schema.json", structuredClone(input));
    if (fulfillment.request_id !== requestId) {
      throw modelProfileRequestError("fulfillment_binding_invalid", "Fulfillment request binding is invalid.", 400);
    }
    if (fulfillment.actor_id !== callerId) {
      throw modelProfileRequestError(
        "fulfillment_actor_invalid",
        "Fulfillment actor must match the authenticated Platform caller.",
        403,
      );
    }
    const digest = modelProfileDigest(fulfillment);
    const operationKeys = [
      `fulfillment-id:${fulfillment.fulfillment_id}`,
      `fulfillment-idempotency:${fulfillment.idempotency_key}`,
    ];
    return store.transact(async (transaction) => {
      const record = transaction.get(requestId);
      if (!record) throw modelProfileRequestError("not_found", "Model-profile request was not found.", 404);
      if (assertReplay(record, operationKeys, digest)) return project(record);
      assertRevision(record, fulfillment.expected_revision);
      assertTimestampOrder(record, fulfillment.recorded_at);
      if (record.review_state !== "approved") {
        throw modelProfileRequestError(
          "fulfillment_not_approved",
          "Platform fulfillment requires an approved request.",
          409,
        );
      }
      const allowed = fulfillment.state === "implementing"
        ? new Set(["not-started", "failed"])
        : new Set(["implementing"]);
      if (!allowed.has(record.fulfillment_state)) {
        throw modelProfileRequestError(
          "fulfillment_transition_invalid",
          `Fulfillment state ${fulfillment.state} is not allowed from ${record.fulfillment_state}.`,
          409,
        );
      }
      const reviewBefore = record.review_state;
      const fulfillmentBefore = record.fulfillment_state;
      record.fulfillment = fulfillment;
      record.fulfillment_state = fulfillment.state;
      record.revision += 1;
      appendEvent(record, {
        actorId: { callerId, operatorId: null },
        commandId: fulfillment.fulfillment_id,
        eventType: `fulfillment-${fulfillment.state}`,
        fulfillmentBefore,
        occurredAt: fulfillment.recorded_at,
        reviewBefore,
        summary: fulfillment.state === "applied"
          ? "Platform source update recorded; profile lifecycle remains authoritative in Platform."
          : `Platform fulfillment state ${fulfillment.state} recorded.`,
      });
      bindOperation(record, operationKeys, digest);
      await transaction.put(record);
      audit?.emit({
        actor: callerId,
        event_type: `model.profile.fulfillment.${fulfillment.state}`,
        outcome: record.fulfillment_state,
        request_id: requestId,
      });
      return project(record);
    });
  }

  return {
    create,
    command,
    fulfill,
    async get({ callerId, requestId }) {
      const record = await store.get(requestId);
      assertOwner(record, callerId);
      return project(record);
    },
    async list({ callerId, cursor = null, limit = 50 }) {
      const records = (await store.list())
        .filter((record) => record.owner_caller_id === callerId)
        .filter((record) => !cursor || record.request.request_id > cursor)
        .sort((left, right) => left.request.request_id.localeCompare(right.request.request_id));
      const page = records.slice(0, limit);
      return {
        schema_version: 1,
        requests: page.map(project),
        next_cursor: records.length > limit ? page.at(-1).request.request_id : null,
      };
    },
  };
}
