import { randomUUID } from "node:crypto";
import { agentConsoleDigest, agentConsoleError } from "./contracts.js";

export const activityKinds = Object.freeze([
  "assistant-response", "proposal-triage", "proposal-disposition", "prototype-candidate",
  "prototype-baseline", "work-design-context", "work-design-tree", "refinement-metadata",
  "execution-tree", "work-design-blocker", "refinement-blocker", "definition-design",
]);

function safeReference(value) {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(value) || /(?:sk-|gh[pousr]_|github_pat_|Bearer|PRIVATE KEY)/i.test(value)) {
    throw agentConsoleError("activity_invalid", "AI activity record reference is invalid.", 400);
  }
  return value;
}

export function activityMetadata(value, runtimeId) {
  if (value === undefined) return { runtime_id: runtimeId, kind: null, subject_ref: null };
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.keys(value).some(key => !["kind", "subject_ref"].includes(key)) || !activityKinds.includes(value.kind)) {
    throw agentConsoleError("activity_invalid", "AI activity metadata must use an admitted task kind.", 400);
  }
  return { runtime_id: runtimeId, kind: value.kind, subject_ref: safeReference(value.subject_ref) };
}

function compare(left, right) {
  return right.requested_at.localeCompare(left.requested_at) || right.id.localeCompare(left.id);
}

export function projectActivityPage(state, { callerId, operatorId, runtimeId, clock, cursor = null, limit = 10 }) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw agentConsoleError("activity_query_invalid", "AI history limit must be between 1 and 50.", 400);
  const binding = agentConsoleDigest({ callerId, operatorId });
  let boundary = null;
  if (cursor !== null) {
    try {
      if (typeof cursor !== "string" || cursor.length > 2048 || !/^[A-Za-z0-9_-]+$/.test(cursor)) throw Error();
      boundary = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
      if (Object.keys(boundary).sort().join() !== "binding,id,requested_at" || boundary.binding !== binding ||
          typeof boundary.id !== "string" || !boundary.id || boundary.id.length > 600 || typeof boundary.requested_at !== "string" || boundary.requested_at.length > 64 || !Number.isFinite(Date.parse(boundary.requested_at))) throw Error();
    } catch { throw agentConsoleError("activity_cursor_invalid", "AI history cursor does not match this operator query.", 400); }
  }
  // Keep at most one bounded page plus a lookahead while traversing existing
  // private state. No prompts, result bodies or error messages enter projection.
  const page = [];
  const offer = item => {
    if (boundary && compare(item, boundary) <= 0) return;
    page.push(item); page.sort(compare);
    if (page.length > limit + 1) page.pop();
  };
  for (const record of Object.values(state.sessions)) {
    if (record.caller_id !== callerId || record.request.operator_id !== operatorId) continue;
    for (const invocation of Object.values(record.invocations)) {
      const metadata = record.activity_metadata?.[invocation.invocation_id];
      offer({
        id: `${record.request.session_id}:${invocation.invocation_id}`, source: "agent-console",
        session_ref: `oos://agent-console/sessions/${encodeURIComponent(record.request.session_id)}`,
        invocation_id: invocation.invocation_id,
        kind: metadata?.kind ?? null, subject_ref: metadata?.subject_ref ?? null,
        state: invocation.state === "running" ? metadata?.runtime_id === runtimeId ? "working" : "interrupted" : invocation.state,
        requested_at: invocation.requested_at, completed_at: invocation.completed_at,
        receipt_ref: invocation.receipt_ref, audit_ref: invocation.model?.audit_ref ?? null,
        context_ref: invocation.context?.projection_receipt_ref ?? null,
        error_code: invocation.failure?.code ?? null,
      });
    }
  }
  for (const item of Object.values(state.advisor_activity ?? {})) {
    if (item.caller_id !== callerId || item.operator_id !== operatorId) continue;
    offer({ id: item.id, source: item.source, session_ref: null, invocation_id: null,
      kind: item.kind, subject_ref: item.subject_ref,
      state: item.state === "working" && item.runtime_id !== runtimeId ? "interrupted" : item.state,
      requested_at: item.requested_at, completed_at: item.completed_at,
      receipt_ref: null, audit_ref: item.audit_ref, context_ref: item.context_ref, error_code: item.error_code });
  }
  const hasMore = page.length > limit;
  const items = page.slice(0, limit), last = items.at(-1);
  return { schema_version: 1, artifact_type: "ai-activity-page", caller_id: callerId, operator_id: operatorId,
    observed_at: clock().toISOString(), items,
    next_cursor: hasMore ? Buffer.from(JSON.stringify({ binding, id: last.id, requested_at: last.requested_at })).toString("base64url") : null,
    coverage: "Retained Agent Console requests; Work Design and Refinement advice from history recording onward. Older task and item metadata may be absent." };
}

export function createAdviceTracker({ store, clock, runtimeId, assertBinding }) {
  return async ({ callerId, operatorId, source, kind, subjectRef, invoke }) => {
    assertBinding(callerId, operatorId);
    if (!["work-design", "refinement"].includes(source)) throw agentConsoleError("activity_invalid", "Unrecognized advisor source.", 400);
    const metadata = activityMetadata({ kind, subject_ref: subjectRef }, runtimeId);
    const id = `advice:${randomUUID()}`;
    await store.transact(state => {
      state.advisor_activity ??= {};
      state.advisor_activity[id] = { ...metadata, id, caller_id: callerId, operator_id: operatorId,
        source, state: "working", requested_at: clock().toISOString(), completed_at: null,
        audit_ref: null, context_ref: null, error_code: null };
    });
    let result;
    try {
      result = await invoke();
    } catch (error) {
      await store.transact(state => Object.assign(state.advisor_activity[id], {
        state: error?.name === "AbortError" ? "cancelled" : "failed", completed_at: clock().toISOString(),
        error_code: typeof error?.code === "string" && /^[a-z0-9_-]{1,100}$/.test(error.code) ? error.code : "advisor_request_failed",
      }));
      throw error;
    }
    await store.transact(state => Object.assign(state.advisor_activity[id], {
      state: "completed", completed_at: clock().toISOString(),
      audit_ref: result.evidence?.gateway_audit_ref ?? null,
      context_ref: result.evidence?.cgg_packet_ref ?? null,
    }));
    return result;
  };
}
