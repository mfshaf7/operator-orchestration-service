import { HttpError } from "../errors.js";
import { intakeDigest } from "../workspace-intake/contracts.js";
import { bindWorkspaceIntakeSourceCandidate } from "../workspace-intake/source-candidate.js";
import { repositoryCustodyIntakeAuthority, repositoryCustodyIntakeCandidate } from "../repository-custody/intake-source.js";
import { assertInstanceIntakeRequest, assertInstanceIntakeDecision } from "./contracts.js";

const TERMINAL = new Set(["succeeded", "cancelled", "rejected", "requires-action"]);
const fail = (code, message, status = 409) => new HttpError(status, `workspace_intake_${code}`, message);
const name = value => typeof value === "string" && /^[a-z0-9][a-z0-9._-]{0,185}$/.test(value);

function targetFor(value) {
  if (!value || value.kind !== "repo" || !name(value.name)) throw fail("preparation_invalid", "Select one repository registration.", 400);
  return { kind: "repo", name: value.name, record_id: `repo:${value.name}` };
}

function assertCaller(record, callerId) {
  if (!record || record.caller_id !== callerId) throw fail("not_found", "Saved registration was not found.", 404);
  if (record.authority_kind !== "internal-instance-record" || record.binding_digest !== intakeDigest({ caller_id: callerId, evaluation: record.evaluation })) {
    throw fail("storage_invalid", "Saved registration failed its original command binding.", 503);
  }
}

function result(record) {
  const complete = record.status === "succeeded";
  return { schema_version: 1, workflow_id: "workspace-intake", authority_kind: "internal-instance-record",
    canonical_authority: record.canonical_authority, request_id: record.request.request_id,
    request: record.request, decision: record.evaluation.decision,
    session_ref: record.evaluation.session_ref, execution_ref: record.evaluation.execution_ref,
    status: record.status, revision: record.history.length, history: record.history,
    next_action: complete || record.status === "cancelled" ? "complete" : record.status === "requires-action" ? "submit-corrected-request"
      : record.failure ? "restore-dependency-and-retry" : "continue",
    canonical_mutation: complete, review: null, readiness: null,
    readback: record.native_result, receipt: record.native_result?.receipt ?? null,
    failure: record.failure, source_attestation: record.source_attestation,
    cancel_allowed: !TERMINAL.has(record.status) && !record.commit_attempted };
}

