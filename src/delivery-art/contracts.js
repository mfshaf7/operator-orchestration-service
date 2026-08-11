import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

import {
  canonicalDigest,
  canonicalJsonErrors,
  canonicalStringify,
} from "./canonical-json.js";

const CONTRACT_DIR = fileURLToPath(
  new URL("../../contracts/delivery-art/", import.meta.url),
);
const MANIFEST = JSON.parse(
  readFileSync(path.join(CONTRACT_DIR, "manifest.json"), "utf8"),
);
const REQUIRED_INVALIDATION_INPUTS = [
  "art-descendant-or-dependency-change",
  "owner-or-rollback-boundary-change",
  "base-ref-or-commit-change",
  "architecture-decision-or-digest-change",
  "validation-or-security-obligation-change",
];
const EVIDENCE_SECTIONS = [
  "changed_surfaces",
  "tests",
  "validations",
  "runtime_and_live",
  "security_and_trust",
];
const SOURCE_BACKED_DECISIONS = new Set([
  "feature_single_landing_unit",
  "child_isolated_landing_unit",
]);
const PROTOCOL_CONFORMANCE_DIMENSIONS = new Set([
  "command-and-acknowledgement-semantics",
  "deterministic-identities-and-idempotency",
  "state-mutation-ordering",
  "retry-cancel-replay-and-recovery-semantics",
  "bounded-failure-mapping",
  "authorization-integrity-and-replay-resistance",
  "session-scenario-and-execution-binding",
  "result-and-owner-receipt-completeness",
  "immutable-baseline-and-restore-evidence",
  "lifecycle-state-matrix",
  "cross-artifact-timeline-ordering",
  "shared-validator-compatibility",
]);
const READINESS_RANK = new Map([
  ["merge-ready", 1],
  ["operating-ready", 2],
]);

function loadValidators() {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  const validators = new Map();

  for (const [artifactType, entry] of Object.entries(MANIFEST.schemas)) {
    const schemaPath = path.join(CONTRACT_DIR, entry.path);
    const raw = readFileSync(schemaPath);
    const actualDigest = createHash("sha256").update(raw).digest("hex");
    if (actualDigest !== entry.sha256) {
      throw new Error(
        `Delivery ART schema snapshot ${entry.path} does not match its authority manifest.`,
      );
    }
    validators.set(artifactType, ajv.compile(JSON.parse(raw.toString("utf8"))));
  }
  return validators;
}

const VALIDATORS = loadValidators();

function clone(value) {
  return structuredClone(value);
}

function normalizedStringSet(values) {
  return new Set(Array.isArray(values) ? values.filter((entry) => typeof entry === "string") : []);
}

function sameStringSet(left, right) {
  const leftSet = normalizedStringSet(left);
  const rightSet = normalizedStringSet(right);
  return leftSet.size === rightSet.size && [...leftSet].every((entry) => rightSet.has(entry));
}

function stringValues(values) {
  return Array.isArray(values)
    ? values.filter((entry) => typeof entry === "string")
    : [];
}

function objectValues(values) {
  return Array.isArray(values)
    ? values.filter((entry) => entry && typeof entry === "object" && !Array.isArray(entry))
    : [];
}

function duplicateValues(values) {
  const seen = new Set();
  return values.filter((value) => {
    if (seen.has(value)) {
      return true;
    }
    seen.add(value);
    return false;
  });
}

function setDifference(left, right) {
  return new Set([...left].filter((entry) => !right.has(entry)));
}

function sameCanonicalValue(left, right) {
  return canonicalStringify(left) === canonicalStringify(right);
}

