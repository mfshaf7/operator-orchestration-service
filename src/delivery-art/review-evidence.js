import { createHash } from "node:crypto";

import { canonicalDigest } from "./canonical-json.js";
import { validateDeliveryArtReviewPacketEvidence } from "./contracts.js";

const RESULT_COLLECTIONS = Object.freeze([
  "tests",
  "validations",
  "runtime_and_live",
  "security_and_trust",
]);

const READINESS_RANK = new Map([
  ["implementation-ready", 1],
  ["merge-ready", 2],
  ["operating-ready", 3],
]);

export class DeliveryArtReviewEvidenceError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = "DeliveryArtReviewEvidenceError";
    this.code = code;
    this.details = details;
  }
}

function clone(value) {
  return structuredClone(value);
}

function assertObject(value, field) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new DeliveryArtReviewEvidenceError(
      "delivery_art_review_evidence_input_invalid",
      `${field} must be an object.`,
      { field },
    );
  }
  return value;
}

function assertSource(workStart, source) {
  assertObject(source, "source");
  const plans = workStart?.landing_unit?.branch_plan ?? [];
  const plan = plans.find((entry) => entry.repo === source.repo_name);
  const validFiles = Array.isArray(source.changed_files) &&
    source.changed_files.every((entry) =>
      typeof entry === "string" &&
      entry.trim() &&
      !entry.startsWith("/") &&
      !entry.split("/").includes(".."));
  if (
    plans.length !== 1 ||
    !plan ||
    source.branch !== plan.branch ||
    source.base_ref !== plan.base_ref ||
    source.base_commit !== plan.base_commit ||
    !/^[0-9a-f]{40}$/.test(String(source.head_commit ?? "")) ||
    !validFiles
  ) {
    throw new DeliveryArtReviewEvidenceError(
      "delivery_art_review_evidence_source_mismatch",
      "Review evidence source must match the durable work-start plan and carry one exact current source revision.",
      {
        expected_repo: plan?.repo ?? null,
        expected_branch: plan?.branch ?? null,
        expected_base_ref: plan?.base_ref ?? null,
        expected_base_commit: plan?.base_commit ?? null,
      },
    );
  }
  return {
    base_commit: source.base_commit,
    base_ref: source.base_ref,
    branch: source.branch,
    changed_files: [...new Set(source.changed_files.map((entry) => entry.trim()))]
      .sort(),
    head_commit: source.head_commit,
    repo_name: source.repo_name,
  };
}

function evidenceId(kind, ...parts) {
  const digest = createHash("sha256")
    .update(parts.join("\0"))
    .digest("hex")
    .slice(0, 20);
  return `evidence:${kind}-${digest}`;
}

function sourceRevision(source) {
  return [{ commit: source.head_commit, repo: source.repo_name }];
}

function hasCurrentSourceRevision(entry, source) {
  return Array.isArray(entry?.source_revisions) &&
    entry.source_revisions.length === 1 &&
    entry.source_revisions[0]?.commit === source.head_commit &&
    entry.source_revisions[0]?.repo === source.repo_name;
}

function resultEntries(document, collection, source) {
  const entries = document?.evidence?.[collection] ?? [];
  if (!Array.isArray(entries)) {
    return clone(entries);
  }
  return entries.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return clone(entry);
    }
    return {
      ...clone(entry),
      source_revisions: entry.result === "not_applicable"
        ? []
        : Array.isArray(entry.source_revisions) &&
            entry.source_revisions.length > 0
          ? clone(entry.source_revisions)
          : sourceRevision(source),
    };
  });
}

function applicableCases(architecture, coveredWorkItemIds) {
  if (architecture?.conformance_plan?.required !== true) {
    return [];
  }
  const covered = new Set(coveredWorkItemIds);
  const targetRank = READINESS_RANK.get("merge-ready");
  return (architecture.conformance_plan.cases ?? [])
    .filter((entry) =>
      (entry.applies_to_work_item_ids ?? []).some((workItemId) =>
        covered.has(workItemId)) &&
      (READINESS_RANK.get(entry.target_readiness) ?? 99) <= targetRank)
    .map((entry) => clone(entry))
    .sort((left, right) => left.id.localeCompare(right.id));
}

function changedSurfaces(document, source) {
  const existing = new Map(
    (Array.isArray(document?.evidence?.changed_surfaces)
      ? document.evidence.changed_surfaces
      : [])
      .filter((entry) => entry?.repo && entry?.path)
      .map((entry) => [`${entry.repo}\0${entry.path}`, entry]),
  );
  return source.changed_files.map((file) => {
    const previous = existing.get(`${source.repo_name}\0${file}`);
    return {
      id: evidenceId("surface", source.repo_name, file),
      repo: source.repo_name,
      path: file,
      summary: typeof previous?.summary === "string" && previous.summary.trim()
        ? previous.summary.trim()
        : `Changed in the ${source.repo_name} Landing Unit.`,
    };
  });
}

