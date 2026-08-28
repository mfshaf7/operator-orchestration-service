import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  assertDeliveryChangeCommand,
  assertDeliveryChangeProjection,
} from "../src/delivery-change/contracts.js";

const timestamp = "2026-08-29T00:00:00Z";
const revision = `delivery-package:sha256:${"a".repeat(64)}`;

function command(operation = {
  type: "revise_work_item",
  payload: {
    work_item_id: "work-item-1028",
    changes: { subject: "Authoritative Delivery change contract" },
  },
}) {
  return {
    schema_version: 1,
    command_id: "delivery-change-command:1028-1",
    delivery_id: "delivery-886",
    expected_source_revision: revision,
    operator: { id: "operator:workspace-owner" },
    acceptance: {
      decision: "apply",
      accepted_at: timestamp,
      accepted_by: "operator:workspace-owner",
      note: "Apply the reviewed in-flight change.",
    },
    operation,
  };
}

test("Delivery change manifest keeps mutation authorities separated", () => {
  const manifest = JSON.parse(readFileSync(
    new URL("../contracts/delivery-change/manifest.json", import.meta.url),
    "utf8",
  ));
  assert.equal(manifest.workflow_authority, "operator-orchestration-service");
  assert.equal(manifest.authority_guards.repository_creation_allowed, false);
  assert.equal(manifest.authority_guards.silent_partial_success_allowed, false);
  assert.equal(
    manifest.authority_guards.automatic_rollback_without_proven_inverse_allowed,
    false,
  );
});

test("Delivery change command binds acceptance, revision, and typed payload", () => {
  assert.equal(assertDeliveryChangeCommand(command()).operation.type, "revise_work_item");

  const wrongOperator = structuredClone(command());
  wrongOperator.acceptance.accepted_by = "operator:someone-else";
  assert.throws(
    () => assertDeliveryChangeCommand(wrongOperator),
    ({ code }) => code === "delivery_change_operator_acceptance_mismatch",
  );

  const unknownField = structuredClone(command());
  unknownField.operation.payload.changes.presentation_tone = "green";
  assert.throws(
    () => assertDeliveryChangeCommand(unknownField),
    ({ code }) => code === "delivery_change_contract_invalid",
  );
});

test("Delivery change projection contains canonical package truth, not UI state", () => {
  const projection = {
    schema_version: 1,
    delivery_id: "delivery-886",
    record_ref: "openproject://work_packages/886",
    source_revision: revision,
    projection_state: "current",
    package: {
      execution_tree: {
        id: 886,
        record_ref: "openproject://work_packages/886",
        status: "in progress",
        subject: "Governed Console Execution",
        type: "Epic",
        children: [],
      },
      dependency_relations: [],
    },
    last_event_ref: null,
    projected_at: timestamp,
  };
  assert.equal(assertDeliveryChangeProjection(projection), projection);
  projection.tone = "ok";
  assert.throws(
    () => assertDeliveryChangeProjection(projection),
    ({ code }) => code === "delivery_change_contract_invalid",
  );
});

test("runtime image includes the Delivery change contract bundle", () => {
  const dockerfile = readFileSync(new URL("../Dockerfile", import.meta.url), "utf8");
  assert.match(
    dockerfile,
    /COPY --chown=node:node contracts\/delivery-change \.\/contracts\/delivery-change/,
  );
});
