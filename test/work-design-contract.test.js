import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  assertWorkDesignApplyRequest,
  assertWorkDesignApplyResult,
  assertWorkDesignAssistRequest,
  assertWorkDesignAssistResult,
  assertWorkDesignError,
} from "../src/work-design/contracts.js";

const contractRoot = new URL("../contracts/work-design/", import.meta.url);
const digest = `sha256:${"a".repeat(64)}`;

function workDesignNode(overrides = {}) {
  return {
    id: "feature-1",
    kind: "Feature",
    title: "Deliver operator-visible planning",
    description: "One bounded planning outcome.",
    draft_body: "## What This Achieves\n\nA reviewable package plan.",
    remark: "Keep execution-only metadata out of Work Design.",
    children: [],
    ...overrides,
  };
}

function assistRequest(kind = "context_advice") {
  const request = {
    schema_version: 1,
    request_id: `work-design-${kind}-1`,
    correlation_id: "correlation-1",
    delivery_id: "delivery-884",
    package_ref: "delivery-package:908",
    source_ref: "openproject://work_packages/908",
    source_revision: "version-17",
    operator: {
      id: "operator:workspace-owner",
      handle: "mfshaf7",
    },
    task: {
      kind,
      contract_ref: "oos.delivery-work-design.v1",
      version: "1.0",
    },
    operator_prompt: "Check whether this package has a coherent outcome boundary.",
  };
  if (kind === "context_advice") {
    request.context_draft = {
      decision: "proceed",
      note: "Continue into a bounded Work Design draft.",
    };
  } else {
    request.tree_draft = {
      selected_node_id: "feature-1",
      tree: workDesignNode(),
      tree_digest: digest,
    };
  }
  return request;
}

function assistResult() {
  return {
    schema_version: 1,
    request_id: "work-design-tree_advice-1",
    correlation_id: "correlation-1",
    response_id: "work-design-response-1",
    task_kind: "tree_advice",
    status: "ready",
    confidence: "medium",
    required_operator_action: "review",
    text: "Split the draft into one Feature and two evidence-bearing User stories.",
    affected_node_id: "feature-1",
    patch_proposal: {
      patch_type: "tree_shape",
      summary: "Keep one outcome per Feature branch.",
    },
    evidence: {
      generated_at: "2026-08-25T03:00:00Z",
      model_profile_id: "delivery-work-design-advisor-v1",
      task_contract_ref: "oos.delivery-work-design.v1",
      output_schema_ref: "platform-engineering/security/schemas/delivery-work-design-advice.schema.json",
      cgg_packet_ref: "cgg://packets/work-design-1",
      redaction_receipt_ref: "cgg://receipts/work-design-1",
      gateway_audit_ref: "local-ledger:work-design-1",
    },
  };
}

function applyRequest() {
  return {
    schema_version: 1,
    request_id: "work-design-apply-1",
    correlation_id: "correlation-1",
    idempotency_key: "work-design-908-version-17",
    delivery_id: "delivery-884",
    package_ref: "delivery-package:908",
    source_ref: "openproject://work_packages/908",
    source_revision: "version-17",
    operator: {
      id: "operator:workspace-owner",
    },
    acceptance: {
      decision: "apply",
      accepted_at: "2026-08-25T03:05:00Z",
      accepted_by: "operator:workspace-owner",
      note: "Apply the reviewed tree.",
    },
    accepted_draft: {
      draft_id: "work-design-draft-1",
      draft_digest: digest,
      tree: workDesignNode(),
    },
    advisor_evidence: [
      {
        response_id: "work-design-response-1",
        gateway_audit_ref: "local-ledger:work-design-1",
      },
    ],
  };
}

function applyResult() {
  return {
    schema_version: 1,
    request_id: "work-design-apply-1",
    correlation_id: "correlation-1",
    application_id: "work-design-application-1",
    status: "applied",
    applied_at: "2026-08-25T03:06:00Z",
    applied_by: "operator:workspace-owner",
    accepted_draft_digest: digest,
    target: {
      delivery_ref: "openproject://work_packages/884",
      created_refs: ["openproject://work_packages/1001"],
      updated_refs: [],
      reused_refs: [],
      readback_complete: true,
    },
    receipt: {
      ref: "oos://receipts/work-design-application-1",
      digest,
    },
  };
}

