import { HttpError } from "./errors.js";
import { decodePrototypeDeliveryTargetMarker } from "./delivery-ingress/prototype-adapter.js";

const MAX_TARGETS = 512;
const PAGE_LIMIT = 20;
const MAX_HISTORY = 200;
const iso = (value) => typeof value === "string" && Number.isFinite(Date.parse(value));
const unavailable = () => ({ state: "unavailable", detail: "Owner evidence could not be verified. Retry the original owner read.", data: null });

// Read composition only. Each workflow retains its original identity, trusted
// activity checks and authorization. No history result grants command eligibility.
export function createDeliveryHistoryReader({
  deliveryService: delivery, prototypeDeliveryApplicationService: prototype, proposalWorkflowService: proposals,
  workDesignService: design, refinementService: refinement,
  deliveryCloseoutService: closeout, clock = () => new Date(),
}) {
  async function intakeForTarget(target, callerId, correlationId, observed = null) {
    const ref = `openproject://work_packages/${target.recordId}`;
    if (target.recordRef !== ref) throw new HttpError(502, "delivery_history_target_mismatch", "Delivery target identity is inconsistent.");
    const native = observed ?? await prototype.readTarget({ recordId: target.recordId, callerId, correlationId });
    if (native.target.recordRef !== ref) throw new HttpError(502, "delivery_history_target_mismatch", "Owner read returned a different Delivery target.");
    if (native.source_kind === "prototype") {
      const app = native.application;
      if (!app) return { state: "unavailable", detail: "The target exists, but its original trusted application receipt is unavailable.", data: null };
      if (app.target.record_ref !== ref) {
        throw new HttpError(502, "delivery_history_intake_mismatch", "Intake receipt does not bind the current target.");
      }
      return { state: "current", detail: "Original native Prototype application and target receipt.", data: {
        source_id: app.ingress_id, source_kind: "prototype", source_ref: app.source.record_ref,
        source_version: app.source.record_version, packet_ref: app.source.packet_ref,
        delivery_id: `delivery-${target.recordId}`, target_ref: ref, title: target.title,
        owner_repo: app.target.owner_repo, state: "consumed", custody: app.source.custody,
        receipt_ref: app.receipt.receipt_ref, receipt_digest: app.receipt.content_digest,
        recorded_at: app.receipt.recorded_at, actor: app.operator_decision.operator_id,
        evidence_refs: [app.receipt.custody.uri, app.source.baseline_ref, app.source.packet_ref],
      } };
    }
    if (native.source_kind === "proposal") {
      const projection = await proposals.getProjection({ callerId, correlationId, proposalId: target.originIdeaRef });
      if (projection.route?.target !== "delivery" || projection.handoff.target_record_ref !== ref ||
          projection.handoff.state !== "applied" || !projection.handoff.target_receipt_ref) {
        return { state: "unavailable", detail: "Proposal backlink exists, but its exact applied handoff receipt is not available.", data: null };
      }
      const custody = projection.route.source_custody;
      if (!["resolved", "not-required"].includes(custody?.repository_gate_state)) {
        return { state: "unavailable", detail: "The Proposal handoff custody cannot be verified against this target.", data: null };
      }
      return { state: "current", detail: "Original applied Proposal handoff and reciprocal Delivery target.", data: {
        source_id: projection.handoff.packet_ref, source_kind: "proposal", source_ref: projection.record_ref,
        source_version: "not-projected", packet_ref: projection.handoff.packet_ref,
        delivery_id: `delivery-${target.recordId}`, target_ref: ref, title: target.title,
        owner_repo: custody.owner, state: "consumed", custody,
        receipt_ref: projection.handoff.target_receipt_ref, receipt_digest: null,
        // Current Proposal update time is not the historical consume time.
        recorded_at: null, actor: null, evidence_refs: [projection.handoff.packet_ref, projection.handoff.target_receipt_ref],
      } };
    }
    return { state: "not-recorded", detail: "This target has no retained Proposal or Prototype ingress binding.", data: null };
  }

  async function readIntake({ callerId, correlationId, cursor = null, limit = PAGE_LIMIT }) {
    const size = Number(limit);
    if (!Number.isSafeInteger(size) || size < 1 || size > PAGE_LIMIT ||
        (cursor !== null && !/^after:[1-9][0-9]*$/.test(cursor))) {
      throw new HttpError(400, "delivery_intake_page_invalid", "Intake requires limit1-20 and an optional after:<target-id> cursor.");
    }
    if (!prototype?.listTargets || !prototype.readTarget) {
      throw new HttpError(503, "delivery_history_owner_unavailable", "The native Delivery ingress reader is unavailable.");
    }
    const targets = await prototype.listTargets();
    if (!Array.isArray(targets) || targets.length > MAX_TARGETS) throw new HttpError(502, "delivery_intake_bound_exceeded", "Delivery target inventory exceeds its bounded reader.");
    const seen = new Set();
    const candidates = targets.filter((target) => {
      if (!Number.isSafeInteger(target.recordId) || target.recordId < 1 || seen.has(target.recordId)) {
        throw new HttpError(502, "delivery_intake_identity_invalid", "Duplicate or invalid Delivery target identity.");
      }
      seen.add(target.recordId);
      return Boolean(decodePrototypeDeliveryTargetMarker(target.description) || target.originIdeaRef);
    }).sort((a, b) => a.recordId - b.recordId);
    const after = cursor ? Number(cursor.slice(6)) : 0;
    const remaining = candidates.filter((t) => t.recordId > after);
    const page = remaining.slice(0, size);
    const sources = [];
    const issues = [];
    // Bound owner concurrency; do not turn visible-page polling into a scan of
    // every workflow application for every initiative.
    for (let index = 0; index < page.length; index += 3) {
      const batch = page.slice(index, index + 3);
      const results = await Promise.allSettled(batch.map((target) => {
        // The owner collection already validated current project/type/parent
        // scope and supplied this target snapshot. A Proposal needs its fresh
        // reciprocal owner projection, not another target read and schema form.
        // Prototype rows still reread their trusted application activity.
        const observed = decodePrototypeDeliveryTargetMarker(target.description)
          ? null : { target, source_kind: "proposal", application: null };
        return intakeForTarget(target, callerId, correlationId, observed);
      }));
      for (let i = 0; i < results.length; i++) {
        const result = results[i], target = batch[i];
        if (result.status === "fulfilled" && result.value.state === "current") sources.push(result.value.data);
        else issues.push({ target_ref: target.recordRef, state: "unavailable",
          detail: result.status === "fulfilled" ? result.value.detail : "Original owner evidence could not be verified." });
      }
    }
    return { schema_version: 1, workflow_id: "delivery-intake-sources", sources, issues,
      next_cursor: remaining.length > size ? `after:${page.at(-1).recordId}` : null,
      coverage: { state: issues.length ? "partial" : "current", detail: "Target-backed native ingress only. Unapplied ideas remain with Proposal or Prototype; absent proof is never a successful consumption." },
      projected_at: clock().toISOString() };
  }

  async function readHistory({ deliveryId, callerId, correlationId }) {
    const match = /^delivery-([1-9][0-9]*)$/.exec(deliveryId);
    if (!match || !Number.isSafeInteger(Number(match[1]))) throw new HttpError(400, "delivery_history_id_invalid", "An exact Delivery initiative is required.");
    const recordId = Number(match[1]), sourceRef = `openproject://work_packages/${recordId}`;
    // The exact target reader also checks project/type/parent boundaries.
    if (!prototype?.readTarget || !delivery?.getDeliveryExecutionSummary) throw new HttpError(503, "delivery_history_owner_unavailable", "Native Delivery target reader is unavailable.");
    const scope = await delivery.getDeliveryExecutionSummary({ deliveryId, callerId, correlationId,
      includeDone: true, includeParked: true });
    if (scope?.delivery_record_ref !== sourceRef) throw new HttpError(404, "delivery_not_found", "The exact target is not in Workspace Delivery ART.");
    const targetRead = await prototype.readTarget({ recordId, callerId, correlationId });
    if (targetRead.target.recordRef !== sourceRef) throw new HttpError(502, "delivery_history_target_mismatch", "Owner returned a different target.");
    const target = targetRead.target;
    const requests = {
      intake: () => intakeForTarget(target, callerId, correlationId, targetRead),
      work_design: () => design.project({ callerId, correlationId, packageId: `delivery-package:${recordId}`, sourceRef }),
      refinement: () => refinement.project({ callerId, correlationId, packageId: `delivery-package:${recordId}`, sourceRef }),
      closeout: () => closeout.getProjection({ callerId, correlationId, deliveryId }),
    };
    const results = await Promise.allSettled(Object.values(requests).map((read) => read()));
    const sections = {}, events = [];
    for (const [index, key] of Object.keys(requests).entries()) {
      const result = results[index];
      if (result.status === "rejected") { sections[key] = unavailable(); continue; }
      if (key === "intake") {
        sections[key] = result.value;
        const entry = result.value.data;
        if (entry?.recorded_at) events.push(event(entry.source_id, "Intake consumed", entry.recorded_at, entry.actor, entry.receipt_ref, [entry.target_ref, ...entry.evidence_refs], "ok"));
        continue;
      }
      const value = result.value;
      const ref = key === "closeout" ? value.record_ref : key === "work_design" ? value.source?.ref : value.packet?.source?.source_ref;
      if (ref !== sourceRef) { sections[key] = unavailable(); continue; }
      const history = key === "closeout" ? value.outcome_history : value.history;
      if (!Array.isArray(history)) { sections[key] = unavailable(); continue; }
      const records = history.slice(-MAX_HISTORY).map((item) => historyRecord(key, item, sourceRef));
      if (records.some((item) => item === null)) { sections[key] = unavailable(); continue; }
      sections[key] = { state: "current", detail: history.length > MAX_HISTORY ? "Latest200 original owner records; older owner history is outside this bounded projection." : "Original retained owner history.", data: {
        state: key === "work_design" ? value.state : key === "refinement" ? value.latest_run?.state ?? "not-recorded" : value.package?.status,
        source_ref: sourceRef, records, total_records: history.length, truncated: history.length > MAX_HISTORY,
      } };
      events.push(...records.filter((item) => iso(item.at)).map((item) => event(item.id, item.title, item.at, item.actor, item.receipt_ref, item.evidence_refs, item.tone)));
    }
    events.sort((a, b) => Date.parse(b.occurred_at) - Date.parse(a.occurred_at));
    return { schema_version: 1, workflow_id: "delivery-package-history", delivery_id: deliveryId,
      record_ref: sourceRef, package: { title: target.title, status: target.status, owner_repo: target.ownerRepo },
      sections, events: events.slice(0, MAX_HISTORY), event_count: events.length,
      history_state: Object.values(sections).some((s) => s.state === "unavailable") ? "partial" : "current",
      mutation_authority: "none", projected_at: clock().toISOString() };
  }
  return { readIntake, readHistory };
}

