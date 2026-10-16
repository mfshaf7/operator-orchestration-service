import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

import { canonicalDigest, canonicalStringify } from "./canonical-json.js";
import { normalizeWorkItemId } from "./work-session.js";

const CONTRACT_ROOT = fileURLToPath(
  new URL("../../contracts/delivery-art-work-session/", import.meta.url),
);
const changeSetSchema = JSON.parse(
  readFileSync(path.join(CONTRACT_ROOT, "source-realization-change-set.schema.json"), "utf8"),
);
const startSchema = JSON.parse(
  readFileSync(path.join(CONTRACT_ROOT, "source-realization-start.schema.json"), "utf8"),
);
const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validateChangeSetSchema = ajv.compile(changeSetSchema);
const validateStartSchema = ajv.compile(startSchema);
const ARTIFACT_FILE = "source-realization.json";
const STABLE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const TERMINAL_ATTEMPTS = new Set(["cancelled", "failed", "source-created"]);

export class DeliveryArtSourceRealizationError extends Error {
  constructor(code, message, { details = null, statusCode = 400 } = {}) {
    super(message);
    this.name = "DeliveryArtSourceRealizationError";
    this.code = code;
    this.details = details;
    this.statusCode = statusCode;
  }

  toResponse() {
    return { error: this.code, message: this.message, details: this.details };
  }
}

function schemaErrors(validator) {
  return (validator.errors ?? []).map((error) =>
    `${error.instancePath || "/"} ${error.message}`);
}

function assertStart(value) {
  if (!validateStartSchema(value)) {
    throw new DeliveryArtSourceRealizationError(
      "delivery_art_source_realization_request_invalid",
      `Source realization start request is invalid: ${schemaErrors(validateStartSchema).join("; ")}`,
    );
  }
  return structuredClone(value);
}

export function validateDeliveryArtSourceRealizationChangeSet(value) {
  const valid = validateChangeSetSchema(value);
  return {
    valid: Boolean(valid),
    errors: valid ? [] : schemaErrors(validateChangeSetSchema),
  };
}

function assertChangeSet(value, { baseCommit, objectiveDigest, sessionId }) {
  const validation = validateDeliveryArtSourceRealizationChangeSet(value);
  if (
    !validation.valid ||
    value.session_id !== sessionId ||
    value.base_commit !== baseCommit ||
    value.objective_digest !== objectiveDigest
  ) {
    throw new DeliveryArtSourceRealizationError(
      "delivery_art_source_realization_change_set_invalid",
      "Governed source realization returned an invalid or incorrectly bound change set.",
      { details: validation, statusCode: 502 },
    );
  }
  const paths = value.operations.map((operation) => operation.path);
  if (new Set(paths).size !== paths.length) {
    throw new DeliveryArtSourceRealizationError(
      "delivery_art_source_realization_change_set_invalid",
      "A source realization change set may mutate each path only once.",
      { statusCode: 502 },
    );
  }
  return structuredClone(value);
}

function assertCommand(value, action) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new DeliveryArtSourceRealizationError(
      "delivery_art_source_realization_command_invalid",
      "Source realization command must be an object.",
    );
  }
  const allowed = action === "continue"
    ? ["schema_version", "command_id", "expected_revision", "accepted_change_set_digest", "requested_at"]
    : action === "cancel"
      ? ["schema_version", "command_id", "expected_revision", "reason", "requested_at"]
      : ["schema_version", "command_id", "expected_revision", "requested_at"];
  const unexpected = Object.keys(value).filter((key) => !allowed.includes(key));
  if (
    unexpected.length > 0 ||
    value.schema_version !== 1 ||
    !STABLE_ID.test(value.command_id ?? "") ||
    typeof value.expected_revision !== "string" ||
    !Number.isFinite(Date.parse(value.expected_revision)) ||
    typeof value.requested_at !== "string" ||
    !Number.isFinite(Date.parse(value.requested_at)) ||
    (action === "continue" && !DIGEST.test(value.accepted_change_set_digest ?? "")) ||
    (action === "cancel" && (typeof value.reason !== "string" || value.reason.trim().length < 20))
  ) {
    throw new DeliveryArtSourceRealizationError(
      "delivery_art_source_realization_command_invalid",
      `Source realization ${action} command is invalid.`,
      { details: { unexpected } },
    );
  }
  return structuredClone(value);
}

