import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { closureDigest, createClosureEvaluation } from "../src/prototype-closure/contracts.js";
import { createPrototypeClosureService } from "../src/prototype-closure/service.js";
import { createPrototypeClosureStore } from "../src/prototype-closure/store.js";

const at = "2026-09-13T12:00:00.000Z";
const caller = "operator:workspace-owner";
const revision = "a".repeat(40);
const mergeCommit = "b".repeat(40);
const eventTypes = {
  "apply-delivery": ["delivery-accepted", "graduating", "incubation-repo"],
  "graduate-source": ["source-graduated", "graduated", "dedicated-owner-repo"],
  "retire-incubation": ["incubation-retired", "retired", "incubation-repo"],
  "reopen-incubation": ["incubation-reopened", "exploring", "incubation-repo"],
};
const evidenceFields = {
  "apply-delivery": ["accepted_baseline_receipt_ref", "accepted_delivery_target_receipt_ref", "target_delivery_ref"],
  "graduate-source": ["accepted_delivery_target_receipt_ref", "durable_owner_acceptance_ref", "source_transfer_receipt_ref"],
  "retire-incubation": ["retention_plan_ref", "runtime_disposition_plan_ref", "runtime_disposition_proof_ref"],
  "reopen-incubation": ["prior_retirement_receipt_ref", "retained_source_readback_ref"],
};

function inputFor(action = "apply-delivery") {
  const lifecycle = {
    "apply-delivery": "baseline-approved",
    "graduate-source": "graduating",
    "retire-incubation": "candidate",
    "reopen-incubation": "retired",
  }[action];
  const request = {
    schema_version: 2,
    artifact_type: "prototype-closure-request",
    request_id: `prototype-closure-request:sample-tool:${action}`,
    prototype_id: "sample-tool",
    action,
    expected_lifecycle: lifecycle,
    expected_source_revision: revision,
    operator_id: caller,
    correlation_id: `correlation:${action}`,
    idempotency_key: `idempotency:${action}`,
  };
  if (action === "apply-delivery") {
    Object.assign(request, {
      accepted_baseline_receipt_ref: "receipt://baseline/accepted",
      target_kind: "new-delivery-epic",
      target_delivery_ref: "openproject://work_packages/900",
      accepted_delivery_target_receipt_ref: "receipt://delivery/accepted",
    });
  } else if (action === "graduate-source") {
    Object.assign(request, {
      accepted_delivery_target_receipt_ref: "receipt://delivery/accepted",
      durable_owner_ref: "owner:console",
      durable_repo_ref: "repo://console/source",
      durable_owner_acceptance_ref: "receipt://owner/accepted",
      transfer_strategy: "transfer",
    });
  } else if (action === "retire-incubation") {
    Object.assign(request, {
      retirement_reason: "Exploration ended",
      retention_plan_ref: "plan://retention/accepted",
      runtime_disposition_plan_ref: "plan://runtime/plan",
    });
  } else {
    request.prior_retirement_receipt_ref = "receipt://retirement/accepted";
  }
  return { request, expected_record_digest: `sha256:${"c".repeat(64)}` };
}

test("Delivery closure rejects a request before ingress acceptance", () => {
  const input = inputFor();
  delete input.request.accepted_delivery_target_receipt_ref;
  assert.throws(
    () => createClosureEvaluation(input.request, input.expected_record_digest),
    /Invalid Prototype Closure request artifact/,
  );
});

function readinessFor(evaluation, outcome = "ready") {
  const resolved = resolvedFor(evaluation.request);
  const evidence = evidenceFields[evaluation.request.action].map((field) => ({
    field,
    ref: resolved[field] ?? evaluation.request[field],
    digest: `sha256:${"e".repeat(64)}`,
    state: "accepted",
  }));
  const readiness = {
    artifact_type: "prototype-closure-readiness",
    request_ref: { id: evaluation.request.request_id, digest: closureDigest(evaluation.request, { ascii: true }) },
    prototype_id: evaluation.request.prototype_id,
    action: evaluation.request.action,
    source_revision: revision,
    actor: "operator-orchestration-service",
    operator_id: caller,
    outcome,
    findings: outcome === "ready" ? [] : [{ code: "owner_missing" }],
    evidence,
  };
  readiness.readiness_digest = closureDigest(readiness);
  return {
    readiness,
    ledger: {
      state: "durable",
      resolution: "read",
      expires_at: "2026-09-13T12:15:00.000Z",
      ref: { uri: `wgcf://readiness/prototype-closure/${readiness.readiness_digest.slice(7)}`, digest: readiness.readiness_digest },
    },
  };
}

