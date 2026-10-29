import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { createPrivateFileTransactions } from "../persistence/private-file-transactions.js";

const MAX_BYTES = 2 * 1024 * 1024;
const kinds = new Set(["work-design", "refinement", "orchestration"]);
const hash = text => createHash("sha256").update(text).digest("hex");
const digest = text => `sha256:${hash(text)}`;
const stable = value => JSON.stringify(value, (_key, item) => item && typeof item === "object" && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
export class SavedWorkError extends Error {
  constructor(code, message, statusCode = 400) { super(message); this.code = code; this.statusCode = statusCode; }
}
const fail = (code, message, status) => { throw new SavedWorkError(code, message, status); };

export function savedWorkStorageKey(kind, subjectId) {
  return kind === "work-design" ? `delivery-work-design-session:${subjectId}:v2`
    : kind === "refinement" ? `delivery-refinement-session:${subjectId}:v1`
      : `orchestration-definition-design:${subjectId}:v1`;
}
function exact(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).sort().join() !== [...keys].sort().join())
    fail("saved_work_input_invalid", "Use the exact saved-work request contract.");
}
function payloadFor(kind, subjectId, raw) {
  if (typeof raw !== "string" || !raw.isWellFormed() || Buffer.byteLength(raw) > MAX_BYTES)
    fail("saved_work_payload_invalid", "Saved work must be bounded UTF-8 JSON text.");
  let value;
  try { value = JSON.parse(raw); } catch { fail("saved_work_payload_invalid", "Saved work is not valid JSON."); }
  if (!value || typeof value !== "object" || Array.isArray(value) || value.schemaVersion !== (kind === "work-design" ? 2 : 1) ||
      (kind === "orchestration" ? value.draftId : value.packageId) !== subjectId)
    fail("saved_work_subject_mismatch", "The saved-work kind, schema and subject must agree.");
  if (kind === "work-design" && (!value.context || !Array.isArray(value.briefVersions) || !Array.isArray(value.context.sessions)))
    fail("saved_work_payload_invalid", "Work Design requires its context, named sessions and brief versions.");
  return value;
}

