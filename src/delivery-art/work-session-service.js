import { canonicalDigest } from "./canonical-json.js";
import { normalizeWorkItemId } from "./work-session.js";

const COMMAND_ACTIONS = new Set([
  "start",
  "continue",
  "reconstruct",
  "recover",
  "merge",
  "close",
]);
const COMMAND_ID_PATTERN = /^work-session-command:[A-Za-z0-9._:-]+$/;

export class DeliveryArtWorkSessionServiceError extends Error {
  constructor(code, message, { details = null, statusCode = 400 } = {}) {
    super(message);
    this.name = "DeliveryArtWorkSessionServiceError";
    this.code = code;
    this.details = details;
    this.statusCode = statusCode;
  }

  toResponse() {
    return {
      error: this.code,
      message: this.message,
      details: this.details,
    };
  }
}

function assertMethod(value, name) {
  if (typeof value !== "function") {
    throw new Error(`${name} is required`);
  }
}

function assertPlainObject(value, fieldName) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new DeliveryArtWorkSessionServiceError(
      "delivery_art_work_session_command_invalid",
      `${fieldName} must be an object.`,
    );
  }
}

function normalizeCommand(action, value) {
  assertPlainObject(value, "command");
  const allowed = new Set([
    "command_id",
    "decision",
    "recovery",
    "expected_session_revision",
  ]);
  const unexpected = Object.keys(value).filter((key) => !allowed.has(key));
  if (unexpected.length > 0) {
    throw new DeliveryArtWorkSessionServiceError(
      "delivery_art_work_session_command_invalid",
      `command contains unsupported fields: ${unexpected.join(", ")}.`,
    );
  }
  if (
    typeof value.command_id !== "string" ||
    !COMMAND_ID_PATTERN.test(value.command_id) ||
    value.command_id.length > 200
  ) {
    throw new DeliveryArtWorkSessionServiceError(
      "delivery_art_work_session_command_invalid",
      "command.command_id must use the work-session-command:<id> format.",
    );
  }
  const expectedRevision = value.expected_session_revision ?? null;
  if (
    expectedRevision !== null &&
    (typeof expectedRevision !== "string" || !expectedRevision.trim())
  ) {
    throw new DeliveryArtWorkSessionServiceError(
      "delivery_art_work_session_command_invalid",
      "command.expected_session_revision must be a non-empty string or null.",
    );
  }
  if (action !== "start" && Object.hasOwn(value, "decision")) {
    throw new DeliveryArtWorkSessionServiceError(
      "delivery_art_work_session_command_invalid",
      "command.decision is only valid for start.",
    );
  }
  if (action === "start" && value.decision !== undefined) {
    assertPlainObject(value.decision, "command.decision");
  }
  if (action !== "recover" && Object.hasOwn(value, "recovery")) {
    throw new DeliveryArtWorkSessionServiceError(
      "delivery_art_work_session_command_invalid",
      "command.recovery is only valid for recover.",
    );
  }
  if (action === "recover") {
    if (value.decision !== undefined) {
      throw new DeliveryArtWorkSessionServiceError(
        "delivery_art_work_session_command_invalid",
        "Recovery cannot include a new Landing Unit decision.",
      );
    }
    assertPlainObject(value.recovery, "command.recovery");
    const recovery = value.recovery;
    const unmerged = recovery.mode === "archive-unmerged";
    const expectedFields = unmerged
      ? ["session_id", "session_revision", "reason", "mode", "pull_request", "source"]
      : ["session_id", "session_revision", "reason", "pull_request"];
    if (
      Object.keys(recovery).sort().join() !== expectedFields.sort().join() ||
      !/^work-session:delivery-[1-9][0-9]*:[a-z0-9][a-z0-9._:-]*$/.test(recovery.session_id ?? "") ||
      typeof recovery.session_revision !== "string" ||
      !Number.isFinite(Date.parse(recovery.session_revision)) ||
      typeof recovery.reason !== "string" ||
      recovery.reason.trim().length < 20
    ) {
      throw new DeliveryArtWorkSessionServiceError(
        "delivery_art_work_session_command_invalid",
        "Recovery requires the exact session id, a substantive reason, and a source or PR binding.",
      );
    }
    if (unmerged) {
      assertPlainObject(recovery.source, "command.recovery.source");
      if (
        recovery.pull_request !== null ||
        Object.keys(recovery.source).sort().join() !==
          ["local_branch_head", "worktree_head"].sort().join() ||
        !/^[0-9a-f]{40}$/.test(recovery.source.local_branch_head ?? "") ||
        recovery.source.worktree_head !== recovery.source.local_branch_head
      ) {
        throw new DeliveryArtWorkSessionServiceError(
          "delivery_art_work_session_command_invalid",
          "Unmerged recovery must bind one exact local branch and worktree head, with no PR.",
        );
      }
    } else {
      assertPlainObject(recovery.pull_request, "command.recovery.pull_request");
      if (
        Object.keys(recovery.pull_request).sort().join() !==
          ["url", "head_commit", "merge_commit"].sort().join() ||
        !/^https:\/\//.test(recovery.pull_request.url ?? "") ||
        !/^[0-9a-f]{40}$/.test(recovery.pull_request.head_commit ?? "") ||
        !/^[0-9a-f]{40}$/.test(recovery.pull_request.merge_commit ?? "")
      ) {
        throw new DeliveryArtWorkSessionServiceError(
          "delivery_art_work_session_command_invalid",
          "Recovery PR must bind an HTTPS URL and exact head and merge commits.",
        );
      }
    }
    if (expectedRevision !== recovery.session_revision) {
      throw new DeliveryArtWorkSessionServiceError(
        "delivery_art_work_session_command_invalid",
        "Recovery revision must match the command's expected session revision.",
      );
    }
  }
  return {
    command_id: value.command_id,
    expected_session_revision: expectedRevision,
    ...(value.decision !== undefined
      ? { decision: structuredClone(value.decision) }
      : {}),
    ...(value.recovery !== undefined
      ? { recovery: structuredClone(value.recovery) }
      : {}),
  };
}

