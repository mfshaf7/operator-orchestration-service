import {
  bindPrototypeMaturity,
  prototypeMaturityReference,
} from "../../src/prototype-maturity/contracts.js";

export const caller = "governance-operations-console";
export const at = "2026-09-10T02:00:00.000Z";
export const revision = "1".repeat(40);
const checks = [
  "request-integrity",
  "lifecycle-source-state",
  "source-version-freshness",
  "packet-integrity",
  "required-evidence",
  "boundary-coherence",
  "security-trigger-disposition",
  "open-issue-disposition",
];
const sections = {
  "candidate-promotion": [
    "candidate-brief",
    "scope-and-non-goals",
    "boundaries-and-risks",
  ],
  "baseline-promotion": [
    "definition",
    "design-and-workflow",
    "evidence",
    "boundaries",
    "issues-and-risk-disposition",
  ],
};

function values(transition) {
  if (transition === "baseline-promotion") {
    return {
      "baseline-title": "Sample accepted baseline",
      "baseline-statement": "The local design and workflow are accepted.",
      "accepted-summary": "The reviewed operator workflow and local proof.",
      "excluded-summary": "Delivery and runtime authority remain excluded.",
      "selected-evidence-refs": ["evidence://sample/design-review"],
      "missing-evidence-disposition": "No required local evidence is missing.",
      "issue-and-risk-disposition": "No open issue blocks local baseline approval.",
    };
  }
  return {
    "prototype-objective": "Prove a bounded workflow.",
    "target-user": "Workspace operator",
    "expected-proof": "A deterministic local transition with review evidence.",
    "accepted-scope": ["Local Prototype workflow", "Synthetic evidence"],
    "excluded-scope": ["Live backend authority", "Public exposure"],
    "boundary-clarifications": "Source remains in Workspace Prototype Studio.",
    "open-issue-disposition": "No issue blocks candidate shaping.",
  };
}

export function commandFixture(transition = "candidate-promotion", sequence = 1) {
  const baseline = transition === "baseline-promotion";
  const lifecycle = baseline ? "candidate" : "exploring";
  const expectedState = {
    source_revision: revision,
    record_digest: `sha256:${"2".repeat(64)}`,
    lifecycle,
  };
  const request = bindPrototypeMaturity(
    {
      schema_version: 1,
      artifact_type: "prototype-maturity-request",
      request_id: `prototype-maturity-request:sample-tool:${sequence}`,
      requested_at: at,
      operator_ref: caller,
      prototype_id: "prototype:sample-tool",
      transition,
      source_lifecycle: lifecycle,
      target_lifecycle: baseline ? "baseline-approved" : "candidate",
      expected_state: expectedState,
      inputs: {
        source_refs: [
          "record://prototype-landings/sample-tool",
          "repo://workspace-prototype-studio/docs/prototypes/sample-tool/brief.md",
        ],
        editable_values: values(transition),
      },
      correlation_id: `prototype-maturity:sample-tool:${sequence}`,
      idempotency_key: `prototype-maturity:sample-tool:${sequence}`,
    },
    "request_digest",
  );
  const packet = bindPrototypeMaturity(
    {
      schema_version: 1,
      artifact_type: "prototype-maturity-packet",
      packet_id: `prototype-maturity-packet:sample-tool:${sequence}`,
      assembled_at: at,
      request_ref: prototypeMaturityReference(request),
      prototype_id: request.prototype_id,
      transition,
      packet_kind: baseline ? "baseline-packet" : "candidate-evidence-packet",
      sections: sections[transition].map((id) => ({
        id,
        state: "ready",
        evidence_refs: [`evidence://sample-tool/${id}`],
      })),
    },
    "packet_digest",
  );
  return {
    authority_revision: revision,
    execution_ref: `execution:sample-tool:${sequence}`,
    packet,
    request,
    session_ref: `session:sample-tool:${sequence}`,
  };
}

