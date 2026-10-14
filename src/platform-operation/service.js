import { canonicalDigest } from "../delivery-art/canonical-json.js";
import { HttpError } from "../errors.js";
import {
  assertPlatformOperationCatalog,
  assertPlatformOperationProjection,
  normalizePlatformOperationCommand,
  normalizePlatformOperationControl,
} from "./contracts.js";
import { PlatformOperationStoreError } from "./store.js";

const TERMINAL_STATES = new Set(["succeeded", "failed", "cancelled"]);

export function createPlatformOperationService({
  audit,
  clock = () => new Date(),
  operatorBindings,
  providerClient,
  securityDecision,
  store,
}) {
  async function catalog({ callerId }) {
    assertCaller(operatorBindings, callerId);
    return assertPlatformOperationCatalog(await providerClient.getCatalog());
  }

  async function submit({ callerId, input }) {
    let command = null;
    try {
      command = normalizePlatformOperationCommand(input);
      assertOperator(operatorBindings, callerId, command.actor_ref);
      const operationId = operationIdFor(command);
      return await store.transactCommand(command, operationId, async ({ current, put }) => {
        if (current) {
          emitAudit(audit, current, callerId, "submit-replayed");
          return publicProjection(current, { replayed: true });
        }
        const ownerCatalog = await providerClient.getCatalog();
        assertCommandAdmission(command, ownerCatalog);
        const now = clock().toISOString();
        let record = {
          schema_version: 1,
          workflow_id: "platform-operation",
          operation_id: operationId,
          command,
          state: "requested",
          provider_operation: requestedProjection(command, now),
          security_decision: structuredClone(securityDecision),
          controls: [],
          created_at: now,
          updated_at: now,
        };
        put(record);
        try {
          const providerOperation = await providerClient.submit(command);
          record = updateFromProvider(record, providerOperation, clock);
        } catch (error) {
          record = blockedForProvider(record, error, clock);
        }
        put(record);
        emitAudit(audit, record, callerId, "submitted");
        return publicProjection(record);
      });
    } catch (error) {
      emitAuditDenial(audit, {
        action: "submit",
        callerId,
        command,
        error,
        input,
      });
      throwStoreFailure(error);
    }
  }

  async function get({ callerId, operationId }) {
    assertCaller(operatorBindings, callerId);
    try {
      return await store.transactOperation(operationId, async ({ current, put }) => {
        if (!current) notFound();
        if (TERMINAL_STATES.has(current.state)) {
          return publicProjection(current, { replayed: true });
        }
        try {
          const providerOperation = await providerClient.readByCommand(current.command);
          const record = updateFromProvider(current, providerOperation, clock);
          put(record);
          emitAudit(audit, record, callerId, "reconciled");
          return publicProjection(record, { reconciled: true });
        } catch (error) {
          const record = blockedForProvider(current, error, clock);
          put(record);
          emitAudit(audit, record, callerId, "reconciliation-blocked");
          return publicProjection(record, { reconciled: false });
        }
      });
    } catch (error) {
      throwStoreFailure(error);
    }
  }

  async function list({ callerId, limit = 100 }) {
    assertCaller(operatorBindings, callerId);
    const bounded = Number.isSafeInteger(limit) && limit > 0 && limit <= 200 ? limit : 100;
    try {
      return {
        workflow_id: "platform-operation-list",
        operations: store.list({ limit: bounded }).map((record) => publicProjection(record)),
      };
    } catch (error) {
      throwStoreFailure(error);
    }
  }

  async function control({ callerId, operationId, input }) {
    let controlRequest = null;
    try {
      controlRequest = normalizePlatformOperationControl(input);
      assertOperator(operatorBindings, callerId, controlRequest.operator_id);
      return await store.transactOperation(operationId, async ({ current, put }) => {
        if (!current) notFound();
        const existing = current.controls.find(
          (entry) => entry.idempotency_key === controlRequest.idempotency_key,
        );
        if (existing) {
          if (existing.request_digest !== canonicalDigest(controlRequest)) {
            throw new HttpError(
              409,
              "platform_operation_control_idempotency_conflict",
              "Control idempotency key is already bound to a different request.",
            );
          }
          if (existing.status === "confirmed") {
            emitAudit(audit, current, callerId, `control-${controlRequest.action}-replayed`);
            return publicProjection(current, { replayed: true });
          }
        } else {
          assertControlAvailable(current, controlRequest);
        }
        const providerOperationId = current.provider_operation?.operation_id;
        if (!providerOperationId) {
          throw new HttpError(
            409,
            "platform_operation_provider_identity_missing",
            "The operation has no verified Platform identity; reconcile it before control.",
          );
        }
        const pendingControl = {
          control_id: controlRequest.control_id,
          idempotency_key: controlRequest.idempotency_key,
          request_digest: canonicalDigest(controlRequest),
          action: controlRequest.action,
          requested_at: controlRequest.requested_at,
          status: "dispatching",
        };
        let record = {
          ...current,
          controls: existing
            ? current.controls.map((entry) => entry.idempotency_key === controlRequest.idempotency_key
              ? pendingControl
              : entry)
            : [...current.controls, pendingControl],
          updated_at: clock().toISOString(),
        };
        put(record);
        try {
          const providerOperation = await providerClient.control(
            current.command,
            providerOperationId,
            controlRequest,
          );
          record = updateFromProvider(record, providerOperation, clock);
          record = updateControlStatus(record, controlRequest.idempotency_key, "confirmed", clock);
        } catch (error) {
          record = blockedForProvider(record, error, clock);
          record = updateControlStatus(record, controlRequest.idempotency_key, "unknown", clock);
        }
        put(record);
        emitAudit(audit, record, callerId, `control-${controlRequest.action}`);
        return publicProjection(record);
      });
    } catch (error) {
      emitAuditDenial(audit, {
        action: "control",
        callerId,
        control: controlRequest,
        error,
        input,
        operationId,
      });
      throwStoreFailure(error);
    }
  }

  return { catalog, control, get, list, submit };
}

