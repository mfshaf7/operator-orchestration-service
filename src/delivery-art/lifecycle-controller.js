import path from "node:path";

import { canonicalStringify } from "./canonical-json.js";
import {
  validateDeliveryArtArtifact,
  validateDeliveryArtReviewPacketEvidence,
} from "./contracts.js";
import { projectDeliveryArtReviewPacketOperatingReadiness } from "./lifecycle-authoring.js";
import {
  DELIVERY_ART_LIFECYCLE_ACTIONS,
  deriveDeliveryArtLifecycleState,
  validateDeliveryArtLifecyclePlan,
} from "./lifecycle.js";

const CLOSED_ART_STATES = new Set(["closed", "done", "retired"]);

export class DeliveryArtLifecycleError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = "DeliveryArtLifecycleError";
    this.code = code;
    this.details = details;
  }
}

function clone(value) {
  return structuredClone(value);
}

function artifactReference(artifact) {
  return {
    digest: artifact?.integrity?.content_digest,
    uri: artifact?.custody?.uri,
  };
}

function sameArtifactReference(reference, artifact) {
  return reference?.uri === artifact?.custody?.uri &&
    reference?.digest === artifact?.integrity?.content_digest;
}

function resolveArtifactPath(plan, configuredPath) {
  return path.isAbsolute(configuredPath)
    ? configuredPath
    : path.resolve(plan.landing_unit.repo_root, configuredPath);
}

function inspectArtifact(artifact, expectedType) {
  if (!artifact) {
    return { artifact: null, valid: false };
  }
  const validation = validateDeliveryArtArtifact(artifact);
  return {
    artifact,
    valid: artifact.artifact_type === expectedType && validation.valid,
    validation,
  };
}

function sameStringValues(left, right) {
  return canonicalStringify([...(left ?? [])].sort()) ===
    canonicalStringify([...(right ?? [])].sort());
}

function architectureMatchesPlan(plan, artifact) {
  const coverage = new Set(artifact.covered_work_item_ids ?? []);
  const ownerByWorkItem = new Map(
    (artifact.architecture?.descendant_owner_map ?? []).map(
      (entry) => [entry.work_item_id, entry.owner_repo],
    ),
  );
  return artifact.delivery_id === plan.delivery_id &&
    plan.covered_work_item_ids.every((workItemId) => coverage.has(workItemId)) &&
    plan.covered_work_item_ids.every(
      (workItemId) => ownerByWorkItem.get(workItemId) === plan.landing_unit.owner_repo,
    );
}

function workStartMatchesPlan(plan, artifact, architecture) {
  const branchPlan = artifact.landing_unit?.branch_plan ?? [];
  const source = branchPlan[0];
  const architectureMatches = plan.architecture.required
    ? Boolean(
        architecture &&
        artifact.architecture?.required === true &&
        artifact.architecture?.packet_ref === architecture.custody?.uri &&
        artifact.architecture?.packet_digest === architecture.integrity?.content_digest,
      )
    : artifact.architecture?.required === false;
  return artifact.delivery_id === plan.delivery_id &&
    sameStringValues(artifact.covered_work_item_ids, plan.covered_work_item_ids) &&
    artifact.operator?.id === plan.operator.id &&
    artifact.operator?.decision_source === plan.operator.decision_source &&
    artifact.landing_unit?.decision === plan.landing_unit.decision &&
    artifact.landing_unit?.split_reason === plan.landing_unit.split_reason &&
    sameStringValues(
      artifact.landing_unit?.owner_repos,
      [plan.landing_unit.owner_repo],
    ) &&
    branchPlan.length === 1 &&
    source?.repo === plan.landing_unit.owner_repo &&
    source?.branch === plan.landing_unit.branch &&
    source?.base_ref === plan.landing_unit.base_ref &&
    architectureMatches;
}