test("Work Design manifest records source runtime without claiming profile activation", () => {
  const manifest = JSON.parse(
    readFileSync(new URL("manifest.json", contractRoot), "utf8"),
  );

  assert.equal(manifest.contract_id, "oos.delivery-work-design.v1");
  assert.deepEqual(manifest.capabilities.live, []);
  assert.equal(manifest.authority_guards.model_output_is_suggestion_only, true);
  assert.equal(manifest.authority_guards.operator_acceptance_required_for_apply, true);
  assert.equal(manifest.authority_guards.direct_provider_access_allowed, false);
  assert.ok(
    manifest.capabilities.contract_admitted.every(
      ({ runtime_status: runtimeStatus }) =>
        runtimeStatus === "implemented-profile-inactive",
    ),
  );
});

test("Work Design assist admits context and tree tasks", () => {
  const contextRequest = assistRequest();
  assert.equal(assertWorkDesignAssistRequest(contextRequest), contextRequest);
  const treeRequest = assistRequest("tree_advice");
  assert.equal(assertWorkDesignAssistRequest(treeRequest), treeRequest);
});

test("Work Design assist rejects missing task context and caller-owned provider fields", () => {
  const missingContext = assistRequest();
  delete missingContext.context_draft;
  assert.throws(
    () => assertWorkDesignAssistRequest(missingContext),
    ({ code }) => code === "work_design_contract_invalid",
  );

  const providerBypass = {
    ...assistRequest(),
    model_profile_id: "operator-selected-model",
  };
  assert.throws(
    () => assertWorkDesignAssistRequest(providerBypass),
    ({ code }) => code === "work_design_contract_invalid",
  );
});

test("Work Design assist result requires typed suggestion evidence", () => {
  const result = assistResult();
  assert.equal(assertWorkDesignAssistResult(result), result);

  const mocked = { ...result, status: "mocked" };
  assert.throws(
    () => assertWorkDesignAssistResult(mocked),
    ({ code }) => code === "work_design_contract_invalid",
  );

  const missingAudit = structuredClone(result);
  delete missingAudit.evidence.gateway_audit_ref;
  assert.throws(
    () => assertWorkDesignAssistResult(missingAudit),
    ({ code }) => code === "work_design_contract_invalid",
  );
});

test("Work Design apply requires explicit matching operator acceptance", () => {
  const request = applyRequest();
  assert.equal(assertWorkDesignApplyRequest(request), request);

  const mismatch = structuredClone(request);
  mismatch.acceptance.accepted_by = "model:delivery-work-design-advisor-v1";
  assert.throws(
    () => assertWorkDesignApplyRequest(mismatch),
    ({ code }) => code === "work_design_operator_acceptance_mismatch",
  );

  const missingAcceptance = structuredClone(request);
  delete missingAcceptance.acceptance;
  assert.throws(
    () => assertWorkDesignApplyRequest(missingAcceptance),
    ({ code }) => code === "work_design_contract_invalid",
  );
});

test("Work Design apply result requires backend readback and a durable receipt", () => {
  const result = applyResult();
  assert.equal(assertWorkDesignApplyResult(result), result);

  const incompleteReadback = structuredClone(result);
  incompleteReadback.target.readback_complete = false;
  assert.throws(
    () => assertWorkDesignApplyResult(incompleteReadback),
    ({ code }) => code === "work_design_contract_invalid",
  );

  const missingReceipt = structuredClone(result);
  delete missingReceipt.receipt;
  assert.throws(
    () => assertWorkDesignApplyResult(missingReceipt),
    ({ code }) => code === "work_design_contract_invalid",
  );
});

test("Work Design errors remain bounded and auditable", () => {
  const error = {
    schema_version: 1,
    correlation_id: "correlation-1",
    code: "ai_profile_inactive",
    message: "The Work Design profile is not active.",
    retryable: false,
    audit_ref: "local-ledger:denied-1",
    receipt_ref: null,
  };
  assert.equal(assertWorkDesignError(error), error);

  assert.throws(
    () => assertWorkDesignError({ ...error, code: "unknown_failure" }),
    ({ code }) => code === "work_design_contract_invalid",
  );
});

test("runtime image includes the Work Design contract bundle", () => {
  const dockerfile = readFileSync(new URL("../Dockerfile", import.meta.url), "utf8");
  assert.match(
    dockerfile,
    /COPY --chown=node:node contracts\/work-design \.\/contracts\/work-design/,
  );
});
