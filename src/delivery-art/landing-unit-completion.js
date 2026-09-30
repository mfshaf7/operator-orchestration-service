import { validateReviewPacket } from "../art-workflow-artifacts.js";
import { parseWorkItemId, toWorkItemId } from "../delivery-model.js";
import { validateDeliveryArtArtifact } from "./contracts.js";
import {
  buildReviewPacketCompletionInput,
  buildReviewPacketParentCloseInput,
  generatedPayloadPreflightEntry,
  landingUnitSourceEvidence,
  reviewPacketDigest,
} from "./review-packet-completion.js";

export function isClosedArtStatus(status) {
  return ["closed", "done", "retired"].includes(
    typeof status === "string" ? status.trim().toLowerCase() : "",
  );
}

export function extractLandingUnitWorkItemEvidence(body) {
  const continuation = body?.continuation_context || {};
  const evidencePacket = body?.evidence_packet || {};
  const targetItem = evidencePacket.target_item || continuation.target_item || null;
  const parentChain = Array.isArray(evidencePacket.parent_chain)
    ? evidencePacket.parent_chain
    : Array.isArray(continuation.parent_chain)
      ? continuation.parent_chain
      : [];
  const openSiblings = Array.isArray(continuation.open_siblings)
    ? continuation.open_siblings
    : [];
  const summary = evidencePacket.continuation_summary || continuation.summary || {};
  const parent = [...parentChain]
    .reverse()
    .find((entry) => entry?.type !== "Epic" && workItemIdFromRecord(entry));
  return {
    ancestors: parentChain
      .map((entry) => ({
        status: entry?.status ?? null,
        subject: truncateValue(entry?.subject ?? ""),
        type: entry?.type ?? null,
        work_item_id: workItemIdFromRecord(entry),
      }))
      .filter((entry) => entry.work_item_id),
    open_sibling_ids: openSiblings.map(workItemIdFromRecord).filter(Boolean),
    parent,
    parent_id: workItemIdFromRecord(parent),
    summary,
    target_item: targetItem,
    work_item_id: workItemIdFromRecord(targetItem) || body?.work_item_id || null,
  };
}

export async function analyzeLandingUnitCompletion({
  packet,
  packetPath = null,
  readEvidence,
}) {
  const coveredWorkItemIds = Array.isArray(packet.covered_work_item_ids)
    ? packet.covered_work_item_ids
    : [];
  const evidenceEntries = [];
  for (const workItemIdInput of coveredWorkItemIds) {
    const workItemId = normalizeWorkItemId(workItemIdInput);
    const result = await readEvidence(workItemId);
    if (result?.ok === false) {
      throw new Error(`failed to read landing-unit evidence for ${workItemId}`);
    }
    evidenceEntries.push({
      ...result,
      evidence: extractLandingUnitWorkItemEvidence(result.response),
      work_item_id: workItemId,
    });
  }
  return buildLandingUnitCompletionPlan({ evidenceEntries, packet, packetPath });
}

