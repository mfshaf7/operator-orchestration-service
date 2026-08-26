import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const CONTRACT_ROOT = fileURLToPath(
  new URL("../../contracts/delivery-art-work-session/", import.meta.url),
);
const workSessionSchema = JSON.parse(
  readFileSync(path.join(CONTRACT_ROOT, "work-session.schema.json"), "utf8"),
);
const decisionSchema = JSON.parse(
  readFileSync(path.join(CONTRACT_ROOT, "decision.schema.json"), "utf8"),
);
const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validateWorkSessionSchema = ajv.compile(workSessionSchema);
const validateDecisionSchema = ajv.compile(decisionSchema);

const CLOSED_ART_STATES = new Set(["closed", "done", "retired"]);
const INCOMPLETE_MARKER = "REQUIRED:";

function validationResult(validator, value) {
  const valid = validator(value);
  return {
    errors: valid
      ? []
      : (validator.errors ?? []).map((error) =>
          `${error.instancePath || "/"} ${error.message}`),
    valid: Boolean(valid),
  };
}

function containsIncompleteMarker(value) {
  if (Array.isArray(value)) {
    return value.some(containsIncompleteMarker);
  }
  if (value && typeof value === "object") {
    return Object.values(value).some(containsIncompleteMarker);
  }
  return typeof value === "string" && value.startsWith(INCOMPLETE_MARKER);
}

function normalizeWorkItemId(value) {
  const match = String(value ?? "").match(/^(?:work-item-)?([1-9][0-9]*)$/);
  if (!match) {
    throw new Error("work item id must look like `work-item-310` or `310`");
  }
  return `work-item-${match[1]}`;
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'"'"'`)}'`;
}

export function validateDeliveryArtWorkSession(value) {
  return validationResult(validateWorkSessionSchema, value);
}

export function validateDeliveryArtWorkSessionDecision(
  value,
  { allowIncomplete = false } = {},
) {
  if (allowIncomplete) {
    const errors = [];
    if (value?.artifact_type !== "delivery_art_work_session_decision") {
      errors.push("artifact_type must equal delivery_art_work_session_decision");
    }
    try {
      normalizeWorkItemId(value?.work_item_id);
    } catch (error) {
      errors.push(error.message);
    }
    return { errors, valid: errors.length === 0 };
  }
  const result = validationResult(validateDecisionSchema, value);
  if (result.valid && containsIncompleteMarker(value)) {
    return {
      errors: ["decision contains an unresolved REQUIRED marker"],
      valid: false,
    };
  }
  if (
    result.valid &&
    !value.covered_work_item_ids.includes(value.work_item_id)
  ) {
    return {
      errors: ["covered_work_item_ids must include work_item_id"],
      valid: false,
    };
  }
  return result;
}

export function createDeliveryArtWorkSessionDecisionDraft({
  callerId,
  continuation,
  operatorId = "operator:workspace-owner",
}) {
  const deliveryId = continuation.delivery_id;
  const workItemId = normalizeWorkItemId(continuation.work_item_id);
  const itemNumber = workItemId.slice("work-item-".length);
  return {
    schema_version: 1,
    artifact_type: "delivery_art_work_session_decision",
    work_item_id: workItemId,
    covered_work_item_ids: [workItemId],
    caller_id: callerId ?? operatorId,
    operator: {
      id: operatorId,
      decision_source: "operator",
    },
    landing_unit: {
      id: `${deliveryId}-${workItemId}`,
      decision: "child_isolated_landing_unit",
      split_reason:
        `${INCOMPLETE_MARKER} explain why this source change is one rollback unit`,
      base_ref: "origin/main",
      branch: `feature/${itemNumber}-replace-with-purpose`,
      rollback_boundary:
        `${INCOMPLETE_MARKER} state what can be reverted independently`,
    },
    architecture: {
      required: null,
      artifact_location: null,
    },
    human_gate_work_item_ids: {
      security_acceptance: [],
    },
  };
}

export function architectureSecurityAcceptanceWorkItemIds({
  architecture,
  landingUnitId,
}) {
  const gates = architecture?.architecture?.required_human_gates ?? [];
  return [...new Set(
    gates
      .filter(
        (gate) =>
          gate?.authority_owner_repo === "security-architecture" &&
          gate?.affected_landing_unit_ids?.includes(landingUnitId),
      )
      .map((gate) => gate.authority_work_item_id),
  )].sort();
}