function resolvedFor(request) {
  const value = {
    artifact_type: "prototype-closure-resolved-authority",
    issuer: "operator-orchestration-service",
    request_digest: closureDigest(request, { ascii: true }),
    verification: { state: "accepted", source_revision: revision, evidence_refs: [] },
  };
  if (request.action === "apply-delivery") {
    Object.assign(value, {
      target_delivery_ref: request.target_delivery_ref,
      accepted_delivery_target_receipt_ref: "receipt://delivery/accepted",
    });
  } else if (request.action === "graduate-source") {
    Object.assign(value, {
      accepted_delivery_target_receipt_ref: request.accepted_delivery_target_receipt_ref,
      durable_owner_ref: request.durable_owner_ref,
      durable_repo_ref: request.durable_repo_ref,
      durable_owner_acceptance_ref: request.durable_owner_acceptance_ref,
      observed_source_custody: "dedicated-owner-repo",
      source_transfer_receipt_ref: "receipt://transfer/accepted",
    });
  } else if (request.action === "retire-incubation") {
    Object.assign(value, {
      retention_plan_ref: request.retention_plan_ref,
      runtime_disposition_plan_ref: request.runtime_disposition_plan_ref,
      runtime_disposition_proof_ref: "proof://runtime/absent",
    });
  } else {
    Object.assign(value, {
      prior_retirement_receipt_ref: request.prior_retirement_receipt_ref,
      prior_retirement_event_ref: "record://prototype-closure/sample-tool/0001",
      retained_source_readback_ref: "readback://studio/retained",
    });
  }
  value.verification.evidence_refs = evidenceFields[request.action].map((field) => value[field] ?? request[field]);
  return value;
}

function eventFor(record) {
  const request = record.request;
  const [eventType, lifecycle, custody] = eventTypes[request.action];
  const event = {
    schema_version: 2,
    artifact_type: "prototype-closure-history-event",
    event_id: "prototype-closure:sample-tool:0002",
    request_ref: request.request_id,
    request_digest: closureDigest(request, { ascii: true }),
    prototype_id: request.prototype_id,
    event_type: eventType,
    expected_source_revision: revision,
    previous_lifecycle: request.expected_lifecycle,
    observed_lifecycle: lifecycle,
    previous_source_custody: "incubation-repo",
    observed_source_custody: custody,
    operator_id: caller,
    correlation_id: request.correlation_id,
    idempotency_key: request.idempotency_key,
    prior_event_digest: null,
    recorded_at: at,
  };
  if (request.action === "apply-delivery") {
    event.accepted_baseline_receipt_ref = request.accepted_baseline_receipt_ref;
    event.accepted_delivery_target_receipt_ref = record.resolved_authority.accepted_delivery_target_receipt_ref;
  } else if (request.action === "graduate-source") {
    event.accepted_delivery_target_receipt_ref = request.accepted_delivery_target_receipt_ref;
    event.durable_owner_acceptance_ref = request.durable_owner_acceptance_ref;
    event.source_transfer_receipt_ref = record.resolved_authority.source_transfer_receipt_ref;
  } else if (request.action === "retire-incubation") {
    event.retention_plan_ref = request.retention_plan_ref;
    event.runtime_disposition_proof_ref = record.resolved_authority.runtime_disposition_proof_ref;
  } else {
    event.prior_retirement_receipt_ref = request.prior_retirement_receipt_ref;
    event.retained_source_readback_ref = record.resolved_authority.retained_source_readback_ref;
  }
  return event;
}

