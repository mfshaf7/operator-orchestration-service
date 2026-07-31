import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  OrchestrationContractError,
  assertWgcfActivityResult,
  normalizeRunControl,
  normalizeValidationReadinessRunId,
  normalizeValidationReadinessRequest,
  toTemporalWorkflowInput,
} from "../src/orchestration/contracts.js";
import {
  assertRunControl,
  assertWorkflowInput,
  workflowApprovalExpiredAt,
} from "../src/orchestration/workflow-contracts.js";
import {
  validWgcfActivityRequest,
  validOrchestrationRequest,
  validWgcfResult,
} from "../test-fixtures/orchestration.js";

test("validation readiness requests preserve only the admitted boundary", () => {
  const request = normalizeValidationReadinessRequest(
    validOrchestrationRequest(),
    { callerId: "governance-operations-console" },
  );

  assert.equal(request.caller_id, "governance-operations-console");
  assert.equal(request.intent_summary, "Prove local validation readiness.");
  assert.match(request.intent_digest, /^sha256:[0-9a-f]{64}$/);
  assert.equal(request.approval_refs.length, 1);
  assert.equal(request.lock_refs.length, 0);
  assert.equal(Object.isFrozen(request), true);

  const workflowInput = toTemporalWorkflowInput(request);
  assert.equal(workflowInput.request_ref, request.request_id);
  assert.equal(workflowInput.source_ref, request.source_record_ref);
  assert.equal(workflowInput.artifact_digest, request.intent_digest);
  assert.equal(workflowInput.caller_id, "governance-operations-console");
  assert.equal(Object.hasOwn(workflowInput, "intent_summary"), false);
  assert.equal(Object.hasOwn(workflowInput, "approval_refs"), false);
  assert.equal(
    assertWorkflowInput(workflowInput, new Date().toISOString()),
    workflowInput,
  );
});

test("workflow history input rejects unknown and mismatched authority data", () => {
  const request = normalizeValidationReadinessRequest(
    validOrchestrationRequest(),
    { callerId: "governance-operations-console" },
  );
  const input = toTemporalWorkflowInput(request);

  assert.throws(
    () =>
      assertWorkflowInput(
        { ...input, caller_secret: "forbidden" },
        new Date().toISOString(),
      ),
    /outside the admitted boundary/,
  );
  assert.throws(
    () =>
      assertWorkflowInput(
        {
          ...input,
          bounded_decision: {
            ...input.bounded_decision,
            scope_ref: "art:delivery-699",
          },
        },
        new Date().toISOString(),
      ),
    /approval scope must match source_ref/,
  );
  assert.throws(
    () => assertWorkflowInput(input, input.bounded_decision.expires_at),
    /approval expired before durable execution started/,
  );
  assert.equal(
    workflowApprovalExpiredAt(input, input.bounded_decision.expires_at),
    true,
  );
});

test("request timestamps accept RFC 3339 offsets and normalize to UTC", () => {
  const payload = validOrchestrationRequest();
  payload.approval_refs[0].decided_at = payload.approval_refs[0].decided_at
    .replace("Z", "+00:00");
  payload.approval_refs[0].expires_at = payload.approval_refs[0].expires_at
    .replace("Z", "+00:00");

  const request = normalizeValidationReadinessRequest(payload, {
    callerId: "governance-operations-console",
  });

  assert.match(request.approval_refs[0].decided_at, /Z$/);
  assert.match(request.approval_refs[0].expires_at, /Z$/);
});

