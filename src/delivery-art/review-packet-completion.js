import { createHash } from "node:crypto";

import {
  buildCompletionSections,
  validateCompletionSections,
} from "../completion-evidence.js";

function sha256Json(value) {
  return createHash("sha256")
    .update(JSON.stringify(value), "utf8")
    .digest("hex");
}

function normalizeEvidenceBullets(lines) {
  if (!Array.isArray(lines) || lines.length === 0) {
    return "- NOT APPLICABLE: no evidence lines were supplied by the Review Packet.";
  }
  return lines
    .map((line) => {
      if (typeof line === "string") return line.trim();
      if (!line || typeof line !== "object") return "";
      const result = line.result === "not_applicable"
        ? "NOT APPLICABLE"
        : String(line.result ?? "CHECK").toUpperCase();
      const label = line.name || line.command || line.id || "Structured evidence";
      const detail = line.summary || line.not_applicable_reason || "Recorded by the Review Packet.";
      return `${result}: ${label}: ${detail}`;
    })
    .filter(Boolean)
    .map((line) => (line.startsWith("- ") ? line : `- ${line}`))
    .join("\n");
}

function normalizeChangedSurfaceBullets(lines) {
  if (!Array.isArray(lines) || lines.length === 0) {
    return "- `Review Packet`: no changed surfaces were supplied.";
  }
  return lines
    .map((line) => {
      if (typeof line === "string") return line.trim();
      if (!line || typeof line !== "object") return "";
      const location = [line.repo, line.path].filter(Boolean).join("/");
      return `\`${location || line.id || "Review Packet"}\`: ${line.summary || "covered by finalized Review Packet evidence."}`;
    })
    .filter(Boolean)
    .map((line) => {
      const body = line.replace(/^- /, "").trim();
      if (body.startsWith("`") || body.startsWith("[")) return `- ${body}`;
      const separatorIndex = body.indexOf(":");
      if (separatorIndex === -1) {
        return `- \`${body}\`: covered by finalized Review Packet evidence.`;
      }
      const surface = body.slice(0, separatorIndex).trim();
      const description = body.slice(separatorIndex + 1).trim();
      return `- \`${surface}\`: ${description}`;
    })
    .join("\n");
}

export function reviewPacketDigest(packet) {
  return packet.integrity?.content_digest ||
    packet.packet_digest ||
    `sha256:${sha256Json(packet)}`;
}

function completionMappingForWorkItem(packet, workItemId) {
  const mappings = Array.isArray(packet.evidence?.acceptance_mapping)
    ? packet.evidence.acceptance_mapping
    : Array.isArray(packet.completion_mapping)
      ? packet.completion_mapping
      : [];
  const mapping = mappings.find((entry) => entry?.work_item_id === workItemId);
  const summary = mapping?.summary ?? mapping?.evidence_summary;
  if (typeof summary === "string" && summary.trim()) return summary.trim();
  return `Finalized Review Packet ${packet.packet_id || "(unknown)"} covers ${workItemId}.`;
}

export function landingUnitSourceEvidence(packet) {
  const landingUnit = packet.landing_unit || {};
  const repos = Array.isArray(landingUnit.repos) ? landingUnit.repos : [];
  const prUrls = repos.map((repo) => repo.pr_url).filter(Boolean);
  const mergeCommits = repos.map((repo) => repo.merge_commit).filter(Boolean);
  return {
    mergeCommit: landingUnit.merge_commit || mergeCommits.join(", ") || "no merge commit recorded",
    mergeCommits,
    prUrl: landingUnit.pr_url || prUrls.join(", ") || "no PR URL recorded",
    prUrls,
    repoNames: repos.map((repo) => repo.repo_name).filter(Boolean),
  };
}

export function buildReviewPacketCompletionInput(packet, workItemId) {
  const digest = reviewPacketDigest(packet);
  const source = landingUnitSourceEvidence(packet);
  return {
    changed_surfaces: normalizeChangedSurfaceBullets(packet.evidence?.changed_surfaces),
    completion_note:
      `Finalized Review Packet ${packet.packet_id || "(unknown)"} digest ` +
      `${digest} binds ${source.prUrl} merge ${source.mergeCommit} to ${workItemId}.`,
    completion_summary: completionMappingForWorkItem(packet, workItemId),
    test_result_evidence: normalizeEvidenceBullets(
      packet.evidence?.tests ?? packet.evidence?.test_results,
    ),
    validation_evidence: normalizeEvidenceBullets(packet.evidence?.validations),
  };
}

export function buildReviewPacketParentCloseInput(packet, parent, childIds) {
  const digest = reviewPacketDigest(packet);
  const source = landingUnitSourceEvidence(packet);
  const recordId = String(parent?.record_ref ?? "").match(/work_packages\/(\d+)$/)?.[1];
  const parentId = parent?.work_item_id ??
    (Number.isInteger(parent?.id) ? `work-item-${parent.id}` : null) ??
    (recordId ? `work-item-${recordId}` : "work-item-unknown");
  const childList = childIds.join(", ");
  return {
    changed_surfaces: normalizeChangedSurfaceBullets(packet.evidence?.changed_surfaces),
    completion_note:
      `Finalized Review Packet ${packet.packet_id || "(unknown)"} digest ` +
      `${digest} binds ${source.prUrl} merge ${source.mergeCommit} to parent ${parentId}.`,
    completion_summary:
      `Closed parent ${parentId} after covered child scope completed through the ` +
      `same finalized Review Packet: ${childList}.`,
    stale_open_justification:
      `All open child scope known to the landing unit under ${parentId} is covered ` +
      `by finalized Review Packet ${packet.packet_id || "(unknown)"} digest ${digest}. ` +
      `Covered children: ${childList}.`,
    test_result_evidence: normalizeEvidenceBullets(
      packet.evidence?.tests ?? packet.evidence?.test_results,
    ),
    validation_evidence: normalizeEvidenceBullets(packet.evidence?.validations),
  };
}

export function generatedPayloadPreflightEntry({ input, target, type }) {
  const sections = buildCompletionSections({
    changedSurfaces: input.changed_surfaces,
    completionSummary: input.completion_summary,
    residualFollowUp: input.residual_follow_up ?? null,
    testResultArtifact: input.test_result_artifact ?? null,
    testResultEvidence: input.test_result_evidence,
    validationEvidence: input.validation_evidence,
  });
  const result = validateCompletionSections(sections);
  return {
    issue_count: result.issues.length,
    issues: result.issues,
    target,
    type,
    valid: result.formattingValid,
  };
}

export function preflightReviewPacketCompletionPayloads(packet) {
  const results = (packet.covered_work_item_ids ?? []).map((workItemId) =>
    generatedPayloadPreflightEntry({
      input: buildReviewPacketCompletionInput(packet, workItemId),
      target: workItemId,
      type: "work-item.complete",
    }));
  return {
    checked_count: results.length,
    invalid_count: results.filter((entry) => !entry.valid).length,
    issues: results.flatMap((entry) =>
      entry.issues.map((issue) => `${entry.type} ${entry.target}: ${issue}`)),
    results,
    valid: results.every((entry) => entry.valid),
  };
}
