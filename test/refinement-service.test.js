import assert from "node:assert/strict";
import test from "node:test";

import { canonicalDigest } from "../src/delivery-art/canonical-json.js";
import {
  createRefinementService,
  RefinementServiceError,
} from "../src/refinement/service.js";

const timestamp = "2026-08-26T01:00:00.000Z";
const packageRef = "delivery-package:909";
const sourceRef = "openproject://work_packages/909";

function operation() {
  return {
    operation_id: "delivery-package:909-governance",
    kind: "governance",
    label: "Update Initiative Governance",
    detail: "Apply accepted package-level governance values.",
    target: "openproject://work_packages/884",
    oos_route: "POST /v1/delivery-initiatives/{delivery_id}/governance",
    status: "planned",
  };
}

function packet() {
  return {
    schema_version: 1,
    packet_id: `refinement-packet:${packageRef}`,
    packet_revision: `sha256:${"b".repeat(64)}`,
    status: "ready_for_review",
    active_step: "readiness_review",
    source: {
      delivery_id: "delivery-884",
      package_ref: packageRef,
      source_ref: sourceRef,
      source_revision: "version-5",
      source_work_design_receipt_id: "work-design-application:receipt-1",
      tree_snapshot_ref: "tree://work-design/receipt-1",
      finalized_brief_ref: "brief://work-design/receipt-1/final",
    },
    target_tree: {
      id: "884",
      kind: "Epic",
      title: "Refinement runtime",
      description: "",
      draft_body: "",
      remark: "",
      children: [],
    },
    draft_groups: [{
      group_id: "delivery-package:909-governance",
      title: "Initiative Governance",
      summary: "Review package-level metadata.",
      fields: [{
        field_key: "initiative-target-pi",
        backend_field: "target_pi",
        label: "Target PI",
        field_kind: "select",
        required: true,
        status: "complete",
        value: "PI-2026-03",
        allowed_values: ["PI-2026-03", "PI-2026-04"],
        target_node_ids: ["884"],
        target_values: { "884": "PI-2026-03" },
        validation_hint: "Target PI must resolve for every selected initiative.",
        route_binding: {
          operation_kind: "governance",
          oos_route: "POST /v1/delivery-initiatives/{delivery_id}/governance",
          payload_key: "target_pi",
          target: "initiative",
        },
      }],
    }],
    readiness_gates: [{
      gate_id: "delivery-package:909-metadata-review",
      label: "Metadata Review",
      detail: "Every required metadata target has a current value.",
      status: "passed",
    }],
    apply_plan: {
      summary: "Apply reviewed metadata.",
      expected_routes: ["POST /v1/delivery-initiatives/{delivery_id}/governance"],
      operations: [operation()],
    },
    last_saved_at: timestamp,
  };
}

function assistRequest() {
  const value = packet();
  return {
    schema_version: 1,
    request_id: "refinement-assist-1",
    correlation_id: "correlation-1",
    delivery_id: value.source.delivery_id,
    package_ref: value.source.package_ref,
    source_ref: value.source.source_ref,
    source_revision: value.source.source_revision,
    operator: { id: "operator:owner" },
    task: {
      kind: "metadata_advice",
      contract_ref: "oos.delivery-refinement.v1",
      version: "1.0",
    },
    packet: {
      packet_id: value.packet_id,
      packet_revision: value.packet_revision,
      source_work_design_receipt_id: value.source.source_work_design_receipt_id,
    },
    target: {
      field_key: "initiative-target-pi",
      field_label: "Target PI",
      field_kind: "select",
      required: true,
      source_value: "PI-2026-03",
      draft_value: "",
      selected_node_ids: ["884"],
      allowed_values: ["PI-2026-03", "PI-2026-04"],
    },
    operator_prompt: "Check the planning increment.",
  };
}