function reviewPacketMatchesPlan(plan, artifact, workStart) {
  const repos = artifact.landing_unit?.repos ?? [];
  const repo = repos[0];
  const sourcePlan = workStart?.landing_unit?.branch_plan?.find(
    (entry) => entry.repo === plan.landing_unit.owner_repo,
  );
  return artifact.delivery_id === plan.delivery_id &&
    sameStringValues(artifact.covered_work_item_ids, plan.covered_work_item_ids) &&
    artifact.operator?.id === plan.operator.id &&
    artifact.operator?.decision_source === plan.operator.decision_source &&
    artifact.work_start?.artifact_ref === workStart?.custody?.uri &&
    artifact.work_start?.artifact_digest === workStart?.integrity?.content_digest &&
    artifact.work_start?.scope_fingerprint === workStart?.scope_fingerprint &&
    artifact.landing_unit?.decision === plan.landing_unit.decision &&
    artifact.landing_unit?.rollback_boundary === plan.landing_unit.rollback_boundary &&
    repos.length === 1 &&
    repo?.repo_name === plan.landing_unit.owner_repo &&
    repo?.branch === plan.landing_unit.branch &&
    repo?.base_ref === plan.landing_unit.base_ref &&
    repo?.base_commit === sourcePlan?.base_commit;
}

function finalizedReviewPacketMatchesPlan(plan, artifact) {
  const repos = artifact.landing_unit?.repos ?? [];
  const repo = repos[0];
  return artifact.delivery_id === plan.delivery_id &&
    sameStringValues(artifact.covered_work_item_ids, plan.covered_work_item_ids) &&
    artifact.operator?.id === plan.operator.id &&
    artifact.operator?.decision_source === plan.operator.decision_source &&
    artifact.landing_unit?.decision === plan.landing_unit.decision &&
    artifact.landing_unit?.rollback_boundary === plan.landing_unit.rollback_boundary &&
    repos.length === 1 &&
    repo?.repo_name === plan.landing_unit.owner_repo &&
    repo?.branch === plan.landing_unit.branch &&
    repo?.base_ref === plan.landing_unit.base_ref;
}

function architectureState(plan, artifactState) {
  if (!plan.architecture.required) {
    return "ready";
  }
  if (!artifactState.artifact) {
    return "required-missing";
  }
  if (!artifactState.valid) {
    return "invalid";
  }
  if (!architectureMatchesPlan(plan, artifactState.artifact)) {
    return "invalid";
  }
  if (artifactState.artifact.decision?.status !== "architecture-ready") {
    return artifactState.artifact.decision?.status === "draft"
      ? "required-missing"
      : "invalid";
  }
  return artifactState.artifact.custody?.state === "durable"
    ? "ready"
    : "local-ready";
}

function workStartState(plan, artifactState, architecture) {
  if (!artifactState.artifact) {
    return "missing";
  }
  if (!artifactState.valid) {
    return "invalid";
  }
  if (!workStartMatchesPlan(plan, artifactState.artifact, architecture)) {
    return "invalid";
  }
  if (artifactState.artifact.custody?.state === "local-draft") {
    return "local-draft";
  }
  return artifactState.artifact.readiness?.level === "implementation-ready"
    ? "implementation-ready"
    : artifactState.artifact.readiness?.level === "blocked"
      ? "blocked"
      : "invalid";
}

function reviewPacketState(plan, artifactState, workStart) {
  const artifact = artifactState.artifact;
  if (!artifact) {
    return "missing";
  }
  if (!artifactState.valid || artifact.schema_version !== 2) {
    return "invalid";
  }
  if (!reviewPacketMatchesPlan(plan, artifact, workStart)) {
    return "invalid";
  }
  if (artifact.status === "finalized" && artifact.custody?.state === "durable") {
    return "finalized";
  }
  if (artifact.status === "merge-ready" && artifact.custody?.state === "durable") {
    return "merge-ready";
  }
  if (artifact.status === "draft" && artifact.custody?.state === "local-draft") {
    return artifact.custody?.supersedes ? "finalization-draft" : "local-draft";
  }
  return "invalid";
}

function readinessReceiptState(artifactState, reviewPacket) {
  if (!artifactState.artifact) {
    return "missing";
  }
  if (!artifactState.valid || !reviewPacket) {
    return "invalid";
  }
  const artifact = artifactState.artifact;
  const expected = projectDeliveryArtReviewPacketOperatingReadiness(
    reviewPacket,
  ).readinessRequest;
  return artifact.delivery_id === expected.delivery_id &&
    sameStringValues(
      artifact.covered_work_item_ids,
      expected.covered_work_item_ids,
    ) &&
    artifact.subject?.artifact_type === expected.artifact_type &&
    artifact.subject?.artifact_id === expected.artifact_id &&
    artifact.subject?.digest_kind === expected.digest_kind &&
    artifact.subject?.digest === expected.digest &&
    artifact.readiness?.level === expected.readiness_level &&
    artifact.readiness?.outcome === "ready" &&
    artifact.readiness?.mutation_allowed === true &&
    artifact.custody?.state === "durable"
    ? "ready"
    : "invalid";
}

