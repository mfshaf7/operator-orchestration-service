import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const contractRoot = new URL("../contracts/delivery-ingress/", import.meta.url);

function readJson(filename) {
  return JSON.parse(readFileSync(new URL(filename, contractRoot), "utf8"));
}

function compile(filename) {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  return ajv.compile(readJson(filename));
}

function resolvedCustody() {
  return {
    classification: "existing-repo",
    repository_mode: "existing",
    repository_gate_state: "resolved",
    owner: "governance-operations-console",
    source_ref: "repo:governance-operations-console",
    rationale: "The existing product repository owns the source.",
  };
}

function baseEnvelope() {
  return {
    schema_version: 1,
    ingress_id: `delivery-ingress:proposal:${"a".repeat(64)}`,
    application_id: "proposal-application:851:delivery-1",
    authority: {
      record_system: "openproject",
      record_project: "workspace-delivery-art",
      mutation_adapter: "operator-orchestration-service",
    },
    source: {
      kind: "proposal",
      record_ref: "openproject://work_packages/851",
      record_version: "version-19",
      status: "accepted",
      packet_ref: "proposal-packet:851",
      packet_digest: null,
      custody: resolvedCustody(),
    },
    operator: { id: "operator:workspace-owner", handle: "mfshaf7" },
    target: {
      record_type: "delivery-epic",
      owner_repo: "governance-operations-console",
      target_pi: null,
    },
    evidence: {
      source_kind: "proposal",
      proposal_id: "idea-851",
      title: "Live Proposal integration",
      body: "Build the live Proposal integration.",
      triage_summary: "Ready for target application.",
      decision_notes: "Accepted for governed Delivery.",
    },
    receipt_ref: "proposal-target-receipt:idea-851:abc123",
  };
}

test("Delivery ingress contract admits Proposal compatibility and versioned Prototype evidence", () => {
  const validate = compile("application-envelope.schema.json");
  const proposal = baseEnvelope();
  const prototype = {
    ...baseEnvelope(),
    ingress_id: `delivery-ingress:prototype:${"b".repeat(64)}`,
    application_id: "prototype-application:console-planner:3",
    source: {
      kind: "prototype",
      record_ref: "prototype://records/console-planner",
      record_version: "baseline-version:3",
      status: "baseline-approved",
      packet_ref: "prototype-delivery-packet:console-planner:3",
      packet_digest: `sha256:${"c".repeat(64)}`,
      custody: resolvedCustody(),
    },
    evidence: {
      source_kind: "prototype",
      prototype_id: "console-planner",
      title: "Console planning assistant",
      objective: "Continue the approved prototype as governed Delivery work.",
      included_scope: ["Planning workflow"],
      excluded_scope: ["Production model activation"],
      remaining_work: ["Wire canonical backend state"],
      baseline_ref: "prototype-baseline:console-planner:3",
      baseline_version: "baseline-version:3",
      evidence_refs: ["evidence:console-planner:preview"],
    },
    receipt_ref: "prototype-target-receipt:console-planner:3",
  };

  assert.equal(validate(proposal), true, JSON.stringify(validate.errors));
  assert.equal(validate(prototype), true, JSON.stringify(validate.errors));
  assert.equal(
    validate({
      ...prototype,
      source: { ...prototype.source, packet_digest: null },
    }),
    false,
  );
  assert.equal(
    validate({
      ...proposal,
      source: {
        ...proposal.source,
        custody: {
          ...proposal.source.custody,
          repository_gate_state: "pending",
        },
      },
    }),
    false,
  );
});

test("Delivery ingress result requires one target and a recorded reciprocal backlink", () => {
  const validate = compile("target-application-result.schema.json");
  const result = {
    schema_version: 1,
    ingress_id: `delivery-ingress:proposal:${"a".repeat(64)}`,
    application_id: "proposal-application:851:delivery-1",
    source: {
      kind: "proposal",
      record_ref: "openproject://work_packages/851",
      record_version: "version-19",
      packet_ref: "proposal-packet:851",
      packet_digest: null,
    },
    target: {
      record_ref: "openproject://work_packages/901",
      record_system: "openproject",
      record_project: "workspace-delivery-art",
      record_type: "delivery-epic",
      application_state: "created",
      source_backlink_state: "recorded",
    },
    receipt: {
      receipt_ref: "proposal-target-receipt:idea-851:abc123",
      owner: "operator-orchestration-service",
      recorded_at: "2026-08-25T03:10:00Z",
    },
  };

  assert.equal(validate(result), true, JSON.stringify(validate.errors));
  assert.equal(
    validate({
      ...result,
      target: { ...result.target, source_backlink_state: "missing" },
    }),
    false,
  );
});

test("Delivery ingress manifest keeps Proposal live and Prototype fail-closed", () => {
  const manifest = readJson("manifest.json");
  const dockerfile = readFileSync(new URL("../../Dockerfile", contractRoot), "utf8");

  assert.equal(manifest.target_authority, "openproject://projects/workspace-delivery-art");
  assert.equal(manifest.mutation_adapter, "operator-orchestration-service");
  assert.equal(manifest.source_classes.proposal.runtime_status, "live");
  assert.equal(manifest.source_classes.prototype.contract_status, "contract-admitted");
  assert.equal(manifest.source_classes.prototype.runtime_status, "not-implemented");
  assert.equal(manifest.invariants.one_target_per_ingress, true);
  assert.match(
    dockerfile,
    /COPY --chown=node:node contracts\/delivery-ingress \.\/contracts\/delivery-ingress/,
  );
});
