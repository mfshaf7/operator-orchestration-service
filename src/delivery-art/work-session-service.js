import { canonicalDigest } from "./canonical-json.js";
import { normalizeWorkItemId } from "./work-session.js";
import { readClosedWorkReview } from "./review-packet-completion.js";

const COMMAND_ACTIONS = new Set([
  "start",
  "continue",
  "reconstruct",
  "recover",
  "merge",
  "close",
]);
const COMMAND_ID_PATTERN = /^work-session-command:[A-Za-z0-9._:-]+$/;
const SOURCE_INTENT_PATTERN = /^source-intent:[A-Za-z0-9][A-Za-z0-9._:/@+\-]{0,241}$/;
const SOURCE_AUTHORIZATION_FILE = "artifacts/source-intent.json";

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
    "source_intent_ref",
    "reviewed_verification_digest",
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
  if (Object.hasOwn(value, "source_intent_ref") &&
      (typeof value.source_intent_ref !== "string" || !SOURCE_INTENT_PATTERN.test(value.source_intent_ref))) {
    throw new DeliveryArtWorkSessionServiceError("delivery_art_source_intent_invalid", "source_intent_ref must identify an immutable canonical source preparation.");
  }
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
  if (value.reviewed_verification_digest !== undefined &&
      (action !== "continue" || value.source_intent_ref !== undefined ||
        typeof value.reviewed_verification_digest !== "string" ||
        !/^sha256:[a-f0-9]{64}$/.test(value.reviewed_verification_digest))) {
    throw new DeliveryArtWorkSessionServiceError("delivery_art_work_session_command_invalid",
      "Reviewed verification requires an exact binding on a verification-only continue request.");
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
    const evidenceBearing = recovery.mode === "archive-merged-evidence";
    const expectedFields = unmerged
      ? ["session_id", "session_revision", "reason", "mode", "pull_request", "source"]
      : evidenceBearing
        ? ["session_id", "session_revision", "reason", "mode", "pull_request"]
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
    ...(value.source_intent_ref !== undefined ? { source_intent_ref: value.source_intent_ref } : {}),
    ...(value.reviewed_verification_digest !== undefined ? { reviewed_verification_digest: value.reviewed_verification_digest } : {}),
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

function storedErrorValue(value) {
  if (Array.isArray(value)) {
    return value.map(storedErrorValue);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, storedErrorValue(entry)]),
    );
  }
  if (
    typeof value === "string" &&
    (value.startsWith("/") || /^[A-Za-z]:[\\/]/.test(value))
  ) {
    return "<redacted:absolute-path>";
  }
  return value;
}

