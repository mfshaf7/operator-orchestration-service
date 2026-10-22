import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { artifactContentDigest } from "../src/delivery-art/contracts.js";
import { createPrototypeClosureDurableOwnerReader } from "../src/prototype-closure/durable-owner-reader.js";
import { createPrototypeClosureOwnerReadbackService } from "../src/prototype-closure/owner-readback-service.js";
import { createPrototypeClosureOwnerEvidenceReader } from "../src/prototype-closure/owner-evidence.js";

function fixture(change = () => {}) {
  const provider = { provider: "github", provider_repository_id: "123456789", full_name: "sample-org/sample-app" };
  const sourceRevision = "b".repeat(40), approvedRevision = "c".repeat(40), merge = "d".repeat(40);
  const packetRef = "record://delivery-packets/sample-tool-accepted";
  const receiptRef = `oos://receipts/prototype-delivery-application/${"e".repeat(64)}`;
  const file = { source_path: "prototypes/sample-tool/app.mjs", git_mode: "100644", git_blob: "a".repeat(40),
    size: 15, sha256: `sha256:${createHash("sha256").update("approved bytes\n").digest("hex")}` };
  const manifest = { schema_version: 1, artifact_type: "prototype-source-import-manifest", prototype_id: "sample-tool",
    owner_repo: "sample-app", provider_repository: provider, delivery_target_ref: "openproject://work_packages/900",
    delivery_packet_ref: packetRef, accepted_delivery_target_receipt_ref: receiptRef,
    prototype_source_revision: approvedRevision, requested_custody: "dedicated-owner-repo", transfer_strategy: "transfer",
    file_mappings: [{ source_path: file.source_path, owner_path: "app/app.mjs", sha256: file.sha256 }] };
  const review = JSON.parse(readFileSync(new URL("../contracts/delivery-art/fixtures/review-packet-finalized.valid.json", import.meta.url)));
  review.delivery_id = "delivery-900";
  review.operator = { id: "operator:reviewer", decision_source: "operator" };
  review.landing_unit.repos = [{ repo_name: "sample-app", base_commit: "f".repeat(40), head_commit: "1".repeat(40),
    merge_commit: merge, pr_url: `https://github.com/${provider.full_name}/pull/2`,
    changed_files: ["records/prototype-source-imports/sample-tool.json", "app/app.mjs"] }];
  const accepted = { receipt: { receipt_ref: receiptRef, custody: { state: "durable" } },
    source: { prototype_id: "sample-tool", packet_ref: packetRef, packet_digest: `sha256:${"2".repeat(64)}` },
    target: { record_ref: manifest.delivery_target_ref, record_project: "workspace-delivery-art" },
    readiness: { outcome: "allow" }, operator_decision: { decision: "apply" } };
  const studio = { prototype_id: "sample-tool", source_revision: sourceRevision, prototype_source_revision: approvedRevision,
    source_packet_ref: packetRef, packet_digest: accepted.source.packet_digest, files: [file] };
  const selected = { owner_repo: "sample-app", repository: { full_name: provider.full_name, id: Number(provider.provider_repository_id) },
    inventory_revision: "3".repeat(40), inventory_digest: `sha256:${"4".repeat(64)}` };
  const state = { review, manifest, accepted, studio, selected, target: { git_blob: file.git_blob, git_mode: file.git_mode, size: file.size },
    checked: [], publicRecheck: true, changeAdmission: false };
  change(state);
  review.integrity.content_digest = artifactContentDigest(review);
  review.custody.uri = `wgcf://artifacts/delivery-art/sha256/${review.integrity.content_digest.slice(7)}`;
  const lookup = { field: "durable_owner_acceptance_ref", ref: review.custody.uri, owner_ref: "sample-app",
    prototype_id: "sample-tool", source_revision: sourceRevision, source_packet_ref: packetRef,
    accepted_delivery_target_receipt_ref: receiptRef, subject_ref: `repo://${provider.full_name}`,
    operator_id: "console-caller", durable_owner_acceptance_ref: review.custody.uri };
  let reads = 0;
  const reader = createPrototypeClosureDurableOwnerReader({
    callerOperatorBindings: { "console-caller": "operator:reviewer" },
    repositoryReader: async input => {
      assert.deepEqual(input, { ownerRepo: "sample-app", legacyRepository: null });
      reads++;
      return { ...selected, inventory_revision: state.changeAdmission && reads > 1 ? "5".repeat(40) : selected.inventory_revision };
    },
    artifactService: { async resolveArtifact({ reference }) {
      assert.deepEqual(reference, { uri: review.custody.uri, digest: review.integrity.content_digest });
      state.checked.push("native-artifact"); return { artifact: review };
    } },
    publicSourceReader: { async inspectPrototypeImport({ providerRepository, mergeCommit, prototypeId, validateManifest }) {
      assert.deepEqual(providerRepository, provider); assert.equal(mergeCommit, merge); assert.equal(prototypeId, "sample-tool");
      validateManifest(manifest); state.checked.push("public-canonical-merge");
      return { manifest, metadata_digest: `sha256:${"6".repeat(64)}`, regularFile(target) {
        assert.ok(manifest.file_mappings.some(row => row.owner_path === target)); return state.target;
      }, async recheckCurrent() { assert.equal(state.publicRecheck, true); state.checked.push("public-main-rechecked"); } };
    } },
    deliveryApplicationService: { async readAcceptedReceipt(input) {
      assert.deepEqual(input, { prototypeId: "sample-tool", packetRef, receiptRef, targetRef: "openproject://work_packages/900" });
      state.checked.push("accepted-delivery"); return accepted;
    } },
    studioSourceClient: { async readImportSource(input) {
      assert.deepEqual(input, { prototypeId: "sample-tool", sourceRevision, packetRef,
        packetDigest: accepted.source.packet_digest, prototypeSourceRevision: approvedRevision });
      state.checked.push("studio-complete-byte-mapping"); return studio;
    } },
  });
  return { reader, lookup, state };
}

