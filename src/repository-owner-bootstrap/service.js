import { HttpError } from "../errors.js";
import { canonicalDigest } from "../delivery-art/canonical-json.js";
import { createBoundedSourceActions, normalizeBoundedSourceCommand } from "../source-authoring/bounded-actions.js";
import { assertSourceCredentialTimestamp, SOURCE_INTENT_REFERENCE } from "../platform-operation/source-credentials.js";
import { bootstrapSourceSession, bootstrapSourceChangeSet } from "./session.js";
import { inspectExistingSourceOwnerControls, sourceOwnerBootstrapPaths } from "./scaffold.js";

const ID = /^[A-Za-z0-9][A-Za-z0-9._:/@+\-]{0,255}$/;
const fail = (code, message, options = {}) => new HttpError(options.statusCode ?? 409, `repository_owner_bootstrap_${code}`, message);
const closed = (value, fields) => {
  if (!value || Array.isArray(value) || Object.keys(value).length !== fields.length || fields.some(field => !Object.hasOwn(value, field))) {
    throw fail("command_invalid", "Use only the exact bounded bootstrap command fields.", { statusCode: 400 });
  }
};
const timestamp = value => assertSourceCredentialTimestamp(value, "requested_at");
const sourceIntent = value => { if (!SOURCE_INTENT_REFERENCE.test(value ?? "")) throw fail("source_intent_invalid", "Select this request's explicitly approved bootstrap source intent."); };
const failure = error => ({ code: typeof error?.code === "string" ? error.code : "repository_owner_bootstrap_effect_unknown",
  message: "Reconcile the original retained bootstrap operation; no replacement source effect is authorized.", retryable: Number(error?.statusCode ?? 500) >= 500 });