// Drafts remain inert operator input. This store cannot apply ART, approve a
// brief, run a definition, invoke a model or attest historical browser authorship.
// Each subject has bounded metadata/current content; no all-project scan.
export function createSavedWorkStore({ root, clock = () => new Date() }) {
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const files = createPrivateFileTransactions({ root, failure: (code, message) => new SavedWorkError(code, message, 503) });
  function location({ callerId, operatorId, kind, subjectId }) {
    if (!kinds.has(kind) || typeof subjectId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,200}$/.test(subjectId) ||
        ![callerId, operatorId].every(v => typeof v === "string" && v.trim()))
      fail("saved_work_identity_invalid", "A bound operator, workflow kind and subject are required.");
    const binding = { caller_id: callerId, operator_id: operatorId, kind, subject_id: subjectId };
    const directory = path.join(root, hash(stable(binding)));
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    return { binding, directory, file: path.join(directory, "current.json") };
  }
  function verified(file, binding) {
    const record = files.read(file, "Saved work", { maxBytes: MAX_BYTES * 4 });
    if (!record) return null;
    const { record_digest, ...body } = record;
    if (record_digest !== digest(stable(body)) || stable(record.binding) !== stable(binding))
      fail("saved_work_corrupt", "Saved work failed its identity or integrity check; original content is preserved.", 503);
    return record;
  }
  const project = record => record ? { revision: record.revision, saved_at: record.saved_at,
    content_digest: record.content_digest, payload_json: record.payload_json,
    acknowledgement_id: record.acknowledgement_id, origin: record.origin } : null;
  function recoveries(directory) {
    const value = files.read(path.join(directory, "recovery-index.json"), "Browser recovery index", { maxBytes: 128 * 1024 });
    if (!value) return [];
    const { digest: recorded, entries } = value;
    if (!Array.isArray(entries) || recorded !== digest(stable(entries))) fail("saved_work_recovery_corrupt", "Browser recovery index failed integrity validation.", 503);
    return entries;
  }
  return {
    read(identity, recoveryId = null) {
      const { binding, directory, file } = location(identity);
      const record = verified(file, binding);
      let recovery = null;
      if (recoveryId !== null) {
        if (!/^[0-9a-f]{64}$/.test(recoveryId)) fail("saved_work_recovery_invalid", "An exact recovery identity is required.");
        const entry = recoveries(directory).find(item => item.recovery_id === recoveryId);
        if (!entry) fail("saved_work_recovery_missing", "The selected browser recovery record is unavailable.", 404);
        recovery = files.read(path.join(directory, `recovery-${recoveryId}.json`), "Original browser record", { maxBytes: MAX_BYTES * 4 });
        if (!recovery || digest(recovery.raw_value) !== entry.content_digest || recovery.storage_key !== entry.storage_key)
          fail("saved_work_recovery_corrupt", "The preserved browser record failed integrity validation.", 503);
      }
      return { schema_version: 1, kind: identity.kind, subject_id: identity.subjectId, record: project(record), recoveries: recoveries(directory), recovery };
    },
    async preserve(identity, command) {
      exact(command, ["storage_key", "raw_value"]);
      const { directory } = location(identity);
      const prefix = savedWorkStorageKey(identity.kind, identity.subjectId).replace(/:v\d+$/, ":v");
      if (typeof command.storage_key !== "string" || !command.storage_key.startsWith(prefix) || !/^\d+$/.test(command.storage_key.slice(prefix.length)) ||
          typeof command.raw_value !== "string" || !command.raw_value.isWellFormed() || Buffer.byteLength(command.raw_value) > MAX_BYTES)
        fail("saved_work_recovery_invalid", "Preserve only a bounded original browser record for this exact subject.");
      return files.withLock(directory, () => {
        const entries = recoveries(directory);
        const recoveryId = hash(stable(command));
        if (!entries.some(item => item.recovery_id === recoveryId)) {
          if (entries.length >= 100) fail("saved_work_recovery_limit", "Browser originals are retained; review recovery storage before importing more.", 409);
          const entry = { recovery_id: recoveryId, storage_key: command.storage_key, content_digest: digest(command.raw_value), preserved_at: clock().toISOString() };
          files.write(path.join(directory, `recovery-${recoveryId}.json`), command);
          const next = [...entries, entry];
          files.write(path.join(directory, "recovery-index.json"), { entries: next, digest: digest(stable(next)) });
        }
        return this.read(identity);
      });
    },
    async save(identity, command) {
      exact(command, ["command_id", "expected_revision", "payload_json", "origin"]);
      if (typeof command.command_id !== "string" || !/^[A-Za-z0-9_.:-]{1,160}$/.test(command.command_id) ||
          !Number.isSafeInteger(command.expected_revision) || command.expected_revision < 0 || !["operator-edit", "browser-import"].includes(command.origin))
        fail("saved_work_input_invalid", "Use a save identity, current revision and explicit input origin.");
      const payload = payloadFor(identity.kind, identity.subjectId, command.payload_json);
      const { binding, directory, file } = location(identity);
      return files.withLock(directory, () => {
        const current = verified(file, binding);
        const commandDigest = digest(stable(command));
        if (current?.command_id === command.command_id) {
          if (current.command_digest !== commandDigest) fail("saved_work_replay_conflict", "This save identity already names different input.", 409);
          return this.read(identity);
        }
        if ((current?.revision ?? 0) !== command.expected_revision)
          fail("saved_work_revision_conflict", "Another session saved this work. Keep your local edits and reload or recover before replacing it.", 409);
        if (current && identity.kind === "work-design") {
          const prior = payloadFor(identity.kind, identity.subjectId, current.payload_json);
          for (const version of prior.briefVersions) {
            const retained = payload.briefVersions.find(item => item.briefVersionId === version.briefVersionId);
            if (!retained || stable(retained) !== stable(version)) fail("saved_work_finalized_immutable", "Finalized brief versions cannot be changed or removed by a draft save.", 409);
          }
        }
        const body = { schema_version: 1, binding, revision: (current?.revision ?? 0) + 1,
          saved_at: clock().toISOString(), content_digest: digest(command.payload_json), payload_json: command.payload_json,
          command_id: command.command_id, command_digest: commandDigest, origin: command.origin,
          acknowledgement_id: `saved-work:${hash(stable(binding))}:${commandDigest.slice(7)}` };
        // Previous complete record is retained before the atomic current-pointer
        // update. A crash never turns a partial write into an acknowledgement.
        if (current) files.write(path.join(directory, "previous.json"), current);
        files.write(file, { ...body, record_digest: digest(stable(body)) });
        return this.read(identity);
      });
    },
  };
}
