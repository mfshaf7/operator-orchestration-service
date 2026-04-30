import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import {
  DELIVERY_COMPLETION_OPTIONAL_SECTION_NAMES,
  DELIVERY_COMPLETION_REQUIRED_SECTION_NAMES,
  validateCompletionSections,
} from "./completion-evidence.js";
import {
  parseDeliveryId,
  parseWorkItemId,
  toDeliveryId,
  toWorkItemId,
} from "./delivery-model.js";
import { readMarkdownSections } from "./delivery-narrative.js";
import {
  validatePlanApplyInput,
  validateWorkItemCreateInput,
} from "./work-item-create-preflight.js";

export const ARTIFACT_SCHEMA_VERSION = 1;
export const MUTATION_DRAFT_TYPE = "art_mutation_draft";
export const REVIEW_PACKET_TYPE = "art_review_packet";
export const MANAGED_ARTIFACT_ROOT = ".art";
export const MANAGED_DRAFT_DIR = path.join(MANAGED_ARTIFACT_ROOT, "drafts");
export const MANAGED_REVIEW_PACKET_DIR = path.join(
  MANAGED_ARTIFACT_ROOT,
  "review-packets",
);
export const MANAGED_ARCHIVE_DIR = path.join(MANAGED_ARTIFACT_ROOT, "archive");