function updateControlStatus(record, idempotencyKey, status, clock) {
  return {
    ...record,
    controls: record.controls.map((entry) => entry.idempotency_key === idempotencyKey
      ? { ...entry, status }
      : entry),
    updated_at: clock().toISOString(),
  };
}

function assertCommandAdmission(command, value) {
  const catalog = assertPlatformOperationCatalog(value);
  if (catalog.freshness !== "current") {
    throw new HttpError(
      409,
      "platform_operation_catalog_not_current",
      "Platform capability truth is not current; command execution is denied.",
    );
  }
  const subject = catalog.subjects.find(
    (entry) => entry.kind === command.subject.kind && entry.ref === command.subject.ref,
  );
  if (!subject) {
    throw new HttpError(
      404,
      "platform_operation_subject_not_found",
      "The command subject is not present in current Platform capability truth.",
    );
  }
  if (subject.source_version !== command.subject.expected_source_version) {
    throw new HttpError(
      409,
      "platform_operation_source_stale",
      "The command expected source version is stale.",
    );
  }
  const capability = subject.capabilities.find(
    (entry) =>
      entry.capability_id === command.capability_id &&
      entry.action === command.action,
  );
  if (!capability) {
    throw new HttpError(
      403,
      "platform_operation_capability_forbidden",
      "The command is outside the finite Platform capability set.",
    );
  }
  if (!capability.available) {
    throw new HttpError(
      409,
      "platform_operation_capability_unavailable",
      capability.unavailable_reason ?? "The Platform capability is currently unavailable.",
    );
  }
  if (capability.approval_required !== true) {
    throw new HttpError(
      409,
      "platform_operation_approval_contract_invalid",
      "Executable Platform capabilities must require exact operator approval.",
    );
  }
}

function assertControlAvailable(record, control) {
  const projection = record.provider_operation;
  const available = control.action === "retry"
    ? projection?.retryable === true
    : projection?.cancel_available === true;
  if (!available) {
    throw new HttpError(
      409,
      "platform_operation_control_unavailable",
      `The ${control.action} control is unavailable in the current operation state.`,
    );
  }
}

function updateFromProvider(record, value, clock) {
  const providerOperation = assertPlatformOperationProjection(value, record.command);
  return {
    ...record,
    state: providerOperation.state,
    provider_operation: providerOperation,
    updated_at: clock().toISOString(),
  };
}

function blockedForProvider(record, error, clock) {
  const now = clock().toISOString();
  const code = error?.code ?? "platform_operation_provider_unavailable";
  const detail = error?.message ?? "Platform operation owner readback is unavailable.";
  const prior = record.provider_operation;
  return {
    ...record,
    state: "blocked",
    provider_operation: {
      schema_version: 1,
      operation_id: prior?.operation_id ?? `platform-owner:unresolved:${record.command.command_id}`,
      command_id: record.command.command_id,
      correlation_id: record.command.correlation_id,
      state: "blocked",
      attempt: prior?.attempt ?? 1,
      subject_ref: record.command.subject.ref,
      capability_id: record.command.capability_id,
      action: record.command.action,
      retryable: false,
      cancel_available: false,
      blocker: {
        code,
        owner: "platform-engineering",
        reason: detail,
        supported_dispositions: ["remove", "defer"],
        next_action: "reconcile-owner-readback",
      },
      failure: null,
      receipt: null,
      safe_log_ref: prior?.safe_log_ref ?? null,
      updated_at: now,
      events: [
        ...(prior?.events ?? []),
        {
          event_id: `event:${record.command.command_id}:${(prior?.events?.length ?? 0) + 1}`,
          sequence: (prior?.events?.length ?? 0) + 1,
          state: "blocked",
          occurred_at: now,
          summary: "Platform owner readback is required before this operation can advance.",
        },
      ],
    },
    updated_at: now,
  };
}