function harness(root, { outcome = "ready", readbackFailure = false, platformFailure = false, invalidAuthority = false, mismatchedEvidence = false, sourceCustody = "incubation-repo" } = {}) {
  let merged = false;
  let prepared = 0;
  let readbacks = 0;
  let cancellations = 0;
  const sourceClient = {
    async state(prototypeId) {
      assert.equal(prototypeId, "sample-tool");
      return {
        source_revision: revision,
        record_digest: `sha256:${"c".repeat(64)}`,
        lifecycle: "candidate",
        source_custody: sourceCustody,
        history: [],
      };
    },
    async snapshot(record) {
      return {
        source_revision: record.request.expected_source_revision,
        record_digest: record.evaluation.expected_record_digest,
        lifecycle: record.request.expected_lifecycle,
        source_custody: sourceCustody,
      };
    },
    async prepare(record) {
      prepared += 1;
      const event = eventFor(record);
      return {
        branch: `prototype-closure/${record.binding_digest.slice(7)}`,
        base_commit: revision,
        files: [{ path: "prototypes.yaml", mode: "100644", content_base64: "c2VjcmV0" }],
        event_path: "records/prototype-closure/sample-tool/history/0002.json",
        event, event_digest: closureDigest(event, { ascii: true }),
      };
    },
    async openReview(record) {
      return {
        number: 8, state: "open", head_commit: "d".repeat(40),
        branch: record.preparation.branch, base_commit: revision,
      };
    },
    async observe(record) {
      if (!merged) return { ...record.review, state: "open", merged: false };
      return {
        ...record.review, state: "closed", merged: true,
        merge_commit: mergeCommit, human_reviewed: true,
      };
    },
    async readback(record) {
      readbacks += 1;
      if (readbackFailure) throw new Error("source readback unavailable");
      return {
        schema_version: 2,
        artifact_type: "prototype-closure-studio-readback",
        readback_id: `prototype-closure-readback:${record.preparation.event.event_id}:${mergeCommit}`,
        prototype_id: record.request.prototype_id,
        source_event_ref: record.preparation.event.event_id,
        source_event_digest: record.preparation.event_digest,
        merged_source_revision: mergeCommit,
        observed_lifecycle: record.preparation.event.observed_lifecycle,
        observed_source_custody: record.preparation.event.observed_source_custody,
        observed_at: at,
      };
    },
    async cancel(record) {
      cancellations += 1;
      return merged ? { review: {
        ...record.review, merged: true, state: "closed",
        merge_commit: mergeCommit, human_reviewed: true,
      } } : null;
    },
  };
  const service = createPrototypeClosureService({
    store: createPrototypeClosureStore({ root }),
    readinessClient: { evaluate: async (evaluation) => readinessFor(evaluation, outcome) },
    authorityResolver: { resolve: async (request) => {
      const value = resolvedFor(request);
      if (invalidAuthority) value.verification.state = "unverified";
      if (mismatchedEvidence) value.accepted_delivery_target_receipt_ref = "receipt://delivery/different";
      return value;
    } },
    sourceClient,
    platformClient: {
      async readDisposition({ request, readback }) {
        if (platformFailure) throw new Error("Platform disposition unavailable");
        return {
          owner_ref: "platform-engineering", state: "accepted", disposition: "absent",
          prototype_id: request.prototype_id, merged_source_revision: readback.merged_source_revision,
          ref: `proof://platform/runtime-absent/${"f".repeat(64)}`,
          digest: `sha256:${"f".repeat(64)}`,
        };
      },
    },
    clock: () => new Date(at),
  });
  return {
    service,
    merge() { merged = true; },
    counts() { return { prepared, readbacks, cancellations }; },
  };
}

async function toReview(h, input) {
  const requestId = input.request.request_id;
  await h.service.submit({ callerId: caller, input });
  assert.equal((await h.service.advance({ callerId: caller, requestId })).status, "decision-required");
  assert.equal((await h.service.decide({ callerId: caller, requestId, input: { decision: "approve" } })).status, "reconciling");
  return h.service.advance({ callerId: caller, requestId });
}