export function createInstanceIntakeService({ instanceId, journal, reader, writer, custodySourceReader,
  sourceOwnerReadinessReader = null, legacyRequestReader = async () => null, enabled = true, clock = () => new Date() }) {
  const active = () => { if (!enabled) throw fail("internal_registration_disabled", "Internal registration writes are disabled; saved history is retained.", 503); };
  async function custody(callerId, requestId, target, requestedRecord, originalSource = null) {
    const source = await custodySourceReader(requestId, { callerId });
    const authority = repositoryCustodyIntakeAuthority({ result: source, target });
    let candidate = repositoryCustodyIntakeCandidate({ result: source, target, requestedRecord });
    if (originalSource) {
      const { candidate_digest: _digest, ...body } = candidate;
      candidate = bindWorkspaceIntakeSourceCandidate({ ...body, source: originalSource });
    }
    return { authority, candidate };
  }
  async function prepare({ callerId, input }) {
    if (!input || Object.keys(input).some(key => !["target", "repository_custody"].includes(key))) throw fail("preparation_invalid", "Prepare one target and its repository connection.", 400);
    const target = targetFor(input?.target);
    const state = await reader.prepare(target.name);
    if (state.canonical_authority.kind === "legacy-git") return state;
    active();
    if (state.current?.record.phase === "inventory") throw fail("already_registered", "This repository is already registered; use its management actions.");
    const selected = input.repository_custody;
    if (!selected || typeof selected.request_id !== "string" || !selected.request_id.trim() || selected.requested_record?.kind !== "repo") {
      throw fail("custody_required", "Create or link the repository before its private registration.", 400);
    }
    const original = state.current?.record.record?.source ?? null;
    const { candidate } = await custody(callerId, selected.request_id, target, selected.requested_record, original);
    return { schema_version: 1, workflow_id: "workspace-intake", authority_kind: "internal-instance-record",
      authority_revision: state.policy_ref.revision, canonical_authority: state.canonical_authority,
      policy_ref: state.policy_ref, expected_state: state.expected_state, target,
      source_candidate: candidate, custody_request_id: selected.request_id, canonical_mutation: false };
  }
  async function submit({ callerId, input }) {
    active();
    if (!input || Object.keys(input).sort().join(",") !== "authority_revision,decision,execution_ref,request,session_ref") {
      throw fail("command_invalid", "Use the exact reviewed registration command.", 400);
    }
    const request = assertInstanceIntakeRequest(input.request, instanceId);
    assertInstanceIntakeDecision(request, input.decision, callerId);
    if (input.authority_revision !== request.policy_ref.revision ||
        ![input.session_ref, input.execution_ref].every(value => typeof value === "string" && value.trim())) {
      throw fail("command_invalid", "The registration must bind its policy and original workflow references.", 400);
    }
    const evaluation = structuredClone(input), binding = intakeDigest({ caller_id: callerId, evaluation });
    return journal.transact(request.request_id, async tx => {
      if (await legacyRequestReader(request.request_id)) throw fail("request_conflict", "This identity belongs to its original source-backed request.");
      if (tx.current) {
        assertCaller(tx.current, callerId);
        if (tx.current.binding_digest !== binding) throw fail("idempotency_conflict", "The saved request belongs to different reviewed input.");
        return result(tx.current);
      }
      const state = await reader.prepare(request.target.name);
      if (state.canonical_authority.kind !== "internal-instance-record" ||
          intakeDigest(state.expected_state) !== intakeDigest(request.expected_state) || intakeDigest(state.policy_ref) !== intakeDigest(request.policy_ref)) {
        throw fail("review_stale", "Registration changed after review; refresh its current state.");
      }
      if (state.current?.record.phase === "inventory") throw fail("already_registered", "This repository is already registered; use its management actions.");
      if (state.current && intakeDigest(state.current.record.record?.source) !== intakeDigest(request.source)) throw fail("source_changed", "Keep the original registration source.");
      const { candidate, authority } = await custody(callerId, request.custody_request_id, request.target,
        request.requested_record, state.current?.record.record?.source ?? null);
      if (intakeDigest(candidate.source) !== intakeDigest(request.source) || intakeDigest(candidate.requested_record) !== intakeDigest(request.requested_record)) {
        throw fail("source_mismatch", "The reviewed registration differs from its current repository connection.");
      }
      const record = { schema_version: 1, authority_kind: "internal-instance-record", caller_id: callerId,
        canonical_authority: state.canonical_authority, request, evaluation, binding_digest: binding,
        source_attestation: { candidate_digest: candidate.candidate_digest, source: candidate.source, evidence_refs: candidate.evidence_refs,
          current_custody_digest: authority.digest, attested_by: "operator-orchestration-service", attested_at: clock().toISOString() },
        status: "accepted", commit_attempted: false, native_result: null, backend_input: null, failure: null,
        history: [{ sequence: 1, at: clock().toISOString(), status: "accepted", details: null }] };
      tx.put(record);
      return result(record);
    });
  }
  function transition(record, status, details = null) {
    record.status = status;
    record.failure = null;
    record.history.push({ sequence: record.history.length + 1, at: clock().toISOString(), status, details });
  }
  async function advance({ callerId, requestId, action = "continue" }) {
    if (!["continue", "cancel"].includes(action)) throw fail("action_invalid", "Use the saved request's continue or cancel action.", 400);
    return journal.transact(requestId, async tx => {
      const record = tx.current;
      assertCaller(record, callerId);
      if (TERMINAL.has(record.status)) return result(record);
      if (action === "cancel") {
        if (record.commit_attempted) throw fail("outcome_unconfirmed", "Resolve the original registration before changing it; its write was already attempted.");
        transition(record, "cancelled"); tx.put(record); return result(record);
      }
      active();
      const original = { request: record.request, decision: record.evaluation.decision, operator_ref: callerId };
      try {
        // This read is serialized with acceptance at WGCF. An earlier timed-out
        // commit is recovered before any fresh custody or source inspection.
        let confirmed = await reader.resolve(record.request.target.name, original);
        if (!confirmed) {
          transition(record, "evaluating"); tx.put(record);
          const { authority } = await custody(callerId, record.request.custody_request_id, record.request.target, record.request.requested_record, record.request.source);
          if (intakeDigest(authority.binding) !== intakeDigest(record.request.requested_record.provider_repository)) throw fail("source_changed", "Repository identity changed; review current registration details.");
          let ownerReadiness = null;
          if (record.request.requested_classification === "admitted") {
            if (typeof sourceOwnerReadinessReader !== "function") throw fail("source_owner_readiness_unavailable", "Complete source setup before admission.", 503);
            ownerReadiness = await sourceOwnerReadinessReader({ callerId, ownerRepo: record.request.target.name,
              providerRepository: record.request.requested_record.provider_repository });
          }
          const attestation = { attested_by: "operator-orchestration-service", source: record.request.source,
            provider_repository: authority.binding, evidence_refs: authority.evidence_refs };
          attestation.attestation_digest = intakeDigest(attestation);
          record.backend_input = { schema_version: 1, ...original, source_attestation: attestation, owner_readiness: ownerReadiness };
          record.commit_attempted = true;
          transition(record, "preparing"); tx.put(record);
          confirmed = await writer.accept(record.request.target.name, record.backend_input);
        }
        record.native_result = confirmed;
        transition(record, "succeeded", { receipt_digest: confirmed.receipt.receipt_digest });
        tx.put(record);
        return result(record);
      } catch (error) {
        const retryable = !error?.statusCode || error.statusCode >= 500 || [401, 403, 404, 405, 408, 429].includes(error.statusCode);
        record.failure = { code: error?.code ?? "instance_records_unavailable", retryable,
          message: retryable ? "The saved registration is waiting for its connection. Retry this same request."
            : "Registration needs a review of its current state or source setup. The original request is retained." };
        if (!retryable) record.status = "requires-action";
        record.history.push({ sequence: record.history.length + 1, at: clock().toISOString(), status: record.status, details: { failure: record.failure.code } });
        tx.put(record);
        return result(record);
      }
    });
  }
  return { prepare, submit, advance,
    async project(requestId, { callerId }) { const record = journal.get(requestId); assertCaller(record, callerId); return result(record); },
    async records({ callerId, target }) { return journal.list({ callerId, target }); },
    async projectRecords({ callerId, input }) {
      const target = targetFor(input?.target);
      const authority = repositoryCustodyIntakeAuthority({ result: await custodySourceReader(input.custody_request_id, { callerId }), target });
      return journal.list({ callerId, target }).filter(record => {
        assertCaller(record, callerId);
        return record.request.custody_request_id === input.custody_request_id &&
          record.request.requested_record.provider_repository.provider_repository_id === authority.binding.provider_repository_id;
      }).map(record => {
        const candidate = bindWorkspaceIntakeSourceCandidate({ schema_version: 1, artifact_type: "workspace-intake-source-candidate",
          source: record.request.source, target, requested_record: record.request.requested_record, evidence_refs: record.source_attestation.evidence_refs });
        if (candidate.candidate_digest !== record.source_attestation.candidate_digest) throw fail("storage_invalid", "Saved registration candidate is inconsistent.", 503);
        return { request_id: record.request.request_id, requested_at: record.request.requested_at, updated_at: record.history.at(-1).at,
          status: record.status, revision: record.history.length, classification: record.request.requested_classification, candidate,
          authority_kind: "internal-instance-record", custody_request_id: record.request.custody_request_id };
      });
    },
  };
}