test("native finalized source packet independently proves owner acceptance and transfer, without a new receipt", async () => {
  const h = fixture();
  const acceptance = await h.reader.read(h.lookup);
  const transfer = await h.reader.read({ ...h.lookup, field: "source_transfer_receipt_ref", ref: undefined });
  assert.equal(acceptance.ref, h.lookup.ref);
  assert.equal(transfer.ref, h.lookup.ref);
  assert.notEqual(acceptance.digest, transfer.digest);
  assert.equal(transfer.observed_source_custody, "dedicated-owner-repo");
  assert.deepEqual(h.state.checked.slice(0, 5), ["native-artifact", "public-canonical-merge", "accepted-delivery",
    "studio-complete-byte-mapping", "public-main-rechecked"]);
  assert.deepEqual(await h.reader.read(h.lookup), acceptance, "No new receipt, timestamp or future SHA is generated on replay");
});

test("already-owned has its own checked strategy, and transfer is denied for that import", async () => {
  const h = fixture(state => { state.manifest.transfer_strategy = "already-owned"; state.manifest.requested_custody = "shared-owner-repo"; });
  assert.equal((await h.reader.read({ ...h.lookup, field: "already_owned_source_proof_ref" })).observed_source_custody, "shared-owner-repo");
  await assert.rejects(h.reader.read({ ...h.lookup, field: "source_transfer_receipt_ref" }));
});

