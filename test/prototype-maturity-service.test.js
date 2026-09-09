import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { createPrototypeMaturityService } from "../src/prototype-maturity/service.js";
import { createPrototypeMaturityStore } from "../src/prototype-maturity/store.js";
import {
  at,
  caller,
  commandFixture,
  readbackFixture,
  readinessFixture,
  revision,
  sourceResultFixture,
} from "../test-fixtures/prototype-maturity/fixture.js";

function harness(root, { readinessOutcome = "ready", failOpenOnce = false } = {}) {
  let openFailed = false;
  let review = {
    repository: "workspace-prototype-studio",
    number: 7,
    url: "https://example.invalid/pull/7",
    state: "open",
    branch: null,
    base_branch: "main",
    base_commit: revision,
    head_commit: "8".repeat(40),
    merged: false,
    merge_commit: null,
    human_reviewed: false,
  };
  const sourceClient = {
    branch: (record) => `prototype-maturity/${record.binding_digest.slice(7)}`,
    state: async (prototypeId, transition) => ({
      prototype_id: prototypeId,
      transition,
      authority_revision: revision,
      expected_state: commandFixture(transition).request.expected_state,
    }),
    async prepare(record) {
      const unchanged = !["promote-candidate", "approve-baseline"].includes(
        record.decision.decision,
      );
      const sourceResult = sourceResultFixture(
        record,
        unchanged ? "unchanged" : "prepared",
      );
      const preparation = {
        branch: this.branch(record),
        base_commit: revision,
        files: [],
        file_count: unchanged ? 0 : sourceResult.changed_paths.length,
        changed_paths: sourceResult.changed_paths,
        content_digest: `sha256:${"7".repeat(64)}`,
        source_result: sourceResult,
        readback: null,
      };
      if (unchanged) {
        preparation.readback = readbackFixture(
          { ...record, preparation },
          { merged: false },
        );
      }
      review.branch = preparation.branch;
      return preparation;
    },
    async openReview() {
      if (failOpenOnce && !openFailed) {
        openFailed = true;
        throw new Error("provider acknowledgement lost");
      }
      return structuredClone(review);
    },
    async observe(record) {
      if (!review.merged) return { review: structuredClone(review) };
      return {
        review: structuredClone(review),
        readback: readbackFixture(record),
      };
    },
    async cancel() {
      return null;
    },
  };
  const readinessClient = {
    evaluate: async (evaluation) =>
      readinessFixture(evaluation, readinessOutcome),
  };
  const service = createPrototypeMaturityService({
    store: createPrototypeMaturityStore({ root }),
    sourceClient,
    readinessClient,
    clock: () => new Date(at),
  });
  return {
    service,
    merge() {
      review = {
        ...review,
        state: "closed",
        merged: true,
        merge_commit: "9".repeat(40),
        human_reviewed: true,
      };
    },
  };
}

async function ready(service, input) {
  await service.submit({ callerId: caller, input });
  return service.advance({
    callerId: caller,
    requestId: input.request.request_id,
  });
}

test("candidate promotion persists decision, review wait, restart and receipt", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "prototype-maturity-service-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const input = commandFixture();
  const first = harness(root);
  const prepared = await first.service.prepare({
    callerId: caller,
    input: { prototype_id: input.request.prototype_id, transition: input.request.transition },
  });
  assert.equal(prepared.canonical_mutation, false);
  assert.equal((await ready(first.service, input)).status, "decision-required");
  assert.equal(
    (
      await first.service.decide({
        callerId: caller,
        requestId: input.request.request_id,
        input: { decision: "promote-candidate" },
      })
    ).status,
    "preparing",
  );
  const waiting = await first.service.advance({
    callerId: caller,
    requestId: input.request.request_id,
  });
  assert.equal(waiting.status, "review-required");
  assert.equal(JSON.stringify(waiting).includes("content_base64"), false);

  const restarted = harness(root);
  restarted.merge();
  const completed = await restarted.service.advance({
    callerId: caller,
    requestId: input.request.request_id,
  });
  assert.equal(completed.status, "succeeded");
  assert.equal(completed.canonical_mutation, true);
  assert.equal(completed.receipt.next_action.code, "baseline-promotion");
  assert.deepEqual(
    await restarted.service.advance({
      callerId: caller,
      requestId: input.request.request_id,
    }),
    completed,
  );
});