for (const action of Object.keys(eventTypes)) {
  test(`${action} waits for reviewed merge and issues a bound terminal receipt`, async (t) => {
    const root = await mkdtemp(path.join(tmpdir(), "prototype-closure-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    const h = harness(root);
    const input = inputFor(action);
    const waiting = await toReview(h, input);
    assert.equal(waiting.status, "review-required");
    assert.equal(JSON.stringify(waiting).includes("content_base64"), false);
    assert.equal(waiting.canonical_mutation, false);
    h.merge();
    const pending = await h.service.advance({ callerId: caller, requestId: input.request.request_id });
    assert.equal(pending.status, "pending-readback");
    assert.equal(pending.receipt, null);
    let completed = await h.service.advance({ callerId: caller, requestId: input.request.request_id });
    if (action === "graduate-source") {
      assert.equal(completed.status, "pending-runtime-disposition");
      assert.equal(completed.receipt, null);
      completed = await h.service.advance({ callerId: caller, requestId: input.request.request_id });
      assert.ok(completed.receipt.evidence_refs.includes(`proof://platform/runtime-absent/${"f".repeat(64)}`));
    }
    assert.equal(completed.status, "succeeded");
    assert.equal(completed.receipt.outcome, "completed");
    assert.match(completed.receipt.receipt_id, /^receipt:\/\/prototype-closure\/[0-9a-f]{64}$/);
    assert.equal(completed.receipt.merged_source_revision, mergeCommit);
    assert.equal(completed.receipt.source_event_digest, pending.preparation.event_digest);
    assert.equal(completed.canonical_mutation, true);
    if (action === "retire-incubation") {
      const retirementRef = `record://prototype-closure/${input.request.prototype_id}/history/${completed.receipt.source_event_ref}`;
      const proof = await createPrototypeClosureStore({ root }).readRetirementReceipt({
        ref: completed.receipt.receipt_id,
        prototypeId: input.request.prototype_id,
        retirementRef,
      });
      assert.equal(proof.subject_ref, retirementRef);
    }
    assert.equal(h.counts().prepared, 1);
  });
}

test("blocked readiness and operator denial leave Studio source unchanged", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "prototype-closure-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const blocked = harness(root, { outcome: "blocked" });
  const input = inputFor();
  await blocked.service.submit({ callerId: caller, input });
  const result = await blocked.service.advance({ callerId: caller, requestId: input.request.request_id });
  assert.equal(result.status, "denied");
  assert.equal(result.receipt.outcome, "denied");
  assert.equal(result.receipt.source_event_ref, undefined);
  assert.equal(blocked.counts().prepared, 0);
});

test("denied retirement keeps the actual durable source custody", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "prototype-closure-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const h = harness(root, { outcome: "blocked", sourceCustody: "shared-owner-repo" });
  const input = inputFor("retire-incubation");
  await h.service.submit({ callerId: caller, input });
  const result = await h.service.advance({ callerId: caller, requestId: input.request.request_id });
  assert.equal(result.receipt.observed_source_custody, "shared-owner-repo");
  assert.equal(result.receipt.previous_source_custody, "shared-owner-repo");
});

test("request replay, caller isolation, and changed input fail closed", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "prototype-closure-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const h = harness(root);
  const input = inputFor();
  const first = await h.service.submit({ callerId: caller, input });
  assert.deepEqual(await h.service.submit({ callerId: caller, input }), first);
  await assert.rejects(h.service.project(input.request.request_id, { callerId: "operator:other" }), /not found/i);
  await assert.rejects(h.service.submit({ callerId: caller, input: {
    ...input, expected_record_digest: `sha256:${"e".repeat(64)}`,
  } }), /different Closure input/i);
  await assert.rejects(h.service.submit({ callerId: "operator:other", input }), /authenticated caller/i);
});

test("durable phase and caller binding survive service reconstruction", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "prototype-closure-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const input = inputFor();
  const first = harness(root);
  await first.service.submit({ callerId: caller, input });
  await first.service.advance({ callerId: caller, requestId: input.request.request_id });
  const restored = harness(root);
  const record = await restored.service.project(input.request.request_id, { callerId: caller });
  assert.equal(record.status, "decision-required");
  assert.equal(record.source_snapshot.source_custody, "incubation-repo");
  await assert.rejects(restored.service.project(input.request.request_id, { callerId: "operator:other" }), /not found/i);
  assert.equal((await restored.service.decide({ callerId: caller, requestId: input.request.request_id, input: { decision: "deny" } })).receipt.outcome, "denied");
});

test("unverified target evidence cannot create a Studio event", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "prototype-closure-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const h = harness(root, { invalidAuthority: true });
  const input = inputFor();
  await h.service.submit({ callerId: caller, input });
  await h.service.advance({ callerId: caller, requestId: input.request.request_id });
  await h.service.decide({ callerId: caller, requestId: input.request.request_id, input: { decision: "approve" } });
  await assert.rejects(h.service.advance({ callerId: caller, requestId: input.request.request_id }), /authority/i);
  assert.equal(h.counts().prepared, 0);
});

