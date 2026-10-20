import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createPrototypeAuthoringService } from "../src/source-authoring/prototype-service.js";
import { createPrototypeAuthoringStore } from "../src/source-authoring/prototype-store.js";

const A = "a".repeat(40); const B = "b".repeat(40);
const CALLER = "console"; const OPERATOR = "operator:owner"; const PROTOTYPE = "prototype:proposal-42";
const d = value => `sha256:${value.repeat(64)}`;
function request() { return { schema_version: 1, request_id: "prototype-source-request:proposal-42:1", prototype_id: PROTOTYPE,
  expected_registry_revision: A, expected_source_revision: A, objective: "Build a small synthetic local app.", requested_at: "2026-10-18T10:00:00Z" }; }
function fixture(t) {
  const root = mkdtempSync(path.join(tmpdir(), "oos-prototype-source-service-")); t.after(() => rmSync(root, { recursive: true, force: true }));
  const store = createPrototypeAuthoringStore({ root }); const contexts = []; let inspections = 0; let identities = 0;
  const entry = { id: "proposal-42", lifecycle: "exploring", project_phase: "incubating", source_custody: "incubation-repo", data_mode: "synthetic",
    visibility_tier: "operator-review", mutation_boundary: "prototype-local", paths: { design_profile: "docs/prototypes/proposal-42/design-profile.md" } };
  const records = { workflow_id: "prototype-records", authority_revision: A, registry: { prototypes: [entry] }, documents: {
    "records/prototype-landings/proposal-42/record.json": { id: PROTOTYPE, source: { custody: "incubation-repo", ref: "repo://workspace-prototype-studio/prototypes/proposal-42" } },
  } };
  let manifest = [{ path: "prototypes/proposal-42/README.md", content_digest: d("c"), bytes: 10 }];
  const service = createPrototypeAuthoringService({ callerOperatorBindings: { [CALLER]: OPERATOR }, store,
    clock: () => new Date("2026-10-18T10:00:01Z"), recordsReader: async () => structuredClone(records),
    sourceExecutor: { executor: { run(context, operation) { contexts.push(context); return operation(); } }, prototypeSource: {
      async inspectCommittedSource(input) { inspections++; assert.equal(input.prototype_id, PROTOTYPE); return {
        schema_version: 1, status: "source-inspected", subject: { kind: "prototype", prototype_id: PROTOTYPE, registry_ref: "record://prototypes/proposal-42",
          registry_revision: input.source_revision, source_ref: "repo://workspace-prototype-studio/prototypes/proposal-42", source_revision: input.source_revision },
        prototype: structuredClone(entry), model_source_scope: { source_root: "prototypes/proposal-42", design_profile: entry.paths.design_profile },
        source_manifest: structuredClone(manifest), design_profile_digest: d("d"),
      }; },
      async inspectSourceCredentialBinding(input) { identities++; assert.equal(input.prototype_id, PROTOTYPE); return {
        repository: "mfshaf7/workspace-prototype-studio", repository_id: 123, installation_id: 456, human_reviewer_id: "mfshaf7", rotate_before_expiry_seconds: 900,
      }; },
    } },
  });
  return { service, store, records, entry, contexts, get inspections() { return inspections; }, get identities() { return identities; },
    setManifest(value) { manifest = value; }, input: input => ({ callerId: CALLER, operatorId: OPERATOR, input }),
    credential: (requestId = request().request_id) => ({ callerId: CALLER, operatorId: OPERATOR, subject: { kind: "prototype", prototype_id: PROTOTYPE, source_request_id: requestId }, decision: null }),
  };
}

test("actual Prototype authoring preparation creates a cold-recoverable source request, not a Delivery item, branch or session", async t => {
  const f = fixture(t); const result = await f.service.create(f.input(request()));
  assert.equal(result.subject.kind, "prototype"); assert.equal(result.session_id, null); assert.equal(result.canonical_mutation, false);
  assert.equal(result.source_scope.source_root, "prototypes/proposal-42");
  assert.equal(f.contexts.every(value => value.prototype_id === PROTOTYPE && value.source_request_id === request().request_id && !Object.hasOwn(value, "work_item_id")), true);
  assert.equal(f.inspections, 1); assert.equal(f.identities, 1);
  assert.deepEqual(await f.service.create(f.input(request())), result);
  assert.equal(f.inspections, 1); assert.equal(f.identities, 1);
  assert.deepEqual(f.service.read({ callerId: CALLER, operatorId: OPERATOR, requestId: request().request_id }), result);
  assert.equal(f.service.list({ callerId: CALLER, operatorId: OPERATOR }).requests.length, 1);
});

test("Prototype request mutation, wrong actor, stale revisions and absent canonical identity fail closed", async t => {
  const f = fixture(t); await f.service.create(f.input(request()));
  await assert.rejects(f.service.create(f.input({ ...request(), objective: "Another immutable objective." })), { code: "prototype_source_authoring_request_conflict" });
  await assert.rejects(f.service.create({ ...f.input(request()), operatorId: "operator:other" }), { code: "prototype_source_authoring_identity_forbidden" });
  assert.throws(() => f.service.read({ callerId: CALLER, operatorId: "operator:other", requestId: request().request_id }), { code: "prototype_source_authoring_identity_forbidden" });
  const other = fixture(t); other.records.authority_revision = B;
  await assert.rejects(other.service.create(other.input(request())), { code: "prototype_source_authoring_source_stale" });
  other.records.registry.prototypes = [];
  await assert.rejects(other.service.create(other.input(request())), { code: "prototype_source_authoring_canonical_subject_unavailable" });
});