export function buildLandingUnitCompletionPlan({
  evidenceEntries,
  packet,
  packetPath = null,
}) {
  const coveredIds = Array.isArray(packet.covered_work_item_ids)
    ? packet.covered_work_item_ids.map(normalizeWorkItemId)
    : [];
  const coveredSet = new Set(coveredIds);
  const parentByWorkItemId = new Map(
    evidenceEntries.map((entry) => [entry.work_item_id, entry.evidence.parent_id]),
  );
  const coveredParentIds = new Set(
    evidenceEntries
      .map((entry) => entry.evidence.parent_id)
      .filter((parentId) => parentId && coveredSet.has(parentId)),
  );
  const validation = packet.schema_version === 2
    ? { ...validateDeliveryArtArtifact(packet), warnings: [] }
    : validateReviewPacket(packet, { final: true });
  const errors = [...validation.errors];
  if (packet.status !== "finalized") {
    errors.push("review packet must be finalized before landing-unit submit");
  }

  const completionTargets = [];
  const skippedWorkItems = [];
  const parentGroups = new Map();

  function collectCompletionPreflightErrors(
    entry,
    { allowOpenDescendants = false } = {},
  ) {
    const targetItem = entry.evidence.target_item || {};
    if (targetItem.blocked === true) {
      errors.push(`${entry.work_item_id} still has active blocker state.`);
    }
    if (targetItem.ready_contract_satisfied !== true) {
      const missingFields = Array.isArray(targetItem.ready_contract_missing_fields)
        ? targetItem.ready_contract_missing_fields
        : [];
      errors.push(
        `${entry.work_item_id} execution contract is not ready` +
          `${missingFields.length > 0 ? `: ${missingFields.join(", ")}` : "."}`,
      );
    }
    const openDescendantCount = entry.evidence.summary?.open_descendant_count ?? 0;
    if (!allowOpenDescendants && openDescendantCount > 0) {
      errors.push(`${entry.work_item_id} has ${openDescendantCount} open descendants.`);
    }
    if (targetItem.completion_narrative_contract_satisfied !== true) {
      const narrativeIssues = Array.isArray(
        targetItem.completion_narrative_contract_issues,
      )
        ? targetItem.completion_narrative_contract_issues
        : [];
      errors.push(
        `${entry.work_item_id} completion narrative is not ready` +
          `${narrativeIssues.length > 0 ? `: ${narrativeIssues.join("; ")}` : "."}`,
      );
    }
    if (targetItem.completion_status_transition_available !== true) {
      errors.push(
        `${entry.work_item_id} cannot transition to done` +
          `${targetItem.completion_status_transition_issue ? `: ${targetItem.completion_status_transition_issue}` : "."}`,
      );
    }
  }

  for (const entry of evidenceEntries) {
    const targetItem = entry.evidence.target_item || {};
    const targetStatus = targetItem.status ?? null;
    if (isClosedArtStatus(targetStatus)) {
      skippedWorkItems.push({
        reason: "already_closed",
        status: targetStatus,
        work_item_id: entry.work_item_id,
      });
    } else if (coveredParentIds.has(entry.work_item_id)) {
      collectCompletionPreflightErrors(entry, { allowOpenDescendants: true });
      skippedWorkItems.push({
        reason: "parent_closeout_after_children",
        status: targetStatus,
        work_item_id: entry.work_item_id,
      });
    } else {
      collectCompletionPreflightErrors(entry);
      completionTargets.push({
        status: targetStatus,
        work_item_id: entry.work_item_id,
      });
    }

    if (entry.evidence.parent_id) {
      const existing = parentGroups.get(entry.evidence.parent_id) || {
        child_ids: [],
        parent: entry.evidence.parent,
        uncovered_open_sibling_ids: new Set(),
      };
      existing.child_ids.push(entry.work_item_id);
      for (const siblingId of entry.evidence.open_sibling_ids) {
        if (!coveredSet.has(siblingId)) {
          existing.uncovered_open_sibling_ids.add(siblingId);
        }
      }
      parentGroups.set(entry.evidence.parent_id, existing);
    }
  }

  const parentCloseoutCandidates = [...parentGroups.entries()]
    .map(([parentId, group]) => {
      const uncovered = [...group.uncovered_open_sibling_ids].sort();
      const parentStatus = group.parent?.status ?? null;
      const parentCovered = coveredSet.has(parentId);
      const eligible =
        parentCovered &&
        !isClosedArtStatus(parentStatus) &&
        group.child_ids.length > 0 &&
        uncovered.length === 0;
      return {
        action: eligible ? "stale-open-close-after-children" : "not-ready",
        child_ids: group.child_ids.sort(),
        eligible_after_child_completion: eligible,
        parent_id: parentId,
        parent_covered: parentCovered,
        parent_status: parentStatus,
        parent_subject: truncateValue(group.parent?.subject ?? ""),
        uncovered_open_sibling_ids: uncovered,
      };
    })
    .sort((left, right) => {
      const hierarchyDepth = (workItemId) => {
        let current = workItemId;
        let depth = 0;
        const seen = new Set();
        while (parentByWorkItemId.get(current) && !seen.has(current)) {
          seen.add(current);
          current = parentByWorkItemId.get(current);
          depth += 1;
        }
        return depth;
      };
      return (
        hierarchyDepth(right.parent_id) - hierarchyDepth(left.parent_id) ||
        left.parent_id.localeCompare(right.parent_id)
      );
    });
  const generatedPayloadPreflight = [];
  for (const target of completionTargets) {
    generatedPayloadPreflight.push(
      generatedPayloadPreflightEntry({
        input: buildReviewPacketCompletionInput(packet, target.work_item_id),
        target: target.work_item_id,
        type: "work-item.complete",
      }),
    );
  }
  for (const candidate of parentCloseoutCandidates.filter(
    (entry) => entry.eligible_after_child_completion,
  )) {
    const group = parentGroups.get(candidate.parent_id);
    generatedPayloadPreflight.push(
      generatedPayloadPreflightEntry({
        input: buildReviewPacketParentCloseInput(packet, group?.parent, candidate.child_ids),
        target: candidate.parent_id,
        type: "work-item.stale-open-close",
      }),
    );
  }
  const generatedPayloadIssues = generatedPayloadPreflight.flatMap((entry) =>
    entry.issues.map((issue) => `${entry.type} ${entry.target}: ${issue}`));
  errors.push(...generatedPayloadIssues);

  const source = landingUnitSourceEvidence(packet);
  const ancestorWorkItems = [];
  const seenAncestorIds = new Set();
  for (const entry of evidenceEntries) {
    for (const ancestor of entry.evidence.ancestors) {
      if (!seenAncestorIds.has(ancestor.work_item_id)) {
        seenAncestorIds.add(ancestor.work_item_id);
        ancestorWorkItems.push(ancestor);
      }
    }
  }
  return {
    ancestor_work_items: ancestorWorkItems,
    coverage: evidenceEntries.map(summarizeLandingUnitItem),
    delivery_id: packet.delivery_id ?? null,
    errors,
    landing_unit: {
      evidence_kind: packet.landing_unit?.evidence_kind ?? null,
      merge_commit: source.mergeCommits[0] ?? packet.landing_unit?.merge_commit ?? null,
      merge_commits: source.mergeCommits,
      pr_url: source.prUrls[0] ?? packet.landing_unit?.pr_url ?? null,
      pr_urls: source.prUrls,
      repo_names: source.repoNames,
      rollback_boundary: packet.landing_unit?.rollback_boundary ?? null,
    },
    packet_digest: reviewPacketDigest(packet),
    packet_id: packet.packet_id ?? null,
    packet_path: packetPath,
    parent_closeout_candidates: parentCloseoutCandidates,
    planned_completion_count: completionTargets.length,
    planned_completions: completionTargets,
    ready_to_submit: errors.length === 0,
    generated_payload_preflight: {
      checked_count: generatedPayloadPreflight.length,
      invalid_count: generatedPayloadPreflight.filter((entry) => !entry.valid).length,
      results: generatedPayloadPreflight,
      valid: generatedPayloadIssues.length === 0,
    },
    skipped_work_items: skippedWorkItems,
    validation: {
      error_count: validation.errors.length,
      errors: validation.errors,
      valid: validation.valid,
      warning_count: validation.warnings.length,
      warnings: validation.warnings,
    },
  };
}