test("adapter authority differing from WGCF evidence cannot create a Studio event", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "prototype-closure-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const h = harness(root, { mismatchedEvidence: true });
  const input = inputFor();
  await h.service.submit({ callerId: caller, input });
  await h.service.advance({ callerId: caller, requestId: input.request.request_id });
  await h.service.decide({ callerId: caller, requestId: input.request.request_id, input: { decision: "approve" } });
  await assert.rejects(h.service.advance({ callerId: caller, requestId: input.request.request_id }), /accepted request/i);
  assert.equal(h.counts().prepared, 0);
});

test("cancellation before merge is terminal without a Studio event", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "prototype-closure-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const h = harness(root);
  const input = inputFor();
  await toReview(h, input);
  const cancelled = await h.service.advance({ callerId: caller, requestId: input.request.request_id, action: "cancel" });
  assert.equal(cancelled.status, "denied");
  assert.equal(cancelled.receipt.finding_code, "operator_cancelled");
  assert.equal(cancelled.receipt.source_event_ref, undefined);
  assert.equal(h.counts().cancellations, 1);
});

test("merge racing cancellation remains pending until exact readback", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "prototype-closure-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const h = harness(root);
  const input = inputFor();
  await toReview(h, input);
  h.merge();
  const pending = await h.service.advance({ callerId: caller, requestId: input.request.request_id, action: "cancel" });
  assert.equal(pending.status, "pending-readback");
  assert.equal(pending.receipt, null);
  assert.equal((await h.service.advance({ callerId: caller, requestId: input.request.request_id })).status, "succeeded");
});

test("post-merge readback failure remains pending and never repeats source preparation", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "prototype-closure-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const h = harness(root, { readbackFailure: true });
  const input = inputFor();
  await toReview(h, input);
  h.merge();
  await h.service.advance({ callerId: caller, requestId: input.request.request_id });
  await assert.rejects(h.service.advance({ callerId: caller, requestId: input.request.request_id }), /readback reconciliation/i);
  const pending = await h.service.project(input.request.request_id, { callerId: caller });
  assert.equal(pending.status, "pending-readback");
  assert.equal(pending.receipt, null);
  assert.equal(h.counts().prepared, 1);
  assert.equal(h.counts().readbacks, 1);
});

test("graduation remains pending when Platform disposition proof is unavailable", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "prototype-closure-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const h = harness(root, { platformFailure: true });
  const input = inputFor("graduate-source");
  await toReview(h, input);
  h.merge();
  await h.service.advance({ callerId: caller, requestId: input.request.request_id });
  assert.equal((await h.service.advance({ callerId: caller, requestId: input.request.request_id })).status, "pending-runtime-disposition");
  await assert.rejects(h.service.advance({ callerId: caller, requestId: input.request.request_id }), /Platform disposition/i);
  const pending = await h.service.project(input.request.request_id, { callerId: caller });
  assert.equal(pending.status, "pending-runtime-disposition");
  assert.equal(pending.receipt, null);
  assert.equal(h.counts().prepared, 1);
});

test("evaluation identity and Unicode digest are deterministic", () => {
  const input = inputFor();
  const one = createClosureEvaluation(input.request, input.expected_record_digest);
  const two = createClosureEvaluation(input.request, input.expected_record_digest);
  assert.deepEqual(one, two);
  assert.equal(closureDigest({ x: "é" }, { ascii: true }), "sha256:bca462b835df0d11fbe295ae8e0bfb14f010da4801c954734d1801e1a07400a9");
});

test("Closure preparation reads current Studio state without creating a request", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "prototype-closure-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const h = harness(root);
  const preparation = await h.service.prepare({ callerId: caller, input: { prototype_id: "sample-tool" } });
  assert.equal(preparation.expected_state.record_digest, `sha256:${"c".repeat(64)}`);
  assert.equal(preparation.authority_revision, revision);
  assert.equal(preparation.expected_state.lifecycle, "candidate");
  assert.deepEqual(preparation.history, []);
  assert.equal(preparation.canonical_mutation, false);
  assert.deepEqual(h.counts(), { prepared: 0, readbacks: 0, cancellations: 0 });
  await assert.rejects(h.service.prepare({ callerId: caller, input: { prototype_id: "../sample-tool" } }), /Prototype identity/);
});
