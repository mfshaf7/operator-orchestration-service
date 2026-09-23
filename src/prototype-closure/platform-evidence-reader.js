import { lstat, readFile } from "node:fs/promises";

import { canonicalDigest } from "../delivery-art/canonical-json.js";
import { closureError } from "./contracts.js";

const DIGEST = /^sha256:[0-9a-f]{64}$/;
const REF = /^[a-z][a-z0-9+.-]*:\/\/[A-Za-z0-9][A-Za-z0-9._~:/%+=-]*$/;
const REVISION = /^[0-9a-f]{40}$/;
const OWNER_FIELDS = new Set([
  "runtime_disposition_plan_ref",
  "runtime_disposition_proof_ref",
]);

function digestRecord(record) {
  const { digest: _digest, ref: _ref, ...content } = record;
  return canonicalDigest(content);
}

function validateRecord(record) {
  if (!record || Object.getPrototypeOf(record) !== Object.prototype ||
      typeof record.field !== "string" || typeof record.ref !== "string" ||
      !REF.test(record.ref) || !DIGEST.test(record.digest ?? "") ||
      record.digest !== digestRecord(record) || !record.ref.endsWith(record.digest.slice(7)) ||
      record.owner_ref !== "platform-engineering" || record.state !== "accepted" ||
      typeof record.prototype_id !== "string" || !record.prototype_id ||
      (record.source_revision != null && !REVISION.test(record.source_revision)) ||
      (record.merged_source_revision != null && !REVISION.test(record.merged_source_revision))) {
    throw closureError("platform_evidence_invalid", "Platform Closure evidence is invalid.", 503);
  }
  return record;
}

export function createPrototypeClosurePlatformEvidenceReader({ evidenceFile }) {
  if (typeof evidenceFile !== "string" || !evidenceFile.trim()) {
    throw closureError("platform_reader_missing", "Closure requires a Platform evidence file.", 503);
  }

  async function records() {
    let info;
    let source;
    try {
      info = await lstat(evidenceFile);
      if (!info.isFile() || info.isSymbolicLink() || info.size > 262144) throw new Error("unsafe evidence file");
      source = await readFile(evidenceFile, "utf8");
    } catch {
      throw closureError("platform_evidence_unavailable", "Platform Closure evidence is unavailable.", 503);
    }
    let value;
    try { value = JSON.parse(source); } catch {
      throw closureError("platform_evidence_invalid", "Platform Closure evidence is invalid.", 503);
    }
    if (value?.schema_version !== 1 || !Array.isArray(value.records) || value.records.length > 256) {
      throw closureError("platform_evidence_invalid", "Platform Closure evidence is invalid.", 503);
    }
    return value.records.map(validateRecord);
  }

  return {
    async read(input) {
      if (!OWNER_FIELDS.has(input?.field) || input.owner_ref !== "platform-engineering") {
        throw closureError("platform_lookup_invalid", "Platform Closure evidence lookup is invalid.", 400);
      }
      const matches = (await records()).filter((record) =>
        record.field === input.field &&
        record.prototype_id === input.prototype_id &&
        (input.ref == null || record.ref === input.ref) &&
        (input.subject_ref == null || record.subject_ref === input.subject_ref) &&
        (input.source_revision == null || record.source_revision === input.source_revision));
      if (matches.length !== 1) {
        throw closureError("platform_evidence_unavailable", "Expected one current Platform Closure proof.", 503);
      }
      const record = matches[0];
      return {
        ref: record.ref,
        owner_ref: record.owner_ref,
        digest: record.digest,
        state: record.state,
        subject_ref: record.subject_ref ?? null,
        source_revision: record.source_revision ?? null,
        source_packet_ref: record.source_packet_ref ?? null,
        prototype_id: record.prototype_id,
      };
    },

    async readDisposition({ request, readback }) {
      const matches = (await records()).filter((record) =>
        record.field === "post_merge_runtime_disposition" &&
        record.prototype_id === request?.prototype_id &&
        record.merged_source_revision === readback?.merged_source_revision);
      if (matches.length !== 1 || !["revoked", "absent"].includes(matches[0].disposition)) {
        throw closureError("platform_evidence_unavailable", "Expected one current Platform runtime disposition.", 503);
      }
      const record = matches[0];
      return {
        owner_ref: record.owner_ref,
        state: record.state,
        disposition: record.disposition,
        prototype_id: record.prototype_id,
        merged_source_revision: record.merged_source_revision,
        ref: record.ref,
        digest: record.digest,
      };
    },
  };
}
