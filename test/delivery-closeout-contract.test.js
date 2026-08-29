import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  assertDeliveryCloseoutCommand,
  assertDeliveryCloseoutProjection,
} from "../src/delivery-closeout/contracts.js";

const timestamp = "2026-08-29T00:00:00Z";
const revision = `delivery-package:sha256:${"a".repeat(64)}`;

function command(impact = { kind: "none" }) {
  return {
    schema_version: 1,
    command_id: "delivery-closeout-command:1030-1",
    delivery_id: "delivery-886",
    expected_source_revision: revision,
    operator: { id: "operator:workspace-owner" },
    acceptance: {
      decision: "apply",
      accepted_at: timestamp,
      accepted_by: "operator:workspace-owner",
      note: "Apply the reviewed Delivery closeout.",
    },
    operation: {
      type: "apply_closeout",
      payload: {
        evidence: {
          changed_surfaces: "- Delivery closeout API.",
          completion_summary: "Delivery work is complete.",
          demo_evidence: "System demo receipt.",
          demo_outcome: "reviewed",
          demo_summary: "The completed behavior was demonstrated.",
          evidence_refs: ["review-packet://delivery-886/final"],
          inspect_action_items: "- Retain outcome history.",
          inspect_summary: "Closeout evidence was inspected.",
          test_result_evidence: "- PASS: npm test",
          validation_evidence: "- PASS: composed closeout proof",
        },
        impact,
      },
    },
  };
}

test("Delivery closeout manifest denies downstream and browser authority", () => {
  const manifest = JSON.parse(readFileSync(
    new URL("../contracts/delivery-closeout/manifest.json", import.meta.url),
    "utf8",
  ));
  assert.equal(manifest.workflow_authority, "operator-orchestration-service");
  assert.equal(manifest.authority_guards.single_writer_runtime_required, true);
  assert.equal(manifest.authority_guards.downstream_mutation_allowed, false);
  assert.equal(manifest.authority_guards.browser_derived_completion_allowed, false);
  assert.equal(manifest.authority_guards.silent_partial_success_allowed, false);
});

test("Delivery closeout command binds operator, revision, evidence, and impact", () => {
  assert.equal(assertDeliveryCloseoutCommand(command()).operation.type, "apply_closeout");

  const wrongOperator = structuredClone(command());
  wrongOperator.acceptance.accepted_by = "operator:someone-else";
  assert.throws(
    () => assertDeliveryCloseoutCommand(wrongOperator),
    ({ code }) => code === "delivery_closeout_operator_acceptance_mismatch",
  );

  const wrongProduct = command({
    kind: "existing_product_change",
    active_product: {
      product_id: "governance-console",
      registry_ref: "workspace-governance://products/wrong-product",
      registry_version: "products-v4",
    },
    change_summary: "Delivery updated the product.",
    product_owner_ref: "repo://governance-operations-console",
  });
  assert.throws(
    () => assertDeliveryCloseoutCommand(wrongProduct),
    ({ code }) => code === "delivery_closeout_product_identity_mismatch",
  );
});

test("Delivery closeout projection contains normalized authority truth only", () => {
  const projection = {
    schema_version: 1,
    delivery_id: "delivery-886",
    record_ref: "openproject://work_packages/886",
    source_revision: revision,
    projection_state: "ready",
    package: { subject: "Governed execution", status: "in-progress" },
    readiness: {
      readiness_ref: `openproject://work_packages/886#closeout-readiness@${revision}`,
      ready_for_closing: true,
      ready_for_closeout: true,
      reasons: [],
      counts: {
        blocked: 0,
        open_descendants: 0,
        weak_evidence: 0,
        weak_done_narrative: 0,
        without_evidence: 0,
        without_owner: 0,
      },
      evidence_refs: [],
    },
    outcome_history: [],
    last_event_ref: null,
    next_action: {
      code: "prepare_delivery_closeout",
      label: "Prepare Delivery Closeout",
      authority: "governance-operations-console",
    },
    projected_at: timestamp,
  };
  assert.equal(assertDeliveryCloseoutProjection(projection), projection);
  projection.tone = "ok";
  assert.throws(
    () => assertDeliveryCloseoutProjection(projection),
    ({ code }) => code === "delivery_closeout_contract_invalid",
  );
});

test("runtime image includes the Delivery closeout contract bundle", () => {
  const dockerfile = readFileSync(new URL("../Dockerfile", import.meta.url), "utf8");
  assert.match(
    dockerfile,
    /COPY --chown=node:node contracts\/delivery-closeout \.\/contracts\/delivery-closeout/,
  );
});