function attemptProjection(attempt) {
  if (!attempt) return null;
  return {
    request_id: attempt.request_id,
    execution_id: attempt.execution_id,
    state: attempt.state,
    requested_at: attempt.requested_at,
    completed_at: attempt.completed_at,
    retry_of: attempt.retry_of,
    objective_digest: attempt.objective_digest,
    context: attempt.context ? structuredClone(attempt.context) : null,
    model: attempt.model ? structuredClone(attempt.model) : null,
    change_set: attempt.change_set
      ? {
          change_set_id: attempt.change_set.change_set_id,
          digest: attempt.change_set_digest,
          commit_message: attempt.change_set.commit_message,
          operations: attempt.change_set.operations.map((operation) => ({
            action: operation.action,
            path: operation.path,
            content_digest: operation.content === null
              ? null
              : canonicalDigest(operation.content),
            expected_digest: operation.expected_digest,
          })),
        }
      : null,
    source_receipt: attempt.source_receipt
      ? structuredClone(attempt.source_receipt)
      : null,
    failure: attempt.failure ? structuredClone(attempt.failure) : null,
  };
}

function nextAction(attempt, configured) {
  if (!configured) {
    return {
      code: "source-realization-runtime-required",
      authority: "platform-engineering",
      reason: "Commission the bounded source-realization model profile before use.",
    };
  }
  if (!attempt) {
    return {
      code: "source-realization-start-required",
      authority: "operator",
      reason: "Submit an exact source-realization objective for the active work session.",
    };
  }
  if (attempt.state === "draft-ready") {
    return {
      code: "source-realization-acceptance-required",
      authority: "operator",
      reason: "Review and accept the exact change-set digest before Agent Gary commits it.",
    };
  }
  if (["applying", "apply-unknown"].includes(attempt.state)) {
    return {
      code: "source-realization-recovery-required",
      authority: "operator-orchestration-service",
      reason: "Reconcile the idempotent source action before retrying or cancelling.",
    };
  }
  if (["cancelled", "failed"].includes(attempt.state)) {
    return {
      code: "source-realization-retry-available",
      authority: "operator",
      reason: "Submit a new request explicitly linked to this terminal attempt.",
    };
  }
  if (attempt.state === "source-created") {
    return {
      code: "work-session-continue-required",
      authority: "operator-orchestration-service",
      reason: "Resume the existing work session to validate, publish, review, and merge the Agent Gary commit.",
    };
  }
  return {
    code: "source-realization-in-progress",
    authority: "operator-orchestration-service",
    reason: "The bounded source-realization attempt is still settling.",
  };
}

function project(record, configured, replayed = false) {
  const attempt = record?.attempts?.at(-1) ?? null;
  return {
    schema_version: 1,
    workflow_id: "delivery-art-source-realization",
    session_id: record?.session_id ?? null,
    work_item_id: record?.work_item_id ?? null,
    revision: record?.revision ?? null,
    state: attempt?.state ?? "not-started",
    attempt: attemptProjection(attempt),
    next_action: nextAction(attempt, configured),
    replayed,
  };
}

function boundedFailure(error) {
  return {
    code: typeof error?.code === "string"
      ? error.code
      : "delivery_art_source_realization_failed",
    message: error instanceof Error ? error.message : String(error),
    retryable: Number(error?.statusCode ?? 500) >= 500,
  };
}