function applyRequest() {
  const value = packet();
  const acceptedDraft = {
    packet_id: value.packet_id,
    packet_revision: value.packet_revision,
    source_work_design_receipt_id: value.source.source_work_design_receipt_id,
    metadata_values: { target_pi: "PI-2026-04" },
    metadata_resolutions: { target_pi: "accepted" },
    apply_plan: value.apply_plan,
  };
  return {
    schema_version: 1,
    request_id: "refinement-apply-1",
    correlation_id: "correlation-1",
    idempotency_key: "refinement-apply-key-1",
    delivery_id: value.source.delivery_id,
    package_ref: value.source.package_ref,
    source_ref: value.source.source_ref,
    source_revision: value.source.source_revision,
    operator: { id: "operator:owner" },
    acceptance: {
      decision: "apply",
      accepted_at: timestamp,
      accepted_by: "operator:owner",
      note: "Apply reviewed metadata.",
    },
    accepted_draft: {
      ...acceptedDraft,
      draft_digest: canonicalDigest(acceptedDraft),
    },
  };
}

function readyProjection(request) {
  return {
    schema_version: 1,
    status: "ready",
    replayed: false,
    request_id: request.assist_request.request_id,
    correlation_id: request.assist_request.correlation_id,
    idempotency_key: request.idempotency_key,
    request_digest: request.assist_request_digest,
    binding: {
      request_id: request.assist_request.request_id,
      correlation_id: request.assist_request.correlation_id,
      idempotency_key: request.idempotency_key,
      workflow_session_id: request.workflow_session_id,
      execution_id: request.execution_id,
      delivery_id: request.assist_request.delivery_id,
      package_ref: request.assist_request.package_ref,
      source_ref: request.assist_request.source_ref,
      source_revision: request.assist_request.source_revision,
      caller_id: "operator-orchestration-service",
      operator_id: request.assist_request.operator.id,
      task: request.assist_request.task,
      packet: request.assist_request.packet,
      target: {
        field_key: request.assist_request.target.field_key,
        field_kind: request.assist_request.target.field_kind,
        selected_node_ids: request.assist_request.target.selected_node_ids,
      },
      requested_at: request.requested_at,
      context_digest: request.assist_request_digest,
      budget_tokens: request.budget_tokens,
    },
    artifact_id: "refinement-artifact-1",
    artifact_digest: `sha256:${"c".repeat(64)}`,
    packet_ref: "/v1/context/packets/refinement-packet-1",
    redaction_receipt_ref: "/v1/context/receipts/refinement-receipt-1",
    projection_receipt_ref: "/v1/context/refinement/projections/refinement-projection-1",
    content: "Model-safe Refinement metadata context.",
    admission_decision: {
      profile: "developer",
      raw_projection: "not_requested",
      redaction_safe: true,
    },
    timeline: { requested_at: request.requested_at, projected_at: timestamp },
    authority: {
      may_select_or_invoke_model: false,
      may_approve_suggestion: false,
      may_mutate_delivery: false,
    },
  };
}

function service(overrides = {}) {
  return createRefinementService({
    clock: () => new Date(timestamp),
    contextClient: {
      async project(request) {
        return readyProjection(request);
      },
    },
    gatewayClient: {
      async invoke(request) {
        return {
          policy_decision: "allow",
          policy_status: "active",
          profile_id: "delivery-refinement-advisor-v1",
          decision_id: request.caller_identity.decision_or_correlation_id,
          caller_id: request.caller_identity.caller_id,
          invocation_path: "governed-ai-gateway",
          task: request.task,
          output: {
            confidence: "medium",
            required_operator_action: "review",
            field_key: "initiative-target-pi",
            value: "PI-2026-04",
            summary: "Use the next admitted increment.",
            rationale: "The operator requested a bounded alternative.",
          },
          audit_ref: "local-ledger:refinement-1",
          generated_at: timestamp,
        };
      },
    },
    runAdapter: {
      async getRun() {
        throw new Error("unused");
      },
      async listRuns() {
        return [];
      },
      async startRun({ request }) {
        return {
          schema_version: 1,
          request_id: request.request_id,
          correlation_id: request.correlation_id,
          run_id: "refinement-run-1",
          state: "accepted",
          replayed: false,
          submitted_at: timestamp,
          updated_at: timestamp,
          poll_ref: `/v1/delivery-refinement/${packageRef}/runs/refinement-run-1`,
          events: [],
          receipt: null,
          failure: null,
        };
      },
    },
    sourceAdapter: {
      async projectPacket() {
        return packet();
      },
    },
    ...overrides,
  });
}

