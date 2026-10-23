import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { canonicalDigest } from "../src/delivery-art/canonical-json.js";
import { createPrototypeClosurePlatformEvidenceReader } from
  "../src/prototype-closure/platform-evidence-reader.js";
import { createPlatformOperationProviderClient } from "../src/platform-operation/provider-client.js";

function boundRecord(content) {
  const digest = canonicalDigest(content);
  return { ...content, ref: `platform://prototype-closure/evidence/${digest.slice(7)}`, digest };
}

test("normal Platform client and Closure reader bind an authenticated exact-event absence lookup", async () => {
  const revision = "a".repeat(40);
  const lookup = { prototype_id: "sample-tool", merged_source_revision: revision,
    source_event_ref: "prototype-closure:sample-tool:0002" };
  const proof = boundRecord({ field: "post_merge_runtime_disposition",
    owner_ref: "platform-engineering", state: "accepted", disposition: "absent",
    prototype_id: lookup.prototype_id, merged_source_revision: revision });
  let calls = 0;
  const provider = createPlatformOperationProviderClient({
    baseUrl: "http://127.0.0.1:38491", allowHttp: true, callerId: "oos", callerSecret: "s".repeat(32),
    async fetchImpl(url, init) {
      calls++;
      assert.equal(String(url), "http://127.0.0.1:38491/v1/console-operations/prototype-closure-dispositions");
      assert.equal(init.method, "POST");
      assert.equal(init.redirect, "error");
      assert.equal(init.headers["x-platform-caller-id"], "oos");
      assert.equal(init.headers["x-platform-caller-secret"], "s".repeat(32));
      assert.deepEqual(JSON.parse(init.body), lookup);
      return Response.json(proof);
    },
  });
  const reader = createPrototypeClosurePlatformEvidenceReader({
    evidenceFile: "/not-read/provider-required.json", dispositionProvider: provider });
  const result = await reader.readDisposition({ request: { prototype_id: "sample-tool" },
    readback: { merged_source_revision: revision, source_event_ref: lookup.source_event_ref } });
  assert.equal(calls, 1);
  assert.equal(result.ref, proof.ref);
  assert.equal(result.disposition, "absent");
  proof.disposition = "revoked";
  await assert.rejects(reader.readDisposition({ request: { prototype_id: "sample-tool" },
    readback: { merged_source_revision: revision, source_event_ref: lookup.source_event_ref } }),
    { code: "prototype_closure_platform_evidence_invalid" });
});

test("commissioned owner lookup cannot fall back to historical file proof after a dependency error", async () => {
  const reader = createPrototypeClosurePlatformEvidenceReader({
    evidenceFile: "/not-read/no-fallback.json",
    dispositionProvider: { async readPrototypeClosureDisposition() { throw new Error("owner unavailable"); } },
  });
  await assert.rejects(reader.readDisposition({ request: { prototype_id: "sample-tool" },
    readback: { merged_source_revision: "a".repeat(40), source_event_ref: "prototype-closure:sample-tool:0002" } }),
    /owner unavailable/);
});

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