function assertGatewayResult(result, { profileId, requestId, projection, source }) {
  const generatedAt = Date.parse(result?.generated_at ?? "");
  if (
    result?.policy_decision !== "allow" ||
    result?.policy_status !== "active" ||
    result?.profile_id !== profileId ||
    result?.decision_id !== requestId ||
    result?.caller_id !== "operator-orchestration-service/source-realization" ||
    result?.invocation_path !== "governed-ai-gateway" ||
    !Number.isFinite(generatedAt) ||
    generatedAt < Date.parse(projection.binding.captured_at) ||
    typeof result?.binding_selection_ref !== "string" ||
    typeof result?.audit_ref !== "string"
  ) {
    throw new DeliveryArtSourceRealizationError(
      "delivery_art_source_realization_model_result_invalid",
      "Governed AI returned an incomplete or incorrectly bound source-realization result.",
      { statusCode: 502 },
    );
  }
  return assertChangeSet(result.output, {
    baseCommit: source.head_commit,
    objectiveDigest: source.objective_digest,
    sessionId: source.session_id,
  });
}

function gatewayRequest({ attempt, operatorId, profileId, projection, source }) {
  return {
    profile_id: profileId,
    caller_identity: {
      caller_id: "operator-orchestration-service/source-realization",
      caller_repo: "operator-orchestration-service",
      caller_workflow: "source-realization",
      decision_or_correlation_id: attempt.request_id,
      requested_profile_id: profileId,
    },
    operator_identity: { operator_id: operatorId },
    task: {
      kind: "source_realization",
      contract_ref: "oos.delivery-art.source-realization.v1",
      version: "1.0",
    },
    provider_output_schema_ref:
      "platform-engineering/security/schemas/source-realization-change-set.schema.json",
    input: {
      task_instruction:
        "Produce one minimal bounded change set using only the admitted packet. Do not run commands, mutate state, approve, merge, or include secrets.",
      model_safe_packet: {
        content: projection.content,
        packet_ref: projection.binding.packet_ref,
        redaction_receipt_ref: projection.binding.redaction_receipt_ref,
        projection_receipt_ref: projection.binding.projection_receipt_ref,
        artifact_digest: projection.binding.artifact_digest,
      },
      source_binding: {
        session_id: source.session_id,
        base_commit: source.head_commit,
        objective_digest: source.objective_digest,
        context_digest: source.context_digest,
      },
    },
  };
}

export function createDeliveryArtSourceRealizationGatewayClient({
  baseUrl,
  fetchImpl = globalThis.fetch,
} = {}) {
  const configured = Boolean(baseUrl);
  return {
    configured,
    async invoke(request, { signal = null } = {}) {
      if (!configured) {
        throw new DeliveryArtSourceRealizationError(
          "delivery_art_source_realization_runtime_unavailable",
          "The governed source-realization model path is not commissioned.",
          { statusCode: 503 },
        );
      }
      let response;
      try {
        response = await fetchImpl(new URL("/v1/governed-ai/invoke", baseUrl), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: canonicalStringify(request),
          signal,
        });
      } catch (error) {
        if (error?.name === "AbortError") throw error;
        throw new DeliveryArtSourceRealizationError(
          "delivery_art_source_realization_runtime_unavailable",
          error instanceof Error ? error.message : "Governed source realization is unavailable.",
          { statusCode: 503 },
        );
      }
      const text = await response.text();
      if (Buffer.byteLength(text, "utf8") > 2 * 1024 * 1024) {
        throw new DeliveryArtSourceRealizationError(
          "delivery_art_source_realization_model_result_oversized",
          "Governed source realization exceeded the bounded response limit.",
          { statusCode: 502 },
        );
      }
      let payload;
      try {
        payload = JSON.parse(text);
      } catch {
        throw new DeliveryArtSourceRealizationError(
          "delivery_art_source_realization_model_result_invalid",
          "Governed source realization returned invalid JSON.",
          { statusCode: 502 },
        );
      }
      if (!response.ok) {
        throw new DeliveryArtSourceRealizationError(
          payload?.code ?? "delivery_art_source_realization_model_rejected",
          payload?.message ?? "Governed source realization rejected the request.",
          { details: payload?.details ?? null, statusCode: response.status },
        );
      }
      return payload;
    },
  };
}

