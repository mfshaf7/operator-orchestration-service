import { assertIntake, bindIntake, createIntakeEvaluation, intakeDigest, intakeError, intakeReference } from "./contracts.js";
import { persistWorkflowFailure } from "../workflow-progress.js";
import { custodyRequestFromIntakeSource, repositoryCustodyIntakeCandidate, repositoryCustodyIntakeAuthority } from "../repository-custody/intake-source.js";
import {
  assertWorkspaceIntakeRequestCandidate,
  assertWorkspaceIntakeSourceCaller,
  assertWorkspaceIntakeSourceCandidate,
  bindWorkspaceIntakeSourceCandidate,
} from "./source-candidate.js";

const TERMINAL = new Set(["succeeded", "cancelled", "rejected", "requires-action"]);
const NEXT = {
  accepted: "continue", evaluating: "continue", preparing: "continue", "review-required": "review-and-merge",
  cancelling: "continue", cancelled: "complete", rejected: "submit-corrected-request", "requires-action": "submit-corrected-request", succeeded: "complete",
};
const SHA = /^[0-9a-f]{40}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const TARGET_NAME = /^[a-z0-9][a-z0-9._-]*$/;
const TARGET_KINDS = new Set(["repo", "product", "component"]);

function preparationTarget(input) {
  if (!input || Array.isArray(input) || !Object.hasOwn(input, "target") ||
      Object.keys(input).some((key) => !["target", "repository_custody"].includes(key))) {
    throw intakeError("preparation_invalid", "Preparation requires exactly one target.", 400);
  }
  const target = input.target;
  if (!target || Array.isArray(target) || Object.keys(target).sort().join(",") !== "kind,name" ||
      !TARGET_KINDS.has(target.kind) || typeof target.name !== "string" || !TARGET_NAME.test(target.name)) {
    throw intakeError("preparation_invalid", "Preparation target must identify one valid repository, product, or component.", 400);
  }
  return { kind: target.kind, name: target.name };
}

function assertPreparationState(value, requestedTarget) {
  const expectedRecordId = `${requestedTarget.kind}:${requestedTarget.name}`;
  const expected = value?.expected_state;
  if (!SHA.test(value?.authority_revision) || value?.target?.kind !== requestedTarget.kind ||
      value?.target?.name !== requestedTarget.name || value?.target?.record_id !== expectedRecordId ||
      !DIGEST.test(expected?.register_digest) ||
      !((expected?.record_version === null && expected?.record_digest === null) ||
        (Number.isInteger(expected?.record_version) && expected.record_version > 0 && DIGEST.test(expected?.record_digest)))) {
    throw intakeError("authority_invalid", "Workspace Intake authority returned invalid preparation state.", 503);
  }
  return value;
}

function publicResult(record) {
  return {
    schema_version: 1, workflow_id: "workspace-intake", request_id: record.request.request_id,
    session_ref: record.evaluation.session_ref, execution_ref: record.evaluation.execution_ref,
    status: record.status,
    next_action: record.failure ? (record.failure.retryable ? "restore-dependency-and-retry" : "inspect-review-or-cancel") : NEXT[record.status],
    revision: record.history.length,
    request: record.request, decision: record.evaluation.decision, readiness: record.readiness,
    review: record.review, readback: record.readback, receipt: record.receipt, failure: record.failure,
    history: record.history,
    source_attestation: record.source_attestation,
    canonical_mutation: record.status === "succeeded",
  };
}

function assertCaller(record, callerId) {
  if (!record || record.caller_id !== callerId) throw intakeError("not_found", "Intake request was not found.", 404);
  if (record.binding_digest !== intakeDigest({ caller_id: record.caller_id, evaluation: record.evaluation })) {
    throw intakeError("storage_invalid", "Stored intake command binding is invalid.", 503);
  }
}