function timestamp(value) {
  if (typeof value !== "string") {
    return null;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function requireTimeOrder(errors, earlierName, earlierValue, laterName, laterValue, { strict = false } = {}) {
  const earlier = timestamp(earlierValue);
  const later = timestamp(laterValue);
  if (earlier === null || later === null) {
    return;
  }
  if ((strict && earlier >= later) || (!strict && earlier > later)) {
    errors.push(
      `${earlierName} must be ${strict ? "earlier than" : "no later than"} ${laterName}`,
    );
  }
}

function entityNumber(value, prefix) {
  const match = typeof value === "string"
    ? value.match(new RegExp(`^${prefix}-([1-9][0-9]*)$`))
    : null;
  return match?.[1] ?? null;
}

function openProjectWorkPackageNumber(value) {
  return typeof value === "string"
    ? value.match(/^openproject:\/\/work_packages\/([1-9][0-9]*)$/)?.[1] ?? null
    : null;
}

function identifierScopedTo(value, prefix, deliveryId) {
  return typeof value === "string" && typeof deliveryId === "string" &&
    new RegExp(`^${prefix}:${deliveryId}(?:$|[-:.])`).test(value);
}

function referenceDigestErrors(reference, digest, label) {
  if (typeof reference !== "string" || typeof digest !== "string") {
    return [];
  }
  return reference.includes(digest.replace(/^sha256:/, ""))
    ? []
    : [`${label} must include its declared content digest`];
}

function evidenceResults(packet) {
  const evidence = packet.evidence ?? {};
  return ["tests", "validations", "runtime_and_live", "security_and_trust"]
    .flatMap((section) => objectValues(evidence[section]));
}

export function deliveryArtContentProjection(artifact) {
  const projection = clone(artifact);
  const custody = projection.custody;
  delete projection.custody;
  if (custody?.supersedes && typeof custody.supersedes === "object") {
    projection.custody = {
      supersedes: clone(custody.supersedes),
    };
  }
  if (projection.integrity && typeof projection.integrity === "object") {
    delete projection.integrity.content_digest;
  }
  return projection;
}

export function artifactContentDigest(artifact) {
  return canonicalDigest(deliveryArtContentProjection(artifact));
}

export function architectureScopeFingerprint(artifact) {
  return canonicalDigest({
    schema_version: artifact.schema_version,
    artifact_type: artifact.artifact_type,
    delivery_id: artifact.delivery_id,
    covered_work_item_ids: artifact.covered_work_item_ids,
    source_snapshot: artifact.source_snapshot,
    architecture: artifact.architecture,
    conformance_plan: artifact.conformance_plan,
    decision_status: artifact.decision?.status,
  });
}

export function workStartScopeFingerprint(artifact) {
  return canonicalDigest({
    schema_version: artifact.schema_version,
    artifact_type: artifact.artifact_type,
    delivery_id: artifact.delivery_id,
    covered_work_item_ids: artifact.covered_work_item_ids,
    landing_unit: artifact.landing_unit,
    architecture: artifact.architecture,
    source_snapshot: artifact.source_snapshot,
    invalidation_inputs: artifact.invalidation_inputs,
  });
}

export function reviewPacketReadinessSubjectDigest(artifact) {
  const projection = clone(artifact);
  delete projection.custody;
  delete projection.finalized_at;
  delete projection.integrity;
  if (projection.readiness && typeof projection.readiness === "object") {
    delete projection.readiness.evaluated_at;
    delete projection.readiness.receipt_refs;
    delete projection.readiness.subject_digest;
  }
  return canonicalDigest(projection);
}

function schemaErrors(artifact) {
  const validator = VALIDATORS.get(artifact?.artifact_type);
  if (!validator) {
    return [`unsupported artifact_type ${JSON.stringify(artifact?.artifact_type)}`];
  }
  if (validator(artifact)) {
    return [];
  }
  return (validator.errors ?? []).map((error) => {
    const location = error.instancePath || "<root>";
    return `${location}: ${error.message}`;
  });
}

function commonSemanticErrors(artifact) {
  const errors = [];
  const expectedDigest = artifactContentDigest(artifact);
  if (artifact?.integrity?.content_digest !== expectedDigest) {
    errors.push(`integrity.content_digest must equal ${expectedDigest}`);
  }
  if (artifact?.custody?.state === "durable") {
    const digestHex = expectedDigest.slice("sha256:".length);
    if (!String(artifact?.custody?.uri ?? "").includes(digestHex)) {
      errors.push("durable custody URI must include the full content digest");
    }
    if (
      artifact?.custody?.backend === "wgcf-artifact-registry" &&
      !/^wgcf:\/\/artifacts\/delivery-art\/sha256\/[0-9a-f]{64}$/.test(
        String(artifact.custody.uri ?? ""),
      )
    ) {
      errors.push("durable custody URI must be an opaque WGCF Delivery ART reference");
    }
    if (artifact?.custody?.backend === "wgcf-artifact-registry") {
      errors.push(
        ...referenceDigestErrors(
          artifact.custody?.receipt_ref?.uri,
          artifact.custody?.receipt_ref?.digest,
          "custody.receipt_ref.uri",
        ),
      );
    }
  }
  if (artifact?.custody?.supersedes) {
    errors.push(
      ...referenceDigestErrors(
        artifact.custody.supersedes.uri,
        artifact.custody.supersedes.digest,
        "custody.supersedes.uri",
      ),
    );
  }
  return errors;
}

function custodyReceiptSemanticErrors(receipt) {
  const errors = [];
  const receiptToken = typeof receipt.receipt_id === "string"
    ? receipt.receipt_id.replace(/^artifact-custody-receipt:/, "")
    : null;
  if (
    receiptToken &&
    !String(receipt.custody?.uri ?? "").includes(receiptToken)
  ) {
    errors.push("custody receipt URI must include its receipt id");
  }
  errors.push(
    ...referenceDigestErrors(
      receipt.subject?.registry_uri,
      receipt.subject?.content_digest,
      "subject.registry_uri",
    ),
  );
  requireTimeOrder(
    errors,
    "storage.persisted_at",
    receipt.storage?.persisted_at,
    "custody.persisted_at",
    receipt.custody?.persisted_at,
    { strict: true },
  );
  return errors;
}

function architectureConformanceErrors(artifact) {
  const errors = [];
  const covered = normalizedStringSet(artifact.covered_work_item_ids);
  const plan = artifact.conformance_plan ?? {};
  const dimensions = normalizedStringSet(plan.dimensions);
  const applicabilityRows = objectValues(plan.work_item_dimension_applicability);
  const applicabilityIds = applicabilityRows.map((row) => row.work_item_id);
  if (duplicateValues(applicabilityIds).length > 0) {
    errors.push("conformance applicability must contain one row per work item");
  }
  if (!sameStringSet(applicabilityIds, [...covered])) {
    errors.push("conformance applicability must exactly cover architecture work items");
  }

  const applicability = new Map(
    applicabilityRows.map((row) => [
      row.work_item_id,
      normalizedStringSet(row.dimension_ids),
    ]),
  );
  const applicableDimensions = new Set(
    [...applicability.values()].flatMap((entries) => [...entries]),
  );
  if (!sameStringSet([...applicableDimensions], [...dimensions])) {
    errors.push("conformance applicability must exactly cover declared dimensions");
  }
  for (const [workItemId, itemDimensions] of applicability) {
    const unknown = setDifference(itemDimensions, dimensions);
    if (unknown.size > 0) {
      errors.push(
        `conformance applicability for ${workItemId} references unknown dimensions: ${[...unknown].sort().join(", ")}`,
      );
    }
  }

  const protocolApplies = plan.protocol_applicability?.applies === true;
  if (protocolApplies) {
    const missing = setDifference(PROTOCOL_CONFORMANCE_DIMENSIONS, dimensions);
    if (missing.size > 0) {
      errors.push(`protocol conformance is missing dimensions: ${[...missing].sort().join(", ")}`);
    }
  }

  const cases = objectValues(plan.cases);
  const caseIds = cases.map((entry) => entry.id);
  if (duplicateValues(caseIds).length > 0) {
    errors.push("conformance cases must have unique ids");
  }
  const coveredByCases = new Set();
  const dimensionsCoveredByCases = new Set();
  const polaritiesByItem = new Map([...covered].map((item) => [item, new Set()]));
  const mergePolaritiesByItem = new Map([...covered].map((item) => [item, new Set()]));
  const mergePolaritiesByDimension = new Map(
    [...dimensions].map((dimension) => [dimension, new Set()]),
  );
  const mergePolaritiesByPair = new Map();
  for (const [item, itemDimensions] of applicability) {
    for (const dimension of itemDimensions) {
      mergePolaritiesByPair.set(`${item}\u0000${dimension}`, new Set());
    }
  }

  for (const entry of cases) {
    const items = normalizedStringSet(entry.applies_to_work_item_ids);
    const caseDimensions = normalizedStringSet(entry.dimension_ids);
    for (const item of items) {
      coveredByCases.add(item);
    }
    for (const dimension of caseDimensions) {
      dimensionsCoveredByCases.add(dimension);
    }
    const unknownItems = setDifference(items, covered);
    if (unknownItems.size > 0) {
      errors.push(
        `conformance case ${entry.id} references unknown work items: ${[...unknownItems].sort().join(", ")}`,
      );
    }
    const unknownDimensions = setDifference(caseDimensions, dimensions);
    if (unknownDimensions.size > 0) {
      errors.push(
        `conformance case ${entry.id} references unknown dimensions: ${[...unknownDimensions].sort().join(", ")}`,
      );
    }
    for (const item of [...items].filter((value) => covered.has(value))) {
      const outside = setDifference(caseDimensions, applicability.get(item) ?? new Set());
      if (outside.size > 0) {
        errors.push(
          `conformance case ${entry.id} is outside applicability for ${item}: ${[...outside].sort().join(", ")}`,
        );
      }
      polaritiesByItem.get(item)?.add(entry.polarity);
      if (entry.target_readiness === "merge-ready") {
        mergePolaritiesByItem.get(item)?.add(entry.polarity);
        for (const dimension of caseDimensions) {
          mergePolaritiesByDimension.get(dimension)?.add(entry.polarity);
          mergePolaritiesByPair.get(`${item}\u0000${dimension}`)?.add(entry.polarity);
        }
      }
    }
  }

  if (plan.required === true) {
    if (!sameStringSet([...coveredByCases], [...covered])) {
      errors.push("required conformance cases must exactly cover architecture work items");
    }
    if (!sameStringSet([...dimensionsCoveredByCases], [...dimensions])) {
      errors.push("required conformance cases must exactly cover declared dimensions");
    }
    for (const [item, polarities] of polaritiesByItem) {
      if (!sameStringSet([...polarities], ["positive", "negative"])) {
        errors.push(`required conformance plan needs positive and negative cases for ${item}`);
      }
    }
  }
  if (protocolApplies) {
    for (const [item, polarities] of mergePolaritiesByItem) {
      if (!sameStringSet([...polarities], ["positive", "negative"])) {
        errors.push(`protocol work item needs positive and negative merge-ready cases: ${item}`);
      }
    }
    for (const dimension of PROTOCOL_CONFORMANCE_DIMENSIONS) {
      const polarities = mergePolaritiesByDimension.get(dimension) ?? new Set();
      if (!sameStringSet([...polarities], ["positive", "negative"])) {
        errors.push(`protocol dimension needs positive and negative merge-ready cases: ${dimension}`);
      }
    }
    for (const [pair, polarities] of mergePolaritiesByPair) {
      if (!sameStringSet([...polarities], ["positive", "negative"])) {
        errors.push(
          `protocol work-item/dimension pair needs positive and negative merge-ready cases: ${pair.replace("\u0000", "/")}`,
        );
      }
    }
  }

  const claims = objectValues(plan.git_causality?.claims);
  const claimIds = claims.map((claim) => claim.id);
  if (duplicateValues(claimIds).length > 0) {
    errors.push("Git-causality claims must have unique ids");
  }
  for (const claim of claims) {
    const claimItems = normalizedStringSet(claim.applies_to_work_item_ids);
    const claimDimensions = normalizedStringSet(claim.dimension_ids);
    for (const item of claimItems) {
      if (!covered.has(item)) {
        errors.push(`Git-causality claim ${claim.id} references unknown work item ${item}`);
        continue;
      }
      const outside = setDifference(claimDimensions, applicability.get(item) ?? new Set());
      if (outside.size > 0) {
        errors.push(
          `Git-causality claim ${claim.id} is outside applicability for ${item}: ${[...outside].sort().join(", ")}`,
        );
      }
      for (const dimension of [...claimDimensions].filter((value) =>
        (applicability.get(item) ?? new Set()).has(value))) {
        const realGitPolarities = new Set(
          cases
            .filter((entry) =>
              entry.target_readiness === "merge-ready" &&
              entry.fidelity === "real-git" &&
              stringValues(entry.applies_to_work_item_ids).includes(item) &&
              stringValues(entry.dimension_ids).includes(dimension))
            .map((entry) => entry.polarity),
        );
        if (!sameStringSet([...realGitPolarities], ["positive", "negative"])) {
          errors.push(
            `Git-causality claim requires positive and negative real-git cases: ${item}/${dimension}`,
          );
        }
      }
    }
  }
  return errors;
}

function architectureSemanticErrors(artifact) {
  const errors = [];
  const deliveryNumber = entityNumber(artifact.delivery_id, "delivery");
  if (!identifierScopedTo(artifact.artifact_id, "architecture-packet", artifact.delivery_id)) {
    errors.push("artifact_id must be scoped to delivery_id");
  }
  if (artifact.scope_fingerprint !== architectureScopeFingerprint(artifact)) {
    errors.push("scope_fingerprint does not match the architecture scope projection");
  }
  const covered = stringValues(artifact.covered_work_item_ids);
  const ownerMap = objectValues(artifact.architecture?.descendant_owner_map);
  const ownerIds = ownerMap.map((entry) => entry.work_item_id);
  const dag = artifact.architecture?.dependency_merge_dag ?? {};
  if (!sameStringSet(covered, ownerIds) || new Set(ownerIds).size !== ownerIds.length) {
    errors.push("architecture descendant owner map must exactly cover each work item once");
  }
  if (!sameStringSet(covered, dag.nodes)) {
    errors.push("architecture dependency graph nodes must exactly cover the work items");
  }
  const sourceRepos = objectValues(artifact.source_snapshot?.repo_revisions)
    .map((entry) => entry.repo);
  const ownerRepos = ownerMap.map((entry) => entry.owner_repo);
  if (duplicateValues(sourceRepos).length > 0) {
    errors.push("architecture source revisions must contain one entry per owner repo");
  }
  if (!sameStringSet(sourceRepos, ownerRepos)) {
    errors.push("architecture source revisions must exactly cover descendant owner repos");
  }

  if (
    deliveryNumber !== null &&
    openProjectWorkPackageNumber(artifact.source_snapshot?.art_ref) !== deliveryNumber
  ) {
    errors.push("architecture source snapshot must reference its Delivery initiative");
  }

  const parentByItem = new Map();
  const roots = [];
  for (const entry of ownerMap) {
    parentByItem.set(entry.work_item_id, entry.parent_work_item_id);
    if (entry.parent_work_item_id === null) {
      roots.push(entry.work_item_id);
    } else if (!covered.includes(entry.parent_work_item_id)) {
      errors.push(
        `architecture descendant ${entry.work_item_id} references unknown parent ${entry.parent_work_item_id}`,
      );
    }
  }
  if (ownerMap.length > 0 && roots.length === 0) {
    errors.push("architecture descendant owner map must contain at least one root");
  }
  const parentWalkComplete = new Set();
  const parentCycleNodes = new Set();
  for (const start of parentByItem.keys()) {
    const chain = [];
    const positions = new Map();
    let current = start;
    while (typeof current === "string" && parentByItem.has(current)) {
      if (positions.has(current)) {
        for (const member of chain.slice(positions.get(current))) {
          parentCycleNodes.add(member);
        }
        break;
      }
      if (parentWalkComplete.has(current)) {
        break;
      }
      positions.set(current, chain.length);
      chain.push(current);
      current = parentByItem.get(current);
    }
    for (const member of chain) {
      parentWalkComplete.add(member);
    }
  }
  if (parentCycleNodes.size > 0) {
    errors.push(
      `architecture descendant parent links must be acyclic: ${[...parentCycleNodes].sort().join(", ")}`,
    );
  }

  const nodes = normalizedStringSet(dag.nodes);
  const adjacency = new Map([...nodes].map((node) => [node, []]));
  const indegree = new Map([...nodes].map((node) => [node, 0]));
  const precedenceEdges = [];
  for (const edge of objectValues(dag.edges)) {
    if (!nodes.has(edge.from) || !nodes.has(edge.to)) {
      errors.push("architecture dependency graph contains an unknown endpoint");
      continue;
    }
    const before = edge.relation === "depends_on" ? edge.to : edge.from;
    const after = edge.relation === "depends_on" ? edge.from : edge.to;
    precedenceEdges.push([before, after]);
    adjacency.get(before).push(after);
    indegree.set(after, indegree.get(after) + 1);
  }
  const ready = [...nodes].filter((node) => indegree.get(node) === 0);
  let visited = 0;
  while (ready.length > 0) {
    const node = ready.pop();
    visited += 1;
    for (const next of adjacency.get(node)) {
      indegree.set(next, indegree.get(next) - 1);
      if (indegree.get(next) === 0) {
        ready.push(next);
      }
    }
  }
  if (visited !== nodes.size) {
    errors.push("architecture dependency graph must be acyclic");
  }

  const mergeOrder = stringValues(dag.merge_order);
  const ownerRepoSet = normalizedStringSet(ownerRepos);
  if (
    duplicateValues(mergeOrder).length > 0 ||
    !sameStringSet(mergeOrder, [...ownerRepoSet])
  ) {
    errors.push("architecture merge order must exactly cover descendant owner repos");
  } else {
    const ownerByItem = new Map(
      ownerMap.map((entry) => [entry.work_item_id, entry.owner_repo]),
    );
    const positions = new Map(mergeOrder.map((repo, index) => [repo, index]));
    for (const [before, after] of precedenceEdges) {
      const beforeRepo = ownerByItem.get(before);
      const afterRepo = ownerByItem.get(after);
      if (
        beforeRepo &&
        afterRepo &&
        beforeRepo !== afterRepo &&
        positions.get(beforeRepo) >= positions.get(afterRepo)
      ) {
        errors.push(
          `architecture merge order violates ${before} before ${after}: ${beforeRepo} must precede ${afterRepo}`,
        );
      }
    }
  }

  const lifecycle = artifact.architecture?.lifecycle_state_model ?? {};
  const lifecycleStates = normalizedStringSet(lifecycle.states);
  for (const transition of objectValues(lifecycle.transitions)) {
    for (const endpoint of [transition.from, transition.to]) {
      if (typeof endpoint === "string" && !lifecycleStates.has(endpoint)) {
        errors.push(`architecture lifecycle transition references unknown state ${endpoint}`);
      }
    }
  }

  errors.push(...architectureConformanceErrors(artifact));

  if (artifact.decision?.status === "blocked-pending-architecture-decision") {
    const openDecisions = objectValues(
      artifact.architecture?.contradictions_open_decisions,
    ).filter((entry) => entry.status === "open");
    if (openDecisions.length === 0) {
      errors.push("blocked architecture decision must identify an open decision");
    }
  }
  if (artifact.decision?.status !== "draft") {
    requireTimeOrder(
      errors,
      "created_at",
      artifact.created_at,
      "decision.decided_at",
      artifact.decision?.decided_at,
    );
    requireTimeOrder(
      errors,
      "source_snapshot.captured_at",
      artifact.source_snapshot?.captured_at,
      "decision.decided_at",
      artifact.decision?.decided_at,
    );
    requireTimeOrder(
      errors,
      "decision.decided_at",
      artifact.decision?.decided_at,
      "custody.persisted_at",
      artifact.custody?.persisted_at,
    );
  }
  return errors;
}

function workStartSemanticErrors(artifact) {
  const errors = [];
  if (!identifierScopedTo(artifact.artifact_id, "work-start", artifact.delivery_id)) {
    errors.push("artifact_id must be scoped to delivery_id");
  }
  if (artifact.scope_fingerprint !== workStartScopeFingerprint(artifact)) {
    errors.push("scope_fingerprint does not match the work-start scope projection");
  }
  const deliveryNumber = entityNumber(artifact.delivery_id, "delivery");
  const allowedSourceIds = new Set([
    deliveryNumber,
    ...stringValues(artifact.covered_work_item_ids)
      .map((value) => entityNumber(value, "work-item")),
  ].filter(Boolean));
  if (!allowedSourceIds.has(openProjectWorkPackageNumber(artifact.source_snapshot?.art_ref))) {
    errors.push("work-start source snapshot must reference its Delivery initiative or covered work item");
  }
  errors.push(
    ...referenceDigestErrors(
      artifact.architecture?.packet_ref,
      artifact.architecture?.packet_digest,
      "architecture.packet_ref",
    ),
  );

  if (SOURCE_BACKED_DECISIONS.has(artifact.landing_unit?.decision)) {
    const ownerRepos = stringValues(artifact.landing_unit?.owner_repos);
    const branchPlan = objectValues(artifact.landing_unit?.branch_plan);
    const sourceRevisions = objectValues(artifact.source_snapshot?.repo_revisions);
    const branchRepos = branchPlan.map((entry) => entry.repo);
    const revisionRepos = sourceRevisions.map((entry) => entry.repo);
    if (duplicateValues(ownerRepos).length > 0) {
      errors.push("work-start owner repos must be unique");
    }
    if (duplicateValues(branchRepos).length > 0) {
      errors.push("work-start branch plan must contain one entry per repo");
    }
    if (duplicateValues(revisionRepos).length > 0) {
      errors.push("work-start source revisions must contain one entry per repo");
    }
    if (!sameStringSet(ownerRepos, branchRepos)) {
      errors.push("work-start branch plan must exactly cover owner repos");
    }
    if (!sameStringSet(ownerRepos, revisionRepos)) {
      errors.push("work-start source revisions must exactly cover owner repos");
    }
    const sourceByRepo = new Map(sourceRevisions.map((entry) => [entry.repo, entry]));
    for (const planned of branchPlan) {
      const source = sourceByRepo.get(planned.repo);
      if (source && source.base_ref !== planned.base_ref) {
        errors.push(`work-start base ref does not match source snapshot for ${planned.repo}`);
      }
      if (source && source.commit !== planned.base_commit) {
        errors.push(`work-start base commit does not match source snapshot for ${planned.repo}`);
      }
    }
  }
  if (!sameStringSet(artifact.invalidation_inputs, REQUIRED_INVALIDATION_INPUTS)) {
    errors.push("work-start invalidation inputs must contain the complete declared set");
  }
  if (
    artifact.architecture?.readiness === "architecture-ready" &&
    (!artifact.architecture.packet_ref || !artifact.architecture.packet_digest)
  ) {
    errors.push("architecture-ready work-start requires packet ref and digest");
  }
  if (
    artifact.architecture?.readiness !== "architecture-ready" &&
    (artifact.architecture?.packet_ref || artifact.architecture?.packet_digest)
  ) {
    errors.push("blocked or not-required architecture must not claim packet evidence");
  }
  if (artifact.readiness?.level !== "draft") {
    requireTimeOrder(
      errors,
      "created_at",
      artifact.created_at,
      "readiness.evaluated_at",
      artifact.readiness?.evaluated_at,
    );
    requireTimeOrder(
      errors,
      "source_snapshot.captured_at",
      artifact.source_snapshot?.captured_at,
      "readiness.evaluated_at",
      artifact.readiness?.evaluated_at,
    );
    requireTimeOrder(
      errors,
      "readiness.evaluated_at",
      artifact.readiness?.evaluated_at,
      "custody.persisted_at",
      artifact.custody?.persisted_at,
    );
  }
  return errors;
}

function allEvidenceEntries(packet) {
  const evidence = packet.evidence ?? {};
  return [
    ...(evidence.changed_surfaces ?? []),
    ...(evidence.tests ?? []),
    ...(evidence.validations ?? []),
    ...(evidence.runtime_and_live ?? []),
    ...(evidence.security_and_trust ?? []),
  ];
}

function reviewPacketSemanticErrors(packet) {
  const errors = [];
  if (!identifierScopedTo(packet.packet_id, "review-packet", packet.delivery_id)) {
    errors.push("packet_id must be scoped to delivery_id");
  }
  errors.push(
    ...referenceDigestErrors(
      packet.work_start?.artifact_ref,
      packet.work_start?.artifact_digest,
      "work_start.artifact_ref",
    ),
  );
  const evidenceEntries = allEvidenceEntries(packet);
  const evidenceIds = evidenceEntries.map((entry) => entry.id);
  if (new Set(evidenceIds).size !== evidenceIds.length) {
    errors.push("Review Packet evidence ids must be globally unique");
  }
  const covered = stringValues(packet.covered_work_item_ids);
  const mappings = objectValues(packet.evidence?.acceptance_mapping);
  const mappedItems = mappings.map((entry) => entry.work_item_id);
  if (duplicateValues(mappedItems).length > 0) {
    errors.push("Review Packet acceptance mapping must contain one row per work item");
  }
  if (!sameStringSet(covered, mappedItems)) {
    errors.push("Review Packet acceptance mapping must exactly cover work items");
  }
  const evidenceIdSet = new Set(evidenceIds);
  for (const mapping of mappings) {
    const itemNumber = entityNumber(mapping.work_item_id, "work-item");
    if (
      itemNumber !== null &&
      openProjectWorkPackageNumber(mapping.acceptance_ref) !== itemNumber
    ) {
      errors.push(
        `acceptance mapping for ${mapping.work_item_id} must reference the same OpenProject work item`,
      );
    }
    for (const evidenceId of mapping.evidence_ids ?? []) {
      if (!evidenceIdSet.has(evidenceId)) {
        errors.push(`acceptance mapping references unknown evidence ${evidenceId}`);
      }
    }
  }
  for (const entry of evidenceEntries) {
    if (entry.result === "fail") {
      errors.push(`required evidence ${entry.id} failed`);
    }
    if (
      entry.result === "not_applicable" &&
      (!entry.not_applicable_reason || !entry.authority_ref)
    ) {
      errors.push(`not-applicable evidence ${entry.id} requires reason and authority`);
    }
  }

  const decision = packet.landing_unit?.decision;
  const evidenceKind = packet.landing_unit?.evidence_kind;
  const repos = objectValues(packet.landing_unit?.repos);
  const repoNames = repos.map((entry) => entry.repo_name);
  if (duplicateValues(repoNames).length > 0) {
    errors.push("Review Packet landing repos must contain one entry per repo");
  }
  if (decision === "non_source_child") {
    if (!["pending", "non_source_evidence"].includes(evidenceKind)) {
      errors.push("non-source Landing Units may use only pending or non-source evidence");
    }
    if (repos.length > 0) {
      errors.push("non-source Landing Units must not declare source repositories");
    }
    if (objectValues(packet.evidence?.changed_surfaces).length > 0) {
      errors.push("non-source Landing Units must not declare changed source surfaces");
    }
  } else if (SOURCE_BACKED_DECISIONS.has(decision) && evidenceKind === "non_source_evidence") {
    errors.push("source-backed Landing Units must not use non-source evidence");
  }

  const repoByName = new Map(
    repos.map((entry) => [entry.repo_name, entry]),
  );
  for (const surface of packet.evidence?.changed_surfaces ?? []) {
    const repo = repoByName.get(surface.repo);
    if (!repo || !(repo.changed_files ?? []).includes(surface.path)) {
      errors.push(`changed surface ${surface.id} is not present in exact repo evidence`);
    }
  }

  const expectedSourceRevisions = new Set(
    repos.map((entry) => `${entry.repo_name}\u0000${entry.head_commit}`),
  );
  for (const entry of evidenceResults(packet)) {
    const revisions = objectValues(entry.source_revisions);
    const revisionRepos = revisions.map((revision) => revision.repo);
    if (duplicateValues(revisionRepos).length > 0) {
      errors.push(`evidence ${entry.id} must contain one source revision per repo`);
    }
    const declaredSourceRevisions = new Set(
      revisions.map((revision) => `${revision.repo}\u0000${revision.commit}`),
    );
    if (
      SOURCE_BACKED_DECISIONS.has(decision) &&
      entry.result === "pass" &&
      !sameStringSet([...declaredSourceRevisions], [...expectedSourceRevisions])
    ) {
      errors.push(`passing evidence ${entry.id} must bind every exact landing-unit source head`);
    }
    if (decision === "non_source_child" && declaredSourceRevisions.size > 0) {
      errors.push(`non-source evidence ${entry.id} must not declare source revisions`);
    }
  }

  requireTimeOrder(
    errors,
    "created_at",
    packet.created_at,
    "readiness.evaluated_at",
    packet.readiness?.evaluated_at,
  );
  if (packet.status === "finalized") {
    const expectedSubjectDigest = reviewPacketReadinessSubjectDigest(packet);
    if (packet.readiness?.subject_digest !== expectedSubjectDigest) {
      errors.push(`readiness.subject_digest must equal ${expectedSubjectDigest}`);
    }
    requireTimeOrder(
      errors,
      "readiness.evaluated_at",
      packet.readiness?.evaluated_at,
      "finalized_at",
      packet.finalized_at,
    );
    requireTimeOrder(
      errors,
      "finalized_at",
      packet.finalized_at,
      "custody.persisted_at",
      packet.custody?.persisted_at,
    );
  }

  if (evidenceKind === "approved_direct_land") {
    const cutoff = Math.max(
      ...[
        packet.readiness?.evaluated_at,
        packet.finalized_at,
        packet.custody?.persisted_at,
      ]
        .map(timestamp)
        .filter((value) => value !== null),
    );
    const validAuthority = Number.isFinite(cutoff) && objectValues(packet.exceptions)
      .some((exception) =>
        exception.kind === "direct-land" &&
        timestamp(exception.expires_at) !== null &&
        timestamp(exception.expires_at) > cutoff);
    if (!validAuthority) {
      errors.push(
        "approved direct land requires an exception valid through readiness, finalization, and durable custody",
      );
    }
  }
  return errors;
}

function receiptSemanticErrors(receipt) {
  const errors = [];
  const subjectPrefixes = {
    art_review_packet: "review-packet",
    delivery_art_architecture_packet: "architecture-packet",
    delivery_art_work_start_record: "work-start",
  };
  const subjectPrefix = subjectPrefixes[receipt.subject?.artifact_type];
  if (
    subjectPrefix &&
    !identifierScopedTo(receipt.subject?.artifact_id, subjectPrefix, receipt.delivery_id)
  ) {
    errors.push("readiness receipt subject id must be scoped to delivery_id");
  }
  const receiptToken = typeof receipt.receipt_id === "string"
    ? receipt.receipt_id.split(":", 2)[1]
    : null;
  if (
    receiptToken &&
    !String(receipt.custody?.uri ?? "").includes(`art-readiness-receipt-${receiptToken}-`)
  ) {
    errors.push("readiness receipt custody URI must include its receipt id");
  }
  const deliveryNumber = entityNumber(receipt.delivery_id, "delivery");
  if (
    deliveryNumber !== null &&
    receipt.readiness?.target_scope !== `art:delivery-${deliveryNumber}`
  ) {
    errors.push("readiness receipt target scope must match its Delivery initiative");
  }
  const findings = objectValues(receipt.findings);
  const findingIds = findings.map((finding) => finding.id);
  if (duplicateValues(findingIds).length > 0) {
    errors.push("readiness receipt findings must have unique ids");
  }
  if (
    receipt.readiness?.outcome === "ready" &&
    receipt.readiness?.mutation_allowed !== true
  ) {
    errors.push("ready receipt must permit mutation");
  }
  if (
    receipt.readiness?.outcome === "ready" &&
    findings.some((finding) => ["blocker", "error"].includes(finding.severity))
  ) {
    errors.push("ready receipt must not contain blocker or error findings");
  }
  if (receipt.readiness?.outcome !== "ready" && findings.length === 0) {
    errors.push("non-ready receipt must identify at least one finding");
  }
  if (
    receipt.readiness?.outcome === "blocked" &&
    !findings.some((finding) => ["blocker", "error"].includes(finding.severity))
  ) {
    errors.push("blocked receipt must identify a blocker or error finding");
  }
  requireTimeOrder(
    errors,
    "readiness.evaluated_at",
    receipt.readiness?.evaluated_at,
    "custody.persisted_at",
    receipt.custody?.persisted_at,
  );
  return errors;
}

export function validateDeliveryArtArtifact(artifact) {
  const errors = [
    ...canonicalJsonErrors(artifact),
    ...schemaErrors(artifact),
  ];
  if (errors.length === 0) {
    errors.push(...commonSemanticErrors(artifact));
    if (artifact.artifact_type === "delivery_art_architecture_packet") {
      errors.push(...architectureSemanticErrors(artifact));
    } else if (artifact.artifact_type === "delivery_art_work_start_record") {
      errors.push(...workStartSemanticErrors(artifact));
    } else if (artifact.artifact_type === "art_review_packet") {
      errors.push(...reviewPacketSemanticErrors(artifact));
    } else if (artifact.artifact_type === "delivery_art_readiness_receipt") {
      errors.push(...receiptSemanticErrors(artifact));
    } else if (artifact.artifact_type === "delivery_art_custody_receipt") {
      errors.push(...custodyReceiptSemanticErrors(artifact));
    }
  }
  return {
    artifact_type: artifact?.artifact_type ?? null,
    content_digest: errors.length === 0 ? artifactContentDigest(artifact) : null,
    errors,
    valid: errors.length === 0,
  };
}

function dependenciesByRef(artifacts) {
  const byRef = new Map();
  for (const artifact of artifacts) {
    const uri = artifact?.custody?.uri;
    if (typeof uri !== "string") {
      continue;
    }
    const candidates = byRef.get(uri) ?? [];
    candidates.push(artifact);
    byRef.set(uri, candidates);
  }
  return byRef;
}

function assertResolvedReference(errors, byRef, ref, digest, label, expectedType) {
  const candidates = byRef.get(ref) ?? [];
  if (candidates.length === 0) {
    errors.push(`${label} does not resolve`);
    return null;
  }
  if (candidates.length > 1) {
    errors.push(`${label} resolves ambiguously`);
    return null;
  }
  const dependency = candidates[0];
  if (dependency.artifact_type !== expectedType) {
    errors.push(`${label} resolves to ${dependency.artifact_type}, not ${expectedType}`);
    return null;
  }
  if (dependency.integrity?.content_digest !== digest) {
    errors.push(`${label} digest does not match the resolved artifact`);
    return null;
  }
  return dependency;
}

function resolvedArtifactIdentifier(artifact) {
  return artifact?.packet_id ?? artifact?.artifact_id ?? artifact?.receipt_id ?? null;
}

function validateCustodyReceiptBinding(errors, sourceArtifact, receipt, label) {
  const expectedSubject = {
    artifact_id: resolvedArtifactIdentifier(sourceArtifact),
    artifact_type: sourceArtifact.artifact_type,
    content_digest: sourceArtifact.integrity?.content_digest,
    delivery_id: sourceArtifact.delivery_id,
    registry_uri: sourceArtifact.custody?.uri,
  };
  for (const [field, expected] of Object.entries(expectedSubject)) {
    if (receipt.subject?.[field] !== expected) {
      errors.push(`${label} subject.${field} must match the source artifact`);
    }
  }
  requireTimeOrder(
    errors,
    `${label} custody.persisted_at`,
    receipt.custody?.persisted_at,
    "source artifact custody.persisted_at",
    sourceArtifact.custody?.persisted_at,
    { strict: true },
  );
}

function receiptSubjectDigest(artifact, digestKind) {
  if (digestKind === "artifact-content") {
    return artifact?.integrity?.content_digest ?? null;
  }
  if (digestKind === "readiness-subject" && artifact?.artifact_type === "art_review_packet") {
    return reviewPacketReadinessSubjectDigest(artifact);
  }
  return null;
}

export function validateDeliveryArtReferences(artifact, dependencies = []) {
  const errors = [];
  const seen = new Set();
  const artifacts = [artifact, ...dependencies].filter((candidate) => {
    if (!candidate || typeof candidate !== "object" || seen.has(candidate)) {
      return false;
    }
    seen.add(candidate);
    return true;
  });
  const byRef = dependenciesByRef(artifacts);
  for (const [uri, candidates] of byRef) {
    if (candidates.length > 1) {
      errors.push(`dependency artifact ref ${uri} resolves ambiguously`);
    }
  }

  for (const candidate of artifacts) {
    const validation = validateDeliveryArtArtifact(candidate);
    if (!validation.valid) {
      const identifier = resolvedArtifactIdentifier(candidate) ?? "unknown";
      errors.push(
        ...validation.errors.map((error) =>
          `dependency artifact ${identifier}: ${error}`),
      );
    }
  }

  for (const candidate of artifacts) {
    if (
      ![
        "delivery_art_architecture_packet",
        "delivery_art_work_start_record",
        "art_review_packet",
      ].includes(candidate.artifact_type) ||
      candidate.custody?.state !== "durable" ||
      candidate.custody?.backend !== "wgcf-artifact-registry"
    ) {
      continue;
    }
    const label = candidate === artifact
      ? "custody receipt"
      : `${resolvedArtifactIdentifier(candidate) ?? "dependency"} custody receipt`;
    const receipt = assertResolvedReference(
      errors,
      byRef,
      candidate.custody?.receipt_ref?.uri,
      candidate.custody?.receipt_ref?.digest,
      `${label} ref`,
      "delivery_art_custody_receipt",
    );
    if (receipt) {
      validateCustodyReceiptBinding(errors, candidate, receipt, label);
    }
  }

  if (artifact.artifact_type === "delivery_art_custody_receipt") {
    const subject = artifact.subject ?? {};
    const subjectCandidates = artifacts.filter((candidate) =>
      candidate !== artifact &&
      candidate.artifact_type === subject.artifact_type &&
      resolvedArtifactIdentifier(candidate) === subject.artifact_id &&
      candidate.integrity?.content_digest === subject.content_digest &&
      candidate.custody?.uri === subject.registry_uri);
    if (subjectCandidates.length === 0) {
      errors.push("custody receipt subject does not resolve to its declared source artifact");
    } else if (subjectCandidates.length > 1) {
      errors.push("custody receipt subject resolves ambiguously");
    } else {
      validateCustodyReceiptBinding(
        errors,
        subjectCandidates[0],
        artifact,
        "custody receipt",
      );
    }
  }

  let current = artifact;
  const currentUri = artifact.custody?.uri;
  const visitedSupersessionUris = new Set(
    typeof currentUri === "string" ? [currentUri] : [],
  );
  while (current?.custody?.supersedes) {
    const priorRef = current.custody.supersedes;
    const prior = assertResolvedReference(
      errors,
      byRef,
      priorRef.uri,
      priorRef.digest,
      "custody.supersedes.uri",
      artifact.artifact_type,
    );
    if (!prior) {
      break;
    }
    if (visitedSupersessionUris.has(priorRef.uri)) {
      errors.push("custody supersession chain must be acyclic");
      return errors;
    }
    if (artifact.artifact_type === "delivery_art_custody_receipt") {
      for (const field of ["delivery_id", "artifact_type", "artifact_id"]) {
        if (prior.subject?.[field] !== artifact.subject?.[field]) {
          errors.push(
            `superseded custody receipt subject.${field} must match its replacement`,
          );
        }
      }
    } else {
      if (prior.delivery_id !== artifact.delivery_id) {
        errors.push("superseded artifact delivery id must match its replacement");
      }
      if (resolvedArtifactIdentifier(prior) !== resolvedArtifactIdentifier(artifact)) {
        errors.push("superseded artifact identifier must match its replacement");
      }
    }
    if (prior.custody?.state !== "durable") {
      errors.push("superseded artifact must have durable custody");
    }
    requireTimeOrder(
      errors,
      "superseded custody.persisted_at",
      prior.custody?.persisted_at,
      "replacement custody.persisted_at",
      current.custody?.persisted_at,
      { strict: true },
    );
    visitedSupersessionUris.add(priorRef.uri);
    current = prior;
  }

  const resolveArchitecture = (workStart) => {
    if (workStart.architecture?.readiness !== "architecture-ready") {
      return null;
    }
    const architecture = assertResolvedReference(
      errors,
      byRef,
      workStart.architecture.packet_ref,
      workStart.architecture.packet_digest,
      "work-start architecture packet",
      "delivery_art_architecture_packet",
    );
    if (!architecture) {
      return null;
    }
    if (architecture.delivery_id !== workStart.delivery_id) {
      errors.push("work-start and architecture packet delivery ids differ");
    }
    if (architecture.decision?.status !== "architecture-ready") {
      errors.push("work-start architecture packet is not architecture-ready");
    }
    const workStartCutoff = workStart.readiness?.evaluated_at ?? workStart.created_at;
    requireTimeOrder(
      errors,
      "architecture decision.decided_at",
      architecture.decision?.decided_at,
      "work-start evaluation",
      workStartCutoff,
    );
    requireTimeOrder(
      errors,
      "architecture custody.persisted_at",
      architecture.custody?.persisted_at,
      "work-start evaluation",
      workStartCutoff,
    );
    const architectureCoverage = normalizedStringSet(architecture.covered_work_item_ids);
    if (
      !stringValues(workStart.covered_work_item_ids)
        .every((workItemId) => architectureCoverage.has(workItemId))
    ) {
      errors.push("work-start coverage is not contained in its architecture packet");
    }
    const workStartCoverage = normalizedStringSet(workStart.covered_work_item_ids);
    const architectureOwners = new Set(
      objectValues(architecture.architecture?.descendant_owner_map)
        .filter((entry) => workStartCoverage.has(entry.work_item_id))
        .map((entry) => entry.owner_repo),
    );
    if (!sameStringSet([...architectureOwners], workStart.landing_unit?.owner_repos ?? [])) {
      errors.push("work-start owner repos differ from its architecture owner map");
    }
    return architecture;
  };

  if (artifact.artifact_type === "delivery_art_work_start_record") {
    resolveArchitecture(artifact);
  }

  if (artifact.artifact_type === "delivery_art_readiness_receipt") {
    const subject = artifact.subject ?? {};
    const subjectCandidates = artifacts.filter((candidate) =>
      candidate !== artifact &&
      candidate.artifact_type === subject.artifact_type &&
      resolvedArtifactIdentifier(candidate) === subject.artifact_id &&
      receiptSubjectDigest(candidate, subject.digest_kind) === subject.digest);
    if (subjectCandidates.length === 0) {
      errors.push("readiness receipt subject does not resolve to its declared artifact and digest");
    } else if (subjectCandidates.length > 1) {
      errors.push("readiness receipt subject resolves ambiguously");
    } else {
      const subjectArtifact = subjectCandidates[0];
      if (subjectArtifact.delivery_id !== artifact.delivery_id) {
        errors.push("readiness receipt and subject delivery ids differ");
      }
      if (!sameStringSet(
        subjectArtifact.covered_work_item_ids,
        artifact.covered_work_item_ids,
      )) {
        errors.push("readiness receipt coverage differs from its subject");
      }
      const level = artifact.readiness?.level;
      const expected = {
        "architecture-ready": [
          "delivery_art_architecture_packet",
          subjectArtifact.decision?.status,
          "architecture-ready",
        ],
        "implementation-ready": [
          "delivery_art_work_start_record",
          subjectArtifact.readiness?.level,
          "implementation-ready",
        ],
        "merge-ready": [
          "art_review_packet",
          [subjectArtifact.status, subjectArtifact.readiness?.level],
          ["merge-ready", "merge-ready"],
        ],
        "operating-ready": [
          "art_review_packet",
          [subjectArtifact.status, subjectArtifact.readiness?.level],
          ["finalized", "operating-ready"],
        ],
      }[level];
      if (expected) {
        const [expectedType, actualState, expectedState] = expected;
        if (subjectArtifact.artifact_type !== expectedType) {
          errors.push("readiness receipt level resolves the wrong artifact type");
        }
        if (
          artifact.readiness?.outcome === "ready" &&
          !sameCanonicalValue(actualState, expectedState)
        ) {
          errors.push("ready receipt subject has not reached its declared readiness level");
        }
      }
      const subjectStateTime = level === "architecture-ready"
        ? subjectArtifact.decision?.decided_at
        : subjectArtifact.readiness?.evaluated_at;
      requireTimeOrder(
        errors,
        "readiness receipt subject decision",
        subjectStateTime,
        "readiness receipt evaluation",
        artifact.readiness?.evaluated_at,
      );
      if (subject.digest_kind === "artifact-content") {
        if (subjectArtifact.custody?.state !== "durable") {
          errors.push("artifact-content receipt subject must have durable custody");
        }
        requireTimeOrder(
          errors,
          "readiness receipt subject custody.persisted_at",
          subjectArtifact.custody?.persisted_at,
          "readiness receipt evaluation",
          artifact.readiness?.evaluated_at,
        );
      } else if (
        level === "operating-ready" &&
        subjectArtifact.readiness?.evaluated_at !== artifact.readiness?.evaluated_at
      ) {
        errors.push("operating-readiness receipt time must match its Review Packet subject");
      }
    }
  }

  if (artifact.artifact_type === "art_review_packet") {
    const workStart = assertResolvedReference(
      errors,
      byRef,
      artifact.work_start?.artifact_ref,
      artifact.work_start?.artifact_digest,
      "Review Packet work-start record",
      "delivery_art_work_start_record",
    );
    if (workStart) {
      if (workStart.delivery_id !== artifact.delivery_id) {
        errors.push("Review Packet and work-start delivery ids differ");
      }
      if (!sameStringSet(workStart.covered_work_item_ids, artifact.covered_work_item_ids)) {
        errors.push("Review Packet coverage differs from its work-start record");
      }
      if (workStart.scope_fingerprint !== artifact.work_start.scope_fingerprint) {
        errors.push("Review Packet scope fingerprint differs from its work-start record");
      }
      if (workStart.readiness?.level !== "implementation-ready") {
        errors.push("Review Packet work-start record is not implementation-ready");
      }
      requireTimeOrder(
        errors,
        "work-start readiness.evaluated_at",
        workStart.readiness?.evaluated_at,
        "Review Packet created_at",
        artifact.created_at,
      );
      requireTimeOrder(
        errors,
        "work-start custody.persisted_at",
        workStart.custody?.persisted_at,
        "Review Packet created_at",
        artifact.created_at,
      );
      if (workStart.landing_unit?.decision !== artifact.landing_unit?.decision) {
        errors.push("Review Packet Landing Unit decision differs from work-start");
      }
      const planned = new Map(
        (workStart.landing_unit?.branch_plan ?? []).map((entry) => [entry.repo, entry]),
      );
      const actual = new Map(
        (artifact.landing_unit?.repos ?? []).map((entry) => [entry.repo_name, entry]),
      );
      if (!sameStringSet([...planned.keys()], [...actual.keys()])) {
        errors.push("Review Packet repos differ from work-start owner repos");
      }
      for (const [repoName, plan] of planned) {
        const repo = actual.get(repoName);
        if (repo && (repo.branch !== plan.branch || repo.base_ref !== plan.base_ref || repo.base_commit !== plan.base_commit)) {
          errors.push(`Review Packet source plan differs for ${repoName}`);
        }
      }

      const architecture = resolveArchitecture(workStart);
      if (architecture?.conformance_plan?.required === true) {
        const packetItems = normalizedStringSet(artifact.covered_work_item_ids);
        const packetRank = READINESS_RANK.get(artifact.readiness?.level) ?? 0;
        const cases = new Map(
          objectValues(architecture.conformance_plan.cases)
            .map((entry) => [entry.id, entry]),
        );
        const applicableCases = new Map(
          [...cases].filter(([, entry]) =>
            stringValues(entry.applies_to_work_item_ids)
              .some((workItemId) => packetItems.has(workItemId)) &&
            (READINESS_RANK.get(entry.target_readiness) ?? 99) <= packetRank),
        );
        const caseResults = new Map();
        for (const result of evidenceResults(artifact)) {
          for (const caseId of stringValues(result.conformance_case_ids)) {
            const results = caseResults.get(caseId) ?? [];
            results.push(result);
            caseResults.set(caseId, results);
          }
        }
        const unknownCases = setDifference(
          new Set(caseResults.keys()),
          new Set(cases.keys()),
        );
        if (unknownCases.size > 0) {
          errors.push(`Review Packet evidence references unknown conformance cases: ${[...unknownCases].sort().join(", ")}`);
        }
        const prematureCases = setDifference(
          new Set(caseResults.keys()),
          new Set(applicableCases.keys()),
        );
        if (prematureCases.size > 0) {
          errors.push(`Review Packet evidence references out-of-scope conformance cases: ${[...prematureCases].sort().join(", ")}`);
        }
        const missingCases = setDifference(
          new Set(applicableCases.keys()),
          new Set(caseResults.keys()),
        );
        if (missingCases.size > 0) {
          errors.push(`Review Packet is missing applicable conformance cases: ${[...missingCases].sort().join(", ")}`);
        }
        for (const [caseId, results] of caseResults) {
          const planned = applicableCases.get(caseId);
          if (!planned) {
            continue;
          }
          for (const result of results) {
            if (result.result !== "pass") {
              errors.push(`conformance case ${caseId} must pass`);
            }
            if (result.fidelity !== planned.fidelity) {
              errors.push(`conformance case ${caseId} must use ${planned.fidelity} fidelity`);
            }
          }
        }
      }
    }

    if (
      artifact.status === "finalized" &&
      SOURCE_BACKED_DECISIONS.has(artifact.landing_unit?.decision) &&
      artifact.custody?.supersedes
    ) {
      const predecessor = assertResolvedReference(
        errors,
        byRef,
        artifact.custody.supersedes.uri,
        artifact.custody.supersedes.digest,
        "finalized Review Packet predecessor",
        "art_review_packet",
      );
      if (predecessor) {
        errors.push(...reviewPacketContinuityErrors(artifact, predecessor));
      }
    }

    for (const receiptRef of artifact.readiness?.receipt_refs ?? []) {
      const receipt = assertResolvedReference(
        errors,
        byRef,
        receiptRef.uri,
        receiptRef.digest,
        "Review Packet readiness receipt",
        "delivery_art_readiness_receipt",
      );
      if (receipt) {
        if (receipt.delivery_id !== artifact.delivery_id) {
          errors.push("readiness receipt and Review Packet delivery ids differ");
        }
        if (!sameStringSet(receipt.covered_work_item_ids, artifact.covered_work_item_ids)) {
          errors.push("readiness receipt coverage differs from Review Packet");
        }
        if (receipt.subject?.artifact_id !== artifact.packet_id) {
          errors.push("readiness receipt subject does not match Review Packet id");
        }
        if (receipt.subject?.digest_kind !== "readiness-subject") {
          errors.push("finalized Review Packet requires a readiness-subject receipt");
        }
        if (receipt.subject?.digest !== artifact.readiness?.subject_digest) {
          errors.push("readiness receipt subject digest does not match Review Packet");
        }
        if (receipt.readiness?.level !== artifact.readiness?.level) {
          errors.push("readiness receipt level does not match Review Packet");
        }
        if (
          receipt.readiness?.outcome !== "ready" ||
          receipt.readiness?.mutation_allowed !== true
        ) {
          errors.push("readiness receipt does not permit finalization");
        }
        if (receipt.readiness?.evaluated_at !== artifact.readiness?.evaluated_at) {
          errors.push("readiness receipt evaluation time does not match Review Packet");
        }
        requireTimeOrder(
          errors,
          "readiness receipt custody.persisted_at",
          receipt.custody?.persisted_at,
          "Review Packet finalized_at",
          artifact.finalized_at,
        );
        requireTimeOrder(
          errors,
          "readiness receipt custody.persisted_at",
          receipt.custody?.persisted_at,
          "Review Packet custody.persisted_at",
          artifact.custody?.persisted_at,
        );
      }
    }
  }
  return errors;
}

function reviewPacketContinuityErrors(finalized, predecessor) {
  const errors = [];
  for (const field of [
    "packet_id",
    "delivery_id",
    "covered_work_item_ids",
    "created_at",
    "operator",
    "work_start",
  ]) {
    if (canonicalStringify(finalized[field]) !== canonicalStringify(predecessor[field])) {
      errors.push(`finalized Review Packet changed merge-ready ${field}`);
    }
  }
  if (predecessor.status !== "merge-ready") {
    errors.push("finalized Review Packet predecessor must be merge-ready");
  }
  for (const field of ["decision", "rollback_boundary"]) {
    if (!sameCanonicalValue(finalized.landing_unit?.[field], predecessor.landing_unit?.[field])) {
      errors.push(`finalized Review Packet changed merge-ready landing_unit.${field}`);
    }
  }
  const expectedKind = predecessor.landing_unit?.evidence_kind === "open_pr"
    ? "merged_pr"
    : predecessor.landing_unit?.evidence_kind === "approved_direct_land"
      ? "approved_direct_land"
      : null;
  if (finalized.landing_unit?.evidence_kind !== expectedKind) {
    errors.push("finalized Review Packet evidence kind does not advance its predecessor");
  }

  const predecessorRepos = new Map(
    objectValues(predecessor.landing_unit?.repos)
      .map((repo) => [repo.repo_name, repo]),
  );
  const finalizedRepos = new Map(
    objectValues(finalized.landing_unit?.repos)
      .map((repo) => [repo.repo_name, repo]),
  );
  if (!sameStringSet([...predecessorRepos.keys()], [...finalizedRepos.keys()])) {
    errors.push("finalized Review Packet repos differ from its merge-ready predecessor");
  }
  const stableRepoFields = [
    "branch",
    "base_ref",
    "base_commit",
    "head_commit",
    "pr_url",
    "changed_files",
    "change_record_refs",
  ];
  for (const [repoName, predecessorRepo] of predecessorRepos) {
    const finalizedRepo = finalizedRepos.get(repoName);
    if (!finalizedRepo) {
      continue;
    }
    for (const field of stableRepoFields) {
      if (!sameCanonicalValue(finalizedRepo[field], predecessorRepo[field])) {
        errors.push(`finalized Review Packet changed merge-ready ${repoName}.${field}`);
      }
    }
  }

  for (const section of EVIDENCE_SECTIONS) {
    const finalizedEntries = new Set(
      objectValues(finalized.evidence?.[section]).map(canonicalStringify),
    );
    for (const predecessorEntry of objectValues(predecessor.evidence?.[section])) {
      if (!finalizedEntries.has(canonicalStringify(predecessorEntry))) {
        errors.push(
          `finalized Review Packet did not preserve merge-ready evidence ${predecessorEntry.id}`,
        );
      }
    }
  }

  const finalizedMappings = new Map(
    objectValues(finalized.evidence?.acceptance_mapping)
      .map((mapping) => [mapping.work_item_id, mapping]),
  );
  for (const predecessorMapping of objectValues(predecessor.evidence?.acceptance_mapping)) {
    const finalizedMapping = finalizedMappings.get(predecessorMapping.work_item_id);
    if (!finalizedMapping) {
      errors.push(
        `finalized Review Packet did not preserve merge-ready acceptance mapping for ${predecessorMapping.work_item_id}`,
      );
      continue;
    }
    const preservedEvidence = stringValues(predecessorMapping.evidence_ids)
      .every((evidenceId) => stringValues(finalizedMapping.evidence_ids).includes(evidenceId));
    if (
      finalizedMapping.acceptance_ref !== predecessorMapping.acceptance_ref ||
      finalizedMapping.summary !== predecessorMapping.summary ||
      !preservedEvidence
    ) {
      errors.push(
        `finalized Review Packet changed merge-ready acceptance evidence for ${predecessorMapping.work_item_id}`,
      );
    }
  }

  if (
    predecessor.rollback !== null &&
    predecessor.rollback !== undefined &&
    !sameCanonicalValue(finalized.rollback, predecessor.rollback)
  ) {
    errors.push("finalized Review Packet changed merge-ready rollback evidence");
  }
  const finalizedExceptions = new Set(
    objectValues(finalized.exceptions).map(canonicalStringify),
  );
  for (const predecessorException of objectValues(predecessor.exceptions)) {
    if (!finalizedExceptions.has(canonicalStringify(predecessorException))) {
      errors.push(
        `finalized Review Packet did not preserve merge-ready exception ${predecessorException.id}`,
      );
    }
  }
  return errors;
}

export function assertValidDeliveryArtArtifact(artifact, dependencies = []) {
  const validation = validateDeliveryArtArtifact(artifact);
  const referenceErrors = validation.valid
    ? validateDeliveryArtReferences(artifact, dependencies)
    : [];
  const errors = [...validation.errors, ...referenceErrors];
  if (errors.length > 0) {
    const error = new Error(errors.join("; "));
    error.code = "delivery_art_artifact_invalid";
    error.validation = { ...validation, errors, valid: false };
    throw error;
  }
  return { ...validation, errors: [], valid: true };
}

export function deliveryArtContractManifest() {
  return clone(MANIFEST);
}