test("baseline approval uses its distinct command and next action", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "prototype-maturity-baseline-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const input = commandFixture("baseline-promotion", 2);
  const current = harness(root);
  await ready(current.service, input);
  await current.service.decide({
    callerId: caller,
    requestId: input.request.request_id,
    input: { decision: "approve-baseline" },
  });
  await current.service.advance({ callerId: caller, requestId: input.request.request_id });
  current.merge();
  const completed = await current.service.advance({ callerId: caller, requestId: input.request.request_id });
  assert.equal(completed.readback.observed_lifecycle, "baseline-approved");
  assert.equal(completed.receipt.next_action.code, "movement-request");
});

test("block and closeout decisions prove unchanged source and emit terminal receipts", async (t) => {
  for (const [sequence, decision, status] of [
    [3, "block-promotion", "blocked"],
    [4, "route-closeout", "routed-closeout"],
  ]) {
    const root = await mkdtemp(path.join(tmpdir(), `prototype-maturity-${status}-`));
    t.after(() => rm(root, { recursive: true, force: true }));
    const input = commandFixture("candidate-promotion", sequence);
    const current = harness(root);
    await ready(current.service, input);
    await current.service.decide({
      callerId: caller,
      requestId: input.request.request_id,
      input:
        decision === "block-promotion"
          ? {
              decision,
              blocker: {
                issue_ref: "openproject://work_packages/999",
                owner_ref: "workspace-prototype-studio",
                required_fix: "Resolve the visible evidence gap.",
              },
            }
          : { decision },
    });
    const completed = await current.service.advance({ callerId: caller, requestId: input.request.request_id });
    assert.equal(completed.status, status);
    assert.equal(completed.canonical_mutation, false);
    assert.equal(completed.readback.authority_state, "unchanged-authority");
    assert.equal(completed.review, null);
  }
});

test("blocked readiness, premature decisions and changed idempotency fail closed", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "prototype-maturity-blocked-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const input = commandFixture();
  const current = harness(root, { readinessOutcome: "blocked" });
  await current.service.submit({ callerId: caller, input });
  await assert.rejects(
    current.service.decide({ callerId: caller, requestId: input.request.request_id, input: { decision: "promote-candidate" } }),
    /requires current ready evidence/,
  );
  const blocked = await current.service.advance({ callerId: caller, requestId: input.request.request_id });
  assert.equal(blocked.status, "requires-action");
  assert.equal(blocked.decision, null);
  const changed = structuredClone(input);
  changed.execution_ref = "execution:changed";
  await assert.rejects(
    current.service.submit({ callerId: caller, input: changed }),
    /different maturity input/,
  );
});

test("lost publication acknowledgement resumes and cancellation preserves no receipt", async (t) => {
  const recoveryRoot = await mkdtemp(path.join(tmpdir(), "prototype-maturity-recovery-"));
  const cancelRoot = await mkdtemp(path.join(tmpdir(), "prototype-maturity-cancel-"));
  t.after(() => Promise.all([
    rm(recoveryRoot, { recursive: true, force: true }),
    rm(cancelRoot, { recursive: true, force: true }),
  ]));
  const input = commandFixture();
  const current = harness(recoveryRoot, { failOpenOnce: true });
  await ready(current.service, input);
  await current.service.decide({ callerId: caller, requestId: input.request.request_id, input: { decision: "promote-candidate" } });
  await assert.rejects(
    current.service.advance({ callerId: caller, requestId: input.request.request_id }),
    /last durable phase/,
  );
  const recovered = harness(recoveryRoot);
  assert.equal((await recovered.service.advance({ callerId: caller, requestId: input.request.request_id })).status, "review-required");

  const cancelInput = commandFixture("candidate-promotion", 5);
  const cancellation = harness(cancelRoot);
  await ready(cancellation.service, cancelInput);
  const cancelled = await cancellation.service.advance({ callerId: caller, requestId: cancelInput.request.request_id, action: "cancel" });
  assert.equal(cancelled.status, "cancelled");
  assert.equal(cancelled.receipt, null);
});
