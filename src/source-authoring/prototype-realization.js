import { selectionEvidence } from "../model-operations/selection-evidence.js";
import { canonicalDigest } from "../delivery-art/canonical-json.js";
import { assertPrototypeChangeSet } from "./prototype-change-set.js";
import { assertSourceCredentialTimestamp, SOURCE_INTENT_REFERENCE } from "../platform-operation/source-credentials.js";
import { createBoundedSourceActions, normalizeBoundedSourceCommand } from "./bounded-actions.js";
import { prototypeAuthoringError } from "./prototype-contracts.js";
import { prototypeSourceSession } from "./prototype-session.js";
import { assertPrototypeOwnerChangeSet } from "./prototype-owner-preparation.js";
import { createOperatorDraftEditor } from "./operator-drafts.js";

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const CALLER = "operator-orchestration-service/prototype-source-authoring";
const terminal = new Set(["failed", "cancelled", "source-created"]);
const fail = (code, message, options = {}) => prototypeAuthoringError(code, message, options.statusCode ?? 409, options.details ?? null);

function closed(value, fields) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== fields.length || fields.some(field => !Object.hasOwn(value, field))) {
    throw fail("command_invalid", "Prototype source command must use its exact bounded contract.", { statusCode: 400 });
  }
}
function intent(value) {
  if (typeof value !== "string" || !SOURCE_INTENT_REFERENCE.test(value)) throw fail("source_intent_invalid", "An exact explicitly approved source intent is required.", { statusCode: 400 });
  return value;
}
function timestamp(value) {
  try { assertSourceCredentialTimestamp(value, "requested_at"); } catch { throw fail("command_invalid", "Prototype command time must be a valid timezone-qualified timestamp.", { statusCode: 400 }); }
}
function failure(error) {
  return { code: typeof error?.code === "string" ? error.code : "prototype_source_authoring_failed",
    message: "The bounded Prototype source operation did not complete; inspect its exact retained attempt before retrying.", retryable: Number(error?.statusCode ?? 500) >= 500 };
}

function project(record, configured, replayed = false) {
  const attempt = record?.attempts?.at(-1) ?? null;
  const code = !configured ? "prototype-source-runtime-required" : !attempt ? "prototype-source-generation-required" :
    attempt.state === "draft-ready" ? "prototype-source-acceptance-required" : ["applying", "apply-unknown"].includes(attempt.state) ? "prototype-source-recovery-required" :
      attempt.state === "source-created" ? "prototype-source-review-required" : terminal.has(attempt.state) ? "prototype-source-retry-available" : "prototype-source-generation-resume-required";
  return { schema_version: 1, workflow_id: "prototype-source-realization", session_id: record.session_id, revision: record.revision,
    state: attempt?.state ?? "not-started", replayed, next_action: { code, authority: code.endsWith("runtime-required") ? "platform-engineering" : "operator-orchestration-service" },
    attempt: attempt ? { request_id: attempt.request_id, execution_id: attempt.execution_id, retry_of: attempt.retry_of, state: attempt.state,
      request: structuredClone(attempt.request),
      requested_at: attempt.requested_at, completed_at: attempt.completed_at, objective_digest: attempt.objective_digest,
      context: attempt.context ? structuredClone(attempt.context) : null, model: attempt.model ? structuredClone(attempt.model) : null,
      ...(attempt.operator_draft ? { operator_draft: structuredClone(attempt.operator_draft) } : {}),
      ...(attempt.owner_preparation ? { owner_preparation: structuredClone(attempt.owner_preparation) } : {}),
      change_set: attempt.change_set ? { digest: attempt.change_set_digest, change_set_id: attempt.change_set.change_set_id,
        commit_message: attempt.change_set.commit_message, operations: attempt.change_set.operations.map(({ content, ...operation }) => ({ ...operation,
          content_digest: content === null ? null : canonicalDigest(content) })) } : null,
      source_receipt: attempt.source_receipt ?? null, failure: attempt.failure ?? null } : null };
}

