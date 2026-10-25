import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { canonicalDigest } from "../src/delivery-art/canonical-json.js";
import { assertLifecycleContextResult, sourceSummary, textDigest } from "../src/source-authoring/context-contract.js";
import { assertPrototypeSourceCapture, buildPrototypeContextRequest, createPrototypeLifecycleContext, prototypeSourcePathAllowed } from "../src/source-authoring/prototype-context.js";
import { createPrototypeAuthoringStore } from "../src/source-authoring/prototype-store.js";

const A = "a".repeat(40); const B = "b".repeat(40); const NOW = "2026-10-18T14:00:00Z";
// Independent oracle: the existing CGG lifecycle protocol uses Python's
// ASCII-escaped compact sorted JSON, including surrogate pairs and DEL.
const pythonWireDigest = value => execFileSync("python3", ["-c",
  "import hashlib,json,sys; print('sha256:'+hashlib.sha256(json.dumps(json.load(sys.stdin),ensure_ascii=True,separators=(',',':'),sort_keys=True).encode()).hexdigest())"],
  { input: JSON.stringify(value), encoding: "utf8" }).trim();
function fixture() {
  const record = { request: { request_id: "prototype-source-request:42:1", prototype_id: "prototype:proposal-42", objective: "Build a synthetic local example." },
    request_digest: textDigest("immutable request"), operator_id: "operator:owner", session: { session_id: "prototype-session:42:1" },
    binding: { subject: { kind: "prototype", prototype_id: "prototype:proposal-42", registry_ref: "record://prototypes/proposal-42",
      registry_revision: A, source_ref: "repo://workspace-prototype-studio/prototypes/proposal-42", source_revision: A },
      source_start: { landing_unit_id: "prototype-authoring-42" }, model_source_scope: { source_root: "prototypes/proposal-42", design_profile: "docs/prototypes/proposal-42/design-profile.md" } } };
  const content = "# Synthetic example\n";
  const capture = { schema_version: 1, session_id: record.session.session_id, owner_repo: "workspace-prototype-studio", landing_unit_id: "prototype-authoring-42",
    head_commit: B, clean: true, tree: { paths: ["prototypes/proposal-42/README.md"], total_path_count: 1, truncated: false },
    files: [{ path: "prototypes/proposal-42/README.md", content, content_digest: textDigest(content), size_bytes: Buffer.byteLength(content) }], admitted_bytes: Buffer.byteLength(content) };
  capture.context_digest = textDigest(JSON.stringify(capture));
  return { record, capture, executionId: "prototype-generation:42:1", budgetTokens: 4000, capturedAt: NOW };
}
function result(request) {
  const { operator, sources, schema_version: _schema, ...rest } = request;
  const binding = { ...rest, caller_id: "operator-orchestration-service", operator_id: operator.id };
  const summary = sourceSummary(sources);
  return { schema_version: 1, status: "ready", replayed: false, request_id: request.request_id, correlation_id: request.correlation_id,
    idempotency_key: request.idempotency_key, request_digest: canonicalDigest({ binding, lifecycle_sources: sources }), binding,
    artifact_id: "prototype-packet-42", artifact_digest: textDigest("redacted packet"), packet_ref: "/v1/context/packets/prototype-42",
    redaction_receipt_ref: "/v1/context/receipts/prototype-42", projection_receipt_ref: "/v1/context/lifecycle/projections/prototype-42", content: "redacted packet",
    admission_decision: { profile: "developer", raw_projection: "not_requested", redaction_safe: true }, timeline: { requested_at: request.requested_at, projected_at: NOW },
    authority: { may_select_or_invoke_model: false, may_approve_suggestion: false, may_mutate_delivery: false }, lifecycle_context: request.lifecycle,
    source_bindings: sources.map(({ content: _content, ...value }) => value), source_summary: summary,
    classification: { context_type: "lifecycle", source_classes: summary.classes, signal_ids: [] }, budget: { requested_tokens: request.budget_tokens, estimated_tokens: 100, truncated: false },
    projection_safety: { raw_context_exposed: false, redaction_applied: true, custody_bound: true },
    lifecycle_authority: { may_choose_action: false, may_mutate_art: false, may_mutate_source: false, may_invoke_model: false, may_choose_raw_fallback: false } };
}

test("Prototype context retains separate registry/source revisions and real subject without fake ART", () => {
  const f = fixture(); const request = buildPrototypeContextRequest(f);
  assert.equal(request.subject.registry_revision, A); assert.equal(request.subject.source_revision, B);
  assert.equal(Object.hasOwn(request, "delivery_id"), false); assert.equal(Object.hasOwn(request, "work_item_ref"), false);
  assert.equal(request.sources.some(source => source.source_class === "art"), false);
  assert.equal(request.sources.at(-1).unavailable_reason, "not_configured");
  assert.equal(request.sources_digest, canonicalDigest(request.sources));
  for (const source of request.sources.filter(value => value.availability === "available")) assert.equal(source.content_digest, textDigest(source.content));
});

