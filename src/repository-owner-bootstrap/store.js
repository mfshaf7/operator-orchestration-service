import { createHash } from "node:crypto";
import { mkdirSync, readdirSync } from "node:fs";
import path from "node:path";
import { canonicalDigest } from "../delivery-art/canonical-json.js";
import { HttpError } from "../errors.js";
import { createPrivateFileTransactions } from "../persistence/private-file-transactions.js";

const ID = /^[A-Za-z0-9][A-Za-z0-9._:/@+\-]{0,255}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const key = value => createHash("sha256").update(value).digest("hex");
const failure = (code, message) => new HttpError(code === "state_busy" ? 409 : 503, `repository_owner_bootstrap_${code}`, message);

export function createRepositoryOwnerBootstrapStore({ root }) {
  const requests = path.join(root, "requests"), artifacts = path.join(root, "artifacts");
  for (const directory of [requests, artifacts]) mkdirSync(directory, { recursive: true, mode: 0o700 });
  const files = createPrivateFileTransactions({ root, failure });
  function requestId(value) {
    if (typeof value !== "string" || !ID.test(value)) throw failure("request_invalid", "Bootstrap requires its exact retained request identity.");
    return value;
  }
  const requestPath = value => path.join(requests, `${key(requestId(value))}.json`);
  function verified(value, expectedId = value?.request?.request_id) {
    if (!value) return null;
    const { record_digest: digest, ...body } = value;
    if (value.schema_version !== 1 || value.artifact_type !== "repository-owner-bootstrap-record" || value.request?.request_id !== expectedId ||
        !ID.test(value.caller_id ?? "") || !ID.test(value.operator_id ?? "") || !Number.isFinite(Date.parse(value.updated_at)) ||
        !Number.isFinite(Date.parse(value.created_at)) || !["prepared", "existing-controls-inspected", "source-work", "source-created", "succeeded", "cancelled"].includes(value.state) ||
        !DIGEST.test(digest ?? "") || canonicalDigest(body) !== digest || canonicalDigest(value.binding) !== value.binding_digest ||
        canonicalDigest({ caller_id: value.caller_id, operator_id: value.operator_id, request: value.request }) !== value.request_digest) {
      throw failure("state_corrupt", "Bootstrap metadata failed its immutable request and binding integrity checks.");
    }
    return value;
  }
  function* scan() {
    for (const entry of readdirSync(requests, { withFileTypes: true })) {
      if (!entry.isFile() || !/^[0-9a-f]{64}\.json$/.test(entry.name)) continue;
      const record = verified(files.read(path.join(requests, entry.name), "Bootstrap metadata", { maxBytes: 131_072 }));
      if (entry.name !== `${key(requestId(record.request.request_id))}.json`) throw failure("state_corrupt", "Bootstrap metadata path differs from its identity.");
      yield record;
    }
  }
  return {
    latestCompletedForOwner(ownerRepo, providerRepository) {
      let latest = null;
      for (const record of scan()) {
        if (record.state !== "succeeded" || record.binding.owner_repo !== ownerRepo ||
            canonicalDigest(record.binding.provider_repository) !== canonicalDigest(providerRepository)) continue;
        if (!latest || record.updated_at > latest.updated_at) latest = record;
      }
      return latest;
    },
    withOwnerLock(ownerRepo, operation) {
      if (!/^[a-z0-9][a-z0-9._-]*$/.test(ownerRepo ?? "")) throw failure("owner_invalid", "Select the exact proposed owner.");
      return files.withLock(`bootstrap-owner:${ownerRepo}`, operation);
    },
    withActionLock(id, operation) { return files.withLock(`bootstrap-source-action:${requestId(id)}`, operation); },
    get(id) { return verified(files.read(requestPath(id), "Bootstrap metadata", { maxBytes: 131_072 }), id); },
    transact(id, operation) {
      return files.withLock(`bootstrap-request:${requestId(id)}`, () => {
        const current = verified(files.read(requestPath(id), "Bootstrap metadata", { maxBytes: 131_072 }), id);
        return operation({ current, put(value) {
          if (value.request?.request_id !== id || (current && ["request_digest", "binding_digest", "caller_id", "operator_id"].some(field => value[field] !== current[field]))) {
            throw failure("request_conflict", "Bootstrap request identity and canonical binding cannot be replaced.");
          }
          const { record_digest: _old, ...body } = value;
          const stored = verified({ ...body, record_digest: canonicalDigest(body) }, id);
          if (Buffer.byteLength(JSON.stringify(stored)) > 131_072) throw failure("metadata_oversized", "Retain bootstrap source bytes in private artifacts, not metadata.");
          files.write(requestPath(id), stored); return stored;
        } });
      });
    },
    pendingForOwner(ownerRepo) {
      let pending = null;
      for (const record of scan()) {
        if (record.binding.owner_repo !== ownerRepo || ["succeeded", "cancelled"].includes(record.state)) continue;
        if (pending) throw failure("state_corrupt", "More than one pending bootstrap request claims this owner.");
        pending = record;
      }
      return pending;
    },
    list({ callerId, ownerRepo = null, limit = 25 } = {}) {
      if (!ID.test(callerId ?? "") || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw failure("list_invalid", "Bootstrap listing requires a caller and bounded page size.");
      const records = [];
      for (const record of scan()) {
        if (record.caller_id !== callerId || (ownerRepo !== null && record.binding.owner_repo !== ownerRepo)) continue;
        records.push(record);
        records.sort((a, b) => b.created_at.localeCompare(a.created_at) || a.request.request_id.localeCompare(b.request.request_id));
        if (records.length > limit) records.pop();
      }
      return records;
    },
    writeArtifact(id, value) {
      const digest = canonicalDigest(value), directory = path.join(artifacts, key(requestId(id)));
      if (Buffer.byteLength(JSON.stringify(value)) > 1_048_576) throw failure("artifact_oversized", "Bootstrap source exceeds its finite private artifact bound.");
      mkdirSync(directory, { recursive: true, mode: 0o700 }); files.write(path.join(directory, `${digest.slice(7)}.json`), value);
      return { request_id: id, digest };
    },
    readArtifact(ref) {
      requestId(ref?.request_id);
      if (!DIGEST.test(ref?.digest ?? "")) throw failure("artifact_invalid", "Bootstrap artifact requires its exact retained digest.");
      const value = files.read(path.join(artifacts, key(ref.request_id), `${ref.digest.slice(7)}.json`), "Bootstrap source artifact", { maxBytes: 1_048_576 });
      if (!value || canonicalDigest(value) !== ref.digest) throw failure("artifact_corrupt", "Bootstrap source artifact is missing or changed.");
      return value;
    },
  };
}
