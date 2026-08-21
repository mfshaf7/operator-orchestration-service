import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const CONTRACT_ROOT = fileURLToPath(
  new URL("../../contracts/delivery-art-lifecycle/", import.meta.url),
);

const capabilities = JSON.parse(
  readFileSync(path.join(CONTRACT_ROOT, "capabilities.json"), "utf8"),
);
const lifecyclePlanSchema = JSON.parse(
  readFileSync(path.join(CONTRACT_ROOT, "lifecycle-plan.schema.json"), "utf8"),
);

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validatePlanSchema = ajv.compile(lifecyclePlanSchema);

export const DELIVERY_ART_LIFECYCLE_ACTIONS = Object.freeze({
  PERSIST_ARCHITECTURE: "persist-architecture",
  DRAFT_WORK_START: "draft-work-start",
  EVALUATE_WORK_START: "evaluate-work-start",
  DRAFT_REVIEW_PACKET: "draft-review-packet",
  MARK_MERGE_READY: "mark-merge-ready",
  DRAFT_FINALIZATION: "draft-finalization",
  ISSUE_OPERATING_READINESS: "issue-operating-readiness",
  FINALIZE_REVIEW_PACKET: "finalize-review-packet",
  CLOSE_ART: "close-art",
});

export const DELIVERY_ART_LIFECYCLE_GATES = Object.freeze({
  ARCHITECTURE_DECISION: "architecture-decision",
  SOURCE_WORK: "source-work",
  EVIDENCE: "evidence",
  PULL_REQUEST: "pull-request",
  SOURCE_MERGE: "source-merge",
  EXCEPTION_ACCEPTANCE: "exception-acceptance",
  ART_CLOSEOUT: "art-closeout",
  BLOCKED: "blocked",
});

const CAPABILITY_STATES = new Set(["implemented", "human-gated", "compatibility", "planned"]);

function validateCapabilitiesContract(value) {
  const errors = [];
  if (value?.schema_version !== 1) {
    errors.push("schema_version must equal 1");
  }
  if (value?.owner_repo !== "operator-orchestration-service") {
    errors.push("owner_repo must equal operator-orchestration-service");
  }
  if (!Array.isArray(value?.capabilities) || value.capabilities.length === 0) {
    errors.push("capabilities must contain at least one capability");
  }
  const ids = new Set();
  for (const [index, capability] of (value?.capabilities ?? []).entries()) {
    if (typeof capability?.id !== "string" || !capability.id) {
      errors.push(`capabilities[${index}].id is required`);
    } else if (ids.has(capability.id)) {
      errors.push(`capabilities[${index}].id is duplicated: ${capability.id}`);
    } else {
      ids.add(capability.id);
    }
    if (!CAPABILITY_STATES.has(capability?.state)) {
      errors.push(`capabilities[${index}].state is unsupported`);
    }
    if (!Number.isInteger(capability?.contract_version) || capability.contract_version < 1) {
      errors.push(`capabilities[${index}].contract_version must be a positive integer`);
    }
    if (typeof capability?.normal_path !== "boolean") {
      errors.push(`capabilities[${index}].normal_path must be boolean`);
    }
  }
  for (const gate of value?.human_gates ?? []) {
    if (typeof gate !== "string" || !gate) {
      errors.push("human_gates must contain non-empty strings");
    }
  }
  if (errors.length > 0) {
    throw new Error(`Delivery ART lifecycle capability contract is invalid: ${errors.join("; ")}`);
  }
  return value;
}

validateCapabilitiesContract(capabilities);

export function deliveryArtLifecycleCapabilities() {
  return structuredClone(capabilities);
}

export function validateDeliveryArtLifecyclePlan(plan) {
  const valid = validatePlanSchema(plan);
  return {
    errors: valid
      ? []
      : (validatePlanSchema.errors ?? []).map((error) =>
          `${error.instancePath || "/"} ${error.message}`),
    valid: Boolean(valid),
  };
}