test("Prototype Unicode source list and response envelope match the Python CGG wire contract without changing source bytes", () => {
  const f = fixture(), content = "\uFEFFcafé — 你好 😀\u007f\r\n";
  f.record.request.objective = "Explain local storage — café / 你好 😀";
  f.capture.files[0] = { ...f.capture.files[0], content, content_digest: textDigest(content), size_bytes: Buffer.byteLength(content) };
  f.capture.admitted_bytes = Buffer.byteLength(content);
  const { context_digest: _old, ...body } = f.capture;
  f.capture = { ...body, context_digest: textDigest(JSON.stringify(body)) };
  const request = buildPrototypeContextRequest(f);
  assert.equal(request.sources_digest, pythonWireDigest(request.sources));
  assert.notEqual(request.sources_digest, canonicalDigest(request.sources));
  assert.equal(JSON.parse(request.sources.find(source => source.source_class === "repository").content).files[0].content, content);
  const response = result(request);
  response.request_digest = pythonWireDigest({ binding: response.binding, lifecycle_sources: request.sources });
  assert.doesNotThrow(() => assertLifecycleContextResult(response, request, "operator-orchestration-service"));
  assert.throws(() => assertLifecycleContextResult({ ...response,
    request_digest: canonicalDigest({ binding: response.binding, lifecycle_sources: request.sources }) }, request, "operator-orchestration-service"),
    { code: "lifecycle_context_response_invalid" });
});

test("Prototype capture rejects sibling source, owner controls, forged content and wrong session", () => {
  const f = fixture();
  for (const candidate of ["prototypes/other/index.html", "prototypes/proposal-42/../other/main.js", "prototypes/proposal-42/.github/workflows/ci.yaml",
    "prototypes/proposal-42/AGENTS.md", "prototypes/proposal-42/.env", "prototypes.yaml", "preview-profiles/proposal-42.yaml"]) {
    assert.equal(prototypeSourcePathAllowed(candidate, f.record.binding.model_source_scope), false);
  }
  assert.equal(prototypeSourcePathAllowed("docs/prototypes/proposal-42/design-profile.md", f.record.binding.model_source_scope), true);
  for (const change of [{ session_id: "another-session" }, { context_digest: textDigest("forged") }, { clean: false },
    { files: [{ ...f.capture.files[0], content: "changed" }] }, { tree: { paths: ["prototypes/other/private.txt"] } }]) {
    assert.throws(() => assertPrototypeSourceCapture(f.record, { ...f.capture, ...change }), { code: "prototype_source_authoring_context_capture_invalid" });
  }
});

test("larger captures chunk within native CGG bounds and deduplicate repository class summaries", () => {
  const f = fixture(); const content = "x".repeat(60_000);
  f.capture.files = Array.from({ length: 4 }, (_, i) => ({ path: `prototypes/proposal-42/file-${i}.txt`, content, content_digest: textDigest(content), size_bytes: content.length }));
  f.capture.admitted_bytes = 240_000; delete f.capture.context_digest; f.capture.context_digest = textDigest(JSON.stringify(f.capture));
  const request = buildPrototypeContextRequest(f);
  assert.equal(request.sources.filter(value => value.source_class === "repository").length, 4);
  assert.deepEqual(sourceSummary(request.sources).classes, ["repository", "runtime", "validation"]);
  assert.equal(request.sources.every(value => value.content === null || Buffer.byteLength(value.content) <= 120_000), true);
});

test("retained projection request survives lost acknowledgement and cold reconstruction without timestamp churn", async t => {
  const root = mkdtempSync(path.join(tmpdir(), "oos-prototype-context-")); t.after(() => rmSync(root, { recursive: true, force: true }));
  const f = fixture(); const store = createPrototypeAuthoringStore({ root }); const observed = [];
  const context = createPrototypeLifecycleContext({ store, client: { callerId: "operator-orchestration-service", async project(request) { observed.push(request); throw new Error("lost acknowledgement"); } } });
  const requestRef = context.prepare(f);
  await assert.rejects(context.project({ record: f.record, requestRef }), /lost acknowledgement/);
  const cold = createPrototypeLifecycleContext({ store: createPrototypeAuthoringStore({ root }), client: { callerId: "operator-orchestration-service", async project(request) { observed.push(request); return result(request); } } });
  const projected = await cold.project({ record: f.record, requestRef });
  assert.deepEqual(observed[0], observed[1]); assert.equal(projected.content, "redacted packet"); assert.equal(projected.captured_at, NOW);
  assert.equal(store.readArtifact(projected.result_ref).packet_ref, projected.packet_ref);
});

test("CGG subject, content custody, raw fallback and authority mismatches never become model context", async t => {
  const root = mkdtempSync(path.join(tmpdir(), "oos-prototype-context-deny-")); t.after(() => rmSync(root, { recursive: true, force: true }));
  const f = fixture(); const store = createPrototypeAuthoringStore({ root });
  const changes = [value => { value.binding.subject.prototype_id = "prototype:another"; }, value => { value.projection_safety.raw_context_exposed = true; },
    value => { value.lifecycle_authority.may_mutate_source = true; }, value => { value.source_bindings[0].content_digest = textDigest("other"); }];
  for (const change of changes) {
    const context = createPrototypeLifecycleContext({ store, client: { callerId: "operator-orchestration-service", async project(request) { const value = result(request); change(value); return value; } } });
    const requestRef = context.prepare(f);
    await assert.rejects(context.project({ record: f.record, requestRef }), { code: "prototype_source_authoring_context_response_invalid" });
  }
});