function requestedProjection(command, now) {
  return {
    schema_version: 1,
    operation_id: `platform-owner:pending:${command.command_id}`,
    command_id: command.command_id,
    correlation_id: command.correlation_id,
    state: "requested",
    attempt: 1,
    subject_ref: command.subject.ref,
    capability_id: command.capability_id,
    action: command.action,
    retryable: false,
    cancel_available: false,
    blocker: null,
    failure: null,
    receipt: null,
    safe_log_ref: null,
    updated_at: now,
    events: [{
      event_id: `event:${command.command_id}:1`,
      sequence: 1,
      state: "requested",
      occurred_at: now,
      summary: "OOS accepted the exact operator command for Platform owner dispatch.",
    }],
  };
}

function publicProjection(record, { reconciled = false, replayed = false } = {}) {
  const provider = assertPlatformOperationProjection(record.provider_operation, record.command);
  return {
    schema_version: 1,
    workflow_id: "platform-operation",
    operation_id: record.operation_id,
    command: structuredClone(record.command),
    state: record.state,
    provider_operation: structuredClone(provider),
    security_decision: structuredClone(record.security_decision),
    controls: structuredClone(record.controls),
    next_action: nextAction(provider),
    created_at: record.created_at,
    updated_at: record.updated_at,
    reconciled,
    replayed,
  };
}

function nextAction(operation) {
  if (operation.state === "succeeded") {
    return { code: "complete", authority: "operator", reason: "Platform receipt and owner readback are terminal." };
  }
  if (operation.state === "cancelled") {
    return { code: "inspect-cancelled-receipt", authority: "operator", reason: "Inspect retained effects recorded by the cancellation receipt." };
  }
  if (operation.state === "failed") {
    return operation.retryable
      ? { code: "retry", authority: "operator", reason: operation.failure?.detail ?? "The failed operation is retryable." }
      : { code: "request-correction", authority: operation.failure?.owner ?? "platform-engineering", reason: operation.failure?.detail ?? "The operation requires correction." };
  }
  if (operation.state === "blocked") {
    return {
      code: operation.blocker?.next_action ?? "resolve-blocker",
      authority: operation.blocker?.owner ?? "platform-engineering",
      reason: operation.blocker?.reason ?? "The Platform owner must resolve the blocker.",
    };
  }
  return operation.cancel_available
    ? { code: "wait-or-cancel", authority: "operator", reason: "The owner operation is in progress and may be cancelled through its bounded control." }
    : { code: "wait", authority: "platform-engineering", reason: "Wait for current Platform owner readback." };
}

function operationIdFor(command) {
  return `platform-operation:${canonicalDigest({ command_id: command.command_id }).slice(7, 31)}`;
}

function assertCaller(bindings, callerId) {
  if (!bindings?.[callerId]) {
    throw new HttpError(
      403,
      "platform_operation_caller_forbidden",
      "The authenticated caller is not admitted to the Platform operation surface.",
    );
  }
}

function assertOperator(bindings, callerId, operatorId) {
  assertCaller(bindings, callerId);
  if (bindings[callerId] !== operatorId) {
    throw new HttpError(
      403,
      "platform_operation_operator_forbidden",
      "The authenticated caller is not bound to the supplied operator identity.",
    );
  }
}

function notFound() {
  throw new HttpError(
    404,
    "platform_operation_not_found",
    "Platform operation was not found.",
  );
}

function throwStoreFailure(error) {
  if (!(error instanceof PlatformOperationStoreError)) throw error;
  throw new HttpError(
    error.code === "platform_operation_idempotency_conflict" ? 409 : 503,
    error.code,
    error.message,
  );
}

function emitAudit(audit, record, callerId, action) {
  audit?.emit?.({
    actor: record.command.actor_ref,
    caller_id: callerId,
    event_type: `platform.operation.${action}`,
    outcome: record.state,
    operation_id: record.operation_id,
    command_id: record.command.command_id,
    correlation_id: record.command.correlation_id,
    receipt_ref: record.provider_operation?.receipt?.receipt_ref ?? null,
  });
}

function emitAuditDenial(audit, {
  action,
  callerId,
  command = null,
  control = null,
  error,
  input,
  operationId = null,
}) {
  audit?.emit?.({
    actor: command?.actor_ref ?? control?.operator_id ?? null,
    caller_id: callerId ?? null,
    event_type: `platform.operation.${action}.denied`,
    outcome: "denied",
    operation_id: operationId,
    command_id: command?.command_id ?? safeIdentifier(input?.command_id),
    control_id: control?.control_id ?? safeIdentifier(input?.control_id),
    correlation_id: command?.correlation_id ?? safeIdentifier(input?.correlation_id),
    error_code: safeIdentifier(error?.code) ?? "platform_operation_denied",
  });
}

function safeIdentifier(value) {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,255}$/.test(value)
    ? value
    : null;
}
