import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  assertRefinementApplyReceipt,
  assertRefinementApplyRequest,
  assertRefinementAssistRequest,
  assertRefinementAssistResult,
  assertRefinementError,
  assertRefinementPacket,
  assertRefinementProjectionResult,
  assertRefinementRunProjection,
} from "../src/refinement/contracts.js";

const contractRoot = new URL("../contracts/refinement/", import.meta.url);
const digest = `sha256:${"a".repeat(64)}`;
const timestamp = "2026-08-26T00:00:00Z";

function operation() {
  return {
    operation_id: "refinement-op-governance",
    kind: "governance",
    label: "Update Epic Governance",
    detail: "Apply reviewed package governance metadata.",
    target: "openproject://work_packages/909",
    oos_route: "POST /v1/delivery-initiatives/{delivery_id}/governance",
    status: "planned",
  };
}

function packet() {
  return {
    schema_version: 1,
    packet_id: "refinement-packet-909",
    packet_revision: "version-3",
    status: "ready_for_review",
    active_step: "readiness_review",
    source: {
      delivery_id: "delivery-884",
      package_ref: "delivery-package:909",
      source_ref: "openproject://work_packages/909",
      source_revision: "version-3",
      source_work_design_receipt_id: "work-design-receipt-909",
      tree_snapshot_ref: "tree://work-design/909/version-3",
      finalized_brief_ref: "brief://work-design/909/final",
    },
    target_tree: {
      id: "feature-909",
      kind: "Feature",
      title: "Deliver Refinement and Catalog",
      description: "One bounded Delivery outcome.",
      draft_body: "## What This Achieves\n\nA governed Refinement path.",
      remark: "Keep runtime activation separate.",
      children: [],
    },
    draft_groups: [
      {
        group_id: "epic-governance",
        title: "Epic Governance",
        summary: "Review package-level governance metadata.",
        fields: [
          {
            field_key: "target-pi",
            backend_field: "target_pi",
            label: "Target PI",
            field_kind: "select",
            required: true,
            status: "dirty",
            value: "PI-2026-03",
            allowed_values: ["PI-2026-03", "PI-2026-04"],
            validation_hint: "Use a broker-projected Target PI.",
            route_binding: {
              operation_kind: "governance",
              oos_route: "POST /v1/delivery-initiatives/{delivery_id}/governance",
              payload_key: "target_pi",
              target: "initiative",
            },
          },
        ],
      },
    ],
    readiness_gates: [
      {
        gate_id: "metadata-review",
        label: "Metadata Review",
        detail: "Every required field has a recorded resolution.",
        status: "passed",
      },
    ],
    apply_plan: {
      summary: "Apply reviewed governance metadata.",
      expected_routes: [
        "POST /v1/delivery-initiatives/{delivery_id}/governance",
      ],
      operations: [operation()],
    },
    last_saved_at: timestamp,
  };
}

function assistRequest() {
  return {
    schema_version: 1,
    request_id: "refinement-assist-1",
    correlation_id: "correlation-1",
    delivery_id: "delivery-884",
    package_ref: "delivery-package:909",
    source_ref: "openproject://work_packages/909",
    source_revision: "version-3",
    operator: { id: "operator:workspace-owner" },
    task: {
      kind: "metadata_advice",
      contract_ref: "oos.delivery-refinement.v1",
      version: "1.0",
    },
    packet: {
      packet_id: "refinement-packet-909",
      packet_revision: "version-3",
      source_work_design_receipt_id: "work-design-receipt-909",
    },
    target: {
      field_key: "target-pi",
      field_label: "Target PI",
      field_kind: "select",
      required: true,
      source_value: "",
      draft_value: "",
      selected_node_ids: ["feature-909"],
      allowed_values: ["PI-2026-03", "PI-2026-04"],
    },
    operator_prompt: "Suggest a valid Target PI from the admitted options.",
  };
}