function storedError(error) {
  return {
    code: typeof error?.code === "string"
      ? error.code
      : "delivery_art_work_session_command_failed",
    details: storedErrorValue(error?.details ?? null),
    message: storedErrorValue(error instanceof Error ? error.message : String(error)),
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
  const conflict = /(?:blocked|closed|locked|missing|not_ready|required|superseded|not_pristine|not_required|changed|revision_stale)$/.test(code);
  return new DeliveryArtWorkSessionServiceError(
    code,
    error instanceof Error ? error.message : String(error),
    {
      details: error?.details ?? null,
      statusCode: Number.isInteger(error?.statusCode) && error.statusCode >= 400 && error.statusCode <= 599
        ? error.statusCode : clientError ? 400 : conflict ? 409 : 502,
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
  resolveArtifact = null,
  sourceRealization = null,
  sourceCredentials = null,
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
  if (
    sourceRealization !== null &&
    ["cancel", "continue", "read", "recover", "start"].some(
      (method) => typeof sourceRealization?.[method] !== "function",
    )
  ) {
    throw new Error("sourceRealization requires start, continue, cancel, recover, and read methods");
  }
  if (sourceCredentials && ["ensureSourceCredential", "withSourceLease", "stopSourceCredential"].some(method => typeof sourceCredentials[method] !== "function")) {
    throw new Error("Source authorization requires the existing Platform-operation ensure, lease, and stop methods.");
  }

  function sourceReference(session, explicit = null, allowSuccessor = false) {
    const binding = session ? store.readArtifact(session, SOURCE_AUTHORIZATION_FILE) : null;
    if (binding && (binding.schema_version !== 1 || binding.artifact_type !== "delivery-art-source-intent-binding" ||
        binding.session_id !== session.session_id || !SOURCE_INTENT_PATTERN.test(binding.source_intent_ref ?? ""))) {
      throw new DeliveryArtWorkSessionServiceError("delivery_art_source_intent_binding_invalid", "The retained source authorization binding is invalid.", { statusCode: 503 });
    }
    if (binding && explicit && binding.source_intent_ref !== explicit) {
      if (allowSuccessor) return explicit;
      throw new DeliveryArtWorkSessionServiceError("delivery_art_source_intent_mismatch", "An active session cannot silently replace its source authorization.", { statusCode: 409 });
    }
    return binding?.source_intent_ref ?? explicit;
  }

  function previousSourceReference(session) {
    const predecessor = store.readPredecessor?.(session);
    if (!predecessor) return null;
    const ref = store.readRebuildCommand?.(predecessor)?.replacement_source_intent_ref ?? sourceReference(predecessor);
    if (ref && !SOURCE_INTENT_PATTERN.test(ref)) {
      throw new DeliveryArtWorkSessionServiceError("delivery_art_source_intent_binding_invalid", "The retained rebuild source authorization is invalid.", { statusCode: 503 });
    }
    return ref;
  }

  function withSourceReference(result, session) {
    const reference = session ? sourceReference(session) : null;
    const binding = reference ? store.readArtifact(session, SOURCE_AUTHORIZATION_FILE) : null;
    const previousReference = result.source_access_scope && session ? previousSourceReference(session) : null;
    return {
      ...result,
      ...(reference ? { source_authorization: { intent_ref: reference, session_id: session.session_id,
        revision: binding.updated_at ?? session.updated_at } } : {}),
      ...(previousReference ? { source_access_scope: { ...result.source_access_scope, predecessor_intent_ref: previousReference } } : {}),
    };
  }

  function retainSourceReference(session, reference) {
    const previous = store.readArtifact(session, SOURCE_AUTHORIZATION_FILE);
    if (previous?.source_intent_ref === reference && previous.updated_at) return;
    const floor = Math.max(Date.parse(session.updated_at) || 0, Date.parse(previous?.updated_at) || 0);
    store.writeArtifact(session, SOURCE_AUTHORIZATION_FILE, { schema_version: 1,
      artifact_type: "delivery-art-source-intent-binding", session_id: session.session_id, source_intent_ref: reference,
      updated_at: new Date(Math.max(clock().getTime(), floor + 1)).toISOString() });
  }

  async function withClosedSourceAccess(result, callerId, operatorId) {
    const closedSessionId = result.state === "closed" ? result.cleanup_receipt?.session_id : null;
    if (!closedSessionId || result.cleanup_receipt.closed_by !== operatorId ||
        typeof sourceCredentials?.readSourcePreparation !== "function") return result;
    const reference = sourceReference({ session_id: closedSessionId });
    if (!reference) return result;

    const observed = await sourceCredentials.readSourcePreparation({ callerId, intentId: reference }).catch(() => null);
    const preparation = observed?.intent_id === reference && observed.session_id === closedSessionId ? observed : null;
    const operationRef = preparation?.operation_refs.revoke ?? null;
    const closed = preparation?.authorization.state === "revoked";
    const state = closed ? "revoked" : operationRef ? "revocation-pending" : "revocation-required";
    return {
      ...result,
      source_authorization: { intent_ref: reference, session_id: closedSessionId, state, operation_ref: operationRef },
      ...(!closed ? { next_action: {
        code: operationRef ? "source-revocation-pending" : "source-revocation-required",
        authority: "platform-engineering",
        reason: "Check the recorded repository access closure for this completed session.",
      } } : {}),
    };
  }

  async function withClosedReview(result) {
    if (result.state !== "closed" || !result.cleanup_receipt) return result;
    const receipt = result.cleanup_receipt;
    const { review, unavailable } = await readClosedWorkReview({
      receipt,
      deliveryId: result.delivery_id ?? receipt.delivery_id,
      workItemId: result.work_item_id,
      resolveArtifact,
    }).catch(() => ({ review: null, unavailable: true }));
    return {
      ...result,
      delivery_id: result.delivery_id ?? receipt.delivery_id,
      ...(review ? { closed_review: review } : {}),
      ...(unavailable ? { closed_review_unavailable: true } : {}),
    };
  }

  async function authorizedSourceEffect({ callerId, operatorId, workItemId, session, command = {}, requestedStartDigest = null, operation }) {
    if (!sourceCredentials) return operation();
    const sourceWorkItemId = session ? controller.sourceAccessWorkItemId?.(session) ?? session.work_item_id ?? session.covered_work_item_ids?.[0] ?? workItemId : workItemId;
    const previous = session ? sourceReference(session) : null;
    const reference = sourceReference(session, command.source_intent_ref ?? null, true);
    if (!reference) {
      throw new DeliveryArtWorkSessionServiceError("delivery_art_source_intent_required", "Prepare and explicitly authorize source access through Platform operations before this source command.", {
        statusCode: 409, details: { subject: { kind: "delivery", work_item_ref: sourceWorkItemId }, preparation_path: "/v1/platform-operations/source-preparations" },
      });
    }
    const scope = { callerId, operatorId, intentId: reference, sessionId: session?.session_id ?? null,
      workItemId: sourceWorkItemId, requestedStartDigest,
      previousIntentId: previous && previous !== reference ? previous : null };
    // Pending owner credentials must not poison the source command journal.
    await sourceCredentials.ensureSourceCredential(scope);
    return sourceCredentials.withSourceLease({ ...scope, operation: async (assertLease) => {
      const execute = async () => {
        if (session) retainSourceReference(session, reference);
        const result = await operation(reference);
        const actual = store.readByAlias(workItemId);
        if (actual && (!session || actual.session_id === session.session_id)) {
          retainSourceReference(actual, reference);
          return withSourceReference(result, actual);
        }
        return result;
      };
      return typeof executor.withSourceLeaseGuard === "function" ? executor.withSourceLeaseGuard(assertLease, execute) : execute();
    } });
  }

  async function withAuthorizedProjectSource({
    callerId, operatorId, workItemId: target, commandId, source,
  }, operation) {
    await assertExecutorAvailable();
    if (!sourceCredentials || typeof executor.withSourceLeaseGuard !== "function") {
      throw new DeliveryArtWorkSessionServiceError("project_source_authority_unavailable",
        "Project runtime source requires the commissioned owner and scoped source lease.", { statusCode: 503 });
    }
    const workItemId = normalizeWorkItemId(target);
    const session = store.readByAlias(workItemId);
    if (!session || !session.covered_work_item_ids.includes(workItemId) ||
        session.session_id !== source?.session_id || session.landing_unit.base_commit !== source.base_commit) {
      throw new DeliveryArtWorkSessionServiceError("project_source_session_changed",
        "The saved project does not match the current authorized source session.", { statusCode: 409 });
    }
    assertIdentityBinding({ callerId, operatorId, command: {}, session });
    return runWithExecutorContext({
      caller_id: callerId, operator_id: operatorId, command_id: commandId,
      session_id: session.session_id, work_item_id: workItemId,
    }, async () => {
      let captured;
      await authorizedSourceEffect({
        callerId, operatorId, workItemId, session,
        async operation() {
          captured = await operation(session);
          return {};
        },
      });
      return captured;
    });
  }

  function captureProjectRuntimeSource({ callerId, operatorId, workItemId, selection }) {
    if (typeof sourceRealization?.captureProjectRuntimeSource !== "function") {
      throw new DeliveryArtWorkSessionServiceError("project_source_unavailable",
        "The source owner does not have project snapshot capture.", { statusCode: 503 });
    }
    return withAuthorizedProjectSource({ callerId, operatorId, workItemId,
      commandId: selection.command_id, source: selection.source },
      session => sourceRealization.captureProjectRuntimeSource(session, selection));
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

  async function continueWork(workItemId, onPublished) {
    return controller.continue(workItemId, onPublished);
  }

  async function merge(workItemId) {
    return controller.merge(workItemId);
  }

  async function reconstruct(workItemId, options) {
    return controller.reconstruct(workItemId, options);
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
    const result = await runWithExecutorContext({
      caller_id: callerId,
      command_id: null,
      operator_id: operatorId,
      session_id: session?.session_id ?? null,
      work_item_id: workItemId,
    }, async () => withSourceReference(withLifecycleContext(
      projectDeliveryArtWorkSessionResult(await status(workItemId)),
      store.readByAlias(workItemId),
    ), store.readByAlias(workItemId)));
    const pending = store.readPendingRebuild?.(store.readByAlias(workItemId));
    if (pending?.caller_id !== callerId || pending?.operator_id !== operatorId || pending?.work_item_id !== workItemId) {
      return withClosedReview(await withClosedSourceAccess(result, callerId, operatorId));
    }
    return { ...result, pending_rebuild: {
      command_id: pending.command_id, expected_session_revision: pending.replacement_expected_revision,
    } };
  }

  function readCommand({ callerId, commandId, operatorId, workItemId: workItemIdInput }) {
    const workItemId = normalizeWorkItemId(workItemIdInput);
    if (typeof commandId !== "string" || commandId.length > 200 || !COMMAND_ID_PATTERN.test(commandId)) {
      throw new DeliveryArtWorkSessionServiceError(
        "delivery_art_work_session_command_invalid", "A valid work-session command id is required.",
      );
    }
    const record = store.readCommandRecord(commandId);
    if (record?.caller_id !== callerId || record?.operator_id !== (operatorId ?? callerId) ||
        record?.work_item_id !== workItemId || record?.command_id !== commandId) {
      return { command_id: commandId, state: "unconfirmed" };
    }
    if (record.state === "completed") {
      return {
        command_id: commandId,
        state: "completed",
        result: { ...structuredClone(record.result), command_receipt: structuredClone(record.receipt), replayed: false },
      };
    }
    if (record.state === "failed") {
      return {
        command_id: commandId,
        state: "failed",
        error: { code: record.error.code, message: record.error.message, status_code: record.error.status_code },
      };
    }
    return {
      command_id: commandId,
      state: "pending",
      ...(record.publication ? { publication: record.publication } : {}),
      ...(record.action === "reconstruct" && record.replacement_session_id && record.replacement_expected_revision
        ? { rebuild_revision: record.replacement_expected_revision } : {}),
    };
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

  async function sourceCredentialPlan({ callerId, operatorId, subject, decision = null, record = null }) {
    await assertExecutorAvailable();
    const workItemId = normalizeWorkItemId(subject.work_item_ref);
    const session = store.readByAlias(workItemId);
    const approvedDecision = record?.proof?.decision ?? decision;
    assertIdentityBinding({ callerId, operatorId, command: { decision: approvedDecision }, session });
    const method = record ? "verifySourceCredential" : "prepareSourceCredential";
    if (typeof controller[method] !== "function") {
      throw new DeliveryArtWorkSessionServiceError("delivery_art_source_credential_authority_unavailable", "Canonical source-intent preparation is unavailable.", { statusCode: 503 });
    }
    const plan = await runWithExecutorContext({
      caller_id: callerId, operator_id: operatorId, command_id: null,
      session_id: session?.session_id ?? null, work_item_id: workItemId,
    }, () => controller[method](workItemId, { callerId, operatorId, decision: approvedDecision, record }));
    if (record || !session) return plan;
    const predecessor = sourceReference(session) ?? previousSourceReference(session);
    return predecessor ? { ...plan, predecessor_intent_ref: predecessor } : plan;
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

  async function readRealization({ callerId, operatorId, workItemId: workItemIdInput }) {
    await assertExecutorAvailable();
    if (!sourceRealization) {
      throw new DeliveryArtWorkSessionServiceError(
        "delivery_art_source_realization_unavailable",
        "The Delivery source-realization adapter is unavailable.",
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
    }, () => sourceRealization.read({ callerId, operatorId, workItemId }));
  }

  async function executeRealization({
    action,
    callerId,
    operatorId,
    request,
    signal = null,
    sourceIntentRef = null,
    workItemId: workItemIdInput,
  }) {
    await assertExecutorAvailable();
    if (sourceIntentRef !== null && (typeof sourceIntentRef !== "string" || !SOURCE_INTENT_PATTERN.test(sourceIntentRef))) {
      throw new DeliveryArtWorkSessionServiceError("delivery_art_source_intent_invalid", "Source realization requires an exact source-intent reference.", { statusCode: 400 });
    }
    if (!sourceRealization || !["start", "continue", "cancel", "recover", "saveDraft", "assist"].includes(action)) {
      throw new DeliveryArtWorkSessionServiceError(
        "delivery_art_source_realization_unavailable",
        "The requested Delivery source-realization action is unavailable.",
        { statusCode: 503 },
      );
    }
    operatorId ??= callerId;
    const workItemId = normalizeWorkItemId(workItemIdInput);
    const session = store.readByAlias(workItemId);
    assertIdentityBinding({ callerId, command: {}, operatorId, session });
    if (sourceCredentials && typeof sourceRealization.readCompletedCommand === "function") {
      const replay = await sourceRealization.readCompletedCommand({ action, callerId, operatorId, request, workItemId });
      if (replay) return replay;
    }
    return runWithExecutorContext({
      caller_id: callerId,
      command_id: request?.command_id ?? request?.request_id ?? null,
      operator_id: operatorId,
      session_id: session?.session_id ?? null,
      work_item_id: workItemId,
    }, () => ["continue", "recover"].includes(action) ? authorizedSourceEffect({
      callerId, operatorId, workItemId, session,
      command: { source_intent_ref: sourceIntentRef },
      operation: () => sourceRealization[action]({ callerId, operatorId, request, signal, workItemId }),
    }) : sourceRealization[action]({
      callerId,
      operatorId,
      request,
      signal,
      workItemId,
    }));
  }

  async function readRealizationSource({ callerId, operatorId, workItemId: input, kind, requestedPaths = [], retained = false, startLine }) {
    await assertExecutorAvailable();
    if (!sourceRealization || !["files", "draft"].includes(kind) || !Array.isArray(requestedPaths) ||
        requestedPaths.length > 48 || new Set(requestedPaths).size !== requestedPaths.length ||
        requestedPaths.some(value => typeof value !== "string" || value.length > 240) ||
        startLine !== undefined && (kind !== "files" || requestedPaths.length !== 1 || !Number.isSafeInteger(startLine) || startLine < 1 || startLine > 262144)) {
      throw new DeliveryArtWorkSessionServiceError("delivery_art_source_realization_request_invalid", "Use the current source draft or bounded source-file selectors.");
    }
    operatorId ??= callerId;
    const workItemId = normalizeWorkItemId(input), session = store.readByAlias(workItemId);
    assertIdentityBinding({ callerId, command: {}, operatorId, session });
    return runWithExecutorContext({ caller_id: callerId, command_id: null, operator_id: operatorId,
      session_id: session?.session_id ?? null, work_item_id: workItemId },
    () => sourceRealization[kind]({ callerId, operatorId, workItemId, requestedPaths, retained, startLine }));
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
        const resumeReplacement = action === "reconstruct" && existing?.state === "pending" && existing.replacement_session_id;
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
          if (!resumeReplacement) throw new DeliveryArtWorkSessionServiceError(
            "delivery_art_work_session_command_outcome_unknown",
            "The prior command attempt has no terminal receipt and requires operator reconciliation.",
            { statusCode: 409 },
          );
        }

        return store.withLock(`mutation:${workItemId}`, async () => {
          const session = store.readByAlias(workItemId);
          const replacement = resumeReplacement ? store.readReplacement(resumeReplacement) : null;
          const switched = replacement?.state === "activated" &&
            replacement.replacement.session_id === session?.session_id &&
            replacement.previous.updated_at === command.expected_session_revision;
          const recoveryReceipt = action === "recover"
            ? store.readRecoveryReceiptBySessionId(command.recovery.session_id)
            : null;
          const recovered = recoveryReceipt &&
            session?.session_id !== command.recovery.session_id;
          const identitySession = recovered
            ? { caller_id: recoveryReceipt.caller_id, operator: { id: recoveryReceipt.operator_id } }
            : session;
          assertIdentityBinding({ callerId, command, operatorId, session: identitySession });
          assertRevision({ action, command, recoveryReceipt, session: switched ? replacement.previous : session });
          if (resumeReplacement && !switched && session?.session_id !== resumeReplacement) {
            throw new DeliveryArtWorkSessionServiceError("delivery_art_work_session_revision_stale", "The original rebuild no longer matches the current work session.", { statusCode: 409 });
          }
          const predecessor = switched ? replacement.previous : session;
          const inProgress = store.readPendingRebuild?.(session);
          if (inProgress && inProgress.command_id !== command.command_id) {
            throw new DeliveryArtWorkSessionServiceError("delivery_art_work_session_rebuild_pending", "Resume the saved rebuild from its original work item before issuing another work-session command.", { statusCode: 409 });
          }
          const terminalSourceReference = resumeReplacement ? existing.replacement_source_intent_ref ?? null
            : sourceCredentials && session && ["close", "recover", "reconstruct"].includes(action)
              ? sourceReference(session, command.source_intent_ref ?? null) : null;
          const executorContext = {
            caller_id: callerId,
            command_id: command.command_id,
            operator_id: operatorId,
            session_id: session?.session_id ?? null,
            work_item_id: workItemId,
          };
          const executeCommand = async (sourceIntentRef = null, operation = null) => {
            const startedAt = resumeReplacement ? existing.started_at : clock().toISOString();
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
              ...(action === "reconstruct" ? {
                replacement_session_id: predecessor.session_id,
                replacement_expected_revision: command.expected_session_revision,
                replacement_source_intent_ref: terminalSourceReference,
              } : {}),
            };
            if (action === "reconstruct") {
              await store.withLock(`rebuild-acceptance:${predecessor.session_id}`, () => {
                const original = store.readPendingRebuild(predecessor);
                if (original && original.command_id !== command.command_id) {
                  throw new DeliveryArtWorkSessionServiceError("delivery_art_work_session_rebuild_pending", "Resume the original accepted rebuild.", { statusCode: 409 });
                }
                store.writeRebuildCommandRef(predecessor, command.command_id);
                store.writeCommandRecord(command.command_id, pending);
              });
            } else {
              store.writeCommandRecord(command.command_id, pending);
            }

            try {
              const recordPublication = ({ url, head_commit }) => {
                if (/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/pull\/[1-9][0-9]*$/.test(url ?? "") &&
                    /^[0-9a-f]{40}$/.test(head_commit ?? "")) {
                  store.writeCommandRecord(command.command_id, { ...pending, publication: { url, head_commit } });
                }
              };
              const raw = await runWithExecutorContext(executorContext, operation ?? (async () => action === "start"
                ? start(workItemId, {
                    ...(command.decision ? { decision: command.decision } : {}),
                    callerId,
                    operatorId,
                  })
                : action === "continue"
                  ? continueWork(workItemId, recordPublication)
                  : action === "reconstruct"
                    ? reconstruct(workItemId, { previousSessionId: resumeReplacement || null })
                  : action === "recover"
                    ? controller.recover(workItemId, { operatorId, recovery: command.recovery })
                  : action === "merge"
                    ? merge(workItemId)
                    : close(workItemId)));
              let result = withLifecycleContext(
                projectDeliveryArtWorkSessionResult(raw),
                store.readByAlias(workItemId),
              );
              const actualSession = store.readByAlias(workItemId);
              if (actualSession && ((sourceIntentRef || operation) && (!session || actualSession.session_id === session.session_id) || result.source_access_scope)) {
                if (sourceIntentRef && (!session || actualSession.session_id === session.session_id)) retainSourceReference(actualSession, sourceIntentRef);
                result = withSourceReference(result, actualSession);
              }
              const retired = predecessor && ["recover", "reconstruct"].includes(action) &&
                actualSession?.session_id !== predecessor.session_id;
              if (sourceCredentials && predecessor && (retired || (action === "close" && ["closed", "cleanup-required", "cleanup-blocked"].includes(result.state)))) {
                const reference = terminalSourceReference;
                if (reference) {
                  if (action === "reconstruct") {
                    const stopped = await sourceCredentials.stopSourceCredential({ callerId, operatorId, intentId: reference, sessionId: predecessor.session_id });
                    if (stopped.state !== "succeeded") {
                      throw new DeliveryArtWorkSessionServiceError("delivery_art_work_session_rebuild_revocation_pending", "The previous workspace access is closing. Resume the saved rebuild to confirm the original result.", { statusCode: 503 });
                    }
                  } else {
                  try {
                    const stopped = await sourceCredentials.stopSourceCredential({ callerId, operatorId, intentId: reference, sessionId: predecessor.session_id });
                    result = { ...result, source_authorization: { intent_ref: reference, session_id: predecessor.session_id,
                      state: stopped.state === "succeeded" ? "revoked" : "revocation-pending", operation_ref: stopped.operation_id } };
                    if (stopped.state !== "succeeded") result.next_action = { code: "source-revocation-pending", authority: "platform-engineering", reason: "Follow the retained Platform operation to confirm exact credential revocation." };
                  } catch (error) {
                    result = { ...result, source_authorization: { intent_ref: reference, session_id: predecessor.session_id, state: "revocation-required", operation_ref: null },
                      next_action: { code: "source-revocation-required", authority: "platform-engineering", reason: "Source authorization closure is not confirmed; use the same source-intent Platform revocation action." } };
                    if (!error?.code) throw error;
                  }
                  }
                }
              }
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
              if (action === "reconstruct") {
                const transition = store.readReplacement(predecessor.session_id);
                if (transition?.state === "activated" || transition?.state === "prepared" && bounded.statusCode >= 500) throw bounded;
              }
              store.writeCommandRecord(command.command_id, {
                ...pending,
                completed_at: clock().toISOString(),
                error: storedError(bounded),
                state: "failed",
              });
              throw bounded;
            }
          };
          if ((sourceCredentials || command.reviewed_verification_digest) && action === "continue" && session && typeof controller.continueAfterMerge === "function") {
            const recorded = await runWithExecutorContext(executorContext, () => controller.continueAfterMerge(
              workItemId, session, (operation) => executeCommand(null, operation), command.reviewed_verification_digest,
            ));
            if (recorded !== null) return recorded;
          }
          if (command.reviewed_verification_digest) {
            throw new DeliveryArtWorkSessionServiceError("delivery_art_operating_verifier_binding_changed",
              "This session is no longer ready for the reviewed verification.", { statusCode: 409 });
          }
          if (sourceCredentials && (action === "continue" || (action === "start" && !session && command.decision))) {
            let requestedStartDigest = null;
            if (action === "start") {
              const prospective = await sourceCredentialPlan({ callerId, operatorId,
                subject: { kind: "delivery", work_item_ref: workItemId }, decision: command.decision });
              requestedStartDigest = prospective.source_start_digest;
            }
            return authorizedSourceEffect({ callerId, operatorId, workItemId, session, command, requestedStartDigest, operation: executeCommand });
          }
          return executeCommand();
        });
      });
    } catch (error) {
      throw boundedExecutionError(error);
    }
  }

  return {
    captureProjectRuntimeSource,
    withAuthorizedProjectSource,
    close,
    continue: continueWork,
    execute,
    executeRealization,
    inspect,
    prepareSourceCredential: sourceCredentialPlan,
    verifySourceCredential: sourceCredentialPlan,
    merge,
    preflight,
    projectContext,
    read,
    readCommand,
    readRealization,
    readRealizationSource,
    reconstruct,
    start,
    status,
  };
}