const MUTATION_OPERATIONS = {
  "initiative.close": {
    description: "Close an initiative through the guided PM2 closeout route.",
    method: "POST",
    target: "delivery",
    path: (targetId) => `/v1/delivery-initiatives/${targetId}/close`,
    payloadTemplate: () => ({
      input: {
        changed_surfaces: "- `CHECK:path/or/surface`: explain what changed.",
        completion_summary: "CHECK: summarize the initiative closeout outcome.",
        demo_date: new Date().toISOString().slice(0, 10),
        demo_evidence: "- CHECK: add system-demo evidence.",
        demo_outcome: "reviewed",
        demo_summary: "CHECK: summarize the system-demo outcome.",
        inspect_action_items: "- CHECK: add inspect-and-adapt actions.",
        inspect_date: new Date().toISOString().slice(0, 10),
        inspect_summary: "CHECK: summarize the inspect-and-adapt outcome.",
        test_result_evidence: "- CHECK: add test-result evidence.",
        validation_evidence: "- CHECK: add validation evidence.",
      },
    }),
  },
  "initiative.governance": {
    description: "Update initiative governance metadata through the broker.",
    method: "POST",
    target: "delivery",
    path: (targetId) => `/v1/delivery-initiatives/${targetId}/governance`,
    payloadTemplate: () => ({
      input: {
        owner_repo: "CHECK: owner repo",
        target_pi: "CHECK: target PI or null",
      },
    }),
  },
  "initiative.inspect-and-adapt": {
    description: "Record Inspect and Adapt evidence on an initiative.",
    method: "POST",
    target: "delivery",
    path: (targetId) =>
      `/v1/delivery-initiatives/${targetId}/inspect-and-adapt`,
    payloadTemplate: () => ({
      input: {
        action_items: "- CHECK: add action items.",
        inspect_date: new Date().toISOString().slice(0, 10),
        inspect_summary: "CHECK: summarize inspect-and-adapt outcome.",
      },
    }),
  },
  "initiative.pi-review": {
    description: "Record PI review and carryover posture for an initiative.",
    method: "POST",
    target: "delivery",
    path: (targetId) => `/v1/delivery-initiatives/${targetId}/pi-review`,
    payloadTemplate: () => ({
      input: {
        pi_review_date: new Date().toISOString().slice(0, 10),
        reviews: [],
        target_pi: "CHECK: reviewed PI",
      },
    }),
  },
  "initiative.plan.apply": {
    description: "Apply a structured delivery plan to an initiative.",
    method: "POST",
    target: "delivery",
    path: (targetId) => `/v1/delivery-initiatives/${targetId}/plan/apply`,
    payloadTemplate: () => ({
      input: {
        plan: {
          items: [],
          schema_version: 1,
        },
      },
    }),
  },
  "initiative.plan.repair": {
    description: "Apply a bounded planning repair to an initiative.",
    method: "POST",
    target: "delivery",
    path: (targetId) => `/v1/delivery-initiatives/${targetId}/plan/repair`,
    payloadTemplate: () => ({
      input: {
        repairs: [],
        schema_version: 1,
      },
    }),
  },
  "initiative.system-demo": {
    description: "Record system-demo evidence on an initiative.",
    method: "POST",
    target: "delivery",
    path: (targetId) => `/v1/delivery-initiatives/${targetId}/system-demo`,
    payloadTemplate: () => ({
      input: {
        demo_date: new Date().toISOString().slice(0, 10),
        demo_evidence: "- CHECK: add system-demo evidence.",
        demo_outcome: "reviewed",
        demo_summary: "CHECK: summarize the system-demo outcome.",
      },
    }),
  },
  "work-item.blocker": {
    description: "Enter or clear a work-item blocker through the bounded route.",
    method: "POST",
    target: "work-item",
    path: (targetId) => `/v1/delivery-work-items/${targetId}/blocker`,
    payloadTemplate: () => ({
      input: {
        action: "record",
        blocker_decision_path: "remove",
        blocker_impact: "CHECK: describe impact.",
        blocker_owner: "CHECK: owner",
        blocker_statement: "CHECK: state exact blocker.",
      },
    }),
  },
  "work-item.bulk-update": {
    description: "Update several work items in one bounded broker request.",
    method: "POST",
    requiredInputSchemaVersion: 1,
    target: "none",
    path: () => "/v1/delivery-work-items/bulk-update",
    payloadTemplate: () => ({
      input: {
        schema_version: 1,
        updates: [],
      },
    }),
  },
  "work-item.complete": {
    description: "Complete a work item with source-backed evidence.",
    method: "POST",
    target: "work-item",
    path: (targetId) => `/v1/delivery-work-items/${targetId}/complete`,
    payloadTemplate: () => ({
      input: {
        changed_surfaces: "- `CHECK:path/or/surface`: explain what changed.",
        completion_summary: "CHECK: summarize the completed work.",
        test_result_evidence: "- CHECK: add test-result evidence.",
        validation_evidence: "- CHECK: add validation evidence.",
      },
    }),
  },
  "work-item.create": {
    description: "Create one delivery work item.",
    method: "POST",
    target: "none",
    path: () => "/v1/delivery-work-items",
    payloadTemplate: () => ({
      input: {
        parent_work_item_id: "CHECK: parent work item id",
        subject: "CHECK: subject",
        type: "User story",
      },
    }),
  },
  "work-item.dependency": {
    description: "Create or remove a dependency relation for one work item.",
    method: "POST",
    target: "work-item",
    path: (targetId) => `/v1/delivery-work-items/${targetId}/dependency`,
    payloadTemplate: () => ({
      input: {
        action: "add",
        depends_on_work_item_id: "CHECK: dependency work item id",
      },
    }),
  },
  "work-item.move": {
    description: "Move one work item to a different parent.",
    method: "POST",
    target: "work-item",
    path: (targetId) => `/v1/delivery-work-items/${targetId}/move`,
    payloadTemplate: () => ({
      input: {
        new_parent_work_item_id: "CHECK: new parent work item id",
        reason: "CHECK: explain the move.",
      },
    }),
  },
  "work-item.parking": {
    description: "Park, retire, or resume one work item.",
    method: "POST",
    target: "work-item",
    path: (targetId) => `/v1/delivery-work-items/${targetId}/parking`,
    payloadTemplate: () => ({
      input: {
        action: "park",
        park_decision: "defer",
        park_reason: "CHECK: explain why this work is parked.",
        park_review_date: new Date().toISOString().slice(0, 10),
      },
    }),
  },
  "work-item.stale-open-close": {
    description: "Close a stale-open item when completed child scope satisfies it.",
    method: "POST",
    target: "work-item",
    path: (targetId) => `/v1/delivery-work-items/${targetId}/stale-open-close`,
    payloadTemplate: () => ({
      input: {
        changed_surfaces: "- `CHECK:path/or/surface`: explain what changed.",
        completion_summary: "CHECK: summarize the completed child scope.",
        stale_open_justification:
          "CHECK: explain why completed child scope satisfies this item.",
        test_result_evidence: "- CHECK: add test-result evidence.",
        validation_evidence: "- CHECK: add validation evidence.",
      },
    }),
  },
  "work-item.update": {
    description: "Update one delivery work item.",
    method: "POST",
    target: "work-item",
    path: (targetId) => `/v1/delivery-work-items/${targetId}/update`,
    payloadTemplate: () => ({
      input: {
        work_note: "CHECK: explain the update.",
      },
    }),
  },
};

export function listMutationOperations() {
  return Object.entries(MUTATION_OPERATIONS)
    .map(([operation, definition]) => ({
      description: definition.description,
      method: definition.method,
      operation,
      target: definition.target,
    }))
    .sort((left, right) => left.operation.localeCompare(right.operation));
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }

  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }

  return JSON.stringify(value);
}