// Bounded source-only owner workflow. No model client, ART writer, admission
// writer, runtime launcher or repository-provisioning capability is accepted.
export function createRepositoryOwnerBootstrapService({ callerOperatorBindings, preparationService, sourceExecutor, platformOperations, store,
  sourceReader = null, clock = () => new Date(), enabled = false }) {
  if (typeof preparationService?.prepare !== "function" || typeof preparationService?.verify !== "function" ||
      typeof sourceExecutor?.executor?.run !== "function" || typeof sourceExecutor?.bootstrapSource?.inspectSourceCredentialBinding !== "function") {
    throw new TypeError("Bootstrap requires the real proposed/custody preparation owner and typed isolated source executor.");
  }
  const revision = current => new Date(Math.max(clock().getTime(), Date.parse(current?.updated_at ?? "1970-01-01") + 1)).toISOString();
  function active() {
    if (!enabled) throw fail("runtime_unavailable", "Bootstrap awaits its exact reviewed source composition; no engineering fallback is substituted.", { statusCode: 503 });
  }
  function identity(callerId, operatorId) {
    if (!callerId || callerOperatorBindings?.[callerId] !== operatorId) throw fail("identity_forbidden", "The caller is not bound to this bootstrap operator.", { statusCode: 403 });
  }
  function retained({ callerId, operatorId, requestId }) {
    identity(callerId, operatorId);
    const record = store.get(requestId);
    if (!record || record.caller_id !== callerId || record.operator_id !== operatorId) throw fail("not_found", "Caller-owned bootstrap request was not found.", { statusCode: 404 });
    return record;
  }
  const prepared = record => store.readArtifact(record.preparation_ref);
  const sourceInput = record => ({ owner_repo: record.binding.owner_repo, session: record.session, plan: prepared(record).plan });
  const run = (record, commandId, operation) => sourceExecutor.executor.run({ caller_id: record.caller_id, operator_id: record.operator_id,
    owner_repo: record.binding.owner_repo, bootstrap_request_id: record.request.request_id,
    session_id: record.session?.session_id ?? null, command_id: commandId }, operation);
  const platform = () => {
    const value = typeof platformOperations === "function" ? platformOperations() : platformOperations;
    if (!["ensureSourceCredential", "withSourceLease", "stopSourceCredential"].every(method => typeof value?.[method] === "function")) {
      throw fail("source_authority_unavailable", "The existing Platform source-intent authority is not commissioned.", { statusCode: 503 });
    }
    return value;
  };
  function realization(record) {
    return record.realization_ref ? store.readArtifact(record.realization_ref) : null;
  }
  function projection(record, { detailed = true } = {}) {
    const source = detailed ? realization(record) : null, attempt = source?.attempts?.at(-1) ?? null, delivery = attempt?.source_delivery ?? {};
    const code = record.state === "cancelled" ? "owner-bootstrap-cancelled" : record.cancellation ? "owner-bootstrap-cancellation-recovery-required"
      : record.state === "succeeded" ? "owner-bootstrap-complete-application-unproven" : !record.session
      ? record.existing_checkout ? "owner-bootstrap-existing-checkout-recovery-required" : "owner-bootstrap-existing-checkout-required"
      : delivery.merge?.state === "succeeded" ? "owner-bootstrap-close-required" : delivery.review?.state === "succeeded" ? "owner-bootstrap-merge-required"
        : delivery.publish?.state === "succeeded" ? "owner-bootstrap-human-review-required" : attempt?.state === "source-created" ? "owner-bootstrap-publish-required"
          : ["applying", "apply-unknown"].includes(attempt?.state) ? "owner-bootstrap-recovery-required"
            : !record.resources ? "owner-bootstrap-authorization-and-start-required" : "owner-bootstrap-draft-acceptance-required";
    return { schema_version: 1, workflow_id: "repository-owner-bootstrap", request_id: record.request.request_id,
      owner_repo: record.binding.owner_repo, state: record.state, revision: record.updated_at,
      created_at: record.created_at, updated_at: record.updated_at, session_id: record.session?.session_id ?? null,
      source_intent_ref: record.source_intent_ref ?? null, source_start_digest: record.binding.source_start_digest,
      next_action: { code: detailed ? code : "owner-bootstrap-inspect-original-request", authority: "operator-orchestration-service" },
      ...(detailed ? { request: structuredClone(record.request), binding: structuredClone(record.binding), source_delivery: structuredClone(delivery),
        draft: attempt ? { state: attempt.state, revision: source.revision, digest: attempt.change_set_digest, failure: attempt.failure ?? null,
          source_receipt: attempt.source_receipt ?? null,
          files: attempt.change_set.operations.map(({ content, ...file }) => ({ ...file, content_digest: canonicalDigest(content) })) } : null,
        existing_owner_controls: structuredClone(prepared(record).existing_owner_controls ?? null) } : {}),
      ...(detailed ? { prepared_source_intent_refs: structuredClone(record.prepared_source_intent_refs ?? []),
        ...(record.cancellation ? { cancellation: structuredClone(record.cancellation) } : {}) } : {}),
      ...(detailed && record.existing_checkout ? { existing_checkout: structuredClone(record.existing_checkout) } : {}),
      app_acceptance: false, inventory_admission: false, runtime_activation: false };
  }
  async function create({ callerId, operatorId, input }) {
    identity(callerId, operatorId);
    closed(input, ["schema_version", "request_id", "preparation_input", "expected_preparation_digest", "workflow_approval_ref", "requested_at"]);
    active();
    if (input.schema_version !== 1 || !ID.test(input.request_id ?? "") || !/^sha256:[0-9a-f]{64}$/.test(input.expected_preparation_digest ?? "") ||
        Buffer.byteLength(JSON.stringify(input)) > 73_728) throw fail("request_invalid", "Bootstrap request identity, exact preparation and size are required.");
    timestamp(input.requested_at);
    if (Date.parse(input.requested_at) > clock().getTime()) throw fail("request_invalid", "Bootstrap request time is in the future.");
    const request = structuredClone(input), requestDigest = canonicalDigest({ caller_id: callerId, operator_id: operatorId, request });
    return store.withOwnerLock(request.preparation_input?.owner_repo, () => store.transact(request.request_id, async ({ current, put }) => {
      if (current) {
        if (current.caller_id !== callerId || current.operator_id !== operatorId || current.request_digest !== requestDigest) throw fail("request_conflict", "Bootstrap request identity is already bound to another immutable request.");
        return projection(current);
      }
      if (store.pendingForOwner(request.preparation_input.owner_repo)) throw fail("owner_request_pending", "Recover the existing pending owner-bootstrap request before creating another.");
      const preparation = await preparationService.prepare({ callerId, operatorId, input: request.preparation_input });
      if (preparation.preparation_digest !== request.expected_preparation_digest) throw fail("preparation_stale", "Current proposed owner or provider source differs from the preparation reviewed by this operator.");
      const session = preparation.plan ? bootstrapSourceSession({ requestDigest, requestId: request.request_id, callerId, operatorId,
        preparation, workflowApprovalRef: request.workflow_approval_ref }) : null;
      if (!session && request.workflow_approval_ref !== null) throw fail("request_invalid", "An existing-controls inspection cannot request an unused workflow credential.");
      let identityMetadata = null;
      const metadata = { caller_id: callerId, operator_id: operatorId, request, session,
        binding: { owner_repo: request.preparation_input.owner_repo }, preparation_ref: store.writeArtifact(request.request_id, preparation) };
      if (session) identityMetadata = await run(metadata, null, () => sourceExecutor.bootstrapSource.inspectSourceCredentialBinding({ owner_repo: session.owner_repo, session, plan: preparation.plan }));
      const binding = { owner_repo: request.preparation_input.owner_repo, provider_repository: preparation.owner_authority.provider_repository,
        intake_entry_ref: preparation.owner_authority.intake_entry_ref, preparation_digest: preparation.preparation_digest,
        source_start_digest: canonicalDigest({ request_digest: requestDigest, preparation_digest: preparation.preparation_digest }),
        source_identity: identityMetadata };
      const now = revision();
      let source = null;
      if (session) {
        const changeSet = bootstrapSourceChangeSet(preparation.plan, session);
        source = { schema_version: 1, session_id: session.session_id, revision: now, attempts: [{ request_id: request.request_id,
          state: "draft-ready", requested_at: request.requested_at, completed_at: now, change_set: changeSet,
          change_set_digest: canonicalDigest(changeSet), objective_digest: session.objective_digest, source_receipt: null, failure: null }] };
      }
      const record = put({ ...metadata, schema_version: 1, artifact_type: "repository-owner-bootstrap-record", request_digest: requestDigest,
        binding, binding_digest: canonicalDigest(binding), state: session ? "prepared" : "existing-controls-inspected",
        source_intent_ref: null, resources: null, realization_ref: source ? store.writeArtifact(request.request_id, source) : null,
        created_at: now, updated_at: now });
      return projection(record);
    }));
  }
  async function credentialPlan({ callerId, operatorId, subject, decision = null, record: credentialRecord = null, intentId = null }) {
    active();
    if (subject?.kind !== "repository-bootstrap" || decision !== null) throw fail("credential_selector_invalid", "Use the actual bootstrap request, not an ART decision or ordinary source subject.");
    const record = retained({ callerId, operatorId, requestId: subject.source_request_id });
    if (!record.session || record.binding.owner_repo !== subject.owner_repo || record.cancellation || ["succeeded", "cancelled"].includes(record.state)) throw fail("source_closed", "This bootstrap request has no open source purpose.");
    await preparationService.verify({ callerId, operatorId, preparation: prepared(record) });
    const metadata = await run(record, null, () => sourceExecutor.bootstrapSource.inspectSourceCredentialBinding(sourceInput(record)));
    if (canonicalDigest(metadata) !== canonicalDigest(record.binding.source_identity) ||
        (credentialRecord && credentialRecord.proof?.source_request_digest !== record.request_digest)) throw fail("source_identity_changed", "Current bootstrap source identity no longer matches this retained request.");
    if (intentId !== null && !credentialRecord) {
      sourceIntent(intentId);
      await store.transact(record.request.request_id, ({ current, put }) => {
        if (current.cancellation || ["succeeded", "cancelled"].includes(current.state)) throw fail("source_closed", "This bootstrap request stopped before source preparation completed.");
        const refs = current.prepared_source_intent_refs ?? [];
        if (!refs.includes(intentId)) put({ ...current, prepared_source_intent_refs: [...refs, intentId], updated_at: revision(current) });
      });
    }
    return { purpose: "trusted-owner-bootstrap", subject: structuredClone(record.session.subject),
      source_start_digest: record.binding.source_start_digest, session_id: record.session.session_id,
      repository: metadata.repository, repository_id: metadata.repository_id, installation_id: metadata.installation_id,
      human_reviewer_id: metadata.human_reviewer_id, landing_unit_id: record.session.landing_unit_id,
      branch: record.session.landing_unit.branch, fetched_base: record.session.landing_unit.base_commit,
      proof: { source_request_digest: record.request_digest, rotate_before_expiry_seconds: metadata.rotate_before_expiry_seconds } };
  }
  async function authorized(record, reference, commandId, operation) {
    sourceIntent(reference);
    const scope = { callerId: record.caller_id, operatorId: record.operator_id, intentId: reference,
      sessionId: record.session.session_id, requestedStartDigest: record.binding.source_start_digest };
    await platform().ensureSourceCredential({ ...scope, previousIntentId: record.source_intent_ref && record.source_intent_ref !== reference ? record.source_intent_ref : null });
    return platform().withSourceLease({ ...scope, operation: async assertLease => {
      await store.transact(record.request.request_id, ({ current, put }) => put({ ...current, source_intent_ref: reference, updated_at: revision(current) }));
      return sourceExecutor.executor.withSourceLeaseGuard(assertLease, () => run(record, commandId, operation));
    } });
  }
  function requireSession(args) {
    const record = retained(args);
    if (!record.session) throw fail("source_not_required", "Existing owner controls require no bootstrap PR or source credential.");
    return record;
  }
  async function writeRealization(session, value) {
    await store.transact(session.source_request_id, ({ current, put }) => {
      if (current.session?.session_id !== session.session_id) throw fail("source_session_changed", "Retained bootstrap session changed.");
      value.revision = revision(current);
      put({ ...current, realization_ref: store.writeArtifact(session.source_request_id, value),
        state: value.attempts.at(-1).state === "source-created" ? "source-created" : current.state, updated_at: value.revision });
    });
  }
  const actions = createBoundedSourceActions({ configured: enabled, revision: () => clock().toISOString(),
    project: record => ({ revision: record.revision, state: record.attempts.at(-1)?.state }),
    readRecord: session => realization(store.get(session.source_request_id)), writeRecord: writeRealization,
    boundedFailure: failure, error: fail,
    assertCommand: (value, action) => { timestamp(value?.requested_at); timestamp(value?.expected_revision); return normalizeBoundedSourceCommand(value, action, fail); },
    assertIdentity: (session, callerId, operatorId) => {
      if (session.caller_id !== callerId || session.operator.id !== operatorId) throw fail("identity_forbidden", "Bootstrap source belongs to another caller/operator.", { statusCode: 403 });
    },
    sessionFor: async args => requireSession(args).session,
    store: { withLock: (key, operation) => store.withActionLock(key.slice("source-realization:".length), operation) },
    sourceAdapter: { applySourceRealization: (session, changeSet) => sourceExecutor.bootstrapSource.applySourceRealization({
      ...sourceInput(store.get(session.source_request_id)), change_set: changeSet }) },
  });
  async function start({ callerId, operatorId, requestId, input }) {
    active();
    closed(input, ["schema_version", "command_id", "source_intent_ref", "requested_at"]); timestamp(input.requested_at); sourceIntent(input.source_intent_ref);
    if (input.schema_version !== 1 || !ID.test(input.command_id ?? "") || Date.parse(input.requested_at) > clock().getTime()) throw fail("command_invalid", "Use the current exact bootstrap start command.");
    const record = requireSession({ callerId, operatorId, requestId });
    return store.withActionLock(record.session.session_id, async () => {
      if (!record.resources) {
        const owned = await authorized(record, input.source_intent_ref, input.command_id, () => sourceExecutor.bootstrapSource.ensureOwnedWorktree(sourceInput(record)));
        await store.transact(requestId, ({ current, put }) => put({ ...current, resources: owned.resources, state: "source-work", updated_at: revision(current) }));
        await writeRealization(record.session, realization(store.get(requestId)));
      }
      return projection(retained({ callerId, operatorId, requestId }));
    });
  }
  const apply = action => async ({ callerId, operatorId, requestId, input }) => {
    active();
    closed(input, ["command", "source_intent_ref"]); sourceIntent(input.source_intent_ref);
    const args = { callerId, operatorId, requestId }, record = requireSession(args);
    const command = { callerId, operatorId, subjectRef: args, request: input.command };
    if (await actions.readCompletedCommand({ ...command, action })) return projection(retained(args));
    if (!record.resources) throw fail("source_start_required", "Start this exact approved bootstrap source session before applying its draft.");
    await authorized(record, input.source_intent_ref, input.command.command_id, () => actions[action](command));
    return projection(retained(args));
  };
  const deliver = action => async ({ callerId, operatorId, requestId, input }) => {
    active();
    closed(input, action === "publish" ? ["command", "source_intent_ref"] : ["command"]);
    if (action === "publish") sourceIntent(input.source_intent_ref);
    const command = input.command;
    closed(command, ["schema_version", "command_id", "expected_revision", "requested_at", "expected_pull_request"]);
    timestamp(command.requested_at); timestamp(command.expected_revision);
    if (command.schema_version !== 1 || !ID.test(command.command_id ?? "")) throw fail("command_invalid", "Use an exact bootstrap source control command.");
    const args = { callerId, operatorId, requestId }, record = requireSession(args);
    return store.withActionLock(record.session.session_id, async () => {
      const source = realization(store.get(requestId)), attempt = source.attempts.at(-1), digest = canonicalDigest(command);
      if (attempt?.state !== "source-created") throw fail("source_not_created", "Accept and reconcile the exact trusted draft before publication or review.");
      attempt.source_delivery ??= {};
      const controls = attempt.source_delivery, prior = controls[action];
      if (prior) {
        if (prior.command_id !== command.command_id || prior.command_digest !== digest) throw fail("replay_conflict", "Recover the original retained source control, not a replacement command.");
        if (prior.state === "succeeded") return projection(retained(args));
      } else if (source.revision !== command.expected_revision || Date.parse(command.requested_at) < Date.parse(attempt.requested_at) || Date.parse(command.requested_at) > clock().getTime()) {
        throw fail("revision_stale", "Bootstrap control must bind the current source revision and timeline.");
      }
      const expected = controls.publish?.pull_request ?? null;
      if (action === "publish" ? command.expected_pull_request !== null : !expected ||
          command.expected_pull_request?.url !== expected.url || command.expected_pull_request?.head_commit !== attempt.source_receipt.head_commit) {
        throw fail("review_changed", "Bootstrap controls must bind this exact retained PR and committed head.");
      }
      if ((action === "merge" && controls.review?.state !== "succeeded") || (action === "close" && controls.merge?.state !== "succeeded")) throw fail("delivery_precondition_failed", "Human review precedes merge; merged readback precedes closure.");
      const control = controls[action] = { command: structuredClone(command), command_id: command.command_id, command_digest: digest, state: "pending", failure: null };
      await writeRealization(record.session, source);
      try {
        const effect = () => run(record, command.command_id, async () => {
          const bound = { ...sourceInput(record), expected_pull_request: expected };
          if (action === "publish") {
            control.validation = await sourceExecutor.bootstrapSource.validateSource({ ...bound, expected_head: attempt.source_receipt.head_commit });
            control.publication = await sourceExecutor.bootstrapSource.publishAgentSource(bound);
            control.pull_request = await sourceExecutor.bootstrapSource.inspectPullRequest(bound);
            if (control.pull_request?.state !== "open" || control.pull_request.head_commit !== attempt.source_receipt.head_commit || !control.pull_request.url) throw fail("publication_unconfirmed", "Reconcile this same exact bootstrap PR.");
          } else if (action === "review") control.pull_request = await sourceExecutor.bootstrapSource.approvePullRequest(bound);
          else if (action === "merge") control.pull_request = await sourceExecutor.bootstrapSource.mergePullRequest(bound);
          else {
            control.revocation = await platform().stopSourceCredential({ callerId, operatorId, intentId: record.source_intent_ref, sessionId: record.session.session_id });
            if (control.revocation.state !== "succeeded") throw fail("revocation_pending", "Exact credential revocation must complete before source retirement.");
            control.cleanup = await sourceExecutor.bootstrapSource.retireSourceResources({ ...bound, resources: record.resources });
            if (control.cleanup.complete !== true) throw fail("cleanup_pending", "Owned source resources remain; preserve unique work and reconcile the same request.");
          }
        });
        if (action === "publish") await authorized(record, input.source_intent_ref, command.command_id, effect); else await effect();
        control.state = "succeeded"; await writeRealization(record.session, source);
        if (action === "close") await store.transact(requestId, ({ current, put }) => put({ ...current, state: "succeeded", updated_at: revision(current) }));
        return projection(retained(args));
      } catch (error) { control.state = "unknown"; control.failure = failure(error); await writeRealization(record.session, source); throw error; }
    });
  };
  return {
    async ownerReadiness({ callerId, operatorId, ownerRepo, providerRepository }) {
      identity(callerId, operatorId);
      if (typeof sourceReader?.inspect !== "function") throw fail("owner_readiness_unavailable", "Actual provider source-readiness inspection is not commissioned.", { statusCode: 503 });
      const completed = store.latestCompletedForOwner(ownerRepo, providerRepository);
      if (!completed) throw fail("owner_controls_required", "Complete the existing owner bootstrap or non-source checkout workflow before source-only admission.");
      const record = realization(completed), native = completed.session ? record?.attempts.at(-1)?.source_delivery?.close?.cleanup?.readback
        : completed.existing_checkout?.receipt;
      const { receipt_digest: nativeDigest, ...nativeBody } = native ?? {};
      if (!native || native.schema_version !== 1 || nativeDigest !== canonicalDigest(nativeBody) || native.owner_repo !== ownerRepo ||
          canonicalDigest(native.provider_repository) !== canonicalDigest(providerRepository) || native.app_acceptance !== false ||
          native.inventory_admission !== false || native.runtime_activation !== false || !/^[0-9a-f]{40}$/.test(native.canonical_commit ?? "") ||
          (completed.session ? native.session_id !== completed.session.session_id || native.plan_digest !== prepared(completed).plan.plan_digest
            : native.source_request_id !== completed.request.request_id) ||
          native.evidence_profile_digest !== (completed.session ? prepared(completed).plan.evidence_profile_digest
            : prepared(completed).existing_owner_controls.evidence_profile_digest)) throw fail("owner_readiness_unproven", "The completed request does not carry its actual canonical owner-controls readback.");
      const inspected = await sourceReader.inspect({ providerRepository, paths: sourceOwnerBootstrapPaths(true) });
      if (inspected.visibility !== "public" || inspected.default_branch !== "main") throw fail("owner_readiness_unqualified", "Private/client source readiness is not qualified by the current public route.");
      const controls = inspectExistingSourceOwnerControls({ ownerRepo, fetchedBase: inspected.fetched_base, observedFiles: inspected.observed_files });
      if (!controls || controls.source_change_required || controls.evidence_profile_digest !== native.evidence_profile_digest) throw fail("owner_controls_changed", "Current actual owner controls differ from the completed proof; reinspect the existing owner for bounded control repair before admission.");
      const body = { schema_version: 1, scope: "source-owner-controls-readiness", owner_repo: ownerRepo,
        provider_repository: structuredClone(providerRepository), fetched_base: inspected.fetched_base,
        canonical_checkout_commit: native.canonical_commit, evidence_profile_digest: controls.evidence_profile_digest,
        source_request_ref: `oos://repository-owner-bootstrap/requests/${encodeURIComponent(completed.request.request_id)}`,
        source_request_revision: completed.updated_at, app_acceptance: false, inventory_admission: false, runtime_activation: false };
      return { ...body, receipt_digest: canonicalDigest(body) };
    },
    create, start, accept: apply("continue"), recover: apply("recover"),
    publish: deliver("publish"), review: deliver("review"), merge: deliver("merge"), close: deliver("close"),
    prepareSourceCredential: credentialPlan,
    verifySourceCredential: args => credentialPlan({ ...args, subject: args.record.request.subject }),
    async materializeExisting({ callerId, operatorId, requestId, input }) {
      active();
      closed(input, ["schema_version", "command_id", "expected_revision", "requested_at"]); timestamp(input.requested_at); timestamp(input.expected_revision);
      if (input.schema_version !== 1 || !ID.test(input.command_id ?? "") || Date.parse(input.requested_at) > clock().getTime()) throw fail("command_invalid", "Use the exact current non-source checkout command.");
      const args = { callerId, operatorId, requestId }, record = retained(args);
      if (record.state === "cancelled") throw fail("source_closed", "A cancelled request cannot be reopened by checkout recovery.");
      if (record.session) throw fail("existing_controls_required", "This request needs its real reviewed bootstrap, not an existing-owner shortcut.");
      return store.withActionLock(requestId, async () => {
        const current = retained(args), digest = canonicalDigest(input), previous = current.existing_checkout;
        if (previous) {
          if (previous.command_digest !== digest) throw fail("replay_conflict", "Recover this exact existing-owner checkout command.");
          if (previous.state === "succeeded") return projection(current);
        } else if (input.expected_revision !== current.updated_at) throw fail("revision_stale", "Inspect current existing-owner preparation before checkout.");
        await preparationService.verify({ callerId, operatorId, preparation: prepared(current) });
        await store.transact(requestId, ({ current, put }) => put({ ...current,
          existing_checkout: { command: structuredClone(input), command_digest: digest, state: "pending" }, updated_at: revision(current) }));
        try {
          const receipt = await run(current, input.command_id, () => sourceExecutor.bootstrapSource.materializeExistingOwner({ owner_repo: current.binding.owner_repo,
            bootstrap_request_id: requestId, preparation: prepared(current) }));
          await store.transact(requestId, ({ current, put }) => put({ ...current, state: "succeeded",
            existing_checkout: { ...current.existing_checkout, state: "succeeded", receipt }, updated_at: revision(current) }));
        } catch (error) {
          await store.transact(requestId, ({ current, put }) => put({ ...current,
            existing_checkout: { ...current.existing_checkout, state: "unknown", failure: failure(error) }, updated_at: revision(current) }));
          throw error;
        }
        return projection(retained(args));
      });
    },
    async cancelUnapplied({ callerId, operatorId, requestId, input }) {
      closed(input, ["schema_version", "command_id", "expected_revision", "requested_at", "reason"]);
      timestamp(input.requested_at); timestamp(input.expected_revision);
      if (input.schema_version !== 1 || !ID.test(input.command_id ?? "") || typeof input.reason !== "string" ||
          input.reason.trim().length < 20 || input.reason.length > 4096 || Date.parse(input.requested_at) > clock().getTime()) throw fail("command_invalid", "Cancel only with the exact current command and explicit bounded reason.");
      const args = { callerId, operatorId, requestId }, record = retained(args);
      return store.withActionLock(record.session?.session_id ?? requestId, async () => {
        const current = retained(args), digest = canonicalDigest(input), previous = current.cancellation;
        if (previous) {
          if (previous.command_digest !== digest) throw fail("replay_conflict", "Recover the original accepted cancellation command.");
          if (previous.state === "succeeded") return projection(current);
        } else if (current.updated_at !== input.expected_revision || current.state === "succeeded" ||
            (current.existing_checkout && current.existing_checkout.state !== "succeeded") ||
            (current.session && realization(current)?.attempts.at(-1)?.state !== "draft-ready")) {
          throw fail("cancel_not_allowed", "Cancel only an unapplied draft or untouched inspection; recover uncertain source/checkout or review committed source instead.");
        }
        await store.transact(requestId, ({ current, put }) => put({ ...current,
          cancellation: { command: structuredClone(input), command_digest: digest, state: "pending" }, updated_at: revision(current) }));
        const cancellations = [];
        try {
          for (const reference of new Set([...(current.prepared_source_intent_refs ?? []), ...(current.source_intent_ref ? [current.source_intent_ref] : [])])) {
            let authorization;
            try { authorization = await platform().readSourcePreparation({ callerId, intentId: reference }); }
            catch (error) {
              if (error?.statusCode !== 404 || error?.code !== "platform_source_intent_not_found") throw error;
              // The canonical stop serializes with an in-flight preparation.
              // Only an authoritative absence after that lock proves no issue
              // was possible. Any late record must be inspected normally.
              const stopped = await platform().stopUnissuedSourcePreparation({ callerId, operatorId, intentId: reference });
              if (stopped?.state === "not-prepared" && stopped.credential_issued === false) {
                cancellations.push({ intent_id: reference, outcome: "preparation-not-retained" });
                continue;
              }
              authorization = stopped;
            }
            if (canonicalDigest(authorization.source_intent.subject) !== canonicalDigest(current.session.subject) ||
                authorization.source_intent.source_start_digest !== current.binding.source_start_digest) throw fail("source_authorization_changed", "Stop only the exact authorization derived for this bootstrap request.");
            if (authorization.authorization.approval_ref === null && authorization.authorization.credential_receipt === null) {
              await platform().stopUnissuedSourcePreparation({ callerId, operatorId, intentId: reference });
              cancellations.push({ intent_id: reference, outcome: "unissued-preparation-stopped" });
            } else {
              const stopped = await platform().stopSourceCredential({ callerId, operatorId, intentId: reference, sessionId: current.session.session_id });
              if (stopped.state !== "succeeded") throw fail("revocation_pending", "Original owned credential revocation remains pending.");
              cancellations.push({ intent_id: reference, outcome: "revoked" });
            }
          }
          const cleanup = current.session ? await run(current, input.command_id, () => sourceExecutor.bootstrapSource.retirePristineResources({
            ...sourceInput(current), resources: current.resources })) : { complete: true, source_resources_created: false };
          if (cleanup.complete !== true) throw fail("cleanup_pending", "Pristine owned source retirement is unfinished; preserve source and recover this same cancellation.");
          await store.transact(requestId, ({ current, put }) => put({ ...current, state: "cancelled", cancellation: {
            ...current.cancellation, state: "succeeded", source_authorizations: cancellations, cleanup }, updated_at: revision(current) }));
          return projection(retained(args));
        } catch (error) {
          await store.transact(requestId, ({ current, put }) => put({ ...current,
            cancellation: { ...current.cancellation, state: "unknown", failure: failure(error) }, updated_at: revision(current) }));
          throw error;
        }
      });
    },
    read: args => projection(retained(args)),
    draft(args) {
      const record = requireSession(args), source = realization(record), attempt = source.attempts.at(-1);
      return { schema_version: 1, workflow_id: "repository-owner-bootstrap-draft", request_id: record.request.request_id,
        revision: source.revision, digest: attempt.change_set_digest, change_set: structuredClone(attempt.change_set) };
    },
    list({ callerId, operatorId, ownerRepo, limit = 25 }) {
      identity(callerId, operatorId);
      if (!/^[a-z0-9][a-z0-9._-]*$/.test(ownerRepo ?? "")) throw fail("list_invalid", "Select one exact owner for cold bootstrap recovery.", { statusCode: 400 });
      const pending = store.pendingForOwner(ownerRepo);
      return { schema_version: 1, workflow_id: "repository-owner-bootstrap-list", owner_repo: ownerRepo,
        pending_request: pending?.caller_id === callerId && pending.operator_id === operatorId ? projection(pending, { detailed: false }) : null,
        records: store.list({ callerId, ownerRepo, limit }).filter(record => record.operator_id === operatorId).map(record => projection(record, { detailed: false })) };
    },
  };
}
