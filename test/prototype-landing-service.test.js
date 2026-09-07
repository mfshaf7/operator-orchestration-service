import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { bindPrototypeLanding, createPrototypeLandingEvaluation, prototypeLandingReference } from "../src/prototype-landing/contracts.js";
import { createPrototypeLandingService } from "../src/prototype-landing/service.js";
import { createPrototypeLandingStore } from "../src/prototype-landing/store.js";
import { at, caller, commandFixture, preparationFixture, readinessFixture } from "../test-fixtures/prototype-landing/fixture.js";

function harness(root, outcome = "ready", options = {}) {
  let openFailed = false;
  let review = { repository: "workspace-prototype-studio", number: 7, url: "https://example.invalid/pull/7", state: "open", branch: null, base_branch: "main", base_commit: "1".repeat(40), head_commit: "9".repeat(40), merged: false, merge_commit: null, human_reviewed: false };
  const sourceClient = {
    branch: (record) => `prototype-landing/${record.binding_digest.slice(7)}`,
    state: async (prototypeId) => ({ prototype_id: prototypeId, authority_revision: "1".repeat(40), expected_state: commandFixture().request.expected_state }),
    async prepare(record) {
      const prepared = preparationFixture(record.evaluation, record.readiness.readiness, record.apply, this.branch(record));
      review.branch = prepared.branch;
      return prepared;
    },
    async openReview() {
      if (options.failOpenOnce && !openFailed) {
        openFailed = true;
        throw new Error("lost provider acknowledgement");
      }
      return structuredClone(review);
    },
    async observe(record) {
      review = { ...review, branch: review.branch ?? record.preparation.branch };
      if (!review.merged) return { review: structuredClone(review) };
      const readback = bindPrototypeLanding({ ...record.preparation.readback, authority_state: "merged-authority", source_branch: "main", source_revision: review.merge_commit }, "readback_digest");
      let receipt = bindPrototypeLanding({ ...record.preparation.receipt, phase: "merged-authority", outcome: "succeeded", readback_ref: prototypeLandingReference(readback), source_result: { ...record.preparation.receipt.source_result, branch: "main", revision: review.merge_commit }, next_action: { code: "candidate-promotion", owner_ref: "workspace-prototype-studio" } }, "receipt_digest");
      if (options.tamperMergedReceipt) {
        receipt = bindPrototypeLanding({ ...receipt, source_result: { ...receipt.source_result, revision: "b".repeat(40) } }, "receipt_digest");
      }
      return { review: structuredClone(review), readback, receipt };
    },
    async cancel() { return null; },
  };
  const readinessClient = { evaluate: async (evaluation) => readinessFixture(evaluation, outcome) };
  const service = createPrototypeLandingService({ store: createPrototypeLandingStore({ root }), sourceClient, readinessClient, clock: () => new Date(at) });
  return { service, merge() { review = { ...review, state: "closed", merged: true, merge_commit: "a".repeat(40), human_reviewed: true }; } };
}

test("Prototype Landing persists review wait, restart, merged readback and stable replay", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "prototype-landing-service-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const first = harness(root);
  const input = commandFixture();
  assert.equal((await first.service.prepare({ callerId: caller, input: { prototype_id: input.request.prototype.id } })).canonical_mutation, false);
  assert.equal((await first.service.submit({ callerId: caller, input })).status, "accepted");
  const waiting = await first.service.advance({ callerId: caller, requestId: input.request.request_id });
  assert.equal(waiting.status, "review-required");
  assert.equal(waiting.preparation.file_count, 8);
  assert.equal(JSON.stringify(waiting).includes("content_base64"), false);
  const restarted = harness(root);
  restarted.merge();
  const completed = await restarted.service.advance({ callerId: caller, requestId: input.request.request_id });
  assert.equal(completed.status, "succeeded");
  assert.equal(completed.canonical_mutation, true);
  assert.equal(completed.receipt.next_action.code, "candidate-promotion");
  assert.deepEqual(await restarted.service.advance({ callerId: caller, requestId: input.request.request_id }), completed);
});

test("blocked readiness is retained without apply or source mutation", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "prototype-landing-blocked-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const { service } = harness(root, "blocked");
  const input = commandFixture();
  await service.submit({ callerId: caller, input });
  const result = await service.advance({ callerId: caller, requestId: input.request.request_id });
  assert.equal(result.status, "requires-action");
  assert.equal(result.readiness.readiness.outcome, "blocked");
  assert.equal(result.apply, null);
  assert.equal(result.canonical_mutation, false);
});

test("same request and idempotency key cannot bind changed content", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "prototype-landing-conflict-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const { service } = harness(root);
  const input = commandFixture();
  await service.submit({ callerId: caller, input });
  const changed = structuredClone(input);
  changed.operator_approval_ref = "approval:different";
  await assert.rejects(service.submit({ callerId: caller, input: changed }), /different Landing input/);
  assert.equal(createPrototypeLandingEvaluation(input, caller).evaluation_id, "prototype-landing-evaluation:sample-tool:1");
});

test("lost provider acknowledgement retains preparation and resumes without another readiness decision", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "prototype-landing-recovery-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const input = commandFixture();
  const first = harness(root, "ready", { failOpenOnce: true });
  await first.service.submit({ callerId: caller, input });
  await assert.rejects(first.service.advance({ callerId: caller, requestId: input.request.request_id }), /last durable phase/);
  const retained = await first.service.project(input.request.request_id, { callerId: caller });
  assert.equal(retained.status, "preparing");
  assert.equal(retained.preparation.file_count, 8);
  const resumed = harness(root);
  const waiting = await resumed.service.advance({ callerId: caller, requestId: input.request.request_id });
  assert.equal(waiting.status, "review-required");
  assert.equal(waiting.history.filter((event) => event.status === "evaluating").length, 1);
});

test("schema-valid merged evidence cannot succeed with mismatched authority bindings", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "prototype-landing-merged-binding-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const input = commandFixture();
  const current = harness(root, "ready", { tamperMergedReceipt: true });
  await current.service.submit({ callerId: caller, input });
  await current.service.advance({ callerId: caller, requestId: input.request.request_id });
  current.merge();
  await assert.rejects(current.service.advance({ callerId: caller, requestId: input.request.request_id }), /Merged Prototype Studio authority/);
  const retained = await current.service.project(input.request.request_id, { callerId: caller });
  assert.equal(retained.status, "review-required");
  assert.equal(retained.canonical_mutation, false);
});
