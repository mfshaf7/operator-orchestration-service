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

test("Repository linking uses the Delivery command identity as its Catalog correlation", () => {
  const linked = command({
    type: "link_repository",
    payload: {
      work_item_id: "work-item-1028",
      owner_repo: "operator-orchestration-service",
      catalog_item_id: "owner-repo",
      catalog_request: {
        schema_version: 1,
        request_id: "catalog-mutation-1028",
        correlation_id: "another-command",
        idempotency_key: "owner-repo-oos-v1",
        source_revision: "catalog-version-1",
        catalog_item_id: "owner-repo",
        mode: "add",
        target_value_id: null,
        operator: { id: "operator:workspace-owner" },
        acceptance: {
          decision: "apply",
          accepted_at: timestamp,
          accepted_by: "operator:workspace-owner",
          note: "Link the admitted repository.",
        },
        draft: {
          value_key: "operator-orchestration-service",
          label: "Operator Orchestration Service",
          description: "Shared operator workflow broker.",
          parent_catalog_value_key: null,
          planning_window_start_date: null,
          planning_window_end_date: null,
          repository_binding: {
            repo_name: "operator-orchestration-service",
            repo_ref: "repo://operator-orchestration-service",
            catalog_value_key: "operator-orchestration-service",
            receipt: {
              receipt_id: "repository-readiness-receipt:1234567890abcdef12345678",
              uri: `wgcf://receipts/repository-readiness/repository-readiness-receipt-1234567890abcdef12345678-${"c".repeat(64)}.json`,
              digest: `sha256:${"c".repeat(64)}`,
              issuer: "workspace-governance-control-fabric",
              target_scope: "repo:operator-orchestration-service",
              outcome: "ready",
              evaluated_at: timestamp,
              generation: 1,
            },
          },
        },
      },
    },
  });

  assert.throws(
    () => assertDeliveryChangeCommand(linked),
    ({ code }) => code === "delivery_change_repository_identity_mismatch",
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
