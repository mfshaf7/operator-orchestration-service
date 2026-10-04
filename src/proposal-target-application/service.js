import {
  assertProposalTargetArtifact,
  assertProposalTargetPreparationInput,
  createProposalTargetEvaluation,
  proposalTargetDigest,
  proposalTargetError,
} from "./contracts.js";

const TERMINAL = new Set(["succeeded", "cancelled", "rejected", "requires-action"]);
const NEXT = { accepted: "continue", preparing: "continue", "review-required": "review-and-merge", cancelling: "continue", cancelled: "complete", rejected: "submit-corrected-request", "requires-action": "submit-corrected-request", succeeded: "prototype-landing" };
const SHA = /^[0-9a-f]{40}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;

function proposalSnapshot(projection, expectedProposalId) {
  const gate = projection.route?.source_custody?.repository_gate_state;
  if (projection.proposal_id !== expectedProposalId || projection.projection_state !== "current" || projection.status !== "accepted" || projection.route?.target !== "prototype" || projection.handoff?.state !== "ready" || !projection.handoff.packet_ref) {
    throw proposalTargetError("proposal_not_ready", "Proposal must be current, accepted, routed to Prototype, and have a ready handoff.");
  }
  if (gate !== "resolved") throw proposalTargetError("repository_gate_unresolved", "Repository custody must be resolved before Prototype target application.");
  const handoffPacketDigest = proposalTargetDigest({ proposal_id: projection.proposal_id, record_ref: projection.record_ref, record_version: projection.record_version, route: projection.route, handoff: projection.handoff });
  return { proposal_id: projection.proposal_id, record_ref: projection.record_ref, record_version: projection.record_version, handoff_packet_ref: projection.handoff.packet_ref, handoff_packet_digest: handoffPacketDigest, route: structuredClone(projection.route) };
}

function publicPreparation(value) {
  if (!value) return null;
  return { branch: value.branch, base_commit: value.base_commit, file_count: value.file_count, changed_paths: structuredClone(value.changed_paths), content_digest: value.content_digest, request: structuredClone(value.request), result: structuredClone(value.result) };
}

function publicResult(record) {
  return {
    schema_version: 1,
    workflow_id: "proposal-target-application",
    application_id: record.evaluation.application_id,
    proposal_id: record.evaluation.proposal.proposal_id,
    prototype_id: record.evaluation.prototype.id,
    session_ref: record.evaluation.session_ref,
    execution_ref: record.evaluation.execution_ref,
    status: record.status,
    next_action: record.failure ? (record.failure.retryable ? "restore-dependency-and-retry" : "inspect-review-or-cancel") : NEXT[record.status],
    revision: record.history.length,
    proposal: structuredClone(record.proposal),
    target: structuredClone(record.evaluation.target),
    preparation: publicPreparation(record.preparation),
    review: structuredClone(record.review),
    target_result: structuredClone(record.target_result),
    proposal_acknowledgement: structuredClone(record.proposal_acknowledgement),
    failure: structuredClone(record.failure),
    history: structuredClone(record.history),
    canonical_target_mutation: record.status === "succeeded",
    proposal_mutation: record.status === "succeeded",
    runtime_activation: false,
  };
}

function assertCaller(record, callerId) {
  if (!record || record.evaluation.caller_id !== callerId) throw proposalTargetError("not_found", "Proposal target application was not found.", 404);
  if (record.binding_digest !== proposalTargetDigest({ caller_id: callerId, evaluation: record.evaluation })) throw proposalTargetError("storage_invalid", "Stored Proposal target command binding is invalid.", 503);
}