test("workflow history input matches its published schema", () => {
  const request = normalizeValidationReadinessRequest(
    validOrchestrationRequest(),
    { callerId: "governance-operations-console" },
  );
  const input = toTemporalWorkflowInput(request);
  const schema = JSON.parse(
    readFileSync(
      new URL(
        "../contracts/orchestration/workflow-input.schema.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );

  assert.deepEqual(Object.keys(input).sort(), [...schema.required].sort());
  assert.deepEqual(
    Object.keys(schema.properties).sort(),
    [...schema.required].sort(),
  );
});

test("validation readiness requests reject unknown fields and authority drift", () => {
  assert.throws(
    () =>
      normalizeValidationReadinessRequest(
        { ...validOrchestrationRequest(), arbitrary_command: "rm -rf /" },
        { callerId: "governance-operations-console" },
      ),
    (error) =>
      error instanceof OrchestrationContractError &&
      error.code === "invalid_request",
  );

  const payload = validOrchestrationRequest();
  payload.approval_refs[0].authority = "different-operator";
  assert.throws(
    () =>
      normalizeValidationReadinessRequest(payload, {
        callerId: "governance-operations-console",
      }),
    (error) =>
      error instanceof OrchestrationContractError &&
      error.details.includes(
        "approval_refs[0].authority must match operator_id",
      ),
  );

  const changedIntent = validOrchestrationRequest();
  changedIntent.intent_summary = "A changed intent with stale approval.";
  assert.throws(
    () =>
      normalizeValidationReadinessRequest(changedIntent, {
        callerId: "governance-operations-console",
      }),
    (error) =>
      error instanceof OrchestrationContractError &&
      error.details.includes(
        "intent_digest must match the canonical request intent",
      ),
  );

  const changedScope = validOrchestrationRequest();
  changedScope.approval_refs[0].scope_ref = "art:delivery-699";
  assert.throws(
    () =>
      normalizeValidationReadinessRequest(changedScope, {
        callerId: "governance-operations-console",
      }),
    (error) =>
      error instanceof OrchestrationContractError &&
      error.details.includes(
        "approval_refs[0].scope_ref must match source_record_ref",
      ),
  );

  const invalidWindow = validOrchestrationRequest();
  invalidWindow.approval_refs[0].expires_at =
    invalidWindow.approval_refs[0].decided_at;
  assert.throws(
    () =>
      normalizeValidationReadinessRequest(invalidWindow, {
        callerId: "governance-operations-console",
      }),
    (error) =>
      error instanceof OrchestrationContractError &&
      error.details.includes(
        "approval_refs[0].expires_at must be later than decided_at",
      ),
  );

  const oversizedRunId = validOrchestrationRequest();
  oversizedRunId.idempotency_key = "x".repeat(256);
  assert.throws(
    () =>
      normalizeValidationReadinessRequest(oversizedRunId, {
        callerId: "governance-operations-console",
      }),
    (error) =>
      error instanceof OrchestrationContractError &&
      error.details.includes(
        "idempotency_key is too long for the bounded aggregate run id",
      ),
  );

  assert.throws(
    () => normalizeValidationReadinessRunId("oos:another-definition:v1:key"),
    (error) =>
      error instanceof OrchestrationContractError &&
      error.code === "invalid_run_reference",
  );
});

test("run controls are strict and versioned", () => {
  const control = {
    schema_version: 1,
    control_id: "control:1",
    action: "retry",
    operator_id: "operator:mfshaf7",
    reason_ref: "decision:retry-1",
    idempotency_key: "control-retry-1",
  };
  assert.deepEqual(normalizeRunControl(control), control);
  assert.equal(assertRunControl(control), control);
  assert.throws(
    () => assertRunControl({ ...control, unbounded_note: "raw context" }),
    /outside the admitted boundary/,
  );
});

test("WGCF results require the admitted terminal result shape", () => {
  const result = validWgcfResult();
  const activityRequest = validWgcfActivityRequest();
  assert.equal(assertWgcfActivityResult(result, activityRequest), result);

  assert.throws(
    () =>
      assertWgcfActivityResult({
        ...result,
        bounded_decision: {
          ...result.bounded_decision,
          terminal: false,
        },
      }, activityRequest),
    /terminal decision semantics/,
  );

  assert.throws(
    () =>
      assertWgcfActivityResult(
        { ...result, source_version: "git:other-source:def456" },
        activityRequest,
      ),
    /source_version does not match the activity request/,
  );

  assert.throws(
    () =>
      assertWgcfActivityResult(
        { ...result, raw_validator_output: "must not cross the boundary" },
        activityRequest,
      ),
    /outside the admitted boundary/,
  );
});

test("WGCF ready results require coherent success evidence", () => {
  const activityRequest = validWgcfActivityRequest();
  const result = validWgcfResult();
  const contradictions = [
    {
      bounded_decision: {
        ...result.bounded_decision,
        validation_outcome: "failure",
      },
    },
    {
      bounded_decision: {
        ...result.bounded_decision,
        readiness_outcome: "blocked",
      },
    },
    {
      bounded_decision: {
        ...result.bounded_decision,
        readiness_reason_count: 1,
      },
    },
  ];

  for (const contradiction of contradictions) {
    assert.throws(
      () =>
        assertWgcfActivityResult(
          { ...result, ...contradiction },
          activityRequest,
        ),
      /ready result requires successful validation and reason-free readiness/,
    );
  }

  assert.throws(
    () =>
      assertWgcfActivityResult(
        {
          ...result,
          receipt_ref: { ...result.receipt_ref, outcome: "failure" },
        },
        activityRequest,
      ),
    /receipt outcome does not match validation_outcome/,
  );
});

test("WGCF non-ready results require coherent blocked readiness evidence", () => {
  const activityRequest = validWgcfActivityRequest();
  const result = validWgcfResult("blocked");

  for (const boundedDecision of [
    { ...result.bounded_decision, readiness_outcome: "ready" },
    { ...result.bounded_decision, readiness_reason_count: 0 },
  ]) {
    assert.throws(
      () =>
        assertWgcfActivityResult(
          { ...result, bounded_decision: boundedDecision },
          activityRequest,
        ),
      /non-ready result requires blocked readiness with at least one reason/,
    );
  }
});
