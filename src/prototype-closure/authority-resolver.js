import { closureDigest, closureError } from "./contracts.js";

const sha256 = /^sha256:[0-9a-f]{64}$/;
const fieldsByAction = {
  "apply-delivery": [
    ["accepted_baseline_receipt_ref", "operator-orchestration-service"],
    ["target_delivery_ref", "workspace-delivery-art"],
    ["accepted_delivery_target_receipt_ref", "operator-orchestration-service"],
  ],
  "graduate-source": [
    ["accepted_delivery_target_receipt_ref", "operator-orchestration-service"],
    ["durable_owner_acceptance_ref", "requested-owner"],
  ],
  "retire-incubation": [
    ["retention_plan_ref", "workspace-prototype-studio"],
    ["runtime_disposition_plan_ref", "platform-engineering"],
    ["runtime_disposition_proof_ref", "platform-engineering"],
  ],
  "reopen-incubation": [
    ["prior_retirement_receipt_ref", "operator-orchestration-service"],
    ["retained_source_readback_ref", "workspace-prototype-studio"],
  ],
};

function requireBinding(condition, code, message) {
  if (!condition) throw closureError(code, message);
}

export function createPrototypeClosureAuthorityResolver({ readEvidence }) {
  if (typeof readEvidence !== "function") {
    throw closureError("owner_reader_missing", "Prototype Closure requires owner-backed evidence readers.", 503);
  }

  return {
    async resolve(request, readiness, source) {
      requireBinding(readiness?.readiness?.outcome === "ready" &&
        source?.source_revision === request.expected_source_revision,
      "authority_source_stale", "Closure target reconciliation requires current ready source evidence.");
      const rows = readiness.readiness.evidence;
      requireBinding(Array.isArray(rows) && rows.length <= 16, "authority_evidence_invalid", "Closure readiness evidence is invalid.");
      const needed = [...fieldsByAction[request.action]];
      if (request.action === "graduate-source") {
        needed.push([request.transfer_strategy === "transfer" ? "source_transfer_receipt_ref" : "already_owned_source_proof_ref", "requested-owner"]);
      }
      const current = {};
      for (const [field, owner] of needed) {
        const matches = rows.filter((row) => row.field === field);
        requireBinding(matches.length === 1 && matches[0].state === "accepted" && sha256.test(matches[0].digest),
          "authority_evidence_invalid", `Closure requires one accepted ${field} evidence row.`);
        const row = matches[0];
        const expectedOwner = owner === "requested-owner" ? request.durable_owner_ref : owner;
        requireBinding(row.owner_ref === expectedOwner && (!request[field] || request[field] === row.ref),
          "authority_evidence_mismatch", `Closure ${field} differs from the accepted request or owner.`);
        const observed = await readEvidence({ field, ref: row.ref, ownerRef: expectedOwner, request, source });
        requireBinding(observed?.ref === row.ref && observed?.owner_ref === expectedOwner &&
          observed?.digest === row.digest && observed?.state === "accepted" &&
          (observed?.subject_ref ?? null) === (row.subject_ref ?? null) &&
          (observed?.source_revision ?? null) === (row.source_revision ?? null) &&
          (observed?.source_packet_ref ?? null) === (row.source_packet_ref ?? null) &&
          (observed?.prototype_id ?? null) === (row.prototype_id ?? null),
        "authority_readback_changed", `Current ${field} owner readback differs from WGCF readiness.`);
        current[field] = observed;
      }

      if (request.action === "apply-delivery") {
        requireBinding(Boolean(source.design_baseline_ref && source.delivery_packet_ref) &&
          current.accepted_baseline_receipt_ref.subject_ref === source.design_baseline_ref &&
          current.accepted_baseline_receipt_ref.prototype_id === request.prototype_id &&
          current.accepted_delivery_target_receipt_ref.subject_ref === current.target_delivery_ref.ref &&
          current.accepted_delivery_target_receipt_ref.source_packet_ref === source.delivery_packet_ref &&
          current.accepted_delivery_target_receipt_ref.prototype_id === request.prototype_id,
        "delivery_target_unproven", "Delivery target or baseline acceptance no longer binds Studio source.");
      } else if (request.action === "graduate-source") {
        const proof = current[request.transfer_strategy === "transfer" ? "source_transfer_receipt_ref" : "already_owned_source_proof_ref"];
        requireBinding(source.project_phase === "delivery-governed" &&
          source.accepted_delivery_target_receipt_ref === current.accepted_delivery_target_receipt_ref.ref &&
          current.accepted_delivery_target_receipt_ref.source_packet_ref === source.delivery_packet_ref &&
          current.accepted_delivery_target_receipt_ref.prototype_id === request.prototype_id &&
          current.durable_owner_acceptance_ref.subject_ref === request.durable_repo_ref &&
          proof.subject_ref === request.durable_repo_ref && proof.source_revision === request.expected_source_revision &&
          ["dedicated-owner-repo", "shared-owner-repo"].includes(proof.observed_source_custody),
        "durable_custody_unproven", "Durable owner custody does not bind this exact Studio source.");
      } else if (request.action === "retire-incubation") {
        requireBinding(current.runtime_disposition_proof_ref.subject_ref === request.runtime_disposition_plan_ref,
          "runtime_disposition_unproven", "Platform disposition proof differs from the accepted runtime plan.");
      } else if (request.action === "reopen-incubation") {
        requireBinding(Boolean(source.retirement_ref) &&
          current.prior_retirement_receipt_ref.subject_ref === source.retirement_ref &&
          current.retained_source_readback_ref.source_revision === request.expected_source_revision,
        "retirement_unproven", "Retained Studio source does not bind the prior retirement receipt.");
      }

      const resolved = {
        artifact_type: "prototype-closure-resolved-authority",
        issuer: "operator-orchestration-service",
        request_digest: closureDigest(request, { ascii: true }),
        verification: {
          state: "accepted", source_revision: request.expected_source_revision,
          evidence_refs: needed.map(([field]) => current[field].ref),
        },
      };
      for (const [field] of needed) resolved[field] = current[field].ref;
      for (const field of ["durable_owner_ref", "durable_repo_ref", "runtime_disposition_plan_ref"]) {
        if (request[field]) resolved[field] = request[field];
      }
      if (request.action === "graduate-source") {
        resolved.observed_source_custody = current[request.transfer_strategy === "transfer" ? "source_transfer_receipt_ref" : "already_owned_source_proof_ref"].observed_source_custody;
      }
      if (request.action === "reopen-incubation") resolved.prior_retirement_event_ref = source.retirement_ref;
      return resolved;
    },
  };
}