function assistResult() {
  return {
    schema_version: 1,
    request_id: "refinement-assist-1",
    correlation_id: "correlation-1",
    response_id: "refinement-response-1",
    status: "ready",
    confidence: "medium",
    required_operator_action: "review",
    suggestion: {
      field_key: "target-pi",
      value: "PI-2026-03",
      summary: "Use the current planning increment.",
      rationale: "The package and its parent objective are committed there.",
      resolution: "ai_drafted",
    },
    evidence: {
      generated_at: timestamp,
      model_profile_id: "delivery-refinement-advisor-v1",
      task_contract_ref: "oos.delivery-refinement.v1",
      output_schema_ref: "platform://schemas/delivery-refinement-advice-v1",
      cgg_packet_ref: "cgg://packets/refinement-1",
      redaction_receipt_ref: "cgg://receipts/refinement-1",
      gateway_audit_ref: "local-ledger:refinement-1",
    },
  };
}

function applyRequest() {
  return {
    schema_version: 1,
    request_id: "refinement-apply-1",
    correlation_id: "correlation-1",
    idempotency_key: "refinement-909-version-3",
    delivery_id: "delivery-884",
    package_ref: "delivery-package:909",
    source_ref: "openproject://work_packages/909",
    source_revision: "version-3",
    operator: { id: "operator:workspace-owner" },
    acceptance: {
      decision: "apply",
      accepted_at: timestamp,
      accepted_by: "operator:workspace-owner",
      note: "Apply the reviewed Refinement draft.",
    },
    accepted_draft: {
      packet_id: "refinement-packet-909",
      packet_revision: "version-3",
      draft_digest: digest,
      source_work_design_receipt_id: "work-design-receipt-909",
      metadata_values: { target_pi: "PI-2026-03" },
      metadata_resolutions: { target_pi: "accepted" },
      apply_plan: {
        summary: "Apply reviewed governance metadata.",
        expected_routes: [
          "POST /v1/delivery-initiatives/{delivery_id}/governance",
        ],
        operations: [operation()],
      },
    },
    advisor_evidence: [
      {
        response_id: "refinement-response-1",
        gateway_audit_ref: "local-ledger:refinement-1",
      },
    ],
  };
}

function receipt() {
  return {
    receipt_id: "refinement-receipt-1",
    receipt_ref: "oos://receipts/refinement-receipt-1",
    receipt_digest: digest,
    run_id: "refinement-run-1",
    applied_at: timestamp,
    applied_by: "operator:workspace-owner",
    accepted_draft_digest: digest,
    source_work_design_receipt_id: "work-design-receipt-909",
    target: {
      delivery_ref: "openproject://work_packages/884",
      created_refs: [],
      updated_refs: ["openproject://work_packages/909"],
      reused_refs: [],
      readback_complete: true,
      source_revision: "version-4",
    },
  };
}

function runProjection() {
  return {
    schema_version: 1,
    request_id: "refinement-apply-1",
    correlation_id: "correlation-1",
    run_id: "refinement-run-1",
    state: "completed",
    replayed: false,
    submitted_at: timestamp,
    updated_at: timestamp,
    poll_ref: "/v1/delivery-refinement/delivery-package:909/runs/refinement-run-1",
    events: [
      {
        event_id: "refinement-event-1",
        sequence: 1,
        event_type: "readback_completed",
        recorded_at: timestamp,
        message: "Canonical readback completed.",
        status: "completed",
      },
    ],
    receipt: receipt(),
    failure: null,
  };
}

test("Refinement manifest admits contracts without claiming a live runtime", () => {
  const manifest = JSON.parse(
    readFileSync(new URL("manifest.json", contractRoot), "utf8"),
  );
  assert.equal(manifest.contract_id, "oos.delivery-refinement.v1");
  assert.deepEqual(manifest.capabilities.live, []);
  assert.equal(manifest.authority_guards.model_output_is_suggestion_only, true);
  assert.equal(manifest.authority_guards.operator_acceptance_required_for_apply, true);
  assert.equal(manifest.authority_guards.direct_temporal_access_from_console_allowed, false);
});