export function createDeliveryArtSourceRealizationService({
  clock = () => new Date(),
  enabled = false,
  gatewayClient,
  lifecycleContext,
  profileId = "source-realization-v1",
  sourceAdapter,
  store,
  workSessionController,
} = {}) {
  for (const method of ["applySourceRealization", "captureRealizationContext"]) {
    if (typeof sourceAdapter?.[method] !== "function") throw new Error(`sourceAdapter.${method} is required`);
  }
  if (typeof lifecycleContext?.project !== "function") throw new Error("lifecycleContext.project is required");
  if (typeof gatewayClient?.invoke !== "function") throw new Error("gatewayClient.invoke is required");
  for (const method of ["readArtifact", "readByAlias", "withLock", "writeArtifact"]) {
    if (typeof store?.[method] !== "function") throw new Error(`store.${method} is required`);
  }
  if (typeof workSessionController?.status !== "function") throw new Error("workSessionController.status is required");
  const configured = enabled === true && gatewayClient.configured !== false;

  function sessionFor(workItemId) {
    const session = store.readByAlias(normalizeWorkItemId(workItemId));
    if (!session) {
      throw new DeliveryArtSourceRealizationError(
        "delivery_art_source_realization_session_missing",
        "Start the Delivery work session before source realization.",
        { statusCode: 409 },
      );
    }
    return session;
  }

  function readRecord(session) {
    return store.readArtifact(session, ARTIFACT_FILE);
  }

  function writeRecord(session, record) {
    store.writeArtifact(session, ARTIFACT_FILE, record);
    return record;
  }

  function revision() {
    return clock().toISOString();
  }

  function assertIdentity(session, callerId, operatorId) {
    if (session.caller_id !== callerId || session.operator.id !== operatorId) {
      throw new DeliveryArtSourceRealizationError(
        "delivery_art_source_realization_identity_mismatch",
        "Source realization caller and operator must match the work session.",
        { statusCode: 403 },
      );
    }
  }

  async function read({ callerId, operatorId, workItemId }) {
    const session = sessionFor(workItemId);
    assertIdentity(session, callerId, operatorId);
    return project(readRecord(session) ?? {
      schema_version: 1,
      artifact_type: "delivery_art_source_realization_record",
      session_id: session.session_id,
      work_item_id: session.work_item_id,
      attempts: [],
      revision: session.updated_at ?? session.created_at ?? null,
    }, configured);
  }

  async function start({ callerId, operatorId, request: input, signal = null, workItemId }) {
    if (!configured) {
      throw new DeliveryArtSourceRealizationError(
        "delivery_art_source_realization_runtime_unavailable",
        "The bounded source-realization runtime is not commissioned.",
        { statusCode: 503 },
      );
    }
    const request = assertStart(input);
    const session = sessionFor(workItemId);
    const acceptedAt = revision();
    if (
      Date.parse(request.requested_at) > Date.parse(acceptedAt) ||
      (session.created_at && Date.parse(request.requested_at) < Date.parse(session.created_at))
    ) {
      throw new DeliveryArtSourceRealizationError(
        "delivery_art_source_realization_timeline_invalid",
        "Source realization request time is outside the active work-session timeline.",
        { statusCode: 409 },
      );
    }
    assertIdentity(session, callerId, operatorId);
    const requestDigest = canonicalDigest(request);
    return store.withLock(`source-realization:${session.session_id}`, async () => {
      let record = readRecord(session);
      const prior = record?.attempts?.find((attempt) => attempt.request_id === request.request_id);
      if (prior) {
        if (prior.request_digest !== requestDigest) {
          throw new DeliveryArtSourceRealizationError(
            "delivery_art_source_realization_replay_conflict",
            "Source realization request_id is bound to different input.",
            { statusCode: 409 },
          );
        }
        return project(record, configured, true);
      }
      const previous = record?.attempts?.at(-1) ?? null;
      if (previous && !TERMINAL_ATTEMPTS.has(previous.state)) {
        throw new DeliveryArtSourceRealizationError(
          "delivery_art_source_realization_attempt_active",
          "Settle the current source-realization attempt before starting another.",
          { statusCode: 409 },
        );
      }
      if (
        (previous && request.retry_of !== previous.request_id) ||
        (!previous && request.retry_of !== null)
      ) {
        throw new DeliveryArtSourceRealizationError(
          "delivery_art_source_realization_retry_binding_invalid",
          "A retry must bind the immediately preceding terminal attempt.",
          { statusCode: 409 },
        );
      }
      const status = await workSessionController.status(session.work_item_id);
      if (
        status.session_revision !== request.expected_session_revision ||
        status.next_action?.code !== "source-work-required" ||
        status.source?.head_commit !== session.landing_unit.base_commit ||
        status.agent_source?.state !== "ready"
      ) {
        throw new DeliveryArtSourceRealizationError(
          "delivery_art_source_realization_precondition_failed",
          "Source realization requires the exact clean implementation-ready session and Agent Gary binding.",
          {
            details: {
              current_session_revision: status.session_revision ?? null,
              next_action: status.next_action?.code ?? null,
            },
            statusCode: 409,
          },
        );
      }
      const now = acceptedAt;
      const attempt = {
        request_id: request.request_id,
        execution_id: request.execution_id,
        request_digest: requestDigest,
        requested_at: request.requested_at,
        completed_at: null,
        retry_of: request.retry_of,
        objective: request.objective,
        objective_digest: canonicalDigest(request.objective),
        state: "accepted",
        context: null,
        model: null,
        change_set: null,
        change_set_digest: null,
        source_receipt: null,
        apply_command_id: null,
        apply_command_digest: null,
        cancel_command_id: null,
        cancel_command_digest: null,
        recovery_command_id: null,
        recovery_command_digest: null,
        failure: null,
      };
      record = record ?? {
        schema_version: 1,
        artifact_type: "delivery_art_source_realization_record",
        session_id: session.session_id,
        work_item_id: session.work_item_id,
        attempts: [],
        revision: now,
      };
      record.attempts.push(attempt);
      record.revision = now;
      writeRecord(session, record);
      try {
        const repositoryContext = await sourceAdapter.captureRealizationContext(session);
        const projection = await lifecycleContext.project({
          callerId,
          operatorId,
          request: {
            schema_version: 1,
            request_id: `source-realization-context:${request.request_id}`,
            execution_id: request.execution_id,
            operation: "continue",
            mode: "packet",
            budget_tokens: request.budget_tokens,
            fallback_reason: null,
          },
          sourceRealization: {
            objective: request.objective,
            objective_digest: attempt.objective_digest,
            repository_context: repositoryContext,
          },
          workItemId: session.work_item_id,
        });
        const source = {
          session_id: session.session_id,
          head_commit: repositoryContext.head_commit,
          objective_digest: attempt.objective_digest,
          context_digest: repositoryContext.context_digest,
        };
        const modelResult = await gatewayClient.invoke(
          gatewayRequest({ attempt, operatorId, profileId, projection, source }),
          { signal },
        );
        const changeSet = assertGatewayResult(modelResult, {
          profileId,
          projection,
          requestId: request.request_id,
          source,
        });
        attempt.context = {
          packet_ref: projection.binding.packet_ref,
          redaction_receipt_ref: projection.binding.redaction_receipt_ref,
          projection_receipt_ref: projection.binding.projection_receipt_ref,
          artifact_digest: projection.binding.artifact_digest,
          repository_context_digest: repositoryContext.context_digest,
        };
        attempt.model = {
          profile_id: modelResult.profile_id,
          binding_selection_ref: modelResult.binding_selection_ref,
          audit_ref: modelResult.audit_ref,
        };
        attempt.change_set = changeSet;
        attempt.change_set_digest = canonicalDigest(changeSet);
        attempt.state = "draft-ready";
        attempt.completed_at = revision();
        record.revision = attempt.completed_at;
        writeRecord(session, record);
        return project(record, configured);
      } catch (error) {
        attempt.state = error?.name === "AbortError" ? "cancelled" : "failed";
        attempt.failure = boundedFailure(error);
        attempt.completed_at = revision();
        record.revision = attempt.completed_at;
        writeRecord(session, record);
        throw error;
      }
    });
  }

  async function continueRealization({ callerId, operatorId, request: input, workItemId }) {
    const command = assertCommand(input, "continue");
    const commandDigest = canonicalDigest(command);
    const session = sessionFor(workItemId);
    assertIdentity(session, callerId, operatorId);
    return store.withLock(`source-realization:${session.session_id}`, async () => {
      const record = readRecord(session);
      const attempt = record?.attempts?.at(-1) ?? null;
      if (attempt?.apply_command_id === command.command_id) {
        if (attempt.apply_command_digest !== commandDigest) {
          throw new DeliveryArtSourceRealizationError(
            "delivery_art_source_realization_replay_conflict",
            "Source realization command_id is bound to different acceptance input.",
            { statusCode: 409 },
          );
        }
        if (attempt.state === "source-created") return project(record, configured, true);
      }
      if (!attempt || record.revision !== command.expected_revision) {
        throw new DeliveryArtSourceRealizationError(
          "delivery_art_source_realization_revision_stale",
          "Source realization command was authored against a stale revision.",
          { statusCode: 409 },
        );
      }
      const acceptedAt = revision();
      if (
        Date.parse(command.requested_at) < Date.parse(attempt.requested_at) ||
        Date.parse(command.requested_at) > Date.parse(acceptedAt)
      ) {
        throw new DeliveryArtSourceRealizationError(
          "delivery_art_source_realization_timeline_invalid",
          "Source realization acceptance time is outside the attempt timeline.",
          { statusCode: 409 },
        );
      }
      if (attempt.state !== "draft-ready") {
        throw new DeliveryArtSourceRealizationError(
          "delivery_art_source_realization_not_ready",
          "Only a draft-ready source realization can be accepted.",
          { statusCode: 409 },
        );
      }
      if (attempt.change_set_digest !== command.accepted_change_set_digest) {
        throw new DeliveryArtSourceRealizationError(
          "delivery_art_source_realization_acceptance_mismatch",
          "Operator acceptance does not bind the current change set.",
          { statusCode: 409 },
        );
      }
      attempt.apply_command_id = command.command_id;
      attempt.apply_command_digest = commandDigest;
      attempt.state = "applying";
      record.revision = revision();
      writeRecord(session, record);
      try {
        attempt.source_receipt = await sourceAdapter.applySourceRealization(
          session,
          attempt.change_set,
        );
        attempt.state = "source-created";
        attempt.completed_at = revision();
        record.revision = attempt.completed_at;
        writeRecord(session, record);
        return project(record, configured);
      } catch (error) {
        attempt.state = "apply-unknown";
        attempt.failure = boundedFailure(error);
        attempt.completed_at = revision();
        record.revision = attempt.completed_at;
        writeRecord(session, record);
        throw error;
      }
    });
  }

  async function cancel({ callerId, operatorId, request: input, workItemId }) {
    const command = assertCommand(input, "cancel");
    const commandDigest = canonicalDigest(command);
    const session = sessionFor(workItemId);
    assertIdentity(session, callerId, operatorId);
    return store.withLock(`source-realization:${session.session_id}`, async () => {
      const record = readRecord(session);
      const attempt = record?.attempts?.at(-1) ?? null;
      if (attempt?.cancel_command_id === command.command_id) {
        if (attempt.cancel_command_digest !== commandDigest) {
          throw new DeliveryArtSourceRealizationError(
            "delivery_art_source_realization_replay_conflict",
            "Source realization command_id is bound to different cancellation input.",
            { statusCode: 409 },
          );
        }
        if (attempt.state === "cancelled") return project(record, configured, true);
      }
      if (!attempt || record.revision !== command.expected_revision) {
        throw new DeliveryArtSourceRealizationError(
          "delivery_art_source_realization_revision_stale",
          "Source realization command was authored against a stale revision.",
          { statusCode: 409 },
        );
      }
      const acceptedAt = revision();
      if (
        Date.parse(command.requested_at) < Date.parse(attempt.requested_at) ||
        Date.parse(command.requested_at) > Date.parse(acceptedAt)
      ) {
        throw new DeliveryArtSourceRealizationError(
          "delivery_art_source_realization_timeline_invalid",
          "Source realization cancellation time is outside the attempt timeline.",
          { statusCode: 409 },
        );
      }
      // This lock also surrounds generation. An acquired lock with an
      // accepted-only record means generation was interrupted before a draft
      // or any accepted source action existed. Cancelling is therefore safe;
      // applying/apply-unknown must still use exact-action recovery instead.
      if (!["accepted", "draft-ready"].includes(attempt.state)) {
        throw new DeliveryArtSourceRealizationError(
          "delivery_art_source_realization_cancel_not_allowed",
          "Only an unapplied accepted or draft-ready source realization can be cancelled safely.",
          { statusCode: 409 },
        );
      }
      attempt.cancel_command_id = command.command_id;
      attempt.cancel_command_digest = commandDigest;
      attempt.cancel_reason = command.reason.trim();
      attempt.state = "cancelled";
      attempt.completed_at = revision();
      record.revision = attempt.completed_at;
      writeRecord(session, record);
      return project(record, configured);
    });
  }

  async function recover({ callerId, operatorId, request: input, workItemId }) {
    const command = assertCommand(input, "recover");
    const commandDigest = canonicalDigest(command);
    const session = sessionFor(workItemId);
    assertIdentity(session, callerId, operatorId);
    return store.withLock(`source-realization:${session.session_id}`, async () => {
      const record = readRecord(session);
      const attempt = record?.attempts?.at(-1) ?? null;
      if (attempt?.recovery_command_id === command.command_id) {
        if (attempt.recovery_command_digest !== commandDigest) {
          throw new DeliveryArtSourceRealizationError(
            "delivery_art_source_realization_replay_conflict",
            "Source realization command_id is bound to different recovery input.",
            { statusCode: 409 },
          );
        }
        if (attempt.state === "source-created") return project(record, configured, true);
      }
      if (!attempt || record.revision !== command.expected_revision) {
        throw new DeliveryArtSourceRealizationError(
          "delivery_art_source_realization_revision_stale",
          "Source realization recovery was authored against a stale revision.",
          { statusCode: 409 },
        );
      }
      const acceptedAt = revision();
      if (
        Date.parse(command.requested_at) < Date.parse(attempt.requested_at) ||
        Date.parse(command.requested_at) > Date.parse(acceptedAt)
      ) {
        throw new DeliveryArtSourceRealizationError(
          "delivery_art_source_realization_timeline_invalid",
          "Source realization recovery time is outside the attempt timeline.",
          { statusCode: 409 },
        );
      }
      if (!["applying", "apply-unknown"].includes(attempt.state) || !attempt.apply_command_id) {
        throw new DeliveryArtSourceRealizationError(
          "delivery_art_source_realization_recovery_not_required",
          "This source realization does not require apply reconciliation.",
          { statusCode: 409 },
        );
      }
      attempt.source_receipt = await sourceAdapter.applySourceRealization(
        session,
        attempt.change_set,
      );
      attempt.recovery_command_id = command.command_id;
      attempt.recovery_command_digest = commandDigest;
      attempt.failure = null;
      attempt.state = "source-created";
      attempt.completed_at = revision();
      record.revision = attempt.completed_at;
      writeRecord(session, record);
      return project(record, configured);
    });
  }

  return { cancel, configured, continue: continueRealization, read, recover, start };
}