export function bindFinalizedReviewPacketReference(plan, reviewPacket) {
  if (
    reviewPacket?.artifact_type !== "art_review_packet" ||
    reviewPacket?.status !== "finalized" ||
    reviewPacket?.custody?.state !== "durable"
  ) {
    return structuredClone(plan);
  }
  const reference = {
    uri: reviewPacket.custody.uri,
    digest: reviewPacket.integrity?.content_digest,
  };
  const next = structuredClone(plan);
  next.artifacts.finalized_review_packet_ref = reference;
  const validation = validateDeliveryArtLifecyclePlan(next);
  if (!validation.valid) {
    throw new Error(
      `Finalized Review Packet reference cannot be bound to the lifecycle plan: ${validation.errors.join("; ")}`,
    );
  }
  return next;
}

function action(state, nextAction, summary) {
  return {
    complete: false,
    gate: null,
    next_action: nextAction,
    state,
    summary,
  };
}

function gate(state, gateId, summary) {
  return {
    complete: false,
    gate: gateId,
    next_action: null,
    state,
    summary,
  };
}

export function deriveDeliveryArtLifecycleState(facts) {
  if (facts?.architecture === "required-missing") {
    return gate(
      "architecture-decision-required",
      DELIVERY_ART_LIFECYCLE_GATES.ARCHITECTURE_DECISION,
      "Architecture-shaping work requires an approved durable architecture packet.",
    );
  }
  if (facts?.architecture === "invalid") {
    return gate(
      "architecture-invalid",
      DELIVERY_ART_LIFECYCLE_GATES.BLOCKED,
      "The architecture packet is present but does not resolve as approved durable evidence.",
    );
  }
  if (facts?.architecture === "local-ready") {
    return action(
      "architecture-persistence-required",
      DELIVERY_ART_LIFECYCLE_ACTIONS.PERSIST_ARCHITECTURE,
      "The approved local architecture packet is ready for durable custody.",
    );
  }

  if (facts?.work_start === "missing") {
    return action(
      "work-start-draft-required",
      DELIVERY_ART_LIFECYCLE_ACTIONS.DRAFT_WORK_START,
      "The current ART and source bases are ready to produce a work-start candidate.",
    );
  }
  if (facts?.work_start === "local-draft") {
    return action(
      "work-start-evaluation-required",
      DELIVERY_ART_LIFECYCLE_ACTIONS.EVALUATE_WORK_START,
      "The local work-start candidate is ready for broker evaluation and durable custody.",
    );
  }
  if (facts?.work_start === "blocked" || facts?.work_start === "invalid") {
    return gate(
      "work-start-blocked",
      DELIVERY_ART_LIFECYCLE_GATES.BLOCKED,
      "Work-start is not implementation-ready; resolve its reported blocker before source work continues.",
    );
  }

  if (facts?.review_packet === "finalized") {
    if (facts?.art === "closed") {
      return {
        complete: true,
        gate: null,
        next_action: null,
        state: "complete",
        summary: "Source, durable evidence, operating readiness, and ART closeout are complete.",
      };
    }
    return gate(
      "art-closeout-approval-required",
      DELIVERY_ART_LIFECYCLE_GATES.ART_CLOSEOUT,
      "ART closeout remains an explicit operator decision after finalized evidence exists.",
    );
  }
  if (facts?.review_packet === "invalid") {
    return gate(
      "review-packet-invalid",
      DELIVERY_ART_LIFECYCLE_GATES.BLOCKED,
      "The Review Packet is inconsistent with its work-start, source, or evidence contract.",
    );
  }

  if (facts?.review_packet === "finalization-draft") {
    if (facts?.readiness_receipt === "invalid") {
      return gate(
        "operating-readiness-receipt-invalid",
        DELIVERY_ART_LIFECYCLE_GATES.BLOCKED,
        "The local readiness receipt does not bind the exact finalization subject.",
      );
    }
    if (facts?.readiness_receipt !== "ready") {
      return action(
        "operating-readiness-required",
        DELIVERY_ART_LIFECYCLE_ACTIONS.ISSUE_OPERATING_READINESS,
        "The post-merge candidate is ready for an exact WGCF operating-readiness decision.",
      );
    }
    return action(
      "review-packet-finalization-required",
      DELIVERY_ART_LIFECYCLE_ACTIONS.FINALIZE_REVIEW_PACKET,
      "The exact operating-readiness receipt is ready to finalize the Review Packet.",
    );
  }

  if (facts?.review_packet === "merge-ready") {
    if (facts?.pull_request === "stale-head") {
      if (facts?.exceptions === "unapproved") {
        return gate(
          "exception-approval-required",
          DELIVERY_ART_LIFECYCLE_GATES.EXCEPTION_ACCEPTANCE,
          "One or more lifecycle exceptions require explicit authority before the revised packet can be authored.",
        );
      }
      if ([
        "wrong-branch",
        "dirty",
        "uncommitted",
        "unpushed",
        "base-diverged",
      ].includes(facts?.source)) {
        return gate(
          "source-work-required",
          DELIVERY_ART_LIFECYCLE_GATES.SOURCE_WORK,
          "The changed pull-request head must match a clean, pushed checkout before the revised packet can be authored.",
        );
      }
      if (facts?.evidence !== "ready") {
        return gate(
          "review-evidence-required",
          DELIVERY_ART_LIFECYCLE_GATES.EVIDENCE,
          "Structured evidence must bind the changed pull-request head before the revised packet can be authored.",
        );
      }
      return action(
        "review-packet-revision-required",
        DELIVERY_ART_LIFECYCLE_ACTIONS.DRAFT_REVIEW_PACKET,
        "The same open pull request has a new head; draft a new immutable Review Packet for the corrected source revision.",
      );
    }
    if (["wrong-base", "mismatch", "closed", "missing"].includes(facts?.pull_request)) {
      return gate(
        "merge-ready-source-binding-invalid",
        DELIVERY_ART_LIFECYCLE_GATES.BLOCKED,
        "The merge-ready packet no longer resolves to its exact pull-request source evidence.",
      );
    }
    if (facts?.pull_request === "draft") {
      return gate(
        "pull-request-review-required",
        DELIVERY_ART_LIFECYCLE_GATES.PULL_REQUEST,
        "The exact pull request returned to draft state and must be reviewable before merge.",
      );
    }
    if (facts?.pull_request === "open") {
      return gate(
        "source-merge-approval-required",
        DELIVERY_ART_LIFECYCLE_GATES.SOURCE_MERGE,
        "Merge remains an explicit operator decision after durable merge-readiness passes.",
      );
    }
    if (facts?.pull_request === "merged") {
      return action(
        "finalization-draft-required",
        DELIVERY_ART_LIFECYCLE_ACTIONS.DRAFT_FINALIZATION,
        "The merged source truth is ready to produce a local post-merge finalization candidate.",
      );
    }
    return gate(
      "merge-ready-source-binding-invalid",
      DELIVERY_ART_LIFECYCLE_GATES.BLOCKED,
      "The merge-ready packet resolved to an unsupported pull-request state.",
    );
  }

  if (facts?.exceptions === "unapproved") {
    return gate(
      "exception-approval-required",
      DELIVERY_ART_LIFECYCLE_GATES.EXCEPTION_ACCEPTANCE,
      "One or more lifecycle exceptions require explicit authority before reconciliation can continue.",
    );
  }

  if ([
    "wrong-branch",
    "dirty",
    "uncommitted",
    "unpushed",
    "base-diverged",
  ].includes(facts?.source)) {
    return gate(
      "source-work-required",
      DELIVERY_ART_LIFECYCLE_GATES.SOURCE_WORK,
      "Source must descend from the recorded base, remain on the recorded branch, and be clean and pushed before review evidence can advance.",
    );
  }
  if (facts?.evidence !== "ready") {
    return gate(
      "review-evidence-required",
      DELIVERY_ART_LIFECYCLE_GATES.EVIDENCE,
      "Structured acceptance, test, validation, runtime, and security evidence must be ready before packet authoring.",
    );
  }

  if (facts?.pull_request === "wrong-base") {
    return gate(
      "pull-request-base-mismatch",
      DELIVERY_ART_LIFECYCLE_GATES.PULL_REQUEST,
      "The pull request must target the base branch recorded by the Landing Unit.",
    );
  }

  if (facts?.review_packet === "missing") {
    if (facts?.pull_request === "missing") {
      return gate(
        "pull-request-required",
        DELIVERY_ART_LIFECYCLE_GATES.PULL_REQUEST,
        "Open the Landing Unit pull request before Review Packet v2 authoring.",
      );
    }
    if (facts?.pull_request === "draft") {
      return gate(
        "pull-request-review-required",
        DELIVERY_ART_LIFECYCLE_GATES.PULL_REQUEST,
        "The pull request must leave draft state before Review Packet v2 authoring.",
      );
    }
    if (facts?.pull_request === "closed") {
      return gate(
        "pull-request-closed",
        DELIVERY_ART_LIFECYCLE_GATES.BLOCKED,
        "The Landing Unit pull request closed without a merge; replace or reopen it before continuing.",
      );
    }
    if (["merged", "mismatch"].includes(facts?.pull_request)) {
      return gate(
        "pre-merge-source-binding-invalid",
        DELIVERY_ART_LIFECYCLE_GATES.BLOCKED,
        "Review Packet authoring requires one exact open pull request before source merge.",
      );
    }
    if (facts?.pull_request !== "open") {
      return gate(
        "pull-request-state-unsupported",
        DELIVERY_ART_LIFECYCLE_GATES.BLOCKED,
        "The pull request resolved to an unsupported pre-merge state.",
      );
    }
    return action(
      "review-packet-draft-required",
      DELIVERY_ART_LIFECYCLE_ACTIONS.DRAFT_REVIEW_PACKET,
      "The implementation-ready work-start and exact source head are ready for a schema-v2 Review Packet draft.",
    );
  }
  if (facts?.review_packet === "local-draft") {
    if (facts?.pull_request === "missing") {
      return gate(
        "pull-request-required",
        DELIVERY_ART_LIFECYCLE_GATES.PULL_REQUEST,
        "Open the Landing Unit pull request before merge-readiness evaluation.",
      );
    }
    if (facts?.pull_request === "draft") {
      return gate(
        "pull-request-review-required",
        DELIVERY_ART_LIFECYCLE_GATES.PULL_REQUEST,
        "The pull request must leave draft state before merge-readiness evaluation.",
      );
    }
    if (facts?.pull_request === "closed") {
      return gate(
        "pull-request-closed",
        DELIVERY_ART_LIFECYCLE_GATES.BLOCKED,
        "The recorded pull request closed without a merge; replace or reopen it before continuing.",
      );
    }
    if (["merged", "mismatch"].includes(facts?.pull_request)) {
      return gate(
        "pre-merge-source-binding-invalid",
        DELIVERY_ART_LIFECYCLE_GATES.BLOCKED,
        "Merge-readiness requires the exact recorded pull request to remain open before source merge.",
      );
    }
    if (facts?.pull_request !== "open") {
      return gate(
        "pull-request-state-unsupported",
        DELIVERY_ART_LIFECYCLE_GATES.BLOCKED,
        "The pull request resolved to an unsupported pre-merge state.",
      );
    }
    return action(
      "merge-readiness-required",
      DELIVERY_ART_LIFECYCLE_ACTIONS.MARK_MERGE_READY,
      "The exact open pull-request head is ready for durable merge-readiness evaluation.",
    );
  }

  return gate(
    "lifecycle-state-unresolved",
    DELIVERY_ART_LIFECYCLE_GATES.BLOCKED,
    "The lifecycle facts do not map to a supported state.",
  );
}