export function createProposalTargetService({ store, sourceClient, proposalWorkflowService, clock = () => new Date(), audit }) {
  async function transition(transaction, record, status, details = null) {
    transaction.assertHeld(); record.status = status; record.failure = null;
    record.history.push({ sequence: record.history.length + 1, at: clock().toISOString(), status, details }); await transaction.put(record);
  }

  async function prepare({ callerId, input }) {
    const command = assertProposalTargetPreparationInput(input);
    const projection = await proposalWorkflowService.getProjection({ callerId, correlationId: `proposal-target-preparation:${command.proposal_id}`, proposalId: command.proposal_id });
    const proposal = proposalSnapshot(projection, command.proposal_id);
    const state = await sourceClient.state(command.prototype_id);
    if (!SHA.test(state.authority_revision) || state.prototype_id !== command.prototype_id || state.expected_state?.source_revision !== state.authority_revision || !DIGEST.test(state.expected_state?.registry_digest) || state.expected_state.record_present !== false || state.expected_state.record_digest !== null) {
      throw proposalTargetError("authority_invalid", "Prototype Studio returned invalid target preparation state.", 503);
    }
    const result = { schema_version: 1, workflow_id: "proposal-target-application", proposal, prototype_id: command.prototype_id, authority_revision: state.authority_revision, expected_state: structuredClone(state.expected_state), canonical_authority: { repo: "workspace-prototype-studio", branch: "main", record_root: "records/prototype-captures" }, canonical_mutation: false };
    audit?.emit({ actor: callerId, event_type: "proposal.target.preparation.read", outcome: "succeeded", proposal_id: command.proposal_id, prototype_id: command.prototype_id, authority_revision: result.authority_revision });
    return result;
  }

  async function submit({ callerId, input }) {
    const evaluation = createProposalTargetEvaluation(input, callerId);
    const projection = await proposalWorkflowService.getProjection({ callerId, correlationId: evaluation.correlation_id, proposalId: evaluation.proposal.proposal_id });
    const proposal = proposalSnapshot(projection, evaluation.proposal.proposal_id);
    const suppliedProposal = { ...evaluation.proposal };
    if (Object.entries(suppliedProposal).some(([key, value]) => proposal[key] !== value)) {
      throw proposalTargetError("proposal_stale", "Proposal source binding changed; prepare a fresh target application.");
    }
    const binding = proposalTargetDigest({ caller_id: callerId, evaluation });
    return store.transact(async (transaction) => {
      const current = transaction.get(evaluation.application_id);
      if (current) { assertCaller(current, callerId); if (current.binding_digest !== binding) throw proposalTargetError("idempotency_conflict", "Application identity is bound to different target input."); return publicResult(current); }
      const record = { binding_digest: binding, evaluation, proposal, requested_at: clock().toISOString(), status: "accepted", preparation: null, review: null, target_result: null, proposal_acknowledgement: null, failure: null, history: [{ sequence: 1, at: clock().toISOString(), status: "accepted", details: null }] };
      await transaction.put(record);
      audit?.emit({ actor: callerId, event_type: "proposal.target.accepted", outcome: "accepted", application_id: evaluation.application_id, proposal_id: evaluation.proposal.proposal_id, prototype_id: evaluation.prototype.id });
      return publicResult(record);
    });
  }

  async function finish(transaction, record, merged, callerId) {
    const result = assertProposalTargetArtifact(merged.result);
    assertProposalTargetArtifact(result.readback.record);
    if (merged.review?.repository !== "workspace-prototype-studio" || merged.review.number !== record.review?.number || merged.review.branch !== record.preparation.branch || merged.review.base_commit !== record.preparation.base_commit || !merged.review.merged || !merged.review.human_reviewed || !SHA.test(merged.review.merge_commit) ||
        result.receipt.prototype_id !== record.evaluation.prototype.id || result.receipt.source_record_ref !== record.proposal.record_ref || result.receipt.source_record_version !== record.proposal.record_version || result.receipt.source_packet_ref !== record.proposal.handoff_packet_ref || result.receipt.target_record_ref !== result.readback.target_record_ref) {
      throw proposalTargetError("merged_readback_mismatch", "Merged Prototype Studio authority does not match the approved Proposal target source.");
    }
    record.review = merged.review; record.target_result = result;
    record.proposal_acknowledgement = await proposalWorkflowService.acknowledgePrototypeHandoff({ callerId, correlationId: record.evaluation.correlation_id, evaluation: record.evaluation, targetResult: result });
    await transition(transaction, record, "succeeded", { merge_commit: merged.review.merge_commit, target_receipt_ref: result.receipt.receipt_ref, proposal_record_version: record.proposal_acknowledgement.projection.record_version });
  }

  async function advance({ callerId, applicationId, action = "continue" }) {
    if (!["continue", "cancel"].includes(action)) throw proposalTargetError("action_invalid", "Unsupported Proposal target action.", 400);
    return store.transact(async (transaction) => {
      const record = transaction.get(applicationId); assertCaller(record, callerId);
      if (TERMINAL.has(record.status)) return publicResult(record);
      try {
        if (action === "cancel" && record.status !== "cancelling") await transition(transaction, record, "cancelling");
        if (record.status === "cancelling") {
          const outcome = await sourceClient.cancel(record, transaction.assertHeld);
          if (outcome?.result) await finish(transaction, record, outcome, callerId); else await transition(transaction, record, "cancelled", outcome?.retained_branch ? { retained_branch: outcome.retained_branch } : null);
          return publicResult(record);
        }
        if (record.status === "accepted") await transition(transaction, record, "preparing");
        if (record.status === "preparing") {
          if (!record.preparation) { record.preparation = await sourceClient.prepare(record, transaction.assertHeld); await transaction.put(record); }
          record.review = await sourceClient.openReview(record, transaction.assertHeld);
          await transition(transaction, record, "review-required", { review_number: record.review.number, head_commit: record.review.head_commit });
          return publicResult(record);
        }
        if (record.status === "review-required") {
          const observed = await sourceClient.observe(record, transaction.assertHeld);
          if (observed.result) await finish(transaction, record, observed, callerId);
          else if (observed.review.state === "closed") await transition(transaction, record, "rejected");
          else if (record.failure) await transition(transaction, record, "review-required", { recovered: true });
        }
        return publicResult(record);
      } catch (error) {
        record.failure = { code: typeof error?.code === "string" && error.code.startsWith("proposal_target_") ? error.code : "proposal_target_dependency_unavailable", retryable: !error?.statusCode || error.statusCode >= 500, message: "Proposal target application could not advance. Inspect the current review or correct the reported dependency before retrying." };
        await transaction.put(record);
        audit?.emit({ actor: callerId, event_type: "proposal.target.advance.failed", outcome: record.status, application_id: applicationId, code: record.failure.code });
        if (typeof error?.code === "string" && error.code.startsWith("proposal_target_")) throw error;
        throw proposalTargetError("dependency_unavailable", "A Proposal target dependency failed; the last durable phase was retained for retry.", 503);
      }
    });
  }

  return { prepare, submit, advance, async project(applicationId, { callerId }) { const record = await store.get(applicationId); assertCaller(record, callerId); return publicResult(record); } };
}
