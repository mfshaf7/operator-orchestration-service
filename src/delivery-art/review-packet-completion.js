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

export async function readClosedWorkReview({ receipt, deliveryId, workItemId, resolveArtifact, packets = new Map() }) {
  const ref = `openproject://work_packages/${workItemId.slice("work-item-".length)}`;
  if (!receipt || receipt.delivery_id !== deliveryId || !receipt.protected_evidence_refs?.includes(ref)) {
    return { review: null, unavailable: false };
  }
  if (!resolveArtifact) return { review: null, unavailable: true };
  const references = receipt.protected_evidence_refs.filter(
    uri => /^wgcf:\/\/artifacts\/delivery-art\/sha256\/[a-f0-9]{64}$/.test(uri),
  );
  const resolved = await Promise.allSettled(references.map(uri => {
    const digest = `sha256:${uri.slice(-64)}`;
    if (!packets.has(uri)) packets.set(uri, resolveArtifact({ reference: { uri, digest } }));
    return packets.get(uri);
  }));
  const packet = resolved.map(result => result.status === "fulfilled" ? result.value.artifact : null)
    .find(candidate => candidate?.artifact_type === "art_review_packet" && candidate.status === "finalized" &&
      candidate.delivery_id === deliveryId && candidate.custody?.state === "durable" &&
      candidate.operator?.id === receipt.closed_by && candidate.covered_work_item_ids.includes(workItemId));
  if (!packet) return { review: null, unavailable: resolved.some(result => result.status === "rejected") };
  const urls = packet.landing_unit?.evidence_kind === "merged_pr"
    ? [...landingUnitSourceEvidence(packet).prUrls, packet.landing_unit.pr_url]
      .filter(url => typeof url === "string" && /^https:\/\/github\.com\/[a-z0-9_.-]+\/[a-z0-9_.-]+\/pull\/[1-9][0-9]*\/?$/i.test(url))
      .map(url => url.replace(/\/$/, "")) : [];
  return {
    review: {
      covered_work_item_ids: packet.covered_work_item_ids.filter(id =>
        receipt.protected_evidence_refs.includes(`openproject://work_packages/${id.slice("work-item-".length)}`)),
      pull_request_urls: [...new Set(urls)],
      verification_recorded: packet.readiness?.level === "operating-ready",
      passed_checks: [...new Set([
        ...(packet.evidence?.tests ?? []), ...(packet.evidence?.validations ?? []),
        ...(packet.evidence?.runtime_and_live ?? []), ...(packet.evidence?.security_and_trust ?? []),
      ].filter(entry => entry.result === "pass" && typeof entry.name === "string" && entry.name.trim())
        .map(entry => entry.name.trim()))],
    },
    unavailable: false,
  };
}

export async function readCompletedChildReviewLinks({ context, deliveryId, store, resolveArtifact }) {
  const children = (context.previously_completed_related_items ?? [])
    .filter(({ item, relation }) => relation === "completed_child" &&
      item?.parent_id === context.target_item.id && item.status === "done" &&
      Number.isSafeInteger(item.id) && item.id > 0 &&
      item.record_ref === `openproject://work_packages/${item.id}`);
  const packets = new Map();

  const links = new Map();
  let covered = 0;
  let unavailable = 0;
  // Limit concurrent registry reads, and reuse packets shared by several children.
  if (store && resolveArtifact) {
    for (let index = 0; index < children.length; index += 4) {
      const batch = children.slice(index, index + 4);
      const results = await Promise.allSettled(batch.map(async ({ item }) => {
        const workItemId = `work-item-${item.id}`;
        return readClosedWorkReview({
          receipt: store.readCleanupReceiptByAlias(workItemId), deliveryId, workItemId, resolveArtifact, packets,
        });
      }));
      for (const [offset, result] of results.entries()) {
        if (result.status === "rejected" || result.value.unavailable) {
          unavailable += 1;
          continue;
        }
        const urls = result.value.review?.pull_request_urls ?? [];
        if (urls.length === 0) continue;
        covered += 1;
        const child = batch[offset].item;
        for (const url of urls) {
          const items = links.get(url) ?? [];
          items.push({ id: child.id, subject: child.subject });
          links.set(url, items);
        }
      }
    }
  } else unavailable = children.length;
  return {
    completed_child_count: children.length,
    matched_child_count: covered,
    unavailable_child_count: unavailable,
    links: Array.from(links, ([url, work_items]) => ({ url, work_items })),
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
