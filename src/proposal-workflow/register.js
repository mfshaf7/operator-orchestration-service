import { createHash } from "node:crypto";
import { HttpError } from "../errors.js";

const PAGE_SIZE = 25;
const SCAN_PAGES = 4;
const STATUSES = new Set(["all", "captured", "triaged", "parked", "done", "retired", "ready-to-route", "waiting-on-repository", "waiting-on-source"]);
const INGRESS = new Set(["all", "console", "agent", "api", "system"]);
const invalid = () => new HttpError(400, "proposal_register_query_invalid", "Select valid Proposal search, filters and continuation.");
const changed = () => new HttpError(409, "proposal_register_changed", "The proposal list changed. Refresh the first page before continuing.");

function selectorOf({ query = "", status = "all", ingress = "all" } = {}) {
  if (typeof query !== "string" || query.length > 200 || !STATUSES.has(status) || !INGRESS.has(ingress)) throw invalid();
  return { query: query.trim().toLowerCase(), status, ingress };
}
function binding(selector) { return createHash("sha256").update(JSON.stringify(selector)).digest("hex"); }
function cursorOf(cursor, selector) {
  if (cursor == null || cursor === "") return { page: 1, index: 0, total: null, anchor: null };
  if (typeof cursor !== "string" || cursor.length > 600 || !/^[A-Za-z0-9_-]+$/.test(cursor)) throw invalid();
  let value;
  try { value = JSON.parse(Buffer.from(cursor, "base64url").toString()); } catch { throw invalid(); }
  if (!value || Object.keys(value).sort().join() !== "anchor,index,page,selector,total" || value.selector !== binding(selector) ||
      !Number.isSafeInteger(value.page) || value.page < 1 || value.page > 10000000 || !Number.isSafeInteger(value.index) || value.index < 0 || value.index >= PAGE_SIZE ||
      !Number.isSafeInteger(value.total) || value.total < 0 || (value.anchor !== null && !/^idea-[1-9][0-9]*$/.test(value.anchor)) || (value.index > 0 && !value.anchor)) throw invalid();
  return value;
}
function encodeCursor(value, selector) { return Buffer.from(JSON.stringify({ ...value, selector: binding(selector) })).toString("base64url"); }

function stateOf(p, deliveryLink) {
  if (p.projection_state !== "current") return "waiting-on-source";
  if (p.delivery_ref) return deliveryLink?.status === "retired" && p.status !== "implemented" ? "retired" : "done";
  if (p.handoff.state === "applied" || ["implemented", "rejected"].includes(p.status)) return "done";
  if (["captured", "triaged", "parked"].includes(p.status)) return p.status;
  return p.route?.source_custody.repository_gate_state === "pending" ? "waiting-on-repository" : "ready-to-route";
}
function matches(p, link, selector) {
  const status = stateOf(p, link);
  if (selector.status !== "all" && status !== selector.status || selector.ingress !== "all" && p.source.ingress !== selector.ingress) return false;
  if (!selector.query) return true;
  return [p.proposal_id, p.record_ref, p.title, p.body, p.record_version, p.source.ingress, "Workspace Proposals", p.route?.target,
    p.route?.rationale, p.route?.source_custody.owner, p.route?.source_custody.source_ref, p.route?.source_custody.rationale,
    p.route?.source_custody.repository_mode, p.route?.source_custody.repository_gate_state, status,
    status === "ready-to-route" ? "review" : status === "waiting-on-repository" ? "repo needed" : status === "waiting-on-source" ? "needs source" : ""]
    .filter(Boolean).join(" ").toLowerCase().includes(selector.query);
}

// Summary reads use the canonical collection fields. They never scan activity
// journals, expand Delivery children or grant authority to submit a command.
export function createProposalRegisterReader({ openProjectClient, projectRecord }) {
  return async function readRegister({ cursor = null, ...input } = {}) {
    const selector = selectorOf(input), position = cursorOf(cursor, selector), records = [];
    let { page, index, total, anchor } = position;
    for (let scanned = 0; scanned < SCAN_PAGES; scanned++) {
      const source = await openProjectClient.listIdeas({ limit: PAGE_SIZE, offset: page });
      if (!source || !Array.isArray(source.items) || source.items.length > PAGE_SIZE || source.limit !== PAGE_SIZE || source.offset !== page ||
          !Number.isSafeInteger(source.total) || source.total < 0 || (source.items.length !== Math.min(PAGE_SIZE, Math.max(0, source.total - (page - 1) * PAGE_SIZE)))) {
        throw new HttpError(502, "proposal_register_source_invalid", "Proposal list metadata could not be verified.");
      }
      if (total !== null && total !== source.total || (index > 0 && source.items[index - 1]?.ideaId !== anchor)) throw changed();
      total = source.total;
      const ids = source.items.map(row => row.ideaId);
      if (new Set(ids).size !== ids.length || ids.some(id => !/^idea-[1-9][0-9]*$/.test(id))) throw changed();
      const linkedIds = [...new Set(source.items.flatMap(row => /^openproject:\/\/work_packages\/([1-9][0-9]*)$/.exec(row.deliveryRef ?? "")?.slice(1).map(Number) ?? []))];
      let delivery = null;
      if (linkedIds.length && typeof openProjectClient.listPrototypeDeliveryApplicationTargets === "function") {
        try { delivery = new Map((await openProjectClient.listPrototypeDeliveryApplicationTargets({ recordIds: linkedIds }))
          .map(row => [row.record_ref, row.status])); }
        catch (error) { if ([401, 403].includes(error.statusCode)) throw error; }
      }
      for (; index < source.items.length; index++) {
        const row = source.items[index], projection = projectRecord(row, null), observedAt = new Date().toISOString();
        const deliveryLink = projection.delivery_ref ? { recordRef: projection.delivery_ref, status: delivery?.get(projection.delivery_ref) ?? null,
          observedAt, sourceState: delivery?.has(projection.delivery_ref) ? "current" : "unavailable" } : undefined;
        if (!matches(projection, deliveryLink, selector)) continue;
        records.push({ creationKnown:typeof row.createdAt === "string" && Number.isFinite(Date.parse(row.createdAt)), createdAt: row.createdAt ?? projection.updated_at, projection, ...(deliveryLink ? { deliveryLink } : {}), summaryOnly: true,
          history: { schema_version: 1, proposal_id: projection.proposal_id, record_version: projection.record_version, events: [], next_cursor: null } });
        if (records.length === PAGE_SIZE) {
          const nextIndex = index + 1, more = (page - 1) * PAGE_SIZE + nextIndex < total;
          return { schema_version: 1, workflow_id: "proposal-register", selector, records, source_total: total,
            next_cursor: more ? encodeCursor({ page: nextIndex === PAGE_SIZE ? page + 1 : page, index: nextIndex % PAGE_SIZE, total,
              anchor: nextIndex === PAGE_SIZE ? null : row.ideaId }, selector) : null };
        }
      }
      page++; index = 0; anchor = null;
      if ((page - 1) * PAGE_SIZE >= total) return { schema_version: 1, workflow_id: "proposal-register", selector, records, source_total: total, next_cursor: null };
    }
    return { schema_version: 1, workflow_id: "proposal-register", selector, records, source_total: total,
      next_cursor: encodeCursor({ page, index: 0, total, anchor: null }, selector) };
  };
}