test("Refinement projection combines the canonical packet with durable run history", async () => {
  const result = await service().project({
    callerId: "governance-operations-console",
    correlationId: "correlation-1",
    packageId: packageRef,
    sourceRef,
  });
  assert.equal(result.packet.packet_revision, packet().packet_revision);
  assert.equal(result.active_run, null);
  assert.deepEqual(result.history, []);
});

test("Refinement assist binds CGG projection and governed output to one packet field", async () => {
  const result = await service().assist({
    callerId: "governance-operations-console",
    packageId: packageRef,
    request: assistRequest(),
  });
  assert.equal(result.suggestion.field_key, "initiative-target-pi");
  assert.equal(result.suggestion.value, "PI-2026-04");
  assert.equal(result.required_operator_action, "review");
});

test("Refinement assist rejects a stale packet before context or model invocation", async () => {
  let invoked = false;
  const request = assistRequest();
  request.packet.packet_revision = "version-stale";
  await assert.rejects(
    service({
      contextClient: { async project() { invoked = true; } },
    }).assist({
      callerId: "governance-operations-console",
      packageId: packageRef,
      request,
    }),
    (error) => error instanceof RefinementServiceError && error.code === "packet_stale",
  );
  assert.equal(invoked, false);
});

test("Refinement assist rejects output outside the admitted option set", async () => {
  const base = service();
  await assert.rejects(
    createRefinementService({
      clock: () => new Date(timestamp),
      contextClient: {
        async project(request) { return readyProjection(request); },
      },
      gatewayClient: {
        async invoke(request) {
          return {
            policy_decision: "allow",
            policy_status: "active",
            profile_id: "delivery-refinement-advisor-v1",
            decision_id: request.caller_identity.decision_or_correlation_id,
            caller_id: request.caller_identity.caller_id,
            invocation_path: "governed-ai-gateway",
            task: request.task,
            output: {
              confidence: "high",
              required_operator_action: "review",
              field_key: "initiative-target-pi",
              value: "PI-NOT-ADMITTED",
              summary: "Invalid option.",
              rationale: "Must be rejected.",
            },
            audit_ref: "local-ledger:invalid-1",
            generated_at: timestamp,
          };
        },
      },
      runAdapter: { async listRuns() { return []; } },
      sourceAdapter: { async projectPacket() { return packet(); } },
    }).assist({
      callerId: "governance-operations-console",
      packageId: packageRef,
      request: assistRequest(),
    }),
    (error) => error instanceof RefinementServiceError && error.code === "ai_output_invalid",
  );
  assert.ok(base);
});

test("Refinement apply validates the immutable draft before starting a durable run", async () => {
  let started = 0;
  const runtime = service({
    runAdapter: {
      async listRuns() { return []; },
      async startRun({ request }) {
        started += 1;
        return {
          schema_version: 1,
          request_id: request.request_id,
          correlation_id: request.correlation_id,
          run_id: "refinement-run-1",
          state: "accepted",
          replayed: false,
          submitted_at: timestamp,
          updated_at: timestamp,
          poll_ref: `/v1/delivery-refinement/${packageRef}/runs/refinement-run-1`,
          events: [],
          receipt: null,
          failure: null,
        };
      },
    },
  });
  const result = await runtime.apply({
    callerId: "governance-operations-console",
    packageId: packageRef,
    request: applyRequest(),
  });
  assert.equal(result.state, "accepted");
  assert.equal(started, 1);

  const stale = applyRequest();
  stale.accepted_draft.packet_revision = "version-stale";
  await assert.rejects(
    runtime.apply({
      callerId: "governance-operations-console",
      packageId: packageRef,
      request: stale,
    }),
    (error) =>
      error instanceof RefinementServiceError && error.code === "accepted_draft_stale",
  );
  assert.equal(started, 1);
});