export function createWorkspaceIntakeService({ store, readinessClient, sourceClient, custodySourceReader = null, sourceOwnerReadinessReader = null, clock = () => new Date(), audit }) {
  async function list({ callerId, input }) {
    const direct = input?.source_class === "direct";
    if (!input || Array.isArray(input) || Object.keys(input).some(key => !["target", "custody_request_id", "source_class", "cursor"].includes(key)) ||
        (direct ? Object.hasOwn(input, "custody_request_id") :
          Object.hasOwn(input, "source_class") || typeof input.custody_request_id !== "string" || input.custody_request_id.length > 256 || !input.custody_request_id.trim()) ||
        (input.cursor !== undefined && !/^[0-9a-f]{64}$/.test(input.cursor))) {
      throw intakeError("list_invalid", "Request listing requires one exact custody or direct product/component selector and an optional opaque cursor.", 400);
    }
    const selected = preparationTarget({ target: input.target });
    if (direct ? !["product", "component"].includes(selected.kind) : selected.kind !== "repo") {
      throw intakeError("list_invalid", "Direct listing requires a product/component; custody listing requires a repository.", 400);
    }
    if (!direct && typeof custodySourceReader !== "function") throw intakeError("custody_source_unavailable", "Canonical repository custody reader is unavailable.", 503);
    const target = { ...selected, record_id: `${selected.kind}:${selected.name}` };
    const custody = direct ? null : repositoryCustodyIntakeAuthority({ result: await custodySourceReader(input.custody_request_id, { callerId }), target });
    const retained = (await store.list()).filter(record => record.caller_id === callerId &&
      record.request.target.kind === target.kind && record.request.target.name === target.name &&
      (direct ? record.request.source.class === "direct" : custodyRequestFromIntakeSource(record.request.source) === input.custody_request_id));
    retained.sort((left, right) => Date.parse(right.request.requested_at) - Date.parse(left.request.requested_at) ||
      right.request.request_id.localeCompare(left.request.request_id));
    const cursorFor = record => intakeDigest({ caller_id: callerId, target,
      ...(direct ? { source_class: "direct" } : { custody_request_id: input.custody_request_id }), request_id: record.request.request_id }).slice(7);
    let offset = 0;
    if (input.cursor !== undefined) {
      offset = retained.findIndex(record => cursorFor(record) === input.cursor) + 1;
      if (!offset) throw intakeError("cursor_invalid", "Request cursor does not belong to this caller and custody target.", 400);
    }
    const page = retained.slice(offset, offset + 25);
    const records = page.map(record => {
      assertCaller(record, callerId);
      if (direct) {
        assertIntake("request", record.request);
        if (record.source_attestation || intakeDigest(record.request) !== intakeDigest(record.evaluation.request)) {
          throw intakeError("storage_invalid", "Direct request metadata does not bind its operator-authored command.", 503);
        }
      } else if (record.request.source.digest !== custody.digest || !record.source_attestation) {
        throw intakeError("storage_invalid", "Retained request does not bind its canonical custody receipt.", 503);
      }
      const candidateBody = { schema_version: 1, artifact_type: "workspace-intake-source-candidate",
        source: record.request.source, target, requested_record: record.request.requested_record,
        evidence_refs: direct ? [record.request.source.ref] : record.source_attestation.evidence_refs };
      // A direct projection describes the accepted operator command. It is
      // deliberately not passed through the source-owner attestation binder.
      const candidate = direct ? bindIntake(candidateBody, "candidate_digest") : bindWorkspaceIntakeSourceCandidate(candidateBody);
      if (!direct && candidate.candidate_digest !== record.source_attestation.candidate_digest) throw intakeError("storage_invalid", "Retained candidate binding is invalid.", 503);
      return { request_id: record.request.request_id, requested_at: record.request.requested_at,
        updated_at: record.history.at(-1).at, status: record.status, revision: record.history.length,
        classification: record.request.requested_classification, candidate };
    });
    // Stay below the existing Console response budget, including its source
    // envelope. Count and byte bounds both apply; never skip an omitted row.
    while (records.length && Buffer.byteLength(JSON.stringify(records), "utf8") > 524288) records.pop();
    if (page.length && !records.length) throw intakeError("list_record_large", "A retained request exceeds the bounded list projection.", 503);
    return { schema_version: 1, workflow_id: "workspace-intake", target,
      revision: retained.reduce((total, record) => total + record.history.length, 0),
      pending_request_count: retained.filter(record => !TERMINAL.has(record.status)).length,
      updated_at: retained.map(record => record.history.at(-1).at).sort().at(-1) ?? null,
      ...(direct ? { source_class: "direct", custody_request_id: null } : { custody_request_id: input.custody_request_id }), records,
      next_cursor: offset + records.length < retained.length ? cursorFor(page[records.length - 1]) : null };
  }
  async function custodyCandidate(callerId, requestId, target, requestedRecord) {
    if (typeof custodySourceReader !== "function") {
      throw intakeError("custody_source_unavailable", "Canonical repository custody reader is unavailable.", 503);
    }
    return repositoryCustodyIntakeCandidate({
      result: await custodySourceReader(requestId, { callerId }), target, requestedRecord,
    });
  }
  async function transition(transaction, record, status, details = null) {
    transaction.assertHeld();
    record.status = status;
    record.failure = null;
    record.history.push({ sequence: record.history.length + 1, at: clock().toISOString(), status, details });
    await transaction.put(record);
  }

  async function submit({ callerId, input }) {
    const evaluation = createIntakeEvaluation(input, callerId);
    const binding = intakeDigest({ caller_id: callerId, evaluation });
    return store.transact(async (tx) => {
      const current = tx.get(input.request.request_id);
      if (current) {
        assertCaller(current, callerId);
        if (current.binding_digest !== binding) throw intakeError("idempotency_conflict", "Request identity is bound to different input.");
        return publicResult(current);
      }
      let attestation = null;
      if (evaluation.request.source.class !== "direct") {
        const custodyId = custodyRequestFromIntakeSource(evaluation.request.source);
        if (custodyId !== null) {
          const candidate = await custodyCandidate(callerId, custodyId, evaluation.request.target, evaluation.request.requested_record);
          assertWorkspaceIntakeRequestCandidate(evaluation.request, candidate);
          // This explicit mutating submit retains the attestation. Read-only
          // preparation never writes a candidate or workflow record.
          await tx.putCandidate({ candidate, attested_at: clock().toISOString(),
            attested_by: "operator-orchestration-service" });
        }
        attestation = tx.getCandidate(evaluation.request.source.ref);
        if (!attestation) {
          throw intakeError("source_candidate_not_found", "Source-owner attestation was not found.", 404);
        }
        assertWorkspaceIntakeRequestCandidate(evaluation.request, attestation.candidate);
      }
      const domain = evaluation.request.requested_record ?? {}, behavior = domain.validation_behavior;
      let sourceOwnerReadiness = null;
      if (evaluation.request.requested_classification === "admitted" && evaluation.request.target.kind === "repo" &&
          domain.provider_repository && domain.requires_security_bindings === false &&
          behavior?.posture === "covered-by-owner-repo" && behavior.wgcf_graph_role === "product-runtime-source") {
        if (typeof sourceOwnerReadinessReader !== "function") throw intakeError("source_owner_readiness_unavailable", "Source-only admission requires its actual completed owner controls and applicable current profile.", 503);
        sourceOwnerReadiness = await sourceOwnerReadinessReader({ callerId, ownerRepo: evaluation.request.target.name, providerRepository: domain.provider_repository });
        const { receipt_digest: proofDigest, ...proofBody } = sourceOwnerReadiness ?? {};
        if (sourceOwnerReadiness?.schema_version !== 1 || sourceOwnerReadiness.scope !== "source-owner-controls-readiness" ||
            proofDigest !== intakeDigest(proofBody) || !/^[0-9a-f]{40}$/.test(sourceOwnerReadiness.fetched_base ?? "") ||
            !/^[0-9a-f]{40}$/.test(sourceOwnerReadiness.canonical_checkout_commit ?? "") ||
            !/^sha256:[0-9a-f]{64}$/.test(sourceOwnerReadiness.evidence_profile_digest ?? "") ||
            !/^oos:\/\/repository-owner-bootstrap\/requests\/[^/]+$/.test(sourceOwnerReadiness.source_request_ref ?? "") ||
            !Number.isFinite(Date.parse(sourceOwnerReadiness.source_request_revision ?? "")) ||
            sourceOwnerReadiness.owner_repo !== evaluation.request.target.name || sourceOwnerReadiness.app_acceptance !== false ||
            sourceOwnerReadiness.inventory_admission !== false || sourceOwnerReadiness.runtime_activation !== false ||
            intakeDigest(sourceOwnerReadiness.provider_repository) !== intakeDigest(domain.provider_repository)) throw intakeError("source_owner_readiness_invalid", "Owner-controls evidence does not bind this exact source-only entrant.");
      }
      const record = {
        caller_id: callerId, binding_digest: binding, evaluation, request: evaluation.request,
        ...(sourceOwnerReadiness ? { source_owner_readiness: structuredClone(sourceOwnerReadiness) } : {}),
        source_attestation: attestation ? {
          candidate_digest: attestation.candidate.candidate_digest,
          evidence_refs: [...attestation.candidate.evidence_refs],
          source: structuredClone(attestation.candidate.source),
          attested_at: attestation.attested_at,
          attested_by: attestation.attested_by,
        } : null,
        status: "accepted", preparation: null, readiness: null, review: null, readback: null, receipt: null, failure: null,
        history: [{ sequence: 1, at: clock().toISOString(), status: "accepted", details: null }],
      };
      await tx.put(record);
      return publicResult(record);
    });
  }

  async function attest({ callerId, input }) {
    const candidate = assertWorkspaceIntakeSourceCandidate(input);
    assertWorkspaceIntakeSourceCaller(candidate, callerId);
    return store.transact(async (tx) => {
      const record = await tx.putCandidate({
        candidate,
        attested_at: clock().toISOString(),
        attested_by: callerId,
      });
      audit?.emit({
        actor: callerId,
        event_type: "workspace.intake.source-candidate.attested",
        outcome: "succeeded",
        source_class: candidate.source.class,
        source_ref: candidate.source.ref,
        candidate_digest: candidate.candidate_digest,
      });
      return structuredClone(record);
    });
  }

  async function prepare({ callerId, input }) {
    const target = preparationTarget(input);
    let candidate = null;
    if (input.repository_custody !== undefined) {
      const custody = input.repository_custody;
      if (!custody || Array.isArray(custody) || Object.keys(custody).sort().join(",") !== "request_id,requested_record" ||
          typeof custody.request_id !== "string" || !custody.request_id.trim()) {
        throw intakeError("preparation_invalid", "Repository custody preparation requires exactly request_id and requested_record.", 400);
      }
      candidate = await custodyCandidate(callerId, custody.request_id,
        { ...target, record_id: `${target.kind}:${target.name}` }, custody.requested_record);
    }
    const state = assertPreparationState(await sourceClient.state(target), target);
    const result = {
      schema_version: 1,
      workflow_id: "workspace-intake",
      authority_revision: state.authority_revision,
      target: structuredClone(state.target),
      expected_state: structuredClone(state.expected_state),
      canonical_authority: {
        repo: "workspace-governance",
        path: "contracts/intake-register.yaml",
        branch: "main",
      },
      canonical_mutation: false,
      ...(candidate ? { source_candidate: candidate } : {}),
    };
    audit?.emit({
      actor: callerId,
      event_type: "workspace.intake.preparation.read",
      outcome: "succeeded",
      target: result.target.record_id,
      authority_revision: result.authority_revision,
    });
    return result;
  }

  async function finish(tx, record, merged) {
    const { request, evaluation, preparation } = record;
    const readback = assertIntake("readback", merged.readback);
    const expected = preparation.readback;
    if (readback.authority_state !== "merged-authority" || readback.record_digest !== expected.record_digest ||
        intakeDigest(readback.record) !== readback.record_digest ||
        intakeDigest(readback.mutation_ref) !== intakeDigest(intakeReference(preparation.mutation, "mutation")) ||
        intakeDigest(readback.target) !== intakeDigest(request.target)) {
      throw intakeError("merged_readback_mismatch", "Merged authority does not match the approved intake record.");
    }
    record.readback = readback;
    record.review = merged.review;
    record.receipt = assertIntake("receipt", bindIntake({
      schema_version: 2, artifact_type: "workspace-intake-receipt",
      receipt_id: `intake-merged:${intakeDigest({ readback: readback.readback_digest, binding: record.binding_digest }).slice(7)}`,
      completed_at: clock().toISOString(), request_ref: intakeReference(request, "request"),
      decision_ref: intakeReference(evaluation.decision, "decision"), mutation_ref: intakeReference(preparation.mutation, "mutation"),
      readback_ref: intakeReference(readback, "readback"), target: request.target,
      phase: "merged-authority", outcome: "succeeded", idempotency_key: request.idempotency_key,
      canonical_authority: { repo: "workspace-governance", path: "contracts/intake-register.yaml", branch: "main" },
    }, "receipt_digest"));
    await transition(tx, record, "succeeded", { merge_commit: merged.review.merge_commit, receipt_digest: record.receipt.receipt_digest });
  }

  async function advance({ callerId, requestId, action = "continue" }) {
    if (!["continue", "cancel"].includes(action)) throw intakeError("action_invalid", "Unsupported intake action.", 400);
    return store.transact(async (tx) => {
      const record = tx.get(requestId);
      assertCaller(record, callerId);
      if (TERMINAL.has(record.status)) return publicResult(record);
      try {
        if (action === "cancel" && record.status !== "cancelling") await transition(tx, record, "cancelling");
        if (record.status === "cancelling") {
          const outcome = await sourceClient.cancel(record, tx.assertHeld);
          if (outcome?.readback) await finish(tx, record, outcome);
          else await transition(tx, record, "cancelled");
          return publicResult(record);
        }
        if (["accepted", "evaluating"].includes(record.status)) {
          if (record.status === "accepted") await transition(tx, record, "evaluating");
          record.readiness = await readinessClient.evaluate(record.evaluation);
          if (record.readiness.receipt.outcome !== "allowed") {
            await transition(tx, record, record.readiness.receipt.outcome === "denied" ? "rejected" : "requires-action");
            return publicResult(record);
          }
          await transition(tx, record, "preparing");
        }
        if (record.status === "preparing") {
          if (!record.preparation) {
            record.preparation = await sourceClient.prepare(record, tx.assertHeld);
            assertIntake("mutation", record.preparation.mutation);
            assertIntake("readback", record.preparation.readback);
            await tx.put(record);
          }
          record.review = await sourceClient.openReview(record, tx.assertHeld);
          await transition(tx, record, "review-required");
          return publicResult(record);
        }
        if (record.status === "review-required") {
          const observed = await sourceClient.observe(record, tx.assertHeld);
          if (observed.readback) await finish(tx, record, observed);
          else if (observed.review.state === "closed") await transition(tx, record, "rejected");
          else if (record.failure) await transition(tx, record, "review-required", { recovered: true });
        }
        return publicResult(record);
      } catch (error) {
        // Keep the last durable phase so a transport timeout cannot erase a
        // remotely completed operation or issue a different command on retry.
        await persistWorkflowFailure({
          transaction: tx,
          record,
          failure: { code: error?.code?.startsWith("workspace_intake_") ? error.code : "workspace_intake_dependency_unavailable", retryable: !error?.statusCode || error.statusCode >= 500, message: "Intake could not advance. Inspect the current review or correct the reported dependency before retrying." },
          clock,
        });
        audit?.emit({ actor: callerId, event_type: "workspace.intake.advance.failed", outcome: record.status, request_id: requestId, code: record.failure.code });
        if (error?.code?.startsWith("workspace_intake_")) throw error;
        throw intakeError("dependency_unavailable", "An intake dependency failed; the last durable phase was retained for retry.", 503);
      }
    });
  }

  return {
    list,
    attest,
    prepare,
    submit,
    advance,
    async project(requestId, { callerId }) { const record = await store.get(requestId); assertCaller(record, callerId); return publicResult(record); },
  };
}
