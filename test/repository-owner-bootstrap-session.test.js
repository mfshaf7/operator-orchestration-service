import assert from "node:assert/strict";
import test from "node:test";
import { canonicalDigest } from "../src/delivery-art/canonical-json.js";
import { planSourceOwnerBootstrap, sourceOwnerBootstrapPaths } from "../src/repository-owner-bootstrap/scaffold.js";
import { bootstrapSourceSession, assertBootstrapSourceSession, bootstrapSourceChangeSet, bootstrapWorktreeRelativePath } from "../src/repository-owner-bootstrap/session.js";

function fixture(workflow = false) {
  const owner = "example-source";
  const authority = { schema_version: 1, owner_repo: owner, classification: "proposed", inventory_posture: null,
    intake_entry_ref: { id: `repo:${owner}`, version: 1, digest: `sha256:${"a".repeat(64)}` },
    provider_repository: { provider: "github", provider_repository_id: "123456789", full_name: `example-owner/${owner}` },
    owner_purpose: "Synthetic source-only owner, not a control plane.", source_bootstrap_eligible: true,
    ordinary_source_eligible: false, model_writes_allowed: false, canonical_mutation: false, runtime_activation: false };
  const profile = { schema_version: 1, owner_repo: owner, profile_id: "fixture-selected-owner-profile-v1", commands: [
    { id: "tests", kind: "tests", name: "Real selected app tests", executable: "node", args: ["--test", "app/test.mjs"], fidelity: "pure-unit", conformance_binding: "matching-fidelity", timeout_seconds: 30 },
    { id: "validations", kind: "validations", name: "Actual source diff", executable: "git", args: ["diff", "--check"], fidelity: "real-git", conformance_binding: "none", timeout_seconds: 30 },
  ] };
  const plan = planSourceOwnerBootstrap({ authority, fetchedBase: "1".repeat(40), profile,
    applicationMarkers: ["app/main.mjs"], withCi: workflow,
    observedFiles: Object.fromEntries(sourceOwnerBootstrapPaths(workflow).map(name => [name, name === "README.md" ? "# Existing purpose\n" : null])) });
  const body = { schema_version: 1, workflow_id: "repository-owner-bootstrap-preparation", caller_id: "console", operator_id: "operator:fixture",
    decision_ref: "operator:fixture-bootstrap", custody_request_id: "custody:fixture", custody_receipt_digest: `sha256:${"b".repeat(64)}`,
    plan, authorization: "preparation-only", credential_issued: false, checkout_created: false, canonical_mutation: false, runtime_activation: false };
  const preparation = { ...body, preparation_digest: canonicalDigest(body) };
  return { plan, preparation, arguments: { requestDigest: `sha256:${"c".repeat(64)}`, requestId: "bootstrap-request:fixture",
    callerId: "console", operatorId: "operator:fixture", preparation,
    workflowApprovalRef: workflow ? "operator:fixture-workflows-grant" : null } };
}

test("bootstrap session uses a real repository subject and finite ordinary source wire without invented ART work", () => {
  const f = fixture();
  const session = bootstrapSourceSession(f.arguments);
  assert.equal(session.subject.kind, "repository-bootstrap");
  assert.deepEqual(session.covered_work_item_ids, []);
  assert.equal(session.subject.workflow_write, false);
  const change = bootstrapSourceChangeSet(f.plan, session);
  assert.deepEqual(change.operations.map(value => value.path).sort(), session.subject.allowed_paths);
  assert.ok(change.operations.every(value => value.action === "create" && value.expected_digest === null && !value.path.startsWith("app/")));
  assert.ok(!change.operations.some(value => value.path === "README.md"), "Existing documentation is not rewritten");
  assert.equal(change.session_id, session.session_id);
  assert.equal(bootstrapWorktreeRelativePath(session), `.worktrees/${session.landing_unit_id}/example-source`);
});

test("trusted bootstrap plan and accountable preparation are immutable before source session creation", () => {
  for (const change of [
    value => { value.callerId = "another-caller"; }, value => { value.operatorId = "operator:other"; },
    value => { value.preparation.plan.files[0].content += "substitute source"; },
    value => { value.preparation.authorization = "approved-by-model"; },
    value => { value.preparation.plan.template.digest = `sha256:${"f".repeat(64)}`; },
  ]) {
    const args = structuredClone(fixture().arguments); change(args);
    assert.throws(() => bootstrapSourceSession(args));
  }
});

test("bootstrap cannot borrow ordinary subject identity or change its derived owner, branch, base or changed paths", () => {
  for (const change of [
    value => { value.subject.kind = "delivery"; }, value => { value.work_item_id = "work-item-1"; },
    value => { value.prototype_id = "prototype:fixture"; }, value => { value.owner_repo = "foreign-owner"; },
    value => { value.landing_unit.branch = "main"; }, value => { value.subject.allowed_paths.push("app/arbitrary.js"); },
  ]) {
    const f = fixture(); const session = bootstrapSourceSession(f.arguments); change(session);
    assert.throws(() => assertBootstrapSourceSession(session));
  }
  const f = fixture(); const session = bootstrapSourceSession(f.arguments);
  f.plan.files[0].content += "unapproved substitution";
  assert.throws(() => bootstrapSourceChangeSet(f.plan, session));
});

test("the bootstrap workflow file requires the separate actual grant and may not be disguised as ordinary source", () => {
  const f = fixture(true);
  assert.throws(() => bootstrapSourceSession({ ...f.arguments, workflowApprovalRef: null }));
  const session = bootstrapSourceSession(f.arguments);
  assert.equal(session.subject.workflow_write, true);
  assert.equal(session.subject.workflow_approval_ref, "operator:fixture-workflows-grant");
  assert.ok(bootstrapSourceChangeSet(f.plan, session).operations.some(value => value.path === ".github/workflows/validate.yaml"));
});