export async function evaluateLandingUnitAncestorDispositions({
  plan,
  readEvidence,
}) {
  const dispositions = [];
  for (const ancestor of plan.ancestor_work_items ?? []) {
    if (ancestor.type === "Epic") {
      dispositions.push({
        ...ancestor,
        disposition: "initiative-readiness-evaluated-separately",
      });
      continue;
    }
    const outcome = await invokeCompletion(() =>
      readEvidence(ancestor.work_item_id));
    if (!outcome.ok) {
      dispositions.push({
        ...ancestor,
        disposition: "read-failed",
        reason: errorDetails(outcome.error).message,
      });
      continue;
    }
    const evidence = extractLandingUnitWorkItemEvidence(outcome.response);
    const item = evidence.target_item ?? {};
    const openDescendantCount = evidence.summary?.open_descendant_count ?? 0;
    const ready =
      item.ready_contract_satisfied === true &&
      item.completion_narrative_contract_satisfied === true &&
      item.completion_status_transition_available === true &&
      openDescendantCount === 0;
    dispositions.push({
      status: item.status ?? ancestor.status,
      subject: truncateValue(item.subject ?? ancestor.subject),
      type: item.type ?? ancestor.type,
      work_item_id: ancestor.work_item_id,
      disposition: isClosedArtStatus(item.status)
        ? "closed"
        : ready
          ? "ready-for-closeout"
          : "retained",
      open_descendant_count: openDescendantCount,
    });
  }
  return dispositions;
}

