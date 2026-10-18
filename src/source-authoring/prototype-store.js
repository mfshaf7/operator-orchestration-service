import { createHash } from "node:crypto";
import { mkdirSync, readdirSync } from "node:fs";
import path from "node:path";
import { canonicalDigest } from "../delivery-art/canonical-json.js";
import { createPrivateFileTransactions } from "../persistence/private-file-transactions.js";
import { PROTOTYPE_SOURCE_REQUEST_ID, prototypeAuthoringError, prototypeRequestDigest } from "./prototype-contracts.js";

const key = value => createHash("sha256").update(value).digest("hex");
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const MAX_METADATA_BYTES = 128 * 1024;
const MAX_ARTIFACT_BYTES = 2 * 1024 * 1024;

// Per-request coordination and content-addressed private artifacts use the
// existing broker transaction primitive. Listing never loads model drafts or
// historical source bytes into memory. This is not canonical Studio custody.
export function createPrototypeAuthoringStore({ root }) {
  const requests = path.join(root, "requests");
  const artifacts = path.join(root, "artifacts");
  for (const directory of [requests, artifacts]) mkdirSync(directory, { recursive: true, mode: 0o700 });
  const files = createPrivateFileTransactions({ root, failure: (code, message) => prototypeAuthoringError(code, message, code === "state_busy" ? 409 : 503) });
  function id(value) {
    if (typeof value !== "string" || !PROTOTYPE_SOURCE_REQUEST_ID.test(value) || value.length > 256) throw prototypeAuthoringError("request_id_invalid", "Actual Prototype source request identity is required.", 400);
    return value;
  }
  const requestPath = value => path.join(requests, `${key(id(value))}.json`);
  function verified(value, expectedId = value?.request?.request_id) {
    if (!value) return null;
    try {
      const { record_digest, ...body } = value;
      if (value.schema_version !== 1 || value.artifact_type !== "prototype-source-authoring-record" || value.request?.request_id !== expectedId ||
        typeof value.caller_id !== "string" || !value.caller_id || typeof value.operator_id !== "string" || !value.operator_id ||
        typeof value.state !== "string" || typeof value.created_at !== "string" || !Number.isFinite(Date.parse(value.created_at)) ||
        typeof value.updated_at !== "string" || !Number.isFinite(Date.parse(value.updated_at)) ||
        !DIGEST.test(record_digest ?? "") || canonicalDigest(body) !== record_digest ||
        prototypeRequestDigest({ callerId: value.caller_id, operatorId: value.operator_id, request: value.request }) !== value.request_digest ||
        !value.binding || canonicalDigest(value.binding) !== value.binding_digest) throw new Error("Invalid retained metadata");
      return value;
    } catch {
      throw prototypeAuthoringError("state_corrupt", "Retained Prototype source metadata failed integrity validation.", 503);
    }
  }
  return {
    withActionLock(sessionId, operation) {
      if (!/^prototype-source-session:[0-9a-f]{64}$/.test(sessionId ?? "")) throw prototypeAuthoringError("source_session_invalid", "An actual Prototype session is required for source action coordination.", 400);
      return files.withLock(`prototype-source-actions:${sessionId}`, operation);
    },
    get(requestId) { return verified(files.read(requestPath(requestId), "Prototype source metadata", { maxBytes: MAX_METADATA_BYTES }), requestId); },
    async transact(requestId, operation) {
      id(requestId);
      return files.withLock(`prototype-source:${requestId}`, async () => {
        const current = verified(files.read(requestPath(requestId), "Prototype source metadata", { maxBytes: MAX_METADATA_BYTES }), requestId);
        return operation({ current, put(value) {
          if (value.request?.request_id !== requestId || value.schema_version !== 1 || value.artifact_type !== "prototype-source-authoring-record" ||
              (current && ["request_digest", "binding_digest", "caller_id", "operator_id"].some(field => current[field] !== value[field]))) {
            throw prototypeAuthoringError("request_conflict", "Prototype request identity and approved canonical binding are immutable.");
          }
          const { record_digest: _prior, ...body } = value;
          const stored = { ...body, record_digest: canonicalDigest(body) };
          verified(stored, requestId);
          if (Buffer.byteLength(JSON.stringify(stored)) > MAX_METADATA_BYTES) throw prototypeAuthoringError("metadata_oversized", "Store source drafts in private artifacts, not the metadata register.", 400);
          files.write(requestPath(requestId), stored);
          return stored;
        } });
      });
    },
    list({ callerId, limit = 100 }) {
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) throw prototypeAuthoringError("limit_invalid", "Source request list limit must be between 1 and 200.", 400);
      const values = [];
      for (const entry of readdirSync(requests, { withFileTypes: true })) {
        if (!entry.isFile() || !/^[0-9a-f]{64}\.json$/.test(entry.name)) continue;
        const record = verified(files.read(path.join(requests, entry.name), "Prototype source metadata", { maxBytes: MAX_METADATA_BYTES }));
        if (entry.name !== `${key(id(record.request.request_id))}.json`) throw prototypeAuthoringError("state_corrupt", "Prototype source metadata path does not match its request.", 503);
        if (record.caller_id !== callerId) continue;
        values.push(record); values.sort((a, b) => b.created_at.localeCompare(a.created_at));
        if (values.length > limit) values.pop();
      }
      return values;
    },
    writeArtifact(requestId, value) {
      id(requestId);
      if (Buffer.byteLength(JSON.stringify(value)) > MAX_ARTIFACT_BYTES) throw prototypeAuthoringError("artifact_oversized", "Source payload exceeds the bounded private artifact limit.", 400);
      const digest = canonicalDigest(value); const directory = path.join(artifacts, key(requestId));
      mkdirSync(directory, { recursive: true, mode: 0o700 });
      const target = path.join(directory, `${digest.slice(7)}.json`);
      files.write(target, value);
      return { request_id: requestId, digest };
    },
    readArtifact(reference) {
      id(reference?.request_id);
      if (!DIGEST.test(reference?.digest ?? "")) throw prototypeAuthoringError("artifact_ref_invalid", "Source artifact requires its exact digest.", 400);
      const value = files.read(path.join(artifacts, key(reference.request_id), `${reference.digest.slice(7)}.json`), "Prototype source artifact", { maxBytes: MAX_ARTIFACT_BYTES });
      if (!value || canonicalDigest(value) !== reference.digest) throw prototypeAuthoringError("artifact_corrupt", "Private source artifact is missing or changed.", 503);
      return value;
    },
  };
}