function publicNextAction(nextAction) {
  if (!nextAction) return null;
  const { command: _command, ...projection } = nextAction;
  return projection;
}

export function projectDeliveryArtWorkSessionResult(result) {
  return {
    ...structuredClone(result),
    next_action: publicNextAction(result.next_action),
  };
}

function storedError(error) {
  return {
    code: typeof error?.code === "string"
      ? error.code
      : "delivery_art_work_session_command_failed",
    details: error?.details ?? null,
    message: error instanceof Error ? error.message : String(error),
    status_code: Number.isInteger(error?.statusCode) ? error.statusCode : 409,
  };
}

function boundedExecutionError(error) {
  if (error instanceof DeliveryArtWorkSessionServiceError) {
    return error;
  }
  const code = typeof error?.code === "string"
    ? error.code
    : "delivery_art_work_session_dependency_failed";
  const clientError = /(?:decision|invalid|mismatch)$/.test(code);
  const conflict = /(?:blocked|closed|locked|missing|not_ready|required|superseded|not_pristine|not_required|changed)$/.test(code);
  return new DeliveryArtWorkSessionServiceError(
    code,
    error instanceof Error ? error.message : String(error),
    {
      details: error?.details ?? null,
      statusCode: clientError ? 400 : conflict ? 409 : 502,
    },
  );
}

function restoreError(record) {
  return new DeliveryArtWorkSessionServiceError(
    record.error.code,
    record.error.message,
    {
      details: record.error.details,
      statusCode: record.error.status_code,
    },
  );
}

