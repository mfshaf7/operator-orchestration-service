import { HttpError } from "../errors.js";
import { projectInventoryRequestJournal } from "../workspace-inventory/contracts.js";
const terminal = new Set(["succeeded", "cancelled", "rejected", "blocked", "stale"]);
const fail = (code, message, status = 409) => new HttpError(status, `workspace_inventory_${code}`, message);

export function createInstanceInventoryFacade({ legacy, legacyStore, native, journal, reader, enabled, family }) {
  const nativeRequest = request => request?.artifact_type === "instance-repository-inventory-request";
  const savedNative = id => typeof id === "string" && id.length <= 256 ? journal.get(id) : null;
  async function existing(id) {
    const [old, current] = await Promise.all([legacyStore.get(id), savedNative(id)]);
    if (old && current) throw fail("authority_conflict", "The saved request has overlapping authorities; preserve both for recovery.", 503);
    return current ? native : legacy;
  }
  async function pending(callerId, target) {
    return (await legacyStore.list()).some(record => record.caller_id === callerId && record.request.target.record_id === target?.record_id && !terminal.has(record.status));
  }
  async function requireLegacy(request, prior) {
    if (!prior && request?.target?.kind === "repo") {
      const state = await reader.prepare(request.target.name, { operation: "inventory" });
      if (state.canonical_authority.kind !== "legacy-git") throw fail("review_stale", "This repository uses internal inventory. Refresh its current registration before submission.");
    }
  }
  return {
    async prepare(args) {
      if (args.input?.target?.kind !== "repo") return legacy.prepare(args);
      const target = { ...args.input.target, record_id: `repo:${args.input.target.name}` };
      if (await pending(args.callerId, target)) return legacy.prepare(args);
      const value = await native.prepare(args);
      return value.canonical_authority.kind === "legacy-git" ? legacy.prepare(args) : value;
    },
    async submit(args) {
      const request = args.input?.request;
      if (nativeRequest(request)) {
        if (!enabled) throw fail("internal_disabled", "Internal inventory writes are disabled in this composition.", 503);
        if (await pending(args.callerId, request.target)) throw fail("original_request_pending", "Continue or cancel the original source-backed request before starting another inventory change.");
        return native.submit(args);
      }
      if (typeof request?.request_id !== "string" || !request.request_id.trim()) return legacy.submit(args);
      if (request.request_id.length > 256) {
        await requireLegacy(request, await legacyStore.get(request.request_id));
        return legacy.submit(args);
      }
      return journal.withRequestLock(request.request_id, async () => {
        if (savedNative(request.request_id)) throw fail("request_conflict", "This identity belongs to its original internal inventory request.");
        await requireLegacy(request, await legacyStore.get(request.request_id));
        return legacy.submit(args);
      });
    },
    async advance(args) { return (await existing(args.requestId)).advance(args); },
    async project(id, options) { return (await existing(id)).project(id, options); },
    async list(args) {
      if (args.input?.target?.kind !== "repo") return legacy.list(args);
      const target = { ...args.input.target, record_id: `repo:${args.input.target.name}` };
      const records = [...await legacyStore.list(), ...await native.records({ callerId: args.callerId, target })];
      const ids = records.map(record => record.request.request_id);
      if (new Set(ids).size !== ids.length) throw fail("authority_conflict", "Saved inventory history contains an overlapping request identity.", 503);
      return projectInventoryRequestJournal({ records, callerId: args.callerId, input: args.input, workflowId: family });
    },
  };
}