function digestArtifact(value) {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

function normalizeTargetId(targetKind, targetId) {
  if (targetKind === "none") {
    if (targetId === undefined || targetId === null || targetId === "" || targetId === "-") {
      return null;
    }
    throw new Error("target_id must be omitted or '-' for operations without a target");
  }

  if (targetKind === "delivery") {
    const parsed = parseDeliveryId(targetId);
    if (!parsed) {
      throw new Error("target_id must look like delivery-304 or 304");
    }
    return toDeliveryId(parsed);
  }

  if (targetKind === "work-item") {
    const parsed = parseWorkItemId(targetId);
    if (!parsed) {
      throw new Error("target_id must look like work-item-310 or 310");
    }
    return toWorkItemId(parsed);
  }

  throw new Error(`unsupported target kind: ${targetKind}`);
}

function readJsonFile(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function writeJsonFile(filePath, value) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export function readArtifactFile(filePath) {
  return readJsonFile(path.resolve(filePath));
}

export function writeArtifactFile(filePath, value) {
  writeJsonFile(path.resolve(filePath), value);
}

function normalizeStringArray(values, fieldName) {
  if (values === undefined || values === null) {
    return [];
  }
  if (!Array.isArray(values)) {
    throw new Error(`${fieldName} must be an array`);
  }
  return values.map((entry, index) => {
    if (typeof entry !== "string" || !entry.trim()) {
      throw new Error(`${fieldName}[${index}] must be a non-empty string`);
    }
    return entry.trim();
  });
}

export function createMutationDraft({
  createdAt = new Date().toISOString(),
  operation,
  operator = null,
  targetId = null,
} = {}) {
  const definition = MUTATION_OPERATIONS[operation];
  if (!definition) {
    throw new Error(
      `unsupported mutation operation: ${operation}. Supported operations: ${Object.keys(
        MUTATION_OPERATIONS,
      )
        .sort()
        .join(", ")}`,
    );
  }

  const normalizedTargetId = normalizeTargetId(definition.target, targetId);
  const routePath = definition.path(normalizedTargetId);

  return {
    artifact_type: MUTATION_DRAFT_TYPE,
    created_at: createdAt,
    draft_id: `mutation-draft-${randomUUID()}`,
    operation,
    operator,
    payload: definition.payloadTemplate(normalizedTargetId),
    route: {
      method: definition.method,
      path: routePath,
    },
    schema_version: ARTIFACT_SCHEMA_VERSION,
    status: "draft",
    submission: {
      result: null,
      submitted_at: null,
    },
    target: {
      id: normalizedTargetId,
      kind: definition.target,
    },
    validation: {
      last_validated_at: null,
      result: "not_validated",
    },
  };
}

function completionEvidenceIssuesForDescription(description) {
  const sections = readMarkdownSections(description);
  const trackedHeadings = [
    ...DELIVERY_COMPLETION_REQUIRED_SECTION_NAMES,
    ...DELIVERY_COMPLETION_OPTIONAL_SECTION_NAMES,
  ];
  if (!trackedHeadings.some((heading) => sections.has(heading))) {
    return [];
  }

  const sectionBodies = Object.fromEntries(
    trackedHeadings
      .filter((heading) => sections.has(heading))
      .map((heading) => [heading, sections.get(heading)]),
  );
  return validateCompletionSections(sectionBodies).issues;
}

function validateMutationDraftPayloadSemantics({ draft, errors }) {
  if (draft.operation === "work-item.create") {
    const result = validateWorkItemCreateInput(draft.payload);
    for (const issue of result.issues) {
      errors.push(`payload.input: ${issue}`);
    }
    return;
  }

  if (draft.operation === "initiative.plan.apply") {
    const result = validatePlanApplyInput(draft.payload);
    for (const issue of result.issues) {
      errors.push(`payload.input: ${issue}`);
    }
    return;
  }

  if (draft.operation === "initiative.pi-review") {
    const reviews = draft.payload?.input?.reviews;
    if (!Array.isArray(reviews) || reviews.length === 0) {
      errors.push("payload.input.reviews must include at least one PI Objective review");
      return;
    }

    for (let index = 0; index < reviews.length; index += 1) {
      const review = reviews[index];
      if (!review || typeof review !== "object" || Array.isArray(review)) {
        errors.push(`payload.input.reviews[${index}] must be an object`);
        continue;
      }

      const targetWorkPackageId = review.target_work_package_id;
      const targetIsInteger =
        Number.isInteger(targetWorkPackageId) && targetWorkPackageId > 0;
      const targetIsNumericString =
        typeof targetWorkPackageId === "string" &&
        /^[1-9][0-9]*$/.test(targetWorkPackageId.trim());
      if (!targetIsInteger && !targetIsNumericString) {
        errors.push(
          `payload.input.reviews[${index}].target_work_package_id must be a positive integer or numeric string`,
        );
      }

      if (typeof review.review_outcome !== "string" || !review.review_outcome.trim()) {
        errors.push(`payload.input.reviews[${index}].review_outcome is required`);
      }

      const actualBusinessValue = review.actual_business_value;
      const actualIsInteger =
        Number.isInteger(actualBusinessValue) && actualBusinessValue >= 0;
      const actualIsNumericString =
        typeof actualBusinessValue === "string" && /^[0-9]+$/.test(actualBusinessValue.trim());
      if (!actualIsInteger && !actualIsNumericString) {
        errors.push(
          `payload.input.reviews[${index}].actual_business_value must be an integer greater than or equal to 0`,
        );
      }
    }
    return;
  }

  if (draft.operation !== "work-item.bulk-update") {
    return;
  }

  const updates = draft.payload?.input?.updates;
  if (!Array.isArray(updates)) {
    return;
  }

  for (let index = 0; index < updates.length; index += 1) {
    const update = updates[index];
    if (!update || typeof update !== "object" || Array.isArray(update)) {
      continue;
    }

    if (typeof update.description !== "string") {
      continue;
    }

    for (const issue of completionEvidenceIssuesForDescription(update.description)) {
      errors.push(`payload.input.updates[${index}].description: ${issue}`);
    }
  }
}

export function validateMutationDraft(draft, { validatedAt = new Date().toISOString() } = {}) {
  const errors = [];
  const warnings = [];

  if (!draft || typeof draft !== "object" || Array.isArray(draft)) {
    return {
      errors: ["mutation draft must be an object"],
      valid: false,
      warnings,
      workflow_id: "delivery-art-mutation-draft-validate",
    };
  }

  if (draft.schema_version !== ARTIFACT_SCHEMA_VERSION) {
    errors.push(`schema_version must equal ${ARTIFACT_SCHEMA_VERSION}`);
  }
  if (draft.artifact_type !== MUTATION_DRAFT_TYPE) {
    errors.push(`artifact_type must equal ${MUTATION_DRAFT_TYPE}`);
  }
  if (draft.status === "discarded") {
    errors.push("discarded drafts cannot be submitted");
  }

  const operation = draft.operation;
  const definition = MUTATION_OPERATIONS[operation];
  if (!definition) {
    errors.push(`unsupported mutation operation: ${operation ?? "(missing)"}`);
  }

  let normalizedTargetId = null;
  if (definition) {
    try {
      normalizedTargetId = normalizeTargetId(
        definition.target,
        draft.target?.id ?? null,
      );
    } catch (error) {
      errors.push(error.message);
    }
  }

  if (!draft.route || typeof draft.route !== "object" || Array.isArray(draft.route)) {
    errors.push("route must be an object");
  } else if (definition) {
    const expectedPath =
      errors.length === 0 || normalizedTargetId !== null
        ? definition.path(normalizedTargetId)
        : null;
    if (draft.route.method !== definition.method) {
      errors.push(`route.method must equal ${definition.method}`);
    }
    if (expectedPath && draft.route.path !== expectedPath) {
      errors.push(`route.path must equal ${expectedPath}`);
    }
    if (typeof draft.route.path === "string" && !draft.route.path.startsWith("/v1/")) {
      errors.push("route.path must stay inside the broker /v1 API surface");
    }
    if (typeof draft.route.path === "string" && draft.route.path.includes("openproject")) {
      errors.push("route.path must not point at raw OpenProject routes");
    }
  }

  if (!draft.payload || typeof draft.payload !== "object" || Array.isArray(draft.payload)) {
    errors.push("payload must be an object");
  } else {
    if (!draft.payload.input || typeof draft.payload.input !== "object") {
      warnings.push("payload.input is missing; most broker write routes require it");
    } else if (
      definition?.requiredInputSchemaVersion !== undefined &&
      draft.payload.input.schema_version !== definition.requiredInputSchemaVersion
    ) {
      errors.push(
        `payload.input.schema_version must equal ${definition.requiredInputSchemaVersion} for ${operation}`,
      );
    }
    const renderedPayload = stableStringify(draft.payload);
    if (renderedPayload.includes(".tmp/")) {
      warnings.push("payload references .tmp scratch; durable evidence should use review packets or source links");
    }
    if (renderedPayload.includes("CHECK:")) {
      warnings.push("payload still contains CHECK placeholders");
    }

    validateMutationDraftPayloadSemantics({ draft, errors });
  }

  return {
    errors,
    next_action:
      errors.length === 0
        ? "Submit this draft through the broker draft submit command after placeholders are resolved."
        : "Fix the validation errors before submitting.",
    route:
      definition && normalizedTargetId !== undefined
        ? {
            method: definition.method,
            path: normalizedTargetId === null
              ? definition.path(null)
              : definition.path(normalizedTargetId),
          }
        : null,
    valid: errors.length === 0,
    validated_at: validatedAt,
    warnings,
    workflow_id: "delivery-art-mutation-draft-validate",
  };
}

function runGit(repoRoot, args, execFileSyncImpl = execFileSync) {
  return execFileSyncImpl("git", ["-C", repoRoot, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function tryRunGit(repoRoot, args, execFileSyncImpl = execFileSync) {
  try {
    return runGit(repoRoot, args, execFileSyncImpl);
  } catch {
    return null;
  }
}

function parseLines(rawValue) {
  return String(rawValue || "")
    .split("\n")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function resolveRepoEvidence(repoInput, execFileSyncImpl = execFileSync) {
  const resolvedInput = path.resolve(repoInput);
  const repoRoot = runGit(
    resolvedInput,
    ["rev-parse", "--show-toplevel"],
    execFileSyncImpl,
  );
  const mergeBase = tryRunGit(repoRoot, ["merge-base", "HEAD", "origin/main"], execFileSyncImpl);
  const changedFiles = new Set();

  if (mergeBase) {
    for (const entry of parseLines(
      tryRunGit(
        repoRoot,
        ["diff", "--name-only", "--diff-filter=ACMR", `${mergeBase}..HEAD`],
        execFileSyncImpl,
      ),
    )) {
      changedFiles.add(entry);
    }
  }

  for (const entry of parseLines(
    tryRunGit(repoRoot, ["diff", "--name-only", "--diff-filter=ACMR"], execFileSyncImpl),
  )) {
    changedFiles.add(entry);
  }
  for (const entry of parseLines(
    tryRunGit(
      repoRoot,
      ["diff", "--cached", "--name-only", "--diff-filter=ACMR"],
      execFileSyncImpl,
    ),
  )) {
    changedFiles.add(entry);
  }
  for (const entry of parseLines(
    tryRunGit(repoRoot, ["ls-files", "--others", "--exclude-standard"], execFileSyncImpl),
  )) {
    changedFiles.add(entry);
  }

  return {
    branch:
      tryRunGit(repoRoot, ["rev-parse", "--abbrev-ref", "HEAD"], execFileSyncImpl) ??
      "HEAD",
    changed_files: [...changedFiles].sort((left, right) => left.localeCompare(right)),
    change_records: [...changedFiles]
      .filter((entry) => entry.startsWith("docs/records/change-records/"))
      .sort((left, right) => left.localeCompare(right)),
    head_sha: tryRunGit(repoRoot, ["rev-parse", "HEAD"], execFileSyncImpl) ?? "unknown",
    merge_base: mergeBase,
    repo_name: path.basename(repoRoot),
    repo_root: repoRoot,
  };
}

export function createReviewPacketDraft({
  coveredWorkItemIds = [],
  createdAt = new Date().toISOString(),
  deliveryId,
  execFileSyncImpl = execFileSync,
  operator = null,
  repoRoots = [process.cwd()],
} = {}) {
  const parsedDeliveryId = parseDeliveryId(deliveryId);
  if (!parsedDeliveryId) {
    throw new Error("delivery_id must look like delivery-304 or 304");
  }

  const normalizedWorkItemIds = normalizeStringArray(
    coveredWorkItemIds,
    "covered_work_item_ids",
  ).map((entry) => {
    const parsed = parseWorkItemId(entry);
    if (!parsed) {
      throw new Error(`covered work item id must look like work-item-310 or 310: ${entry}`);
    }
    return toWorkItemId(parsed);
  });

  const repoEvidence = repoRoots.map((repoRoot) =>
    resolveRepoEvidence(repoRoot, execFileSyncImpl),
  );

  return {
    artifact_type: REVIEW_PACKET_TYPE,
    completion_mapping: normalizedWorkItemIds.map((workItemId) => ({
      evidence_summary: "CHECK: explain how this landing unit satisfies the work item.",
      work_item_id: workItemId,
    })),
    covered_work_item_ids: normalizedWorkItemIds,
    created_at: createdAt,
    delivery_id: toDeliveryId(parsedDeliveryId),
    evidence: {
      changed_surfaces: repoEvidence.flatMap((repo) =>
        repo.changed_files.map((entry) => `${repo.repo_name}/${entry}`),
      ),
      test_results: [],
      validations: [],
    },
    landing_unit: {
      evidence_kind: "pending",
      merge_commit: null,
      pr_url: null,
      repos: repoEvidence,
      rollback_boundary: "CHECK: describe the review and rollback boundary.",
    },
    operator,
    packet_id: `review-packet-${randomUUID()}`,
    schema_version: ARTIFACT_SCHEMA_VERSION,
    status: "draft",
    validation: {
      last_validated_at: null,
      result: "not_validated",
    },
  };
}

function collectStringValues(value, output = []) {
  if (typeof value === "string") {
    output.push(value);
    return output;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      collectStringValues(entry, output);
    }
    return output;
  }
  if (value && typeof value === "object") {
    for (const entry of Object.values(value)) {
      collectStringValues(entry, output);
    }
  }
  return output;
}

export function validateReviewPacket(
  packet,
  { final = false, validatedAt = new Date().toISOString() } = {},
) {
  const errors = [];
  const warnings = [];

  if (!packet || typeof packet !== "object" || Array.isArray(packet)) {
    return {
      errors: ["review packet must be an object"],
      final,
      valid: false,
      warnings,
      workflow_id: "delivery-art-review-packet-validate",
    };
  }

  if (packet.schema_version !== ARTIFACT_SCHEMA_VERSION) {
    errors.push(`schema_version must equal ${ARTIFACT_SCHEMA_VERSION}`);
  }
  if (packet.artifact_type !== REVIEW_PACKET_TYPE) {
    errors.push(`artifact_type must equal ${REVIEW_PACKET_TYPE}`);
  }
  if (!parseDeliveryId(packet.delivery_id)) {
    errors.push("delivery_id must look like delivery-304 or 304");
  }

  const coveredWorkItemIds = Array.isArray(packet.covered_work_item_ids)
    ? packet.covered_work_item_ids
    : [];
  if (coveredWorkItemIds.length === 0) {
    errors.push("covered_work_item_ids must contain at least one work item");
  }
  for (const [index, workItemId] of coveredWorkItemIds.entries()) {
    if (!parseWorkItemId(workItemId)) {
      errors.push(`covered_work_item_ids[${index}] must look like work-item-310 or 310`);
    }
  }

  if (!packet.landing_unit || typeof packet.landing_unit !== "object") {
    errors.push("landing_unit must be an object");
  } else {
    const repos = Array.isArray(packet.landing_unit.repos)
      ? packet.landing_unit.repos
      : [];
    if (repos.length === 0) {
      warnings.push("landing_unit.repos is empty; source-backed closure usually needs repo evidence");
    }
    if (
      typeof packet.landing_unit.rollback_boundary !== "string" ||
      !packet.landing_unit.rollback_boundary.trim() ||
      packet.landing_unit.rollback_boundary.includes("CHECK:")
    ) {
      warnings.push("landing_unit.rollback_boundary still needs a concrete review boundary");
    }
    if (final) {
      const evidenceKind = packet.landing_unit.evidence_kind;
      if (
        !["merged_pr", "approved_direct_land", "non_source_evidence"].includes(
          evidenceKind,
        )
      ) {
        errors.push(
          "landing_unit.evidence_kind must be merged_pr, approved_direct_land, or non_source_evidence before finalization",
        );
      }
      if (
        evidenceKind === "merged_pr" &&
        (typeof packet.landing_unit.pr_url !== "string" ||
          !packet.landing_unit.pr_url.trim())
      ) {
        errors.push("landing_unit.pr_url is required for merged_pr evidence");
      }
      if (
        ["merged_pr", "approved_direct_land"].includes(evidenceKind) &&
        (typeof packet.landing_unit.merge_commit !== "string" ||
          !packet.landing_unit.merge_commit.trim())
      ) {
        errors.push(
          "landing_unit.merge_commit is required for source-backed finalization",
        );
      }
    }
  }

  const validations = Array.isArray(packet.evidence?.validations)
    ? packet.evidence.validations
    : [];
  if (final && validations.length === 0) {
    errors.push("evidence.validations must contain at least one validation result");
  }

  const rendered = collectStringValues(packet).join("\n");
  if (rendered.includes(".tmp/")) {
    errors.push("review packets must not use .tmp scratch files as durable evidence");
  }
  if (rendered.includes("CHECK:")) {
    const message = "review packet still contains CHECK placeholders";
    if (final) {
      errors.push(message);
    } else {
      warnings.push(message);
    }
  }

  return {
    errors,
    final,
    next_action:
      errors.length === 0 && final
        ? "Finalize this packet and use its digest in ART completion evidence."
        : errors.length === 0
          ? "Resolve warnings before finalization, then run review-packet finalize."
          : "Fix the validation errors before finalization.",
    packet_digest: errors.length === 0 ? digestArtifact(packet) : null,
    valid: errors.length === 0,
    validated_at: validatedAt,
    warnings,
    workflow_id: "delivery-art-review-packet-validate",
  };
}

function lineEntries(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter(Boolean);
}

function hasConcreteText(value) {
  return typeof value === "string" && value.trim() && !value.includes("CHECK:");
}

export function validateReviewPacketReadiness(
  packet,
  { validatedAt = new Date().toISOString() } = {},
) {
  const baseValidation = validateReviewPacket(packet, {
    final: false,
    validatedAt,
  });
  const errors = [...baseValidation.errors];
  const warnings = [];

  if (!packet || typeof packet !== "object" || Array.isArray(packet)) {
    return {
      errors,
      final: false,
      next_action: "Fix the Review Packet shape before checking landing readiness.",
      packet_digest: null,
      ready: false,
      valid: false,
      validated_at: validatedAt,
      warnings,
      workflow_id: "delivery-art-review-packet-readiness",
    };
  }

  const landingUnit = packet.landing_unit || {};
  const evidence = packet.evidence || {};
  const repos = Array.isArray(landingUnit.repos) ? landingUnit.repos : [];
  const changedSurfaces = lineEntries(evidence.changed_surfaces);
  const testResults = lineEntries(evidence.test_results);
  const validations = lineEntries(evidence.validations);
  const completionMapping = Array.isArray(packet.completion_mapping)
    ? packet.completion_mapping
    : [];
  const coveredWorkItemIds = Array.isArray(packet.covered_work_item_ids)
    ? packet.covered_work_item_ids
    : [];

  if (packet.status !== "draft") {
    errors.push("review packet readiness must run on a draft packet before merge");
  }
  if (landingUnit.evidence_kind !== "open_pr") {
    errors.push(
      "landing_unit.evidence_kind must be open_pr for pre-merge readiness; use merged_pr only after merge and finalize the packet",
    );
  }
  if (!hasConcreteText(landingUnit.pr_url)) {
    errors.push("landing_unit.pr_url is required before pre-merge readiness passes");
  }
  if (!hasConcreteText(landingUnit.rollback_boundary)) {
    errors.push("landing_unit.rollback_boundary must describe the concrete rollback boundary");
  }
  if (repos.length === 0) {
    errors.push("landing_unit.repos must contain at least one repo before merge");
  }
  for (const [index, repo] of repos.entries()) {
    const changedFiles = Array.isArray(repo.changed_files) ? repo.changed_files : [];
    if (changedFiles.length === 0) {
      errors.push(`landing_unit.repos[${index}].changed_files must not be empty before merge`);
    }
    if (!hasConcreteText(repo.branch)) {
      errors.push(`landing_unit.repos[${index}].branch is required before merge`);
    }
    if (!hasConcreteText(repo.repo_name)) {
      errors.push(`landing_unit.repos[${index}].repo_name is required before merge`);
    }
  }

  if (changedSurfaces.length === 0) {
    errors.push("evidence.changed_surfaces must explain the source surfaces before merge");
  }
  for (const [index, entry] of changedSurfaces.entries()) {
    if (!entry.includes(":")) {
      errors.push(
        `evidence.changed_surfaces[${index}] must explain what changed on the surface, not only list a path`,
      );
    }
  }
  if (testResults.length === 0) {
    errors.push("evidence.test_results must contain at least one test result before merge");
  }
  if (validations.length === 0) {
    errors.push("evidence.validations must contain at least one validation result before merge");
  }
  for (const [index, entry] of [...testResults, ...validations].entries()) {
    if (!/^(- )?(PASS|FAIL|NOT APPLICABLE|Attached artifact): /.test(entry)) {
      errors.push(
        `evidence result line ${index} must start with PASS:, FAIL:, NOT APPLICABLE:, or Attached artifact:`,
      );
    }
  }

  if (completionMapping.length !== coveredWorkItemIds.length) {
    errors.push(
      "completion_mapping must contain one evidence mapping for each covered work item",
    );
  }
  for (const workItemId of coveredWorkItemIds) {
    const mapping = completionMapping.find((entry) => entry?.work_item_id === workItemId);
    if (!mapping) {
      errors.push(`completion_mapping is missing evidence summary for ${workItemId}`);
      continue;
    }
    if (!hasConcreteText(mapping.evidence_summary)) {
      errors.push(`completion_mapping for ${workItemId} must explain how the landing unit satisfies the item`);
    }
  }

  if (baseValidation.warnings.length > 0) {
    errors.push(...baseValidation.warnings);
  }

  const ready = errors.length === 0;
  return {
    errors,
    final: false,
    next_action: ready
      ? "Pre-merge landing readiness passed. Merge the reviewed PR, then set evidence_kind to merged_pr and finalize the Review Packet."
      : "Fix the readiness errors before merging the source landing unit.",
    packet_digest: ready ? digestArtifact(packet) : null,
    ready,
    valid: ready,
    validated_at: validatedAt,
    warnings,
    workflow_id: "delivery-art-review-packet-readiness",
  };
}

export function finalizeReviewPacket(
  packet,
  { finalizedAt = new Date().toISOString() } = {},
) {
  const validation = validateReviewPacket(packet, {
    final: true,
    validatedAt: finalizedAt,
  });
  if (!validation.valid) {
    return {
      review_packet: packet,
      validation,
      workflow_id: "delivery-art-review-packet-finalize",
    };
  }

  const finalizedPacketBase = {
    ...packet,
    finalized_at: finalizedAt,
    status: "finalized",
    validation: {
      last_validated_at: finalizedAt,
      result: "valid",
      warnings: validation.warnings,
    },
  };
  const packetDigest = digestArtifact({
    ...finalizedPacketBase,
    packet_digest: null,
  });
  const finalizedPacket = {
    ...finalizedPacketBase,
    packet_digest: packetDigest,
  };

  return {
    review_packet: finalizedPacket,
    validation: {
      ...validation,
      packet_digest: packetDigest,
    },
    workflow_id: "delivery-art-review-packet-finalize",
  };
}

function listFilesRecursive(rootDir) {
  if (!existsSync(rootDir)) {
    return [];
  }

  const entries = [];
  const walk = (currentDir) => {
    for (const name of readdirSync(currentDir)) {
      const fullPath = path.join(currentDir, name);
      const stats = statSync(fullPath);
      if (stats.isDirectory()) {
        walk(fullPath);
        continue;
      }
      entries.push({
        bytes: stats.size,
        path: fullPath,
        relative_path: path.relative(process.cwd(), fullPath),
      });
    }
  };
  walk(rootDir);
  return entries.sort((left, right) => left.relative_path.localeCompare(right.relative_path));
}

export function inspectScratchArtifacts({ repoRoot = process.cwd() } = {}) {
  const previousCwd = process.cwd();
  process.chdir(repoRoot);
  try {
    const legacyScratch = listFilesRecursive(".tmp").map((entry) => ({
      ...entry,
      classification: "legacy_unmanaged_payload",
      durable_evidence: false,
    }));
    const managedDrafts = listFilesRecursive(MANAGED_DRAFT_DIR).map((entry) => ({
      ...entry,
      classification: "managed_mutation_draft",
      durable_evidence: false,
    }));
    const reviewPackets = listFilesRecursive(MANAGED_REVIEW_PACKET_DIR).map((entry) => ({
      ...entry,
      classification: "managed_review_packet",
      durable_evidence: true,
    }));

    return {
      items: [...legacyScratch, ...managedDrafts, ...reviewPackets],
      summary: {
        legacy_unmanaged_payload_count: legacyScratch.length,
        managed_mutation_draft_count: managedDrafts.length,
        managed_review_packet_count: reviewPackets.length,
      },
      workflow_id: "delivery-art-scratch-status",
    };
  } finally {
    process.chdir(previousCwd);
  }
}

export function archiveLegacyScratchArtifacts({
  archivedAt = new Date().toISOString(),
  dryRun = true,
  repoRoot = process.cwd(),
} = {}) {
  const status = inspectScratchArtifacts({ repoRoot });
  const legacyItems = status.items.filter(
    (item) => item.classification === "legacy_unmanaged_payload",
  );
  const archiveDir = path.join(
    repoRoot,
    MANAGED_ARCHIVE_DIR,
    "legacy-scratch",
    archivedAt.replace(/[:.]/g, "-"),
  );

  const actions = legacyItems.map((item) => {
    const destination = path.join(archiveDir, path.relative(path.join(repoRoot, ".tmp"), item.path));
    if (!dryRun) {
      mkdirSync(path.dirname(destination), { recursive: true });
      renameSync(item.path, destination);
    }
    return {
      action: dryRun ? "would_archive" : "archived",
      from: item.relative_path,
      to: path.relative(repoRoot, destination),
    };
  });

  return {
    actions,
    dry_run: dryRun,
    summary: {
      archived_count: dryRun ? 0 : actions.length,
      legacy_unmanaged_payload_count: legacyItems.length,
      would_archive_count: dryRun ? actions.length : 0,
    },
    workflow_id: "delivery-art-scratch-cleanup",
  };
}