test("finalized custody, exact reviewed owner/operator/Delivery and source-import coverage are mandatory", async () => {
  for (const mutate of [
    s => { s.review.status = "merge-ready"; }, s => { s.review.custody.state = "local"; },
    s => { s.review.custody.backend = "caller"; }, s => { s.review.operator.id = "operator:another"; },
    s => { s.review.operator.decision_source = "ai-suggested"; }, s => { s.review.delivery_id = "delivery-901"; },
    s => { s.review.landing_unit.evidence_kind = "open_pr"; },
    s => { s.review.landing_unit.repos[0].merge_commit = null; },
    s => { s.review.landing_unit.repos[0].changed_files = ["unrelated.md"]; },
    s => { s.review.landing_unit.repos[0].pr_url = "https://github.com/foreign-org/sample-app/pull/2"; },
    s => { s.review.landing_unit.repos.push({ ...s.review.landing_unit.repos[0] }); },
    s => { s.manifest.owner_repo = "other-app"; }, s => { s.manifest.prototype_id = "other-tool"; },
    s => { s.manifest.provider_repository = { ...s.manifest.provider_repository, provider_repository_id: "999" }; },
    s => { s.manifest.accepted_delivery_target_receipt_ref = `oos://receipts/prototype-delivery-application/${"0".repeat(64)}`; },
    s => { s.manifest.file_mappings[0].sha256 = `sha256:${"0".repeat(64)}`; },
    s => { s.manifest.file_mappings[0].owner_path = "../outside"; },
    s => { s.manifest.file_mappings.push({ ...s.manifest.file_mappings[0] }); },
    s => { s.studio.files.push({ ...s.studio.files[0], source_path: "prototypes/sample-tool/omitted.mjs" }); },
    s => { s.target.git_blob = "0".repeat(40); }, s => { s.target.git_mode = "120000"; }, s => { s.target.size++; },
    s => { s.accepted.receipt.custody.state = "local"; }, s => { s.accepted.source.prototype_id = "another-tool"; },
    s => { s.accepted.readiness.outcome = "deny"; }, s => { s.accepted.operator_decision.decision = "deny"; },
    s => { s.publicRecheck = false; }, s => { s.changeAdmission = true; },
  ]) {
    const h = fixture(mutate);
    await assert.rejects(h.reader.read(h.lookup), undefined, mutate.toString());
  }
});

test("caller refs cannot masquerade as a packet and transfer discovery never scans other sessions", async () => {
  const h = fixture();
  for (const input of [
    { ...h.lookup, ref: "receipt://made-up/accepted" },
    { ...h.lookup, subject_ref: "repo://foreign-org/sample-app" },
    { ...h.lookup, operator_id: "unbound-caller" },
    { ...h.lookup, field: "source_transfer_receipt_ref", ref: undefined, durable_owner_acceptance_ref: undefined },
  ]) await assert.rejects(h.reader.read(input));
});

test("normal owner readback emits exactly eight wire fields and direct owner evidence retains verified custody", async () => {
  const h = fixture();
  const service = createPrototypeClosureOwnerReadbackService({ baselineReader: { read() {} }, deliveryReader: { read() {} },
    durableOwnerReader: h.reader });
  const wire = await service.read(h.lookup);
  assert.equal(Object.keys(wire).length, 8);
  assert.equal(Object.hasOwn(wire, "observed_source_custody"), false);
  const owners = Object.fromEntries(["workspace-prototype-studio", "workspace-delivery-art", "platform-engineering",
    "operator-orchestration-service"].map(owner => [owner, { read() { throw new Error("not the requested owner"); } }]));
  const dispatch = createPrototypeClosureOwnerEvidenceReader({ ...owners, "requested-owner": h.reader });
  const result = await dispatch({ field: h.lookup.field, ref: h.lookup.ref, ownerRef: "sample-app", request: {
    prototype_id: "sample-tool", expected_source_revision: h.lookup.source_revision, operator_id: "console-caller",
    durable_repo_ref: h.lookup.subject_ref, durable_owner_acceptance_ref: h.lookup.ref,
    accepted_delivery_target_receipt_ref: h.lookup.accepted_delivery_target_receipt_ref,
  }, source: { delivery_packet_ref: h.lookup.source_packet_ref } });
  assert.equal(result.observed_source_custody, "dedicated-owner-repo");
  await assert.rejects(dispatch({ field: "retention_plan_ref", ref: h.lookup.ref, ownerRef: "sample-app", request: {} }),
    { code: "prototype_closure_owner_reader_missing" });
});
