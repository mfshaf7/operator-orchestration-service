import { HttpError } from "../errors.js";
import { intakeDigest } from "../workspace-intake/contracts.js";

const terminal = new Set(["succeeded", "cancelled", "rejected", "requires-action"]);
const fail = (code, message, status = 409) => new HttpError(status, `workspace_intake_${code}`, message);

// Old requests retain their source authority. Only a positive authority result,
// never a backend timeout/404, chooses the source-backed route for a new request.
export function createInstanceIntakeFacade({ legacy, legacyStore, native, journal, reader, enabled = true }) {
  async function existing(requestId) {
    const [source, internal] = await Promise.all([legacyStore.get(requestId),
      typeof requestId === "string" && requestId.length <= 256 ? journal.get(requestId) : null]);
    if (source && internal) throw fail("authority_conflict", "The request is claimed by two authorities; preserve both for recovery.", 503);
    return internal ? native : legacy;
  }
  async function hasLegacyPending(callerId, target) {
    return (await legacyStore.list()).some(record => record.caller_id === callerId &&
      record.request.target.kind === target.kind && record.request.target.name === target.name && !terminal.has(record.status));
  }
  async function requireLegacyAuthority(request, prior) {
    if (!prior && request?.target?.kind === "repo" && request?.source?.class === "repository-custody") {
      const state = await reader.prepare(request.target.name);
      if (state.canonical_authority.kind !== "legacy-git") throw fail("review_stale", "This repository now uses internal registration. Refresh its preparation before submission.");
    }
  }
  return {
    attest: args => legacy.attest(args),
    async prepare(args) {
      if (args.input?.target?.kind !== "repo" || !args.input?.repository_custody) return legacy.prepare(args);
      if (await hasLegacyPending(args.callerId, args.input.target)) return legacy.prepare(args);
      const prepared = await native.prepare(args);
      return prepared.canonical_authority?.kind === "legacy-git" ? legacy.prepare(args) : prepared;
    },
    async submit(args) {
      const request = args.input?.request;
      if (request?.artifact_type === "instance-repository-intake-request") {
        if (!enabled) throw fail("internal_registration_disabled", "Internal registration is not enabled in this composition.", 503);
        if (await hasLegacyPending(args.callerId, request.target)) throw fail("original_request_pending", "Continue or cancel the original source-backed request before making a new registration decision.");
        return native.submit(args);
      }
      if (typeof request?.request_id !== "string" || !request.request_id.trim()) return legacy.submit(args);
      if (request.request_id.length > 256) {
        await requireLegacyAuthority(request, await legacyStore.get(request.request_id));
        return legacy.submit(args);
      }
      return journal.withRequestLock(request?.request_id, async () => {
        if (journal.get(request.request_id)) throw fail("request_conflict", "This request belongs to its saved internal registration.");
        const prior = await legacyStore.get(request.request_id);
        await requireLegacyAuthority(request, prior);
        return legacy.submit(args);
      });
    },
    async project(requestId, options) { return (await existing(requestId)).project(requestId, options); },
    async advance(args) { return (await existing(args.requestId)).advance(args); },
    async list(args) {
      if (args.input?.target?.kind !== "repo" || args.input?.source_class === "direct") return legacy.list(args);
      const input = args.input, target = { ...input.target, record_id: `repo:${input.target.name}` };
      if (Object.keys(input).some(key => !["target", "custody_request_id", "cursor"].includes(key)) ||
          typeof input.custody_request_id !== "string" || !input.custody_request_id.trim() ||
          input.cursor !== undefined && !/^[0-9a-f]{64}$/.test(input.cursor)) throw fail("list_invalid", "Select one repository connection and its saved-request cursor.", 400);
      // The retained source set is frozen for new project registrations. Fetch
      // its bounded pages, then combine with only this target's private journal.
      const old = [], seen = new Set();
      let cursor, legacySummary;
      do {
        const page = await legacy.list({ ...args, input: { ...input, cursor } });
        legacySummary ??= page;
        old.push(...page.records);
        cursor = page.next_cursor ?? undefined;
        if (cursor && seen.has(cursor)) throw fail("storage_invalid", "Saved source pagination did not advance.", 503);
        if (cursor) seen.add(cursor);
      } while (cursor);
      const internal = await native.projectRecords(args);
      const all = [...old, ...internal];
      if (new Set(all.map(record => record.request_id)).size !== all.length) throw fail("authority_conflict", "Saved request history has an overlapping identity.", 503);
      all.sort((a, b) => Date.parse(b.requested_at) - Date.parse(a.requested_at) || b.request_id.localeCompare(a.request_id));
      const cursorFor = record => intakeDigest({ caller_id: args.callerId, target,
        custody_request_id: input.custody_request_id, request_id: record.request_id }).slice(7);
      let offset = 0;
      if (input.cursor) {
        offset = all.findIndex(record => cursorFor(record) === input.cursor) + 1;
        if (!offset) throw fail("cursor_invalid", "The cursor does not belong to this request history.", 400);
      }
      const records = all.slice(offset, offset + 25);
      while (records.length && Buffer.byteLength(JSON.stringify(records)) > 524288) records.pop();
      if (all.length > offset && !records.length) throw fail("list_record_large", "A saved request exceeds the bounded history view.", 503);
      return { schema_version: 1, workflow_id: "workspace-intake", target, custody_request_id: input.custody_request_id,
        revision: (legacySummary?.revision ?? 0) + internal.reduce((sum, record) => sum + record.revision, 0),
        pending_request_count: all.filter(record => !terminal.has(record.status)).length,
        updated_at: all.map(record => record.updated_at).sort().at(-1) ?? null, records,
        next_cursor: offset + records.length < all.length ? cursorFor(records.at(-1)) : null };
    },
  };
}
