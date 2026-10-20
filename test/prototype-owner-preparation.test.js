import assert from "node:assert/strict";
import test from "node:test";
import { normalizePrototypeOwnerPreparation, assertPrototypeOwnerChangeSet } from "../src/source-authoring/prototype-owner-preparation.js";
import { prototypeDeliveryPreparationRequest, prototypeDeliveryOwnerChangeSet } from "../src/source-authoring/prototype-delivery-preparation.js";
import { loadOpenApiSpec, validateValueAgainstSchema } from "../scripts/api_contract_tools.mjs";

const intent = () => ({ kind: "delivery-packet", work: { title: "Synthetic continuation", objective: "Deliver the accepted design.",
  included_scope: ["Preserve accepted source"], excluded_scope: [], remaining_work: ["Owner validation"] },
  custody: { classification: "new-repo-required", repository_mode: "new", repository_gate_state: "resolved", owner: "sample-product",
    source_ref: "repo://sample-product@main", rationale: "Existing resolved synthetic custody" },
  evidence_refs: ["record://evidence/synthetic-preview"], rationale: "Continue through Delivery", decision_ref: "record://decisions/synthetic-handoff" });
const session = () => ({ session_id: "prototype-source-session:fixture", prototype_id: "prototype:sample", operator: { id: "operator:synthetic" }, owner_repo: "workspace-prototype-studio",
  objective_digest: `sha256:${"a".repeat(64)}`, landing_unit: { base_commit: "b".repeat(40) }, subject: { source_revision: "b".repeat(40) }, owner_preparation: intent() });

test("Delivery preparation uses native work/custody definitions and supports source and non-source outcomes without fake CI", () => {
  const source = intent(); assert.deepEqual(normalizePrototypeOwnerPreparation(source), source);
  const spec = loadOpenApiSpec();
  assert.deepEqual(validateValueAgainstSchema(spec, spec.components.schemas.PrototypeOwnerPreparation, source), []);
  for (const classification of ["non-source-work", "platform-internal"]) {
    const value = { ...source, custody: { ...source.custody, classification, repository_mode: "not-required", repository_gate_state: "not-required", source_ref: null } };
    assert.deepEqual(normalizePrototypeOwnerPreparation(value), value);
  }
  for (const value of [{ ...source, source_revision: {} }, { ...source, baseline: "caller-selected" }, { ...source, command: "shell" },
    { ...source, custody: { ...source.custody, repository_gate_state: "pending" } }, { ...source, work: { ...source.work, remaining_work: [] } },
    { ...source, evidence_refs: [] }, { ...source, work: { ...source.work, title: "\ud800" } }]) {
    assert.throws(() => normalizePrototypeOwnerPreparation(value), { code: "prototype_source_authoring_owner_preparation_invalid" });
  }
});

test("native Delivery emission receives server-derived operator and actual source Git binding, never a future or caller baseline", () => {
  const selected = session(), request = prototypeDeliveryPreparationRequest(selected);
  assert.equal(request.prototype_id, "sample"); assert.equal(request.authorization.operator_id, selected.operator.id);
  assert.equal(request.source_revision.head_commit, selected.subject.source_revision);
  assert.equal(request.source_revision.base_commit, selected.landing_unit.base_commit);
  assert.equal(request.source_revision.repository, "workspace-prototype-studio"); assert.equal(request.source_revision.ref, "HEAD");
  assert.equal(Object.hasOwn(request, "baseline"), false); assert.equal(Object.hasOwn(request, "tree"), false);
});

test("native packet plan is bounded to one exact packet and the existing registry backlink; unrelated controls remain forbidden", () => {
  const selected = session(), request = prototypeDeliveryPreparationRequest(selected);
  const operations = [{ action: "replace", path: "prototypes.yaml", content: "# native-emitted registry\n", expected_digest: `sha256:${"c".repeat(64)}` },
    { action: "create", path: `records/delivery-packets/sample-${"d".repeat(64)}.json`, content: "{}\n", expected_digest: null }];
  const plan = prototypeDeliveryOwnerChangeSet({ session: selected, request, operations });
  assert.equal(assertPrototypeOwnerChangeSet(plan.change_set, selected), plan.change_set);
  for (const path of ["records/delivery-packets/other.json", `.github/workflows/ci.yaml`, "records/design-baselines/sample.yaml", "prototypes/sample/index.html"]) {
    assert.throws(() => assertPrototypeOwnerChangeSet({ ...plan.change_set, operations: [operations[0], { ...operations[1], path }] }, selected),
      { code: "prototype_source_authoring_owner_change_set_invalid" });
  }
  for (const malformed of [null, {}, { operations: { length: 2 } }]) assert.throws(() => assertPrototypeOwnerChangeSet(malformed, selected),
    { code: "prototype_source_authoring_owner_change_set_invalid" });
});