export function architectureLandingUnitId({
  architecture,
  coveredWorkItemIds,
}) {
  const expected = [...coveredWorkItemIds].sort();
  const matches = (architecture?.architecture?.landing_units ?? []).filter(
    (unit) => {
      const covered = [...(unit?.covered_work_item_ids ?? [])].sort();
      return (
        covered.length === expected.length &&
        covered.every((workItemId, index) => workItemId === expected[index])
      );
    },
  );
  return matches.length === 1 ? matches[0].id : null;
}

export function createDeliveryArtWorkSession({
  architectureFile,
  baseCommit,
  clock = () => new Date(),
  continuation,
  decision,
}) {
  const timestamp = clock().toISOString();
  const workItemId = normalizeWorkItemId(decision.work_item_id);
  const deliveryId = continuation.delivery_id;
  const aliases = [
    decision.landing_unit.id,
    ...decision.covered_work_item_ids,
  ].sort();
  const session = {
    schema_version: 1,
    artifact_type: "delivery_art_work_session",
    session_id: `work-session:${deliveryId}:${decision.landing_unit.id}`,
    delivery_id: deliveryId,
    landing_unit_id: decision.landing_unit.id,
    covered_work_item_ids: [...decision.covered_work_item_ids].sort(),
    aliases,
    owner_repo: continuation.continuation_context.target_item.owner_repo,
    target_pi: continuation.continuation_context.target_item.target_pi ?? null,
    caller_id: decision.caller_id,
    operator: structuredClone(decision.operator),
    landing_unit: {
      decision: decision.landing_unit.decision,
      split_reason: decision.landing_unit.split_reason,
      base_ref: decision.landing_unit.base_ref,
      base_commit: baseCommit,
      branch: decision.landing_unit.branch,
      rollback_boundary: decision.landing_unit.rollback_boundary,
    },
    architecture: {
      required: decision.architecture.required,
      artifact_file: decision.architecture.required ? architectureFile : null,
    },
    artifacts: {
      work_start_file: "artifacts/work-start.json",
      review_packet_file: "artifacts/review-packet.json",
      readiness_receipt_file: "artifacts/readiness-receipt.json",
      evidence_file: "artifacts/evidence.json",
      resource_manifest_file: "resource-manifest.json",
    },
    human_gate_work_item_ids: structuredClone(
      decision.human_gate_work_item_ids,
    ),
    state: "implementation-ready",
    created_at: timestamp,
    updated_at: timestamp,
  };
  const validation = validateDeliveryArtWorkSession(session);
  if (!validation.valid) {
    throw new Error(
      `Generated Delivery ART work session is invalid: ${validation.errors.join("; ")}`,
    );
  }
  return session;
}

export function buildDeliveryArtLifecycleCompatibilityPlan({
  artifactPath,
  repoRoot,
  session,
}) {
  const plan = {
    schema_version: 1,
    artifact_type: "delivery_art_lifecycle_plan",
    lifecycle_id: `lifecycle:${session.delivery_id}-${session.landing_unit_id}`,
    created_at: session.created_at,
    delivery_id: session.delivery_id,
    covered_work_item_ids: [...session.covered_work_item_ids],
    operator: structuredClone(session.operator),
    landing_unit: {
      decision: session.landing_unit.decision,
      split_reason: session.landing_unit.split_reason,
      repo_root: repoRoot,
      owner_repo: session.owner_repo,
      base_ref: session.landing_unit.base_ref,
      branch: session.landing_unit.branch,
      rollback_boundary: session.landing_unit.rollback_boundary,
    },
    architecture: {
      required: session.architecture.required,
      packet_path: session.architecture.required
        ? artifactPath(session.architecture.artifact_file)
        : null,
    },
    artifacts: {
      work_start_path: artifactPath(session.artifacts.work_start_file),
      review_packet_path: artifactPath(session.artifacts.review_packet_file),
      readiness_receipt_path: artifactPath(
        session.artifacts.readiness_receipt_file,
      ),
      evidence_path: artifactPath(session.artifacts.evidence_file),
    },
  };
  const reviewPacket = (() => {
    try {
      return JSON.parse(readFileSync(plan.artifacts.review_packet_path, "utf8"));
    } catch {
      return null;
    }
  })();
  if (
    reviewPacket?.status === "finalized" &&
    reviewPacket?.custody?.state === "durable"
  ) {
    plan.artifacts.finalized_review_packet_ref = {
      uri: reviewPacket.custody.uri,
      digest: reviewPacket.integrity.content_digest,
    };
  }
  return plan;
}

