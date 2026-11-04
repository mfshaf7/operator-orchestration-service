import assert from "node:assert/strict";
import test from "node:test";
import { loadOpenApiSpec, validateValueAgainstSchema } from "../scripts/api_contract_tools.mjs";
import { intakeDigest } from "../src/workspace-intake/contracts.js";
import { nativeInput, nativeResult, instanceId, target, policy, at } from "../test-fixtures/instance-records.js";
const spec = loadOpenApiSpec();
const issues = (schema, value) => validateValueAgainstSchema(spec, { $ref: `#/components/schemas/${schema}` }, value);

test("Existing Intake API describes the complete native authority alternative without fake source evidence", () => {
  const input = nativeInput();
  const preparation = { schema_version: 1, workflow_id: "workspace-intake", authority_kind: "internal-instance-record",
    authority_revision: policy.revision, target, expected_state: input.request.expected_state,
    canonical_authority: { kind: "internal-instance-record", instance_id: instanceId, record_id: target.record_id },
    policy_ref: policy, canonical_mutation: false, custody_request_id: input.request.custody_request_id,
    source_candidate: { schema_version: 1, artifact_type: "workspace-intake-source-candidate", source: input.request.source,
      target, requested_record: input.request.requested_record, evidence_refs: input.source_attestation.evidence_refs, candidate_digest: intakeDigest("synthetic-candidate") } };
  const command = { authority_revision: policy.revision, request: input.request, decision: input.decision,
    session_ref: "console://workspace-intake/synthetic", execution_ref: "console://workspace-intake/synthetic/execution" };
  assert.deepEqual(issues("WorkspaceIntakePreparation", preparation), []);
  assert.deepEqual(issues("WorkspaceIntakeCommand", command), []);
  const { authority_revision: _revision, ...retainedCommand } = command;
  const result = { ...retainedCommand, schema_version: 1, workflow_id: "workspace-intake", request_id: input.request.request_id,
    authority_kind: preparation.authority_kind, canonical_authority: preparation.canonical_authority, cancel_allowed: true,
    status: "accepted", next_action: "continue", revision: 1, canonical_mutation: false,
    readiness: null, review: null, readback: null, receipt: null, failure: null,
    history: [{ sequence: 1, at, status: "accepted", details: null }],
    source_attestation: { source: input.request.source, candidate_digest: preparation.source_candidate.candidate_digest,
      evidence_refs: input.source_attestation.evidence_refs, current_custody_digest: intakeDigest("current-custody"),
      attested_by: "operator-orchestration-service", attested_at: at } };
  assert.deepEqual(validateValueAgainstSchema(spec, spec.components.schemas.WorkspaceIntakeResult.oneOf[1], result), []);
  assert.deepEqual(issues("WorkspaceIntakeResult", result), []);
  const completed = nativeResult(input);
  assert.deepEqual(issues("WorkspaceIntakeResult", { ...result, status: "succeeded", next_action: "complete", cancel_allowed: false,
    canonical_mutation: true, receipt: completed.receipt, readback: completed,
    history: [{ sequence: 1, at, status: "succeeded", details: { receipt_digest: completed.receipt.receipt_digest } }] }), []);
  assert.deepEqual(issues("WorkspaceIntakeResult", { ...result, failure: { code: "offline", retryable: true, message: "Retry the original request." },
    history: [{ sequence: 1, at, status: "accepted", details: { failure: "offline" } }] }), []);
  const bad = structuredClone(result); bad.receipt = { schema_version: 2, phase: "merged-authority" };
  assert.notDeepEqual(issues("WorkspaceIntakeResult", bad), []);
});