export async function submitLandingUnitCompletion({
  closeParent,
  completeWorkItem,
  packet,
  plan,
  readEvidence,
}) {
  const completed = [];
  const failed = [];
  const projectionStates = [];

  for (const target of plan.planned_completions) {
    const outcome = await invokeCompletion(() =>
      completeWorkItem({
        input: buildReviewPacketCompletionInput(packet, target.work_item_id),
        workItemId: target.work_item_id,
      }));
    if (!outcome.ok) {
      failed.push(failureProjection(outcome, { work_item_id: target.work_item_id }));
      break;
    }
    const completedStatus = outcome.response?.work_item?.status ?? null;
    if (!isClosedArtStatus(completedStatus)) {
      failed.push({
        response: outcome.response ?? null,
        status: outcome.status ?? null,
        work_item_id: target.work_item_id,
      });
      break;
    }
    if (outcome.projection_state) projectionStates.push(outcome.projection_state);
    completed.push({
      status: completedStatus,
      wgcf_receipt_id: outcome.response?.wgcf_art_readiness?.receipt_id ?? null,
      work_item_id: target.work_item_id,
    });
  }

  const parentCloseouts = [];
  if (failed.length === 0) {
    for (const candidate of plan.parent_closeout_candidates.filter(
      (entry) => entry.eligible_after_child_completion,
    )) {
      const refreshedOutcome = await invokeCompletion(() =>
        readEvidence(candidate.parent_id));
      if (!refreshedOutcome.ok) {
        failed.push(failureProjection(refreshedOutcome, {
          parent_id: candidate.parent_id,
        }));
        break;
      }
      const refreshed = refreshedOutcome.response;
      const parentEvidence = extractLandingUnitWorkItemEvidence(refreshed);
      const parentItem = parentEvidence.target_item || {};
      if (isClosedArtStatus(parentItem.status)) {
        parentCloseouts.push({
          action: "skipped",
          parent_id: candidate.parent_id,
          reason: "already_closed",
          status: parentItem.status ?? null,
        });
        continue;
      }
      const refreshedSummary = parentEvidence.summary || {};
      if (refreshedSummary.open_child_count !== 0) {
        parentCloseouts.push({
          action: "skipped",
          open_child_count: refreshedSummary.open_child_count ?? null,
          parent_id: candidate.parent_id,
          reason: "open_children_remain",
        });
        failed.push({
          parent_id: candidate.parent_id,
          response: refreshed ?? null,
          status: refreshedOutcome.status ?? null,
        });
        break;
      }

      const outcome = await invokeCompletion(() =>
        closeParent({
          input: buildReviewPacketParentCloseInput(
            packet,
            parentItem,
            candidate.child_ids,
          ),
          workItemId: candidate.parent_id,
        }));
      if (!outcome.ok) {
        failed.push(failureProjection(outcome, { parent_id: candidate.parent_id }));
        break;
      }
      const parentStatus = outcome.response?.work_item?.status ?? null;
      if (!isClosedArtStatus(parentStatus)) {
        failed.push({
          parent_id: candidate.parent_id,
          response: outcome.response ?? null,
          status: outcome.status ?? null,
        });
        break;
      }
      if (outcome.projection_state) projectionStates.push(outcome.projection_state);
      parentCloseouts.push({
        action: "stale-open-closed",
        parent_id: candidate.parent_id,
        status: parentStatus,
        wgcf_receipt_id: outcome.response?.wgcf_art_readiness?.receipt_id ?? null,
      });
    }
  }

  return {
    completed,
    failed,
    packet_digest: plan.packet_digest,
    packet_id: plan.packet_id,
    parent_closeouts: parentCloseouts,
    projection_states: projectionStates,
    skipped_work_items: plan.skipped_work_items,
    status: failed.length === 0 ? "submitted" : "submission_failed",
  };
}

function normalizeWorkItemId(value) {
  const recordId = parseWorkItemId(String(value ?? ""));
  if (!recordId) throw new Error(`invalid Delivery work item id: ${value}`);
  return toWorkItemId(recordId);
}

function workItemIdFromRecord(item) {
  if (!item || typeof item !== "object") return null;
  if (Number.isInteger(item.id) && item.id > 0) return toWorkItemId(item.id);
  if (typeof item.record_ref === "string") {
    const match = item.record_ref.match(/work_packages\/(\d+)$/);
    if (match) return toWorkItemId(Number.parseInt(match[1], 10));
  }
  return null;
}

function summarizeLandingUnitItem(entry) {
  const item = entry.evidence.target_item || {};
  const parent = entry.evidence.parent || {};
  return {
    parent_id: entry.evidence.parent_id,
    parent_status: parent.status ?? null,
    parent_subject: truncateValue(parent.subject ?? ""),
    status: item.status ?? null,
    subject: truncateValue(item.subject ?? ""),
    type: item.type ?? null,
    work_item_id: entry.work_item_id,
  };
}

function truncateValue(value, maxLength = 140) {
  const normalized = String(value ?? "").trim();
  return normalized.length > maxLength
    ? `${normalized.slice(0, maxLength - 3)}...`
    : normalized;
}

async function invokeCompletion(callback) {
  try {
    const result = await callback();
    return result?.ok === false
      ? result
      : { ok: true, response: result?.response ?? result, ...result };
  } catch (error) {
    return {
      error,
      ok: false,
      response: errorDetails(error),
      status: Number.isInteger(error?.statusCode) ? error.statusCode : null,
    };
  }
}

function failureProjection(outcome, target) {
  return {
    ...target,
    ...(Number.isInteger(outcome.exit_code) ? { exit_code: outcome.exit_code } : {}),
    response: outcome.response ?? null,
    status: Number.isInteger(outcome.status) ? outcome.status : null,
  };
}

function errorDetails(error) {
  return {
    code: typeof error?.code === "string"
      ? error.code
      : "delivery_art_landing_unit_completion_failed",
    details: error?.details ?? null,
    message: error instanceof Error ? error.message : String(error),
  };
}
