import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { canonicalDigest } from "../src/delivery-art/canonical-json.js";
import { createRepositoryCustodyService } from "../src/repository-custody/service.js";
import { createRepositoryCustodyStore } from "../src/repository-custody/store.js";
import { repositoryCustodyIntakeAuthority } from "../src/repository-custody/intake-source.js";
import { createRepositoryOwnerBootstrapPreparation } from "../src/repository-owner-bootstrap/preparation.js";
import { custodyRequest, custodyDecision, providerReadback, TEST_CLOCK } from "../test-fixtures/repository-custody.js";

const callerId = "fixture-console";
const operatorId = "fixture-operator";
const owner = "example-repository";
const target = { kind: "repo", name: owner, record_id: `repo:${owner}` };
async function harness(t, { changeAuthority = () => {}, readCustody = value => value, inspectSource = value => value } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), "bootstrap-preparation-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const request = custodyRequest();
  const custody = createRepositoryCustodyService({ clock: TEST_CLOCK,
    store: createRepositoryCustodyStore({ root }),
    readinessClient: { evaluate: async () => {
      const decision = custodyDecision(request);
      return { decision, decisionRef: { uri: "wgcf://decisions/repository-custody/synthetic.json", digest: decision.integrity.content_digest } };
    } }, providerClient: { read: async input => providerReadback(input) },
  });
  const result = await custody.execute({ callerId, input: request });
  const actualCustody = repositoryCustodyIntakeAuthority({ result, target });
  const calls = [];
  let observations = 0;
  const service = createRepositoryOwnerBootstrapPreparation({ callerOperatorBindings: { [callerId]: operatorId },
    custodySourceReader: async (id, options) => {
      calls.push("custody"); assert.equal(id, request.request_id); assert.equal(options.callerId, callerId);
      return readCustody(await custody.project(id));
    },
    intakeSourceClient: { proposedSourceOwner: async ({ target: selected, custodyResult }) => {
      calls.push("intake"); observations++;
      assert.deepEqual(selected, target); assert.equal(custodyResult.status, "succeeded");
      const authority = { schema_version: 1, owner_repo: owner, classification: "proposed", inventory_posture: null,
        intake_entry_ref: { id: `repo:${owner}`, version: 1, digest: `sha256:${"a".repeat(64)}` },
        intake_register_digest: `sha256:${String(observations % 10).repeat(64)}`, authority_revision: String(observations % 10).repeat(40),
        provider_repository: actualCustody.binding, custody_receipt_digest: actualCustody.digest,
        owner_purpose: "Synthetic source-only owner; no control-plane, Security or runtime authority.",
        source_bootstrap_eligible: true, ordinary_source_eligible: false, model_writes_allowed: false,
        canonical_mutation: false, runtime_activation: false };
      changeAuthority(authority, observations);
      return authority;
    } },
    sourceReader: { inspect: async ({ providerRepository, paths }) => {
      calls.push("source"); assert.deepEqual(providerRepository, actualCustody.binding);
      return inspectSource({ fetched_base: "1".repeat(40), visibility: "public", default_branch: "main",
        observed_files: Object.fromEntries(paths.map(name => [name, name === "README.md" ? "# Actual owner documentation\n" : null])) });
    } },
  });
  const input = { owner_repo: owner, custody_request_id: request.request_id, with_ci: false,
    decision_ref: "operator:fixture-bootstrap-plan", application_markers: ["app/main.mjs"],
    evidence_profile: { schema_version: 1, owner_repo: owner, profile_id: "fixture-project-evidence-v1", commands: [
      { id: "tests", name: "Real project tests", kind: "tests", executable: "node", args: ["app/test.mjs"], fidelity: "pure-unit", conformance_binding: "matching-fidelity", timeout_seconds: 30 },
      { id: "validations", name: "Exact source diff", kind: "validations", executable: "git", args: ["diff", "--check", "{{base_commit}}...{{head_commit}}"], fidelity: "real-git", conformance_binding: "none", timeout_seconds: 30 },
    ] } };
  return { root, service, input, calls, stateFile: path.join(root, "records", `${createHash("sha256").update(request.request_id).digest("hex")}.json`) };
}