export function readinessFixture(evaluation, outcome = "ready") {
  const readiness = bindPrototypeMaturity(
    {
      schema_version: 1,
      artifact_type: "prototype-maturity-readiness",
      readiness_id: evaluation.request.request_id.replace(
        /^prototype-maturity-request:/,
        "prototype-maturity-readiness:",
      ),
      evaluated_at: at,
      request_ref: prototypeMaturityReference(evaluation.request),
      packet_ref: prototypeMaturityReference(evaluation.packet),
      prototype_id: evaluation.request.prototype_id,
      transition: evaluation.request.transition,
      observed_state: structuredClone(evaluation.request.expected_state),
      outcome,
      checks: checks.map((id, index) => ({
        id,
        state: outcome === "ready" || index ? "ready" : outcome,
        evidence_refs: [`evidence://sample-tool/${id}`],
      })),
      findings:
        outcome === "ready"
          ? []
          : [
              {
                code: `maturity-${outcome}`,
                severity: "blocking",
                detail: "Correct the maturity evidence and submit a fresh request.",
                owner_ref: caller,
                required_fix: "Correct the evidence packet.",
              },
            ],
    },
    "readiness_digest",
  );
  return {
    readiness,
    ledger: {
      resolution: "read",
      state: "durable",
      ref: {
        uri: `wgcf://readiness/prototype-maturity/${readiness.readiness_digest.slice(7)}`,
        digest: readiness.readiness_digest,
      },
      authority_revision: evaluation.authority_revision,
      contract_digest: `sha256:${"3".repeat(64)}`,
      implementation_ref: "4".repeat(40),
      service_identity_ref: "spiffe://test/wgcf/prototype-maturity",
      policy_version: "prototype-maturity.v1@test",
      expires_at: "2026-09-10T02:15:00.000Z",
    },
  };
}

export function sourceResultFixture(record, outcome = "prepared") {
  const changed = outcome === "unchanged" ? [] : [
    "prototypes.yaml",
    "records/prototype-maturity/sample-tool/candidate.json",
    "records/prototype-maturity/sample-tool/history/prototype-maturity-decision-sample-tool-1.json",
  ];
  return bindPrototypeMaturity(
    {
      schema_version: 1,
      artifact_type: "prototype-maturity-source-result",
      result_id: record.decision.decision_id.replace(
        /^prototype-maturity-decision:/,
        "prototype-maturity-source-result:",
      ),
      prepared_at: at,
      decision_ref: prototypeMaturityReference(record.decision),
      prototype_id: record.decision.prototype_id,
      transition: record.decision.transition,
      decision: record.decision.decision,
      outcome,
      source_branch: record.decision.source_branch,
      source_revision:
        outcome === "unchanged" ? revision : `git-tree:${"5".repeat(40)}`,
      record_digest: `sha256:${"6".repeat(64)}`,
      changed_paths: changed,
      next_action:
        outcome === "unchanged"
          ? record.decision.decision === "route-closeout"
            ? { code: "prototype-closeout", owner_ref: "operator-orchestration-service" }
            : { code: "resolve-blocker", owner_ref: record.decision.blocker.owner_ref }
          : { code: "review-source", owner_ref: "operator-orchestration-service" },
    },
    "result_digest",
  );
}

export function readbackFixture(record, { merged = true } = {}) {
  return bindPrototypeMaturity(
    {
      schema_version: 1,
      artifact_type: "prototype-maturity-readback",
      readback_id: record.decision.decision_id.replace(
        /^prototype-maturity-decision:/,
        "prototype-maturity-readback:",
      ),
      observed_at: at,
      decision_ref: prototypeMaturityReference(record.decision),
      prototype_id: record.decision.prototype_id,
      transition: record.decision.transition,
      decision: record.decision.decision,
      authority_state: merged ? "merged-authority" : "unchanged-authority",
      source_revision: merged ? "9".repeat(40) : revision,
      record_digest: record.preparation.source_result.record_digest,
      observed_lifecycle: merged
        ? record.evaluation.request.target_lifecycle
        : record.evaluation.request.source_lifecycle,
      record_ref: "record://prototype-registry/sample-tool",
    },
    "readback_digest",
  );
}
