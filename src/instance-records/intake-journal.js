import { createHash } from "node:crypto";
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readdirSync } from "node:fs";
import path from "node:path";
import { HttpError } from "../errors.js";
import { intakeDigest } from "../workspace-intake/contracts.js";
import { createPrivateFileTransactions } from "../persistence/private-file-transactions.js";

const hash = value => createHash("sha256").update(value).digest("hex");
const fail = (code, message) => new HttpError(code === "state_busy" ? 409 : 503, `instance_intake_${code}`, message);

// One durable record per request, stored under its exact private target.
// The request locator is durable before the record, so a crash cannot hide an
// accepted request from target discovery. No cross-project journal scan.
export function createInstanceIntakeJournal({ root, instanceId }) {
  if (typeof instanceId !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(instanceId)) throw fail("identity_invalid", "The installation identity is not configured.");
  const requests = path.join(root, "requests"), targets = path.join(root, "targets");
  for (const directory of [requests, targets]) mkdirSync(directory, { recursive: true, mode: 0o700 });
  const files = createPrivateFileTransactions({ root, failure: fail });
  const identity = id => {
    if (typeof id !== "string" || !id.trim() || id.length > 256) throw fail("identity_invalid", "Use the original registration request identity.");
    return id;
  };
  const location = id => path.join(requests, `${hash(identity(id))}.json`);
  function targetIndex(record) {
    const body = { instance_id: instanceId, caller_id: record.caller_id, target: record.request.target,
      request_id: record.request.request_id, binding_digest: record.binding_digest };
    const directory = path.join(targets, intakeDigest({ instance_id: instanceId, caller_id: body.caller_id, target: body.target }).slice(7));
    return { directory, file: path.join(directory, `${hash(body.request_id)}.json`),
      value: { ...body, locator_digest: intakeDigest(body) } };
  }
  function ensureLocator(record) {
    const index = targetIndex(record), file = location(record.request.request_id);
    if (!existsSync(index.directory)) {
      mkdirSync(index.directory, { recursive: true, mode: 0o700 });
      const parent = openSync(targets, "r");
      try { fsyncSync(parent); } finally { closeSync(parent); }
    }
    if (existsSync(file)) {
      if (intakeDigest(files.read(file, "Registration locator", { maxBytes: 8192 })) !== intakeDigest(index.value)) {
        throw fail("state_corrupt", "The saved registration locator differs from its original request.");
      }
    } else files.write(file, index.value);
    return index.file;
  }
  function verified(value, id) {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw fail("state_corrupt", "Saved registration metadata is invalid.");
    const { record_digest, ...body } = value;
    if (value.schema_version !== 1 || value.authority_kind !== "internal-instance-record" ||
        value.request?.request_id !== id || value.request.instance_id !== instanceId ||
        value.request.target?.kind !== "repo" || value.request.target.record_id !== `repo:${value.request.target.name}` ||
        typeof value.caller_id !== "string" || !value.caller_id.trim() ||
        !value.evaluation || typeof value.evaluation !== "object" || Array.isArray(value.evaluation) ||
        value.binding_digest !== intakeDigest({ caller_id: value.caller_id, evaluation: value.evaluation }) ||
        intakeDigest(value.request) !== intakeDigest(value.evaluation?.request) || record_digest !== intakeDigest(body)) {
      throw fail("state_corrupt", "Saved registration failed its request, installation or integrity binding.");
    }
    return value;
  }
  function get(id) {
    const file = location(id);
    if (!existsSync(file)) return null;
    const locator = files.read(file, "Registration locator", { maxBytes: 8192 });
    if (!locator || locator.instance_id !== instanceId || locator.request_id !== id ||
        !locator.target || locator.target.kind !== "repo" || locator.target.record_id !== `repo:${locator.target.name}` ||
        typeof locator.caller_id !== "string" || !locator.caller_id.trim()) {
      throw fail("state_corrupt", "Saved registration locator is invalid.");
    }
    const { locator_digest, ...body } = locator;
    if (locator_digest !== intakeDigest(body)) throw fail("state_corrupt", "Saved registration locator failed its integrity binding.");
    const directory = path.join(targets, intakeDigest({ instance_id: instanceId, caller_id: locator.caller_id, target: locator.target }).slice(7));
    const targetFile = path.join(directory, `${hash(id)}.json`);
    if (!existsSync(targetFile)) throw fail("state_corrupt", "The saved registration record is missing; preserve its locator for recovery.");
    const record = verified(files.read(targetFile, "Saved registration", { maxBytes: 524288 }), id);
    if (intakeDigest(targetIndex(record).value) !== intakeDigest(locator)) throw fail("state_corrupt", "Saved registration differs from its original locator.");
    return structuredClone(record);
  }
  return {
    get,
    withRequestLock(id, operation) { return files.withLock(`registration-request:${identity(id)}`, operation); },
    list({ callerId, target }) {
      const directory = path.join(targets, intakeDigest({ instance_id: instanceId, caller_id: callerId, target }).slice(7));
      if (!existsSync(directory)) return [];
      const records = [];
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        if (!entry.isFile() || !/^[0-9a-f]{64}\.json$/.test(entry.name)) continue;
        const stored = files.read(path.join(directory, entry.name), "Saved registration", { maxBytes: 524288 });
        const record = verified(stored, stored?.request?.request_id);
        if (record.caller_id !== callerId || intakeDigest(record.request.target) !== intakeDigest(target) ||
            entry.name !== `${hash(identity(record.request.request_id))}.json`) {
          throw fail("state_corrupt", "Saved registration does not belong to this exact target.");
        }
        // Only a locator is derived here. The approved request and its progress
        // always come from the complete durable record, never a placeholder.
        ensureLocator(record);
        records.push(structuredClone(record));
      }
      return records;
    },
    transact(id, operation) {
      return files.withLock(`registration-request:${identity(id)}`, async () => {
        const current = get(id);
        return operation({ current, put(record) {
          if (record.request?.request_id !== id || current && record.binding_digest !== current.binding_digest) {
            throw new HttpError(409, "instance_intake_request_conflict", "The saved registration belongs to different accepted input.");
          }
          const { record_digest: _old, ...body } = record;
          const value = verified({ ...body, record_digest: intakeDigest(body) }, id);
          if (Buffer.byteLength(JSON.stringify(value)) > 524288) throw fail("state_oversized", "Registration metadata exceeds its private journal bound.");
          const file = ensureLocator(value);
          files.write(file, value);
          return structuredClone(value);
        } });
      });
    },
  };
}

// A missing installation setting cannot downgrade retained private requests to
// the old public-source route. Check only locator/target directory entries.
export function hasInstanceJournalState(root) {
  for (const name of ["requests", "targets"]) {
    try { if (readdirSync(path.join(root, name)).length) return true; }
    catch (error) { if (error.code !== "ENOENT") throw fail("state_unavailable", "Retained internal request state could not be inspected."); }
  }
  return false;
}