test("caller-bound read-only preparation orders canonical custody and proposed authority before exact source; unrelated authority revisions do not invalidate the selected plan", async t => {
  const h = await harness(t);
  const before = await readFile(h.stateFile, "utf8");
  const args = { callerId, operatorId, input: h.input };
  const prepared = await h.service.prepare(args);
  assert.deepEqual(h.calls, ["custody", "intake", "source", "custody", "intake"]);
  assert.deepEqual(await h.service.prepare(args), prepared);
  const { preparation_digest, ...body } = prepared;
  assert.equal(preparation_digest, canonicalDigest(body));
  assert.equal(prepared.authorization, "preparation-only");
  for (const field of ["credential_issued", "checkout_created", "canonical_mutation", "runtime_activation"]) assert.equal(prepared[field], false);
  assert.equal(prepared.plan.app_import, false);
  assert.equal(await readFile(h.stateFile, "utf8"), before, "Preparation must not change existing custody state");
});

test("unauthorized callers and browser-supplied coordinates or file maps fail before custody or source reads", async t => {
  const h = await harness(t);
  await assert.rejects(h.service.prepare({ callerId: "other", operatorId, input: h.input }), { statusCode: 403 });
  for (const additional of [{ repository: "foreign/source" }, { files: {} }, { provider_repository: {} }, { token: "not-accepted" }]) {
    await assert.rejects(h.service.prepare({ callerId, operatorId, input: { ...h.input, ...additional } }), { statusCode: 400 });
  }
  assert.deepEqual(h.calls, []);
});

test("missing or mismatched custody and nonproposed or privileged authority fail before target source reads", async t => {
  for (const changeAuthority of [
    value => { value.classification = "retired"; }, value => { value.classification = "out-of-scope"; },
    value => { value.inventory_posture = "active"; }, value => { value.source_bootstrap_eligible = false; },
    value => { value.ordinary_source_eligible = true; }, value => { value.model_writes_allowed = true; },
    value => { value.provider_repository = { ...value.provider_repository, provider_repository_id: "42" }; },
    value => { value.custody_receipt_digest = `sha256:${"f".repeat(64)}`; },
  ]) {
    const h = await harness(t, { changeAuthority });
    await assert.rejects(h.service.prepare({ callerId, operatorId, input: h.input }));
    assert.ok(!h.calls.includes("source"));
  }
  const h = await harness(t, { readCustody: value => ({ ...value, request: { ...value.request, request_id: "another-request" } }) });
  await assert.rejects(h.service.prepare({ callerId, operatorId, input: h.input }), /different retained request/);
  assert.ok(!h.calls.includes("source"));
});

test("admitted authority can prepare the same finite controls without gaining ordinary source or Inventory authority", async t => {
  const h = await harness(t, { changeAuthority: value => { value.classification = "admitted"; value.intake_entry_ref.version = 2; } });
  const prepared = await h.service.prepare({ callerId, operatorId, input: h.input });
  assert.equal(prepared.owner_authority.classification, "admitted");
  assert.equal(prepared.owner_authority.ordinary_source_eligible, false);
  assert.equal(prepared.plan.app_import, false);
  assert.equal(prepared.plan.canonical_mutation, false);
  await h.service.verify({ callerId, operatorId, preparation: prepared });
});

test("selected Intake changes during provider inspection and unqualified private source cannot produce a preparation", async t => {
  const h = await harness(t, { changeAuthority: (value, count) => { value.intake_entry_ref.version = count; } });
  await assert.rejects(h.service.prepare({ callerId, operatorId, input: h.input }), /changed during preparation/);
  const privateSource = await harness(t, { inspectSource: value => ({ ...value, visibility: "private" }) });
  await assert.rejects(privateSource.service.prepare({ callerId, operatorId, input: privateSource.input }), /private\/client operation is not qualified/);
});