function gatewayRequest({ metadata, attempt, projection, capture, profileId }) {
  return { profile_id: profileId, caller_identity: { caller_id: CALLER, caller_repo: "operator-orchestration-service", caller_workflow: "prototype-source-authoring",
    decision_or_correlation_id: attempt.request_id, requested_profile_id: profileId }, operator_identity: { operator_id: metadata.operator_id },
    task: { kind: "prototype_source_authoring", contract_ref: "oos.prototype.source-authoring.v1", version: "1.0" },
    provider_output_schema_ref: "platform-engineering/security/schemas/source-realization-change-set.schema.json",
    input: { task_instruction: "Draft one minimal bounded app/design change set using only the admitted packet. Stay within its model_source_scope. Do not create owner controls, CI, executable profiles, credentials, approvals or receipts. Do not run tools, apply, publish, merge or activate anything.",
      model_safe_packet: { content: projection.content, packet_ref: projection.packet_ref, redaction_receipt_ref: projection.redaction_receipt_ref,
        projection_receipt_ref: projection.projection_receipt_ref, artifact_digest: projection.artifact_digest },
      source_binding: { session_id: metadata.session.session_id, base_commit: capture.head_commit, objective_digest: attempt.objective_digest, context_digest: capture.context_digest } } };
}

export function createPrototypeSourceRealizationService({ authoringService, store, sourceExecutor, platformOperations, lifecycleContext, gatewayClient,
  clock = () => new Date(), enabled = false, profileId = "prototype-source-authoring-v1" }) {
  if (typeof authoringService?.sourceRecord !== "function" || typeof store?.withActionLock !== "function" ||
      typeof sourceExecutor?.executor?.run !== "function" || typeof lifecycleContext?.prepare !== "function" || typeof lifecycleContext?.project !== "function" ||
      typeof gatewayClient?.invoke !== "function") throw new TypeError("Prototype realization requires the canonical owner workflow, existing source executor, private store, CGG and governed model adapter.");
  const configured = enabled === true;
  const modelConfigured = configured && gatewayClient.configured !== false;
  const owner = args => authoringService.sourceRecord(args);
  const platform = () => {
    const result = typeof platformOperations === "function" ? platformOperations() : platformOperations;
    if (!["ensureSourceCredential", "withSourceLease"].every(method => typeof result?.[method] === "function")) throw fail("source_authority_unavailable", "The existing Platform source intent authority is not commissioned.", { statusCode: 503 });
    return result;
  };
  const revision = () => clock().toISOString();
  const metadataRevision = current => new Date(Math.max(clock().getTime(), Date.parse(current.updated_at) + 1)).toISOString();
  function retainedSession(args) {
    const metadata = owner(args);
    if (!metadata.session) throw fail("source_session_required", "Start the actual Prototype source session with its approved source intent first.");
    return metadata;
  }
  const run = (metadata, commandId, operation) => sourceExecutor.executor.run({ caller_id: metadata.caller_id, operator_id: metadata.operator_id,
    prototype_id: metadata.request.prototype_id, source_request_id: metadata.request.request_id, session_id: metadata.session.session_id, command_id: commandId }, operation);
  const sourceInput = metadata => ({ prototype_id: metadata.request.prototype_id, session: metadata.session });
  async function authorized(metadata, reference, commandId, operation) {
    const scope = { callerId: metadata.caller_id, operatorId: metadata.operator_id, intentId: intent(reference), sessionId: metadata.session.session_id,
      requestedStartDigest: authoringService.read({ callerId: metadata.caller_id, operatorId: metadata.operator_id, requestId: metadata.request.request_id }).source_start_digest };
    await platform().ensureSourceCredential({ ...scope, previousIntentId: metadata.source_intent_ref && metadata.source_intent_ref !== reference ? metadata.source_intent_ref : null });
    return platform().withSourceLease({ ...scope, operation: async assertLease => {
      await store.transact(metadata.request.request_id, ({ current, put }) => put({ ...current, source_intent_ref: reference, updated_at: metadataRevision(current) }));
      return sourceExecutor.executor.withSourceLeaseGuard(assertLease, () => run(metadata, commandId, operation));
    } });
  }
  function readRecord(session) {
    const metadata = store.get(session.source_request_id);
    return metadata.realization_ref ? store.readArtifact(metadata.realization_ref) : { schema_version: 1, session_id: session.session_id, attempts: [], revision: metadata.updated_at };
  }
  async function writeRecord(session, record) {
    await store.transact(session.source_request_id, ({ current, put }) => {
      if (current.session?.session_id !== session.session_id) throw fail("source_session_changed", "The actual source session changed before retaining its realization.");
      // Every visible attempt/context/control change gets a fresh authority
      // revision, including intermediate writes and same-millisecond effects.
      record.revision = Date.parse(record.revision) > Date.parse(current.updated_at) ? record.revision : metadataRevision(current);
      const reference = store.writeArtifact(session.source_request_id, record);
      put({ ...current, realization_ref: reference, state: "source-work", updated_at: record.revision });
    });
  }
  async function startSession({ callerId, operatorId, requestId, input }) {
    closed(input, ["schema_version", "command_id", "source_intent_ref", "requested_at"]); intent(input.source_intent_ref); timestamp(input.requested_at);
    if (!configured) throw fail("runtime_unavailable", "The bounded Prototype authoring composition is not commissioned.", { statusCode: 503 });
    if (input.schema_version !== 1 || !ID.test(input.command_id ?? "") || Date.parse(input.requested_at) > clock().getTime()) throw fail("command_invalid", "Prototype session start requires a stable command and current request time.", { statusCode: 400 });
    let metadata = owner({ callerId, operatorId, requestId });
    await authoringService.prepareSourceCredential({ callerId, operatorId, subject: { kind: "prototype", prototype_id: metadata.request.prototype_id, source_request_id: requestId } });
    metadata = await store.transact(requestId, ({ current, put }) => {
      if (current.session) return current;
      return put({ ...current, session: prototypeSourceSession(current), state: "source-authorization-required", updated_at: metadataRevision(current) });
    });
    return store.withActionLock(metadata.session.session_id, async () => {
      const owned = await authorized(metadata, input.source_intent_ref, input.command_id, () => sourceExecutor.prototypeSource.ensureOwnedWorktree(sourceInput(metadata)));
      await store.transact(requestId, ({ current, put }) => put({ ...current, resources: current.resources ?? owned.resources, state: "source-work", updated_at: metadataRevision(current) }));
      return read({ callerId, operatorId, requestId });
    });
  }
  function read(args) {
    const metadata = owner(args);
    const record = metadata.session ? readRecord(metadata.session) : null;
    const realization = record ? project(record, configured) : null;
    const delivery = record?.attempts.at(-1)?.source_delivery ?? {};
    const next = delivery.close?.state === "succeeded" ? "prototype-source-complete" : delivery.merge?.state === "succeeded" ? "prototype-source-close-required"
      : delivery.review?.state === "succeeded" ? "prototype-source-merge-required" : delivery.publish?.state === "succeeded" ? "prototype-source-human-review-required"
        : realization?.state === "source-created" ? "prototype-source-publish-required" : null;
    return { ...authoringService.read(args), source_request: structuredClone(metadata.request), state: metadata.state, source_intent_ref: metadata.source_intent_ref ?? null,
      next_action: !metadata.source_intent_ref ? { code: "prototype-source-authorization-required", authority: "platform-engineering", reason: "Prepare and explicitly approve this exact source scope before source actions." }
        : next ? { code: next, authority: "operator-orchestration-service" } : realization.next_action,
      source_delivery: structuredClone(delivery), realization };
  }
  async function generate({ callerId, operatorId, requestId, input, signal = null }) {
    closed(input, ["schema_version", "request_id", "execution_id", "expected_revision", "budget_tokens", "retry_of", "requested_at", "source_intent_ref"]);
    timestamp(input.requested_at); timestamp(input.expected_revision); intent(input.source_intent_ref);
    if (!modelConfigured) throw fail("runtime_unavailable", "The bounded Prototype model purpose is not commissioned.", { statusCode: 503 });
    if (input.schema_version !== 1 || !ID.test(input.request_id ?? "") || !ID.test(input.execution_id ?? "") ||
        (input.retry_of !== null && !ID.test(input.retry_of)) || !Number.isInteger(input.budget_tokens) || input.budget_tokens < 1 || input.budget_tokens > 8000) throw fail("command_invalid", "Prototype generation requires bounded immutable request, execution and budget fields.", { statusCode: 400 });
    const metadata = retainedSession({ callerId, operatorId, requestId });
    return store.withActionLock(metadata.session.session_id, async () => {
      const record = readRecord(metadata.session);
      // Authorization may be explicitly replaced after exact predecessor
      // revocation; it is not a new objective/execution. The live authority
      // below verifies successor adoption before resuming any effect.
      const { source_intent_ref: _authorization, ...generationIntent } = input;
      const digest = canonicalDigest(generationIntent);
      let attempt = record.attempts.find(value => value.request_id === input.request_id);
      if (attempt) {
        if (attempt.request_digest !== digest) throw fail("replay_conflict", "Generation request identity is bound to different immutable input.");
        if (attempt.state !== "accepted") return project(record, configured, true);
      }
      if (!attempt) {
        const prior = record.attempts.at(-1);
        if (record.revision !== input.expected_revision || (prior && !terminal.has(prior.state)) || (prior?.request_id ?? null) !== input.retry_of || prior?.state === "source-created") {
          throw fail("generation_precondition_failed", "Use the exact current revision and retry only the immediately preceding unapplied terminal attempt; committed source proceeds to review.");
        }
        if (Date.parse(input.requested_at) < Date.parse(metadata.created_at) || Date.parse(input.requested_at) > clock().getTime()) throw fail("timeline_invalid", "Generation time is outside the actual source request timeline.");
      }
      // Prove eligibility before credential effects, and authorize before
      // accepting a new generation journal. Historical acknowledgements above
      // are reads, not fresh source authority.
      await authorized(metadata, input.source_intent_ref, input.request_id, async () => {});
      if (!attempt) {
        attempt = { request: structuredClone(input), request_id: input.request_id, execution_id: input.execution_id, request_digest: digest, requested_at: input.requested_at, retry_of: input.retry_of,
          objective_digest: metadata.session.objective_digest, state: "accepted", completed_at: null, context_request_ref: null, context: null,
          model_request_ref: null, model: null, change_set: null, change_set_digest: null, source_receipt: null, failure: null };
        record.attempts.push(attempt); record.revision = revision(); await writeRecord(metadata.session, record);
      }
      try {
        if (metadata.session.owner_preparation) {
          const prepared = await run(metadata, input.request_id, () => sourceExecutor.prototypeSource.prepareOwner(sourceInput(metadata)));
          assertPrototypeOwnerChangeSet(prepared.change_set, metadata.session);
          if (prepared.authority !== "workspace-prototype-studio" || prepared.model_invoked !== false || prepared.runtime_activated !== false ||
              !/^sha256:[0-9a-f]{64}$/.test(prepared.plan_digest ?? "") || !/^sha256:[0-9a-f]{64}$/.test(prepared.request_digest ?? "")) {
            throw fail("owner_plan_invalid", "The trusted owner preparation lacks its exact non-model evidence.", { statusCode: 502 });
          }
          const { change_set: changeSet, ...evidence } = prepared;
          attempt.owner_preparation = evidence; attempt.change_set = changeSet; attempt.change_set_digest = canonicalDigest(changeSet);
          attempt.state = "draft-ready"; attempt.completed_at = revision();
          await writeRecord(metadata.session, record); return project(record, configured);
        }
        if (!attempt.context_request_ref) {
          const capture = await run(metadata, input.request_id, () => sourceExecutor.prototypeSource.captureRealizationContext(sourceInput(metadata)));
          attempt.capture_ref = store.writeArtifact(requestId, capture);
          attempt.context_request_ref = lifecycleContext.prepare({ record: metadata, capture, executionId: input.execution_id, budgetTokens: input.budget_tokens, capturedAt: revision() });
          await writeRecord(metadata.session, record);
        }
        const capture = store.readArtifact(attempt.capture_ref);
        const projection = await lifecycleContext.project({ record: metadata, requestRef: attempt.context_request_ref });
        const { content: _modelContent, ...safeProjection } = projection; attempt.context = safeProjection;
        const modelRequest = gatewayRequest({ metadata, attempt, projection, capture, profileId });
        if (!attempt.model_request_ref || store.readArtifact(attempt.model_request_ref).selection_evidence_version === 1) modelRequest.selection_evidence_version = 1;
        const modelReference = store.writeArtifact(requestId, modelRequest);
        if (attempt.model_request_ref && canonicalDigest(attempt.model_request_ref) !== canonicalDigest(modelReference)) throw fail("model_request_changed", "Retained model invocation must not change across recovery.");
        attempt.model_request_ref = modelReference; await writeRecord(metadata.session, record);
        const result = await gatewayClient.invoke(modelRequest, { signal }); const changeSet = result?.output;
        if (result?.policy_decision !== "allow" || result.policy_status !== "active" || result.profile_id !== profileId || result.decision_id !== input.request_id ||
            result.caller_id !== CALLER || result.invocation_path !== "governed-ai-gateway" || !Number.isFinite(Date.parse(result.generated_at ?? "")) ||
            Date.parse(result.generated_at) < Date.parse(projection.captured_at) || !result.binding_selection_ref || !result.audit_ref || changeSet?.base_commit !== capture.head_commit) {
          throw fail("model_result_invalid", "Governed model result did not retain the exact admitted Prototype purpose, source and bounded app/design scope.", { statusCode: 502 });
        }
        assertPrototypeChangeSet(changeSet, metadata.session, { status: 502, code: "model_result_invalid" });
        attempt.model = { profile_id: result.profile_id, binding_selection_ref: result.binding_selection_ref, audit_ref: result.audit_ref,
          ...selectionEvidence(result, { profileId, taskKind: modelRequest.task.kind }) };
        attempt.change_set = changeSet; attempt.change_set_digest = canonicalDigest(changeSet); attempt.state = "draft-ready"; attempt.completed_at = revision();
        record.revision = attempt.completed_at; await writeRecord(metadata.session, record); return project(record, configured);
      } catch (error) {
        attempt.state = error?.name === "AbortError" ? "cancelled" : "failed"; attempt.failure = failure(error); attempt.completed_at = revision();
        record.revision = attempt.completed_at; await writeRecord(metadata.session, record); throw error;
      }
    });
  }
  const actions = createBoundedSourceActions({ configured, revision, project, readRecord, writeRecord, boundedFailure: failure, error: fail,
    assertCommand: (value, action) => {
      timestamp(value?.requested_at); timestamp(value?.expected_revision);
      if (action === "cancel" && typeof value.reason === "string" && value.reason.length > 4096) throw fail("command_invalid", "Prototype cancellation reason exceeds its bounded operator contract.", { statusCode: 400 });
      return normalizeBoundedSourceCommand(value, action, fail);
    },
    assertIdentity(session, callerId, operatorId) { if (session.caller_id !== callerId || session.operator.id !== operatorId) throw fail("identity_forbidden", "Prototype source session belongs to another caller/operator.", { statusCode: 403 }); },
    sessionFor: async args => retainedSession(args).session,
    store: { withLock: (key, operation) => store.withActionLock(key.slice("source-realization:".length), operation) },
    sourceAdapter: { applySourceRealization: (session, changeSet) => sourceExecutor.prototypeSource.applySourceRealization({ prototype_id: session.prototype_id, session, change_set: changeSet }) },
  });
  const apply = action => async ({ callerId, operatorId, requestId, input }) => {
    closed(input, ["command", "source_intent_ref"]); intent(input.source_intent_ref);
    const subjectRef = { callerId, operatorId, requestId }; const args = { callerId, operatorId, subjectRef, request: input.command };
    const completed = await actions.readCompletedCommand({ ...args, action }); if (completed) return completed;
    const metadata = retainedSession(subjectRef);
    return authorized(metadata, input.source_intent_ref, input.command.command_id, () => actions[action](args));
  };
  const deliver = action => async ({ callerId, operatorId, requestId, input }) => {
    closed(input, action === "publish" ? ["command", "source_intent_ref"] : ["command"]);
    if (action === "publish") intent(input.source_intent_ref);
    const command = input.command;
    closed(command, ["schema_version", "command_id", "expected_revision", "requested_at", "expected_pull_request"]);
    timestamp(command.requested_at); timestamp(command.expected_revision);
    if (command.schema_version !== 1 || !ID.test(command.command_id ?? "")) throw fail("command_invalid", "Source delivery control requires an exact command identity.", { statusCode: 400 });
    const metadata = retainedSession({ callerId, operatorId, requestId });
    return store.withActionLock(metadata.session.session_id, async () => {
      const record = readRecord(metadata.session); const attempt = record.attempts.at(-1); const digest = canonicalDigest(command);
      if (attempt?.state !== "source-created") throw fail("source_not_created", "Accept and reconcile the source draft before review or source delivery.");
      attempt.source_delivery ??= {};
      const controls = attempt.source_delivery; const prior = controls[action];
      if (prior) {
        if (prior.command_id !== command.command_id || prior.command_digest !== digest) throw fail("replay_conflict", "Reconcile this source control using its retained exact command; do not replace uncertain effects.");
        if (prior.state === "succeeded") return { ...read({ callerId, operatorId, requestId }), replayed: true };
      } else if (record.revision !== command.expected_revision || Date.parse(command.requested_at) < Date.parse(attempt.requested_at) || Date.parse(command.requested_at) > clock().getTime()) {
        throw fail("revision_stale", "Source delivery control must bind the current revision and attempt timeline.");
      }
      const expected = controls.publish?.pull_request ?? null;
      const head = attempt.source_receipt.head_commit;
      if (action !== "publish") closed(command.expected_pull_request, ["url", "head_commit"]);
      if (action === "publish" ? command.expected_pull_request !== null :
        !expected || command.expected_pull_request?.url !== expected.url || command.expected_pull_request?.head_commit !== head) {
        throw fail("review_binding_changed", "Source controls must bind this session's exact retained PR and committed head.");
      }
      if ((action === "merge" && controls.review?.state !== "succeeded") || (action === "close" && controls.merge?.state !== "succeeded")) {
        throw fail("delivery_precondition_failed", "Complete exact human review before merge, and merged readback before terminal cleanup.");
      }
      if (action === "publish") await authorized(metadata, input.source_intent_ref, command.command_id, async () => {});
      controls[action] = { ...prior, command: structuredClone(command), command_id: command.command_id, command_digest: digest, state: "pending", requested_at: command.requested_at, failure: null };
      record.revision = revision(); await writeRecord(metadata.session, record);
      const control = controls[action];
      try {
        const effect = () => run(metadata, command.command_id, async () => {
          const bound = { ...sourceInput(metadata), expected_pull_request: expected };
          if (action === "publish") {
            control.validation = await sourceExecutor.prototypeSource.validateSource({ ...bound, expected_head: head });
            control.publication = await sourceExecutor.prototypeSource.publishAgentSource(bound);
            control.pull_request = await sourceExecutor.prototypeSource.inspectPullRequest(bound);
            if (control.pull_request?.state !== "open" || control.pull_request.head_commit !== head || !control.pull_request.url) throw fail("publication_unconfirmed", "Reconcile this same source PR before human review.");
          } else if (action === "review") {
            control.pull_request = await sourceExecutor.prototypeSource.approvePullRequest(bound);
          } else if (action === "merge") {
            control.pull_request = await sourceExecutor.prototypeSource.mergePullRequest(bound);
          } else {
            if (!metadata.source_intent_ref || typeof platform().stopSourceCredential !== "function") throw fail("source_stop_unavailable", "Exact owned credential revocation is required before completion.", { statusCode: 503 });
            control.revocation = await platform().stopSourceCredential({ callerId, operatorId, intentId: metadata.source_intent_ref, sessionId: metadata.session.session_id });
            control.cleanup = await sourceExecutor.prototypeSource.retireSourceResources({ ...bound, resources: metadata.resources });
            if (control.revocation.state !== "succeeded" || control.cleanup.complete !== true) throw fail("closure_pending", "Exact credential revocation or owned resource retirement is still pending; retained or unique source is never discarded.");
          }
        });
        if (action === "publish") await authorized(metadata, input.source_intent_ref, command.command_id, effect); else await effect();
        control.state = "succeeded"; control.completed_at = revision(); record.revision = control.completed_at; await writeRecord(metadata.session, record);
        if (action === "close") await store.transact(requestId, ({ current, put }) => put({ ...current, state: "succeeded", updated_at: metadataRevision(current) }));
        return read({ callerId, operatorId, requestId });
      } catch (error) {
        control.state = "unknown"; control.failure = failure(error); record.revision = revision(); await writeRecord(metadata.session, record); throw error;
      }
    });
  };
  const save = createOperatorDraftEditor({ enabled: configured,
    sessionFor: args => { const metadata = retainedSession(args); return { ...metadata.session, created_at: metadata.created_at }; },
    assertIdentity(session, callerId, operatorId) {
      if (session.caller_id !== callerId || session.operator.id !== operatorId) throw fail("identity_forbidden", "This source session belongs to another caller/operator.", { statusCode: 403 });
    },
    readRecord, writeRecord, withLock: (session, operation) => store.withActionLock(session.session_id, operation),
    putArtifact: (session, _name, value) => store.writeArtifact(session.source_request_id, value),
    readArtifact: (_session, reference) => store.readArtifact(reference),
    commitRecord: (session, record, command, commandDigest) => store.transact(session.source_request_id, ({ current, put }) => {
      if (current.session?.session_id !== session.session_id) throw fail("source_session_changed", "The source session changed before saving.");
      record.revision = metadataRevision(current);
      const acknowledgement = project(record, configured);
      const ackRef = store.writeArtifact(session.source_request_id, acknowledgement);
      record.operator_saves = [...(record.operator_saves ?? []), { command_id: command.command_id, command_digest: commandDigest, ack_ref: ackRef, ack_digest: canonicalDigest(acknowledgement) }];
      const reference = store.writeArtifact(session.source_request_id, record);
      put({ ...current, realization_ref: reference, state: "source-work", updated_at: record.revision });
      return acknowledgement;
    }),
    canonicalObjective: session => store.get(session.source_request_id).request.objective,
    assertEditable(session) {
      if (session.owner_preparation) throw fail("owner_change_set_invalid", "Trusted owner preparations remain inspect-only.");
    },
    async validateDraft(session, changeSet, command) {
      assertPrototypeChangeSet(changeSet, session);
      const metadata = store.get(session.source_request_id);
      const result = await run(metadata, command.command_id, () => sourceExecutor.prototypeSource.validateSourceRealization({ ...sourceInput(metadata), change_set: changeSet }));
      if (result?.valid !== true || result.session_id !== session.session_id || result.base_commit !== session.landing_unit.base_commit || result.change_set_digest !== canonicalDigest(changeSet)) {
        throw fail("validation_mismatch", "The source owner did not validate this exact Prototype draft.", { statusCode: 502 });
      }
    },
    nextRevision: record => new Date(Math.max(clock().getTime(), Date.parse(record.revision) + 1)).toISOString(),
    project: record => project(record, configured), clock, error: fail,
  });
  return { configured, read, startSession, generate, continue: apply("continue"), recover: apply("recover"),
    saveDraft({ callerId, operatorId, requestId, input }) {
      return save({ callerId, operatorId, subjectRef: { callerId, operatorId, requestId }, request: input });
    },
    async files({ callerId, operatorId, requestId, requestedPaths = [] }) {
      const metadata = retainedSession({ callerId, operatorId, requestId });
      if (metadata.session.owner_preparation) throw fail("owner_change_set_invalid", "Trusted owner preparations expose their exact retained draft only.");
      return run(metadata, `source-files:${metadata.session.session_id}`, () => sourceExecutor.prototypeSource.captureRealizationContext({
        ...sourceInput(metadata), requested_paths: requestedPaths, tree_only: requestedPaths.length === 0,
      }));
    },
    publish: deliver("publish"), review: deliver("review"), merge: deliver("merge"), close: deliver("close"),
    draft(args) {
      const metadata = retainedSession(args); const record = readRecord(metadata.session); const attempt = record.attempts.at(-1);
      if (!attempt?.change_set) throw fail("draft_missing", "No retained source draft is available for this request.", { statusCode: 404 });
      return { schema_version: 1, workflow_id: "prototype-source-draft", request_id: metadata.request.request_id, session_id: metadata.session.session_id, revision: record.revision,
        digest: attempt.change_set_digest, objective: metadata.request.objective, change_set: structuredClone(attempt.change_set), accepted: attempt.state === "source-created",
        operator_draft: attempt.operator_draft ? structuredClone(attempt.operator_draft) : null };
    },
    cancelAttempt: ({ callerId, operatorId, requestId, input }) => actions.cancel({ callerId, operatorId, subjectRef: { callerId, operatorId, requestId }, request: input }) };
}