function resultEvidence(evidence) {
  return RESULT_COLLECTIONS.flatMap((collection) =>
    Array.isArray(evidence[collection]) ? evidence[collection] : []);
}

function evidenceIdsForWorkItem(evidence, cases, workItemId) {
  const caseById = new Map(cases.map((entry) => [entry.id, entry]));
  const ids = (evidence.changed_surfaces ?? [])
    .map((entry) => entry?.id)
    .filter(Boolean);
  for (const entry of resultEvidence(evidence)) {
    if (!entry?.id) {
      continue;
    }
    const caseIds = Array.isArray(entry.conformance_case_ids)
      ? entry.conformance_case_ids
      : [];
    if (
      caseIds.length === 0 ||
      caseIds.some((caseId) =>
        caseById.get(caseId)?.applies_to_work_item_ids?.includes(workItemId))
    ) {
      ids.push(entry.id);
    }
  }
  return [...new Set(ids)].sort();
}

function acceptanceMapping(document, evidence, workStart, cases) {
  const previous = new Map(
    (Array.isArray(document?.evidence?.acceptance_mapping)
      ? document.evidence.acceptance_mapping
      : [])
      .filter((entry) => entry?.work_item_id)
      .map((entry) => [entry.work_item_id, entry]),
  );
  return [...workStart.covered_work_item_ids]
    .sort()
    .map((workItemId) => {
      const item = previous.get(workItemId);
      const itemNumber = workItemId.slice("work-item-".length);
      return {
        work_item_id: workItemId,
        acceptance_ref: `openproject://work_packages/${itemNumber}`,
        evidence_ids: evidenceIdsForWorkItem(evidence, cases, workItemId),
        summary: typeof item?.summary === "string" && item.summary.trim()
          ? item.summary.trim()
          : `Current source and validation evidence for ${workItemId}.`,
      };
    });
}

function finding(code, message, target) {
  return { code, message, target };
}

function projectionFindings(evidence, cases, source) {
  const findings = [];
  if (evidence.changed_surfaces.length === 0) {
    findings.push(finding(
      "changed_surfaces_missing",
      "Commit at least one source change before Review Packet authoring.",
      "evidence.changed_surfaces",
    ));
  }
  if (evidence.tests.length === 0) {
    findings.push(finding(
      "test_evidence_missing",
      "Attach at least one test result for the exact source revision.",
      "evidence.tests",
    ));
  }
  if (evidence.validations.length === 0) {
    findings.push(finding(
      "validation_evidence_missing",
      "Attach at least one validation result for the exact source revision.",
      "evidence.validations",
    ));
  }

  const results = resultEvidence(evidence);
  for (const entry of results) {
    if (entry?.result === "fail") {
      findings.push(finding(
        "evidence_result_failed",
        `${entry.name ?? entry.id ?? "Evidence result"} must pass or carry an approved not-applicable judgment.`,
        entry.id ?? "evidence",
      ));
    }
    if (
      entry?.result !== "not_applicable" &&
      !hasCurrentSourceRevision(entry, source)
    ) {
      findings.push(finding(
        "evidence_source_revision_stale",
        `${entry.name ?? entry.id ?? "Evidence result"} must be rerun or re-authored for source ${source.head_commit}.`,
        entry.id ?? "evidence",
      ));
    }
  }
  const allIds = [
    ...evidence.changed_surfaces,
    ...results,
  ].map((entry) => entry?.id).filter(Boolean);
  const seenIds = new Set();
  const duplicateIds = new Set();
  for (const id of allIds) {
    if (seenIds.has(id)) {
      duplicateIds.add(id);
    }
    seenIds.add(id);
  }
  for (const duplicateId of duplicateIds) {
    findings.push(finding(
      "evidence_id_duplicate",
      `Use one unique evidence id for ${duplicateId}.`,
      duplicateId,
    ));
  }
  const casesById = new Map(cases.map((entry) => [entry.id, entry]));
  const represented = new Map();
  for (const entry of results) {
    for (const caseId of entry?.conformance_case_ids ?? []) {
      const matches = represented.get(caseId) ?? [];
      matches.push(entry);
      represented.set(caseId, matches);
      if (!casesById.has(caseId)) {
        findings.push(finding(
          "conformance_case_out_of_scope",
          `Remove out-of-scope conformance case ${caseId}.`,
          entry.id ?? "evidence",
        ));
      }
    }
  }
  for (const requiredCase of cases) {
    const matches = represented.get(requiredCase.id) ?? [];
    if (matches.length === 0) {
      findings.push(finding(
        "conformance_case_evidence_missing",
        `Attach passing ${requiredCase.fidelity} evidence for ${requiredCase.id}.`,
        requiredCase.id,
      ));
      continue;
    }
    for (const entry of matches) {
      if (entry.result !== "pass") {
        findings.push(finding(
          "conformance_case_not_passing",
          `${requiredCase.id} must be represented by passing evidence.`,
          entry.id ?? requiredCase.id,
        ));
      }
      if (entry.fidelity !== requiredCase.fidelity) {
        findings.push(finding(
          "conformance_case_fidelity_mismatch",
          `${requiredCase.id} requires ${requiredCase.fidelity} fidelity.`,
          entry.id ?? requiredCase.id,
        ));
      }
    }
  }

  const validation = validateDeliveryArtReviewPacketEvidence(evidence);
  for (const message of validation.errors) {
    findings.push(finding(
      "review_evidence_contract_invalid",
      message,
      "evidence",
    ));
  }
  return findings.filter((entry, index, values) =>
    values.findIndex((candidate) =>
      candidate.code === entry.code &&
      candidate.message === entry.message &&
      candidate.target === entry.target) === index);
}

