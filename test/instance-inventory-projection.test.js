import assert from "node:assert/strict";
import test from "node:test";
import { createInstanceInventoryProjection } from "../src/instance-records/inventory-projection.js";
import { nativeResult, nativeInventoryResult, instanceId, target, at } from "../test-fixtures/instance-records.js";
import { intakeDigest } from "../src/workspace-intake/contracts.js";
const counts = { intake: { "out-of-scope": 0, proposed: 0, admitted: 1 }, inventory: { active: 1, suspended: 0, retired: 0 } };

test("Private registry projection preserves native namespace, real lineage and the reviewed source-only candidate defaults", async () => {
  const intake = nativeResult(); intake.record.status = "admitted";
  intake.receipt.record_digest = intakeDigest(intake.record); intake.receipt.receipt_digest = intakeDigest(intake.receipt, "receipt_digest");
  const inventory = nativeInventoryResult();
  const reader = { catalog: async options => ({ authority: { kind: "internal-instance-record", instance_id: instanceId },
    counts, records: options.scope === "eligible" ? [intake] : [inventory], selection: { query: options.query, scope: options.scope }, next_after: null }) };
  const project = createInstanceInventoryProjection({ reader, clock: () => new Date(at) });
  const eligible = await project({ input: { scope: "eligible" } });
  const candidate = eligible.eligible_promotions[0];
  assert.equal(candidate.canonical_authority.instance_id, instanceId);
  assert.equal(candidate.intake_entry_ref.digest, intake.receipt.record_digest);
  assert.deepEqual(candidate.active_record.value.owns, [intake.record.notes]);
  assert.deepEqual(candidate.approval_refs, [intake.record.record.decision.ref, intake.record.record.decision.id]);
  assert.equal(candidate.candidate_digest, intakeDigest(candidate, "candidate_digest"));
  const page = await project();
  assert.equal(page.records[0].id, target.record_id);
  assert.equal(page.records[0].version, inventory.receipt.version);
  assert.equal(page.records[0].lineage.source_digest, inventory.record.record.lineage.source_digest);
  assert.equal(page.projection_digest, intakeDigest(page, "projection_digest"));
  assert.equal(page.canonical_authority, undefined);
  assert.equal(page.authority.kind, "internal-instance-record");
  await assert.rejects(project({ input: { scope: "all" } }), { statusCode: 400 });
});