function event(id, title, at, actor, receipt, refs, tone) {
  return { event_id: id, title, occurred_at: at, actor: actor ?? "owner not projected",
    receipt_ref: receipt, evidence_refs: refs.filter((x) => typeof x === "string"), tone };
}

function historyRecord(kind, item, targetRef) {
  if (kind === "work_design") {
    if (item.target?.delivery_ref !== targetRef || !item.application_id || !item.receipt?.ref) return null;
    return { id: item.application_id, title: "Work Design applied", state: item.status, at: item.applied_at,
      actor: item.applied_by, receipt_ref: item.receipt.ref, digest: item.receipt.digest,
      evidence_refs: [targetRef, ...item.target.created_refs, ...item.target.updated_refs, ...item.target.reused_refs], tone: "ok" };
  }
  if (kind === "refinement") {
    if (!item.run_id) return null;
    const receipt = item.receipt;
    if (receipt && receipt.target.delivery_ref !== targetRef) return null;
    return { id: item.run_id, title: `Refinement ${item.state}`, state: item.state, at: receipt?.applied_at ?? item.updated_at,
      actor: receipt?.applied_by ?? null, receipt_ref: receipt?.receipt_ref ?? null, digest: receipt?.receipt_digest ?? null,
      evidence_refs: [targetRef, ...(receipt ? [receipt.source_work_design_receipt_id, ...receipt.target.created_refs, ...receipt.target.updated_refs, ...receipt.target.reused_refs] : [])],
      tone: item.state === "completed" ? "ok" : item.state === "failed" ? "danger" : "info" };
  }
  if (item.delivery_id !== `delivery-${targetRef.split("/").at(-1)}` || !item.event_id) return null;
  return { id: item.event_id, title: `Delivery closeout ${item.status}`, state: item.status, at: item.occurred_at,
    actor: item.operator_id, receipt_ref: item.receipt?.ref ?? null, digest: item.receipt?.digest ?? null,
    evidence_refs: [targetRef, item.outcome_ref].filter(Boolean), tone: item.status === "applied" ? "ok" : ["failed", "rejected"].includes(item.status) ? "danger" : "info" };
}