function assertIdentityBinding({ callerId, command, operatorId, session }) {
  const boundCallerId = command.decision?.caller_id ?? session?.caller_id ?? null;
  const boundOperatorId = command.decision?.operator?.id ?? session?.operator?.id ?? null;
  if (boundCallerId && boundCallerId !== callerId) {
    throw new DeliveryArtWorkSessionServiceError(
      "delivery_art_work_session_caller_mismatch",
      "The authenticated caller does not match the work-session caller binding.",
      { statusCode: 403 },
    );
  }
  if (boundOperatorId && boundOperatorId !== operatorId) {
    throw new DeliveryArtWorkSessionServiceError(
      "delivery_art_work_session_operator_mismatch",
      "The accountable operator does not match the work-session operator binding.",
      { statusCode: 403 },
    );
  }
}

function assertRevision({ action, command, recoveryReceipt, session }) {
  const recovered = action === "recover" && recoveryReceipt &&
    session?.session_id !== command.recovery.session_id;
  const currentRevision = recovered
    ? recoveryReceipt.session_revision
    : session?.updated_at ?? null;
  if (action !== "start" && !session && !recovered) {
    throw new DeliveryArtWorkSessionServiceError(
      "delivery_art_work_session_not_started",
      "Start the work session before issuing this command.",
      { statusCode: 409 },
    );
  }
  if (command.expected_session_revision !== currentRevision) {
    throw new DeliveryArtWorkSessionServiceError(
      "delivery_art_work_session_revision_stale",
      "The command was authored against a stale work-session revision.",
      {
        details: {
          current_session_revision: currentRevision,
          expected_session_revision: command.expected_session_revision,
        },
        statusCode: 409,
      },
    );
  }
}