function localReviewPacketMatchesInputs(artifact, evidenceDocument) {
  if (!evidenceDocument) {
    return false;
  }
  const evidence = evidenceDocument.evidence ?? evidenceDocument;
  const exceptions = evidenceDocument.exceptions ?? [];
  return canonicalStringify(artifact.evidence) === canonicalStringify(evidence) &&
    canonicalStringify(artifact.exceptions) === canonicalStringify(exceptions);
}

function boundPullRequestState(reviewPacket, pullRequest, ownerRepo) {
  const state = pullRequest?.state ?? "missing";
  if (!reviewPacket || !["draft", "merge-ready"].includes(reviewPacket.status)) {
    return state;
  }
  const repo = reviewPacket.landing_unit?.repos?.find(
    (entry) => entry.repo_name === ownerRepo,
  );
  if (!repo) {
    return "mismatch";
  }
  if (["missing", "wrong-base"].includes(state)) {
    return state;
  }
  if (pullRequest.url !== repo.pr_url) {
    return "mismatch";
  }
  if (pullRequest.head_commit !== repo.head_commit) {
    return reviewPacket.status === "merge-ready" &&
      ["open", "draft"].includes(state)
      ? "stale-head"
      : "mismatch";
  }
  return state;
}

function finalizedSourceProjection(reviewPacket, ownerRepo) {
  if (reviewPacket?.status !== "finalized") {
    return null;
  }
  const repo = reviewPacket.landing_unit?.repos?.find(
    (entry) => entry.repo_name === ownerRepo,
  );
  if (!repo) {
    return null;
  }
  const mergedPullRequest = reviewPacket.landing_unit?.evidence_kind === "merged_pr";
  return {
    pullRequest: {
      base_ref: String(repo.base_ref ?? "").replace(/^origin\//, ""),
      head_commit: repo.head_commit,
      merge_commit: repo.merge_commit,
      state: mergedPullRequest ? "merged" : "not-required",
      url: repo.pr_url,
    },
    source: {
      base_commit: repo.base_commit,
      branch: repo.branch,
      changed_files: clone(repo.changed_files ?? []),
      head_commit: repo.head_commit,
      merge_commit: repo.merge_commit,
      state: mergedPullRequest ? "merged" : "landed",
    },
  };
}

function evidenceEntries(evidence) {
  return [
    ...(evidence?.changed_surfaces ?? []),
    ...(evidence?.tests ?? []),
    ...(evidence?.validations ?? []),
    ...(evidence?.runtime_and_live ?? []),
    ...(evidence?.security_and_trust ?? []),
  ];
}

function evidenceState(document, coveredWorkItemIds) {
  const evidence = document?.evidence ?? document;
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) {
    return "missing";
  }
  if (!validateDeliveryArtReviewPacketEvidence(evidence).valid) {
    return "invalid";
  }
  const requiredArrays = [
    "changed_surfaces",
    "tests",
    "validations",
    "acceptance_mapping",
    "runtime_and_live",
    "security_and_trust",
  ];
  if (requiredArrays.some((key) => !Array.isArray(evidence[key]))) {
    return "invalid";
  }
  if (
    evidence.changed_surfaces.length === 0 ||
    evidence.tests.length === 0 ||
    evidence.validations.length === 0
  ) {
    return "incomplete";
  }
  const mappedItems = evidence.acceptance_mapping
    .map((entry) => entry?.work_item_id)
    .filter(Boolean)
    .sort();
  if (JSON.stringify(mappedItems) !== JSON.stringify([...coveredWorkItemIds].sort())) {
    return "invalid";
  }
  const entries = evidenceEntries(evidence);
  const ids = entries.map((entry) => entry?.id).filter(Boolean);
  if (ids.length !== entries.length || new Set(ids).size !== ids.length) {
    return "invalid";
  }
  if (entries.some((entry) => entry?.result === "fail")) {
    return "invalid";
  }
  const idSet = new Set(ids);
  if (
    evidence.acceptance_mapping.some((entry) =>
      !Array.isArray(entry?.evidence_ids) ||
      entry.evidence_ids.length === 0 ||
      entry.evidence_ids.some((id) => !idSet.has(id)))
  ) {
    return "invalid";
  }
  return "ready";
}

