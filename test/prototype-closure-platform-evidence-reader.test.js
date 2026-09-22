import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { canonicalDigest } from "../src/delivery-art/canonical-json.js";
import { createPrototypeClosurePlatformEvidenceReader } from
  "../src/prototype-closure/platform-evidence-reader.js";

function boundRecord(content) {
  const digest = canonicalDigest(content);
  return { ...content, ref: `platform://prototype-closure/evidence/${digest.slice(7)}`, digest };
}

test("Platform evidence reader resolves owner proof and post-merge disposition", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "oos-platform-evidence-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const evidenceFile = path.join(root, "platform-evidence.json");
  const revision = "a".repeat(40);
  const proof = boundRecord({
    field: "runtime_disposition_proof_ref",
    owner_ref: "platform-engineering",
    state: "accepted",
    subject_ref: "plan://runtime/sample-tool",
    source_revision: revision,
    source_packet_ref: null,
    prototype_id: "sample-tool",
  });
  const disposition = boundRecord({
    field: "post_merge_runtime_disposition",
    owner_ref: "platform-engineering",
    state: "accepted",
    disposition: "absent",
    prototype_id: "sample-tool",
    merged_source_revision: revision,
  });
  await writeFile(evidenceFile, JSON.stringify({ schema_version: 1, records: [proof, disposition] }), { mode: 0o600 });
  const reader = createPrototypeClosurePlatformEvidenceReader({ evidenceFile });
  const observed = await reader.read({
    field: proof.field, owner_ref: proof.owner_ref, prototype_id: proof.prototype_id,
    subject_ref: proof.subject_ref, source_revision: revision,
  });
  assert.equal(observed.ref, proof.ref);
  assert.deepEqual(await reader.readDisposition({
    request: { prototype_id: "sample-tool" }, readback: { merged_source_revision: revision },
  }), {
    owner_ref: "platform-engineering", state: "accepted", disposition: "absent",
    prototype_id: "sample-tool", merged_source_revision: revision,
    ref: disposition.ref, digest: disposition.digest,
  });
});

test("Platform evidence reader rejects tampering and ambiguous proof", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "oos-platform-evidence-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const evidenceFile = path.join(root, "platform-evidence.json");
  const record = boundRecord({
    field: "runtime_disposition_proof_ref", owner_ref: "platform-engineering",
    state: "accepted", subject_ref: "plan://runtime/sample-tool",
    source_revision: "a".repeat(40), source_packet_ref: null, prototype_id: "sample-tool",
  });
  await writeFile(evidenceFile, JSON.stringify({ schema_version: 1, records: [{ ...record, prototype_id: "changed" }] }));
  const reader = createPrototypeClosurePlatformEvidenceReader({ evidenceFile });
  await assert.rejects(reader.read({
    field: record.field, owner_ref: record.owner_ref,
    prototype_id: "sample-tool", subject_ref: record.subject_ref,
  }), { code: "prototype_closure_platform_evidence_invalid" });
});