test("Refinement packet preserves semantic Console data without presentation tone", () => {
  const value = packet();
  assert.equal(assertRefinementPacket(value), value);
  assert.throws(
    () => assertRefinementPacket({ ...value, tone: "ok" }),
    ({ code }) => code === "refinement_contract_invalid",
  );
  const undeclaredRoute = structuredClone(value);
  undeclaredRoute.apply_plan.expected_routes = [];
  assert.throws(
    () => assertRefinementPacket(undeclaredRoute),
    ({ code }) => code === "refinement_apply_plan_route_mismatch",
  );
});

test("Refinement assist is typed, suggestion-only, and provider-neutral", () => {
  assert.equal(assertRefinementAssistRequest(assistRequest()).task.kind, "metadata_advice");
  assert.equal(assertRefinementAssistResult(assistResult()).required_operator_action, "review");
  assert.throws(
    () => assertRefinementAssistRequest({ ...assistRequest(), model_profile_id: "caller-choice" }),
    ({ code }) => code === "refinement_contract_invalid",
  );
  assert.throws(
    () => assertRefinementAssistResult({ ...assistResult(), status: "mocked" }),
    ({ code }) => code === "refinement_contract_invalid",
  );
});

test("Refinement apply binds matching operator acceptance and metadata resolutions", () => {
  assert.equal(assertRefinementApplyRequest(applyRequest()).acceptance.decision, "apply");
  const wrongOperator = structuredClone(applyRequest());
  wrongOperator.acceptance.accepted_by = "model:delivery-refinement-advisor-v1";
  assert.throws(
    () => assertRefinementApplyRequest(wrongOperator),
    ({ code }) => code === "refinement_operator_acceptance_mismatch",
  );
  const missingResolution = structuredClone(applyRequest());
  missingResolution.accepted_draft.metadata_values.owner_repo = "operator-orchestration-service";
  assert.throws(
    () => assertRefinementApplyRequest(missingResolution),
    ({ code }) => code === "refinement_metadata_resolution_mismatch",
  );
});

test("Refinement durable run cannot report completion without readback receipt", () => {
  assert.equal(assertRefinementApplyReceipt(receipt()).target.readback_complete, true);
  assert.equal(assertRefinementRunProjection(runProjection()).state, "completed");
  const missingReceipt = structuredClone(runProjection());
  missingReceipt.receipt = null;
  assert.throws(
    () => assertRefinementRunProjection(missingReceipt),
    ({ code }) => code === "refinement_contract_invalid",
  );
  const duplicateSequence = structuredClone(runProjection());
  duplicateSequence.events.push({
    ...duplicateSequence.events[0],
    event_id: "refinement-event-2",
  });
  assert.throws(
    () => assertRefinementRunProjection(duplicateSequence),
    ({ code }) => code === "refinement_event_sequence_invalid",
  );
});

test("runtime image includes the Refinement contract bundle", () => {
  const dockerfile = readFileSync(new URL("../Dockerfile", import.meta.url), "utf8");
  assert.match(
    dockerfile,
    /COPY --chown=node:node contracts\/refinement \.\/contracts\/refinement/,
  );
});

test("Refinement projection and bounded errors remain strictly versioned", () => {
  const run = runProjection();
  const projection = {
    schema_version: 1,
    package_ref: "delivery-package:909",
    source_revision: "version-4",
    packet: packet(),
    active_run: null,
    latest_run: run,
    history: [run],
    projected_at: timestamp,
  };
  assert.equal(assertRefinementProjectionResult(projection), projection);
  assert.equal(
    assertRefinementError({
      schema_version: 1,
      correlation_id: "correlation-1",
      code: "packet_stale",
      message: "The packet revision changed before apply.",
      retryable: true,
    }).code,
    "packet_stale",
  );
});