test("the canonical Prototype source request resolves real ordinary-source scope before an authoring session exists", async t => {
  const f = fixture(t); const created = await f.service.create(f.input(request()));
  const plan = await f.service.prepareSourceCredential(f.credential());
  assert.equal(plan.subject.kind, "prototype"); assert.equal(plan.subject.prototype_id, PROTOTYPE);
  assert.equal(plan.session_id, null); assert.equal(plan.source_start_digest, created.source_start_digest);
  assert.equal(plan.repository, "mfshaf7/workspace-prototype-studio"); assert.equal(plan.proof.rotate_before_expiry_seconds, 900);
  await assert.rejects(f.service.prepareSourceCredential({ ...f.credential(), decision: { work_item_id: "work-item-42" } }), { code: "prototype_source_authoring_credential_selector_invalid" });
});

test("unrelated registry commits do not invalidate an existing Prototype session, while material source or custody changes do", async t => {
  const f = fixture(t); const created = await f.service.create(f.input(request()));
  await f.store.transact(request().request_id, ({ current, put }) => put({ ...current, session: { session_id: "prototype-source-session:proposal-42:1" }, state: "source-work" }));
  f.records.authority_revision = B;
  const plan = await f.service.prepareSourceCredential(f.credential());
  assert.equal(plan.session_id, "prototype-source-session:proposal-42:1"); assert.equal(plan.source_start_digest, created.source_start_digest);
  assert.equal(plan.subject.registry_revision, A);
  f.setManifest([{ path: "prototypes/proposal-42/README.md", content_digest: d("e"), bytes: 20 }]);
  await assert.rejects(f.service.prepareSourceCredential(f.credential()), { code: "prototype_source_authoring_source_start_changed" });
  f.entry.source_custody = "dedicated-repo";
  await assert.rejects(f.service.prepareSourceCredential(f.credential()), { code: "prototype_source_authoring_source_ineligible" });
});

test("a prospective request cannot claim the current base after owner source advanced", async t => {
  const f = fixture(t); await f.service.create(f.input(request())); f.records.authority_revision = B;
  await assert.rejects(f.service.prepareSourceCredential(f.credential()), { code: "prototype_source_authoring_source_start_changed" });
});

test("trusted Preview intent is part of immutable source authorization, not an unbound model or control-path grant", async t => {
  const f = fixture(t);
  const preparation = { kind: "preview-profile", port: 18199, support_profile: "interactive", runtime_activation: true,
    ttl_seconds: 3600, decision_ref: "record://operator-decisions/reviewed-preview" };
  const original = { ...request(), owner_preparation: preparation };
  const created = await f.service.create(f.input(original));
  const scope = await f.service.prepareSourceCredential(f.credential());
  assert.equal(created.source_start_digest, scope.source_start_digest);
  await assert.rejects(f.service.create(f.input({ ...original, owner_preparation: { ...preparation, port: 18200 } })), { code: "prototype_source_authoring_request_conflict" });
  for (const value of [null, { ...preparation, path: "prototypes/other/index.html" }, { ...preparation, kind: "shell" },
    { ...preparation, port: 80 }, { ...preparation, ttl_seconds: 0 }, { ...preparation, decision_ref: "" }]) {
    await assert.rejects(f.service.create(f.input({ ...request(), request_id: "prototype-source-request:invalid", owner_preparation: value })),
      { code: "prototype_source_authoring_owner_preparation_invalid" });
  }
  const different = fixture(t); const model = await different.service.create(different.input(request()));
  assert.notEqual(model.source_start_digest, created.source_start_digest);
});

test("Delivery packet preparation needs a canonical accepted Baseline before source identity or resources, and a changed Baseline invalidates scope", async t => {
  const f = fixture(t);
  const owner_preparation = { kind: "delivery-packet", work: { title: "Synthetic continuation", objective: "Continue the accepted design", included_scope: ["Preserve source"], excluded_scope: [], remaining_work: ["Validate owner source"] },
    custody: { classification: "non-source-work", repository_mode: "not-required", repository_gate_state: "not-required", owner: "synthetic-owner", source_ref: null, rationale: "No target source required" },
    evidence_refs: ["record://evidence/synthetic"], rationale: "Continue through Delivery", decision_ref: "record://decisions/handoff" };
  const input = { ...request(), owner_preparation };
  await assert.rejects(f.service.create(f.input(input)), { code: "prototype_source_authoring_baseline_required" });
  assert.equal(f.identities, 0); assert.equal(f.store.list({ callerId: CALLER }).length, 0);
  f.entry.lifecycle = "baseline-approved"; f.entry.design_baseline_ref = "record://design-baselines/synthetic-approved";
  const created = await f.service.create(f.input(input));
  assert.equal(created.session_id, null);
  await f.store.transact(input.request_id, ({ current, put }) => put({ ...current, session: { session_id: "prototype-source-session:synthetic-packet" }, state: "source-work" }));
  f.entry.design_baseline_ref = "record://design-baselines/synthetic-successor";
  await assert.rejects(f.service.prepareSourceCredential(f.credential()), { code: "prototype_source_authoring_source_start_changed" });
});