export function deliveryArtWorkSessionState(projection) {
  if (projection.complete) {
    return "closed";
  }
  if (projection.gate === "source-work") {
    return "source-work";
  }
  if (projection.gate === "evidence") {
    return "evidence-required";
  }
  if (projection.gate === "pull-request") {
    return "pull-request-required";
  }
  if (projection.gate === "source-merge") {
    return "merge-required";
  }
  if (projection.gate === "art-closeout") {
    return "closeout-required";
  }
  if (projection.gate) {
    return "blocked";
  }
  if ([
    "operating-readiness-required",
    "review-packet-finalization-required",
  ].includes(projection.state)) {
    return "operating-readiness-required";
  }
  return "implementation-ready";
}

export function deliveryArtWorkNextAction({
  artifactPaths,
  context,
  securityStatuses = [],
  workItemId,
}) {
  const projection = context.projection;
  const command = (value) => `npm run art -- work ${value} ${workItemId}`;
  if (projection.complete) {
    return {
      code: "work-complete",
      command: command("status"),
      reason: projection.summary,
      authority: "workspace-delivery-art",
    };
  }
  if (projection.next_action) {
    return {
      code: projection.next_action,
      command: command("continue"),
      reason: projection.summary,
      authority: "operator-orchestration-service",
    };
  }
  if (
    projection.gate === "source-merge" &&
    securityStatuses.some((status) => !CLOSED_ART_STATES.has(String(status).toLowerCase()))
  ) {
    const pending = context.session.human_gate_work_item_ids.security_acceptance
      .filter((_, index) =>
        !CLOSED_ART_STATES.has(String(securityStatuses[index]).toLowerCase()));
    return {
      code: "security-acceptance-required",
      command: `npm run art -- item continuation ${pending[0]}`,
      reason: "The exact source head requires its recorded Security acceptance before merge.",
      authority: "security-architecture",
    };
  }
  if (projection.gate === "source-work") {
    return {
      code: "source-work-required",
      command: `git -C ${shellQuote(context.repo_root)} status --short`,
      reason: projection.summary,
      authority: context.session.owner_repo,
    };
  }
  if (projection.gate === "evidence") {
    return {
      code: "review-evidence-required",
      command: `${process.env.EDITOR || "vi"} ${shellQuote(artifactPaths.evidence)}`,
      reason: projection.summary,
      authority: context.session.owner_repo,
    };
  }
  if (projection.gate === "pull-request") {
    const pullRequest = context.pull_request;
    if (pullRequest.state === "missing") {
      return {
        code: "pull-request-required",
        command: [
          "gh pr create --fill",
          `--base ${shellQuote(context.session.landing_unit.base_ref.replace(/^origin\//, ""))}`,
          `--head ${shellQuote(context.session.landing_unit.branch)}`,
        ].join(" "),
        reason: projection.summary,
        authority: context.session.owner_repo,
      };
    }
    return {
      code: "pull-request-review-required",
      command: pullRequest.url
        ? `gh pr view ${shellQuote(pullRequest.url)} --web`
        : command("status"),
      reason: projection.summary,
      authority: "source-reviewer",
    };
  }
  if (projection.gate === "source-merge") {
    return {
      code: "source-merge-approval-required",
      command: context.pull_request.url
        ? `gh pr view ${shellQuote(context.pull_request.url)} --web`
        : command("status"),
      reason: projection.summary,
      authority: "source-reviewer",
    };
  }
  if (projection.gate === "exception-acceptance") {
    return {
      code: "exception-or-risk-acceptance-required",
      command: `${process.env.EDITOR || "vi"} ${shellQuote(artifactPaths.evidence)}`,
      reason: projection.summary,
      authority: "operator",
    };
  }
  if (projection.gate === "art-closeout") {
    return {
      code: "art-closeout-required",
      command: command("close"),
      reason: projection.summary,
      authority: "operator",
    };
  }
  return {
    code: "work-blocked",
    command: `${command("status")} --json`,
    reason: projection.summary,
    authority: "operator-orchestration-service",
  };
}

export function deliveryArtWorkDecisionNextAction({ decisionPath, workItemId }) {
  return {
    code: "landing-unit-decision-required",
    command:
      `npm run art -- work start ${workItemId} --decision ${shellQuote(decisionPath)}`,
    reason:
      `Review and complete the generated decision draft at ${decisionPath} before source work starts.`,
    authority: "operator",
  };
}

export { normalizeWorkItemId };