function exceptionState(document, now) {
  const exceptions = document?.exceptions ?? [];
  if (!Array.isArray(exceptions)) {
    return "unapproved";
  }
  return exceptions.some((entry) =>
    !entry?.authority_ref ||
    (entry.expires_at && Date.parse(entry.expires_at) <= Date.parse(now)))
    ? "unapproved"
    : "approved";
}

function artState(statuses) {
  return Array.isArray(statuses) && statuses.length > 0 &&
    statuses.every((status) => CLOSED_ART_STATES.has(String(status).toLowerCase()))
    ? "closed"
    : "open";
}

function assertAdapter(adapter, methods, name) {
  for (const method of methods) {
    if (typeof adapter?.[method] !== "function") {
      throw new Error(`${name}.${method} is required`);
    }
  }
}

export function createDeliveryArtLifecycleController({
  artAdapter,
  brokerAdapter,
  clock = () => new Date(),
  fileAdapter,
  sourceAdapter,
} = {}) {
  assertAdapter(fileAdapter, ["read", "write"], "fileAdapter");
  assertAdapter(sourceAdapter, ["inspect", "pullRequest"], "sourceAdapter");
  assertAdapter(brokerAdapter, ["request"], "brokerAdapter");
  assertAdapter(artAdapter, ["statuses"], "artAdapter");

  async function inspect(plan) {
    const planValidation = validateDeliveryArtLifecyclePlan(plan);
    if (!planValidation.valid) {
      throw new DeliveryArtLifecycleError(
        "delivery_art_lifecycle_plan_invalid",
        "Delivery ART lifecycle plan failed contract validation.",
        planValidation,
      );
    }

    const paths = {
      architecture: plan.architecture.packet_path
        ? resolveArtifactPath(plan, plan.architecture.packet_path)
        : null,
      evidence: resolveArtifactPath(plan, plan.artifacts.evidence_path),
      readinessReceipt: resolveArtifactPath(
        plan,
        plan.artifacts.readiness_receipt_path,
      ),
      reviewPacket: resolveArtifactPath(plan, plan.artifacts.review_packet_path),
      workStart: resolveArtifactPath(plan, plan.artifacts.work_start_path),
    };
    const [
      architecture,
      workStart,
      reviewPacket,
      evidenceDocument,
      readinessReceipt,
    ] =
      await Promise.all([
        paths.architecture ? fileAdapter.read(paths.architecture) : null,
        fileAdapter.read(paths.workStart),
        fileAdapter.read(paths.reviewPacket),
        fileAdapter.read(paths.evidence),
        fileAdapter.read(paths.readinessReceipt),
      ]);
    const architectureArtifact = inspectArtifact(
      architecture,
      "delivery_art_architecture_packet",
    );
    const workStartArtifact = inspectArtifact(
      workStart,
      "delivery_art_work_start_record",
    );
    const projectedWorkStartState = workStartState(
      plan,
      workStartArtifact,
      architectureArtifact.artifact,
    );
    const sourcePlan = projectedWorkStartState === "implementation-ready"
      ? workStartArtifact.artifact.landing_unit?.branch_plan?.find(
          (entry) => entry.repo === plan.landing_unit.owner_repo,
        )
      : null;
    const workStartSourceMatches = projectedWorkStartState !== "implementation-ready" ||
      Boolean(
        sourcePlan &&
        sourcePlan.repo === plan.landing_unit.owner_repo &&
        sourcePlan.branch === plan.landing_unit.branch &&
        sourcePlan.base_ref === plan.landing_unit.base_ref,
      );
    const projectedSourceBinding = sourcePlan && workStartSourceMatches
      ? { ...plan.landing_unit, base_commit: sourcePlan.base_commit }
      : plan.landing_unit;
    let reviewPacketArtifact = inspectArtifact(reviewPacket, "art_review_packet");
    const finalizedReviewPacketRef = plan.artifacts.finalized_review_packet_ref ?? null;
    if (
      finalizedReviewPacketRef &&
      !(
        reviewPacketArtifact.valid &&
        reviewPacketArtifact.artifact?.status === "finalized" &&
        reviewPacketArtifact.artifact?.custody?.state === "durable" &&
        sameArtifactReference(finalizedReviewPacketRef, reviewPacketArtifact.artifact)
      )
    ) {
      const resolved = await brokerRequest({
        body: { reference: finalizedReviewPacketRef },
        callerId: plan.operator.id,
        path: "/v1/delivery-art/artifacts/resolve",
      });
      reviewPacketArtifact = inspectArtifact(
        resolved.artifact,
        "art_review_packet",
      );
    }
    const terminalReviewPacket = Boolean(finalizedReviewPacketRef);
    if (
      terminalReviewPacket &&
      !(
        reviewPacketArtifact.valid &&
        reviewPacketArtifact.artifact?.status === "finalized" &&
        reviewPacketArtifact.artifact?.custody?.state === "durable" &&
        sameArtifactReference(finalizedReviewPacketRef, reviewPacketArtifact.artifact) &&
        finalizedReviewPacketMatchesPlan(plan, reviewPacketArtifact.artifact)
      )
    ) {
      throw new DeliveryArtLifecycleError(
        "delivery_art_lifecycle_terminal_reference_invalid",
        "The lifecycle plan's finalized Review Packet reference did not resolve to matching durable terminal evidence.",
        { reference: finalizedReviewPacketRef },
      );
    }
    let reviewState = terminalReviewPacket
      ? "finalized"
      : reviewPacketState(
          plan,
          reviewPacketArtifact,
          workStartArtifact.artifact,
        );
    if (
      reviewState === "local-draft" &&
      !localReviewPacketMatchesInputs(reviewPacketArtifact.artifact, evidenceDocument)
    ) {
      reviewState = "invalid";
    }
    const projectedArchitectureState = terminalReviewPacket
      ? "ready"
      : architectureState(plan, architectureArtifact);
    const packetRepo = reviewPacketArtifact.artifact?.landing_unit?.repos?.find(
      (entry) => entry.repo_name === plan.landing_unit.owner_repo,
    );
    const finalizedSource = reviewState === "finalized"
      ? finalizedSourceProjection(
          reviewPacketArtifact.artifact,
          plan.landing_unit.owner_repo,
        )
      : null;
    const shouldInspectPullRequest =
      projectedArchitectureState === "ready" &&
      projectedWorkStartState === "implementation-ready" &&
      ["missing", "local-draft", "merge-ready"].includes(reviewState);
    const pullRequest = shouldInspectPullRequest
      ? await sourceAdapter.pullRequest(
          projectedSourceBinding,
          packetRepo
            ? { head_commit: packetRepo.head_commit, url: packetRepo.pr_url }
            : null,
        )
      : finalizedSource?.pullRequest ?? { state: "missing" };
    const pullRequestState = boundPullRequestState(
      reviewPacketArtifact.artifact,
      pullRequest,
      plan.landing_unit.owner_repo,
    );
    const shouldInspectSource = !terminalReviewPacket &&
      projectedArchitectureState === "ready" && (
      projectedWorkStartState === "missing" ||
      (
        projectedWorkStartState === "implementation-ready" &&
        (
          ["missing", "local-draft"].includes(reviewState) ||
          (reviewState === "merge-ready" && pullRequestState === "stale-head")
        )
      )
    );
    const source = shouldInspectSource
      ? await sourceAdapter.inspect(projectedSourceBinding)
      : finalizedSource?.source ?? {
          base_commit: packetRepo?.base_commit ?? sourcePlan?.base_commit ?? null,
          branch: packetRepo?.branch ?? sourcePlan?.branch ?? plan.landing_unit.branch,
          changed_files: packetRepo?.changed_files ?? [],
          head_commit: packetRepo?.head_commit ?? null,
          state: "not-required",
        };
    const sourceState =
      pullRequest.head_commit &&
      source.head_commit &&
      pullRequestState !== "merged" &&
      pullRequest.head_commit !== source.head_commit
        ? "unpushed"
        : source.state;
    const now = clock().toISOString();
    const reviewInput = reviewState === "missing" || pullRequestState === "stale-head"
      ? evidenceDocument
      : reviewPacketArtifact.artifact;
    const readinessReceiptArtifact = inspectArtifact(
      readinessReceipt,
      "delivery_art_readiness_receipt",
    );
    const facts = {
      architecture: reviewState === "finalized"
        ? "ready"
        : projectedArchitectureState,
      art: reviewState === "finalized"
        ? artState(await artAdapter.statuses(plan.covered_work_item_ids))
        : "open",
      evidence: evidenceState(reviewInput, plan.covered_work_item_ids),
      exceptions: exceptionState(reviewInput, now),
      pull_request: pullRequestState,
      readiness_receipt: terminalReviewPacket
        ? "ready"
        : readinessReceiptState(
            readinessReceiptArtifact,
            reviewPacketArtifact.artifact,
          ),
      review_packet: reviewState,
      source: sourceState,
      work_start: reviewState === "finalized"
        ? "implementation-ready"
        : workStartSourceMatches ? projectedWorkStartState : "invalid",
    };
    const projection = deriveDeliveryArtLifecycleState(facts);
    return {
      artifacts: {
        architecture: architectureArtifact.artifact,
        evidence: evidenceDocument,
        readiness_receipt: readinessReceiptArtifact.artifact,
        review_packet: reviewPacketArtifact.artifact,
        work_start: workStartArtifact.artifact,
      },
      facts,
      paths,
      plan: clone(plan),
      projection,
      pull_request: pullRequest,
      source,
    };
  }

  async function brokerRequest({ body, callerId, path: requestPath }) {
    const response = await brokerAdapter.request({ body, callerId, path: requestPath });
    if (!response || response.ok === false) {
      throw new DeliveryArtLifecycleError(
        "delivery_art_lifecycle_transition_failed",
        `Delivery ART lifecycle transition failed at ${requestPath}.`,
        response?.body ?? response ?? null,
      );
    }
    return response.body ?? response;
  }

  async function executeAction(context) {
    const { plan, projection } = context;
    const callerId = plan.operator.id;
    switch (projection.next_action) {
      case DELIVERY_ART_LIFECYCLE_ACTIONS.PERSIST_ARCHITECTURE: {
        const body = await brokerRequest({
          body: { artifact: context.artifacts.architecture },
          callerId,
          path: "/v1/delivery-art/architecture-packets/persist",
        });
        await fileAdapter.write(context.paths.architecture, body.artifact);
        break;
      }
      case DELIVERY_ART_LIFECYCLE_ACTIONS.DRAFT_WORK_START: {
        if (
          context.source.branch !== plan.landing_unit.branch ||
          !context.source.base_commit
        ) {
          throw new DeliveryArtLifecycleError(
            "delivery_art_lifecycle_source_context_invalid",
            "Work-start authoring requires the recorded branch and an exact base commit.",
            context.source,
          );
        }
        const architectureReference = plan.architecture.required
          ? artifactReference(context.artifacts.architecture)
          : null;
        const body = await brokerRequest({
          body: {
            input: {
              architecture: {
                reference: architectureReference,
                required: plan.architecture.required,
              },
              covered_work_item_ids: plan.covered_work_item_ids,
              delivery_id: plan.delivery_id,
              landing_unit: {
                branch_plan: [{
                  base_commit: context.source.base_commit,
                  base_ref: plan.landing_unit.base_ref,
                  branch: plan.landing_unit.branch,
                  repo: plan.landing_unit.owner_repo,
                }],
                decision: plan.landing_unit.decision,
                owner_repos: [plan.landing_unit.owner_repo],
                planned_review_packet_ref: plan.artifacts.review_packet_path,
                split_reason: plan.landing_unit.split_reason,
              },
              operator: {
                decision_source: plan.operator.decision_source,
              },
            },
          },
          callerId,
          path: "/v1/delivery-art/work-start/draft",
        });
        await fileAdapter.write(context.paths.workStart, body.work_start);
        break;
      }
      case DELIVERY_ART_LIFECYCLE_ACTIONS.EVALUATE_WORK_START: {
        const body = await brokerRequest({
          body: { artifact: context.artifacts.work_start },
          callerId,
          path: "/v1/delivery-art/work-start/evaluate",
        });
        await fileAdapter.write(context.paths.workStart, body.artifact);
        break;
      }
      case DELIVERY_ART_LIFECYCLE_ACTIONS.DRAFT_REVIEW_PACKET: {
        const evidenceDocument = context.artifacts.evidence;
        const body = await brokerRequest({
          body: {
            input: {
              created_at: clock().toISOString(),
              evidence: evidenceDocument.evidence ?? evidenceDocument,
              exceptions: evidenceDocument.exceptions ?? [],
              landing_unit: {
                evidence_kind: "open_pr",
                repos: [{
                  base_commit: context.source.base_commit,
                  base_ref: plan.landing_unit.base_ref,
                  branch: plan.landing_unit.branch,
                  changed_files: context.source.changed_files,
                  change_record_refs: evidenceDocument.change_record_refs ?? [],
                  head_commit: context.pull_request.head_commit,
                  merge_commit: null,
                  pr_url: context.pull_request.url,
                  repo_name: plan.landing_unit.owner_repo,
                }],
                rollback_boundary: plan.landing_unit.rollback_boundary,
              },
              operator: {
                decision_source: plan.operator.decision_source,
              },
              schema_version: 2,
              work_start_ref: artifactReference(context.artifacts.work_start),
            },
          },
          callerId,
          path: "/v1/delivery-art/review-packets",
        });
        await fileAdapter.write(context.paths.reviewPacket, body.review_packet);
        break;
      }
      case DELIVERY_ART_LIFECYCLE_ACTIONS.MARK_MERGE_READY: {
        const body = await brokerRequest({
          body: { review_packet: context.artifacts.review_packet },
          callerId,
          path: "/v1/delivery-art/review-packets/readiness",
        });
        await fileAdapter.write(context.paths.reviewPacket, body.artifact);
        break;
      }
      case DELIVERY_ART_LIFECYCLE_ACTIONS.DRAFT_FINALIZATION: {
        const evidenceDocument = context.artifacts.evidence;
        const body = await brokerRequest({
          body: {
            input: {
              evidence: evidenceDocument
                ? evidenceDocument.evidence ?? evidenceDocument
                : context.artifacts.review_packet.evidence,
              exceptions: evidenceDocument
                ? evidenceDocument.exceptions ?? []
                : context.artifacts.review_packet.exceptions,
              merge_ready_ref: artifactReference(context.artifacts.review_packet),
              merged_repos: [{
                head_commit: context.pull_request.head_commit,
                merge_commit: context.pull_request.merge_commit,
                pr_url: context.pull_request.url,
                repo_name: plan.landing_unit.owner_repo,
              }],
            },
          },
          callerId,
          path: "/v1/delivery-art/review-packets/finalization-drafts",
        });
        await fileAdapter.write(
          context.paths.reviewPacket,
          body.finalization_candidate,
        );
        break;
      }
      case DELIVERY_ART_LIFECYCLE_ACTIONS.ISSUE_OPERATING_READINESS: {
        const body = await brokerRequest({
          body: { review_packet: context.artifacts.review_packet },
          callerId,
          path: "/v1/delivery-art/review-packets/operating-readiness",
        });
        await fileAdapter.write(
          context.paths.reviewPacket,
          body.finalization_candidate,
        );
        await fileAdapter.write(
          context.paths.readinessReceipt,
          body.readiness_receipt,
        );
        break;
      }
      case DELIVERY_ART_LIFECYCLE_ACTIONS.FINALIZE_REVIEW_PACKET: {
        const readinessReceipt = await fileAdapter.read(context.paths.readinessReceipt);
        const body = await brokerRequest({
          body: {
            readiness_receipt_ref: artifactReference(readinessReceipt),
            review_packet: context.artifacts.review_packet,
          },
          callerId,
          path: "/v1/delivery-art/review-packets/finalize",
        });
        await fileAdapter.write(context.paths.reviewPacket, body.artifact);
        break;
      }
      default:
        throw new DeliveryArtLifecycleError(
          "delivery_art_lifecycle_action_unsupported",
          `Unsupported lifecycle action ${projection.next_action}.`,
        );
    }
    return projection.next_action;
  }

  async function reconcile(plan, { maxTransitions = 8 } = {}) {
    const executed = [];
    for (let index = 0; index < maxTransitions; index += 1) {
      const before = await inspect(plan);
      if (before.projection.complete || before.projection.gate) {
        return { ...before, executed_actions: executed };
      }
      const executedAction = await executeAction(before);
      executed.push(executedAction);
      const after = await inspect(plan);
      if (
        !after.projection.complete &&
        !after.projection.gate &&
        after.projection.next_action === before.projection.next_action
      ) {
        throw new DeliveryArtLifecycleError(
          "delivery_art_lifecycle_no_progress",
          `Lifecycle action ${executedAction} completed without advancing durable state.`,
        );
      }
      if (after.projection.complete || after.projection.gate) {
        return { ...after, executed_actions: executed };
      }
    }
    throw new DeliveryArtLifecycleError(
      "delivery_art_lifecycle_transition_limit",
      `Lifecycle reconciliation exceeded ${maxTransitions} mechanical transitions.`,
    );
  }

  return { inspect, reconcile };
}
