import test from "node:test";
import assert from "node:assert/strict";

import { HttpError } from "../src/errors.js";
import {
  createDeliveryIngressService,
  deliveryIngressId,
} from "../src/delivery-ingress/service.js";
import { createProposalDeliveryIngressAdapter } from "../src/delivery-ingress/proposal-adapter.js";

const NOW = "2026-08-25T03:10:00.000Z";

function proposalEnvelope(overrides = {}) {
  const source = {
    kind: "proposal",
    record_ref: "openproject://work_packages/851",
    record_version: "version-19",
    status: "accepted",
    packet_ref: "proposal-packet:851",
    packet_digest: null,
    custody: {
      classification: "existing-repo",
      repository_mode: "existing",
      repository_gate_state: "resolved",
      owner: "governance-operations-console",
      source_ref: "repo:governance-operations-console",
      rationale: "The existing product repository owns the source.",
    },
  };
  return {
    schema_version: 1,
    ingress_id: deliveryIngressId({
      packetRef: source.packet_ref,
      sourceKind: source.kind,
      sourceRecordRef: source.record_ref,
    }),
    application_id: "proposal-application:851:delivery-1",
    authority: {
      record_system: "openproject",
      record_project: "workspace-delivery-art",
      mutation_adapter: "operator-orchestration-service",
    },
    source,
    operator: {
      id: "operator:workspace-owner",
      handle: "mfshaf7",
    },
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
      triage_summary: "The Proposal is ready for a target application.",
      decision_notes: "Accepted for governed Delivery.",
    },
    receipt_ref: "proposal-target-receipt:idea-851:abc123",
    ...overrides,
  };
}

function prototypeEnvelope(overrides = {}) {
  const source = {
    kind: "prototype",
    record_ref: "prototype://records/console-planner",
    record_version: "baseline-version:3",
    status: "baseline-approved",
    packet_ref: "prototype-delivery-packet:console-planner:3",
    packet_digest: `sha256:${"a".repeat(64)}`,
    custody: {
      classification: "existing-repo",
      repository_mode: "existing",
      repository_gate_state: "resolved",
      owner: "governance-operations-console",
      source_ref: "repo:governance-operations-console",
      rationale: "The graduated product repository owns the source.",
    },
  };
  return {
    schema_version: 1,
    ingress_id: deliveryIngressId({
      packetRef: source.packet_ref,
      sourceKind: source.kind,
      sourceRecordRef: source.record_ref,
    }),
    application_id: "prototype-application:console-planner:3",
    authority: {
      record_system: "openproject",
      record_project: "workspace-delivery-art",
      mutation_adapter: "operator-orchestration-service",
    },
    source,
    operator: { id: "operator:workspace-owner", handle: "mfshaf7" },
    target: {
      record_type: "delivery-epic",
      owner_repo: "governance-operations-console",
      target_pi: null,
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
    ...overrides,
  };
}

test("Delivery ingress applies a Proposal through one source adapter and returns target-owned evidence", async () => {
  const calls = [];
  const sourceRecord = {
    deliveryRef: "openproject://work_packages/901",
    ideaId: "idea-851",
    recordRef: "openproject://work_packages/851",
  };
  const openProjectClient = {
    async consumeAcceptedIdea(input) {
      calls.push(input);
      return {
        deliveryCreated: true,
        deliveryRecord: { recordRef: "openproject://work_packages/901" },
        sourceRecord,
      };
    },
  };
  const service = createDeliveryIngressService({
    adapters: {
      proposal: createProposalDeliveryIngressAdapter({ openProjectClient }),
    },
    clock: () => new Date(NOW),
  });

  const applied = await service.apply({
    envelope: proposalEnvelope(),
    sourceContext: { currentRecord: sourceRecord, recordId: 851 },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].ownerRepo, "governance-operations-console");
  assert.equal(calls[0].targetPi, null);
  assert.equal(applied.sourceRecord, sourceRecord);
  assert.equal(applied.result.target.application_state, "created");
  assert.equal(applied.result.target.source_backlink_state, "recorded");
  assert.equal(applied.result.receipt.receipt_ref, proposalEnvelope().receipt_ref);
  assert.equal(applied.result.receipt.recorded_at, NOW);
});

test("Delivery ingress fails closed when a contract-admitted source adapter is not registered", async () => {
  const service = createDeliveryIngressService({ adapters: {} });

  await assert.rejects(
    () => service.apply({ envelope: prototypeEnvelope() }),
    (error) =>
      error instanceof HttpError &&
      error.code === "delivery_ingress_source_not_implemented" &&
      error.statusCode === 501,
  );
});

test("Delivery ingress rejects stale identities, incomplete custody, and source-evidence mismatches before mutation", async () => {
  let calls = 0;
  const service = createDeliveryIngressService({
    adapters: {
      proposal: {
        async apply() {
          calls += 1;
          throw new Error("must not be called");
        },
      },
    },
  });
  const invalidEnvelopes = [
    proposalEnvelope({ ingress_id: "delivery-ingress:proposal:stale" }),
    proposalEnvelope({
      source: {
        ...proposalEnvelope().source,
        custody: {
          ...proposalEnvelope().source.custody,
          repository_gate_state: "pending",
        },
      },
    }),
    proposalEnvelope({
      evidence: {
        ...proposalEnvelope().evidence,
        source_kind: "prototype",
      },
    }),
  ];

  for (const envelope of invalidEnvelopes) {
    await assert.rejects(
      () => service.apply({ envelope }),
      (error) => error instanceof HttpError,
    );
  }
  assert.equal(calls, 0);
});

test("Delivery ingress rejects Proposal runtime context that does not match the envelope", async () => {
  let calls = 0;
  const service = createDeliveryIngressService({
    adapters: {
      proposal: createProposalDeliveryIngressAdapter({
        openProjectClient: {
          async consumeAcceptedIdea() {
            calls += 1;
          },
        },
      }),
    },
  });

  await assert.rejects(
    () => service.apply({
      envelope: proposalEnvelope(),
      sourceContext: {
        currentRecord: {
          ideaId: "idea-999",
          recordRef: "openproject://work_packages/851",
        },
        recordId: 851,
      },
    }),
    (error) =>
      error instanceof HttpError &&
      error.code === "delivery_ingress_source_context_mismatch",
  );
  assert.equal(calls, 0);
});