export function deliveryArtReviewEvidenceProjectionDigest({
  architecture = null,
  currentDocument = null,
  source,
  workStart,
}) {
  const normalizedSource = assertSource(workStart, source);
  const cases = applicableCases(
    architecture,
    workStart.covered_work_item_ids,
  );
  return canonicalDigest({
    architecture: architecture
      ? {
          digest: architecture.integrity?.content_digest ?? null,
          uri: architecture.custody?.uri ?? null,
      }
      : null,
    authored_results: Object.fromEntries(
      RESULT_COLLECTIONS.map((collection) => [
        collection,
        (Array.isArray(currentDocument?.evidence?.[collection])
          ? currentDocument.evidence[collection]
          : [])
          .map((entry) => {
            if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
              return clone(entry);
            }
            const normalized = clone(entry);
            delete normalized.source_revisions;
            return normalized;
          }),
      ]),
    ),
    cases: cases.map((entry) => ({
      applies_to_work_item_ids: entry.applies_to_work_item_ids,
      fidelity: entry.fidelity,
      id: entry.id,
      target_readiness: entry.target_readiness,
    })),
    source: normalizedSource,
    work_start: {
      digest: workStart.integrity?.content_digest ?? null,
      uri: workStart.custody?.uri ?? null,
    },
  });
}

export function projectDeliveryArtReviewEvidence({
  architecture = null,
  currentDocument = null,
  source,
  workStart,
}) {
  assertObject(workStart, "work_start");
  if (
    workStart.artifact_type !== "delivery_art_work_start_record" ||
    workStart.readiness?.level !== "implementation-ready" ||
    workStart.custody?.state !== "durable"
  ) {
    throw new DeliveryArtReviewEvidenceError(
      "delivery_art_review_evidence_work_start_invalid",
      "Review evidence projection requires one durable implementation-ready work-start record.",
    );
  }
  const document = currentDocument === null
    ? { evidence: {}, exceptions: [], change_record_refs: [] }
    : assertObject(currentDocument, "current_document");
  const normalizedSource = assertSource(workStart, source);
  const cases = applicableCases(architecture, workStart.covered_work_item_ids);
  const evidence = {
    changed_surfaces: changedSurfaces(document, normalizedSource),
    tests: resultEntries(document, "tests", normalizedSource),
    validations: resultEntries(document, "validations", normalizedSource),
    acceptance_mapping: [],
    runtime_and_live: resultEntries(
      document,
      "runtime_and_live",
      normalizedSource,
    ),
    security_and_trust: resultEntries(
      document,
      "security_and_trust",
      normalizedSource,
    ),
  };
  evidence.acceptance_mapping = acceptanceMapping(
    document,
    evidence,
    workStart,
    cases,
  );
  const projectionDigest = deliveryArtReviewEvidenceProjectionDigest({
    architecture,
    currentDocument: document,
    source: normalizedSource,
    workStart,
  });
  const findings = projectionFindings(evidence, cases, normalizedSource);
  return {
    evidence_document: {
      evidence,
      exceptions: Array.isArray(document.exceptions)
        ? clone(document.exceptions)
        : document.exceptions,
      change_record_refs: Array.isArray(document.change_record_refs)
        ? [...new Set(document.change_record_refs)].sort()
        : document.change_record_refs,
      projection: {
        schema_version: 1,
        projection_digest: projectionDigest,
        source_revision: {
          commit: normalizedSource.head_commit,
          repo: normalizedSource.repo_name,
        },
        work_start_ref: {
          digest: workStart.integrity.content_digest,
          uri: workStart.custody.uri,
        },
        required_conformance_case_ids: cases.map((entry) => entry.id),
      },
    },
    requirements: {
      conformance_cases: cases.map((entry) => ({
        applies_to_work_item_ids: clone(entry.applies_to_work_item_ids),
        expected_outcome: entry.expected_outcome,
        fidelity: entry.fidelity,
        id: entry.id,
      })),
      required_evidence_kinds: [
        "changed_surfaces",
        "tests",
        "validations",
      ],
    },
    readiness: {
      finding_count: findings.length,
      findings,
      ready: findings.length === 0,
    },
  };
}