export function createDeliveryArtWorkSessionService({
  clock = () => new Date(),
  controller,
  executor = { available: true, id: "local-engineering-source-executor" },
  lifecycleContext = null,
  store,
} = {}) {
  for (const method of [
    "close",
    "continue",
    "merge",
    "preflight",
    "reconstruct",
    "recover",
    "start",
    "status",
  ]) {
    assertMethod(controller?.[method], `controller.${method}`);
  }
  for (const method of [
    "readByAlias",
    "readRecoveryReceiptBySessionId",
    "readCommandRecord",
    "withLock",
    "writeCommandRecord",
  ]) {
    assertMethod(store?.[method], `store.${method}`);
  }
  if (typeof executor?.id !== "string" || !executor.id.trim()) {
    throw new Error("executor.id is required");
  }
  if (
    lifecycleContext !== null &&
    (typeof lifecycleContext.project !== "function" ||
      typeof lifecycleContext.status !== "function")
  ) {
    throw new Error("lifecycleContext requires project and status methods");
  }

  function withLifecycleContext(result, session) {
    return lifecycleContext && session
      ? { ...result, lifecycle_context: lifecycleContext.status(session) }
      : result;
  }

  async function assertExecutorAvailable() {
    if (executor.available !== true) {
      throw new DeliveryArtWorkSessionServiceError(
        "delivery_art_work_session_executor_unavailable",
        "The admitted Delivery source executor is unavailable.",
        {
          details: { executor_id: executor.id },
          statusCode: 503,
        },
      );
    }
    if (typeof executor.assertAvailable === "function") {
      try {
        await executor.assertAvailable();
      } catch (error) {
        throw new DeliveryArtWorkSessionServiceError(
          "delivery_art_work_session_executor_unavailable",
          "The admitted Delivery source executor is unavailable.",
          {
            details: {
              executor_id: executor.id,
              reason: error?.details?.cause ?? error?.code ?? "health_check_failed",
            },
            statusCode: 503,
          },
        );
      }
    }
  }

  function runWithExecutorContext(context, operation) {
    return typeof executor.run === "function"
      ? executor.run(context, operation)
      : operation();
  }

  async function start(workItemId, options = {}) {
    return controller.start(workItemId, options);
  }

  async function status(workItemId) {
    return controller.status(workItemId);
  }

  async function preflight(workItemId, options = {}) {
    return controller.preflight(workItemId, options);
  }

  async function continueWork(workItemId) {
    return controller.continue(workItemId);
  }

  async function merge(workItemId) {
    return controller.merge(workItemId);
  }

  async function reconstruct(workItemId) {
    return controller.reconstruct(workItemId);
  }

  async function close(workItemId) {
    return controller.close(workItemId);
  }

  async function read({ callerId, operatorId, workItemId: workItemIdInput }) {
    await assertExecutorAvailable();
    operatorId ??= callerId;
    const workItemId = normalizeWorkItemId(workItemIdInput);
    const session = store.readByAlias(workItemId);
    assertIdentityBinding({ callerId, command: {}, operatorId, session });
    return runWithExecutorContext({
      caller_id: callerId,
      command_id: null,
      operator_id: operatorId,
      session_id: session?.session_id ?? null,
      work_item_id: workItemId,
    }, async () => withLifecycleContext(
      projectDeliveryArtWorkSessionResult(await status(workItemId)),
      store.readByAlias(workItemId),
    ));
  }

  async function inspect({ callerId, decision = null, operatorId, workItemId: workItemIdInput }) {
    await assertExecutorAvailable();
    operatorId ??= callerId;
    const workItemId = normalizeWorkItemId(workItemIdInput);
    if (decision !== null) {
      assertPlainObject(decision, "decision");
    }
    const session = store.readByAlias(workItemId);
    assertIdentityBinding({
      callerId,
      command: !session && decision ? { decision } : {},
      operatorId,
      session,
    });
    return runWithExecutorContext({
      caller_id: callerId,
      command_id: null,
      operator_id: operatorId,
      session_id: session?.session_id ?? null,
      work_item_id: workItemId,
    }, async () => withLifecycleContext(
      projectDeliveryArtWorkSessionResult(await preflight(workItemId, {
        callerId,
        ...(decision ? { decision } : {}),
        operatorId,
      })),
      store.readByAlias(workItemId),
    ));
  }

  async function projectContext({
    callerId,
    operatorId,
    request,
    workItemId: workItemIdInput,
  }) {
    await assertExecutorAvailable();
    if (!lifecycleContext) {
      throw new DeliveryArtWorkSessionServiceError(
        "delivery_art_lifecycle_context_unavailable",
        "The Delivery lifecycle context adapter is unavailable.",
        { statusCode: 503 },
      );
    }
    operatorId ??= callerId;
    const workItemId = normalizeWorkItemId(workItemIdInput);
    const session = store.readByAlias(workItemId);
    assertIdentityBinding({ callerId, command: {}, operatorId, session });
    return runWithExecutorContext({
      caller_id: callerId,
      command_id: null,
      operator_id: operatorId,
      session_id: session?.session_id ?? null,
      work_item_id: workItemId,
    }, () => lifecycleContext.project({
      callerId,
      operatorId,
      request,
      workItemId,
    }));
  }

  async function execute({
    action,
    callerId,
    command: input,
    operatorId,
    workItemId: workItemIdInput,
  }) {
    if (!COMMAND_ACTIONS.has(action)) {
      throw new DeliveryArtWorkSessionServiceError(
        "delivery_art_work_session_action_invalid",
        `Unsupported work-session action: ${action}.`,
      );
    }
    await assertExecutorAvailable();
    operatorId ??= callerId;
    const workItemId = normalizeWorkItemId(workItemIdInput);
    const command = normalizeCommand(action, input);
    const requestDigest = canonicalDigest({
      action,
      caller_id: callerId,
      command,
      operator_id: operatorId,
      work_item_id: workItemId,
    });

    try {
      return await store.withLock(`command:${command.command_id}`, async () => {
        const existing = store.readCommandRecord(command.command_id);
        if (existing) {
          if (existing.request_digest !== requestDigest) {
            throw new DeliveryArtWorkSessionServiceError(
              "delivery_art_work_session_command_conflict",
              "The command id is already bound to a different request.",
              { statusCode: 409 },
            );
          }
          if (existing.state === "completed") {
            return {
              ...structuredClone(existing.result),
              command_receipt: structuredClone(existing.receipt),
              replayed: true,
            };
          }
          if (existing.state === "failed") {
            throw restoreError(existing);
          }
          throw new DeliveryArtWorkSessionServiceError(
            "delivery_art_work_session_command_outcome_unknown",
            "The prior command attempt has no terminal receipt and requires operator reconciliation.",
            { statusCode: 409 },
          );
        }

        return store.withLock(`mutation:${workItemId}`, async () => {
          const session = store.readByAlias(workItemId);
          const recoveryReceipt = action === "recover"
            ? store.readRecoveryReceiptBySessionId(command.recovery.session_id)
            : null;
          const recovered = recoveryReceipt &&
            session?.session_id !== command.recovery.session_id;
          const identitySession = recovered
            ? { caller_id: recoveryReceipt.caller_id, operator: { id: recoveryReceipt.operator_id } }
            : session;
          assertIdentityBinding({ callerId, command, operatorId, session: identitySession });
          assertRevision({ action, command, recoveryReceipt, session });
          const startedAt = clock().toISOString();
          const pending = {
            schema_version: 1,
            artifact_type: "delivery_art_work_session_command_record",
            action,
            caller_id: callerId,
            command_id: command.command_id,
            executor_id: executor.id,
            operator_id: operatorId,
            request_digest: requestDigest,
            state: "pending",
            work_item_id: workItemId,
            started_at: startedAt,
          };
          store.writeCommandRecord(command.command_id, pending);

          try {
            const raw = await runWithExecutorContext({
              caller_id: callerId,
              command_id: command.command_id,
              operator_id: operatorId,
              session_id: session?.session_id ?? null,
              work_item_id: workItemId,
            }, async () => action === "start"
              ? start(workItemId, {
                  ...(command.decision ? { decision: command.decision } : {}),
                  callerId,
                  operatorId,
                })
              : action === "continue"
                ? continueWork(workItemId)
                : action === "reconstruct"
                  ? reconstruct(workItemId)
                : action === "recover"
                  ? controller.recover(workItemId, { operatorId, recovery: command.recovery })
                : action === "merge"
                  ? merge(workItemId)
                  : close(workItemId));
            const result = withLifecycleContext(
              projectDeliveryArtWorkSessionResult(raw),
              store.readByAlias(workItemId),
            );
            const completedAt = clock().toISOString();
            const receiptBody = {
              caller_id: callerId,
              command_id: command.command_id,
              completed_at: completedAt,
              executor_id: executor.id,
              operator_id: operatorId,
              request_digest: requestDigest,
              result_state: result.state,
              work_item_id: workItemId,
            };
            const receipt = {
              ...receiptBody,
              digest: canonicalDigest(receiptBody),
              ref: `oos://delivery-art/work-session-command-receipts/${encodeURIComponent(command.command_id)}`,
            };
            store.writeCommandRecord(command.command_id, {
              ...pending,
              completed_at: completedAt,
              receipt,
              result,
              state: "completed",
            });
            return { ...result, command_receipt: receipt, replayed: false };
          } catch (error) {
            const bounded = boundedExecutionError(error);
            store.writeCommandRecord(command.command_id, {
              ...pending,
              completed_at: clock().toISOString(),
              error: storedError(bounded),
              state: "failed",
            });
            throw bounded;
          }
        });
      });
    } catch (error) {
      throw boundedExecutionError(error);
    }
  }

  return {
    close,
    continue: continueWork,
    execute,
    inspect,
    merge,
    preflight,
    projectContext,
    read,
    reconstruct,
    start,
    status,
  };
}
