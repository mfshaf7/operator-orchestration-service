import assert from "node:assert/strict";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { closureDigest } from "../src/prototype-closure/contracts.js";
import { createPrototypeClosureSourceClient } from "../src/prototype-closure/source-client.js";
import { createPrototypeClosureBaselineOwnerReader, prototypeClosureBaselineReceiptRef } from "../src/prototype-closure/baseline-owner-reader.js";
import { bindPrototypeMaturity, createPrototypeMaturityDecision, createPrototypeMaturityReceipt } from "../src/prototype-maturity/contracts.js";
import { at, caller, commandFixture, readbackFixture, readinessFixture } from "../test-fixtures/prototype-maturity/fixture.js";

const authorityRoot = process.env.OOS_PROTOTYPE_STUDIO_ROOT;

test("historical baseline readback accepts a pre-Closure Studio ancestor without weakening mutation reads", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "prototype-closure-historical-baseline-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim();
  git("init");
  git("config", "user.name", "Prototype Closure Test");
  git("config", "user.email", "prototype-closure@example.invalid");
  await writeFile(path.join(root, "prototypes.yaml"), [
    "prototypes:",
    "  - id: sample-tool",
    "    lifecycle: baseline-approved",
    "    source_custody: incubation-repo",
    "    design_baseline_ref: record://design-baselines/sample-tool-v1",
    "    title: 'Reviewed — 日本語 😀 é'",
    "",
  ].join("\n"));
  git("add", "prototypes.yaml");
  git("commit", "-m", "record accepted baseline");
  const baselineRevision = git("rev-parse", "HEAD");
  git("update-ref", "refs/remotes/origin/main", baselineRevision);

  const source = createPrototypeClosureSourceClient({ authorityRoot: root, provider: {} });
  const baseline = await source.readBaselineAt(baselineRevision, "sample-tool");
  assert.equal(baseline.lifecycle, "baseline-approved");
  assert.equal(baseline.design_baseline_ref, "record://design-baselines/sample-tool-v1");
  // Independent Python producer encoding; never derive both sides from Closure.
  const recordDigest = execFileSync("python3", ["-c", [
    "import hashlib,json,sys,yaml",
    "record=yaml.safe_load(sys.stdin)['prototypes'][0]",
    "print('sha256:'+hashlib.sha256(json.dumps(record,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()).hexdigest())",
  ].join(";" )], { input: git("show", "HEAD:prototypes.yaml"), encoding: "utf8" }).trim();
  assert.equal(baseline.record_digest, recordDigest);
  assert.notEqual(recordDigest, closureDigest({
    id: "sample-tool", lifecycle: "baseline-approved", source_custody: "incubation-repo",
    design_baseline_ref: baseline.design_baseline_ref, title: "Reviewed — 日本語 😀 é",
  }, { ascii: true }));

  const evaluation = commandFixture("baseline-promotion", 2);
  const decision = createPrototypeMaturityDecision({ evaluation,
    readiness: readinessFixture(evaluation).readiness, operatorRef: caller,
    decision: "approve-baseline", sourceBranch: "prototype-maturity/baseline-test", decidedAt: at });
  const readback = bindPrototypeMaturity({
    ...readbackFixture({ decision, evaluation, preparation: { source_result: { record_digest: recordDigest } } }),
    source_revision: baselineRevision,
  }, "readback_digest");
  const receipt = createPrototypeMaturityReceipt({ decision, readback, completedAt: at });
  const ref = prototypeClosureBaselineReceiptRef(receipt);
  const readerFor = (observed) => createPrototypeClosureBaselineOwnerReader({
    maturityStore: { async get(id) {
      assert.equal(id, evaluation.request.request_id);
      return { status: "succeeded", receipt, readback: observed };
    } }, studioSourceClient: source,
  });
  const lookup = { field: "accepted_baseline_receipt_ref", ref, prototype_id: "sample-tool" };
  assert.equal((await readerFor(readback).read(lookup)).digest, receipt.receipt_digest);
  await assert.rejects(readerFor(readback).read({ ...lookup, prototype_id: "other-tool" }),
    { code: "prototype_closure_baseline_receipt_binding_invalid" });
  await assert.rejects(readerFor({ ...readback, record_digest: `sha256:${"0".repeat(64)}` }).read(lookup),
    /digest/);
  // Even a correctly sealed receipt cannot bless a different source digest.
  const wrong = bindPrototypeMaturity({ ...readback, record_digest: `sha256:${"0".repeat(64)}` }, "readback_digest");
  const wrongReceipt = createPrototypeMaturityReceipt({ decision, readback: wrong, completedAt: at });
  const wrongReader = createPrototypeClosureBaselineOwnerReader({
    maturityStore: { async get() { return { status: "succeeded", receipt: wrongReceipt, readback: wrong }; } },
    studioSourceClient: source,
  });
  await assert.rejects(wrongReader.read(lookup), { code: "prototype_closure_baseline_source_invalid" });
  await assert.rejects(source.readAt(baselineRevision, "sample-tool"));
});

test("Prototype Studio accepts an exact retirement in an isolated clone", { skip: !authorityRoot }, async () => {
  await access(path.join(authorityRoot, "scripts/prototype_closure.py"));
  const revision = execFileSync("git", ["-C", authorityRoot, "rev-parse", "refs/remotes/origin/main"], { encoding: "utf8" }).trim();
  const source = createPrototypeClosureSourceClient({
    authorityRoot,
    provider: { mainRevision: async () => revision },
  });
  const current = await source.state("client-review-portal");
  const request = {
    schema_version: 2,
    artifact_type: "prototype-closure-request",
    request_id: "prototype-closure-request:client-review-portal:retire-conformance",
    prototype_id: "client-review-portal",
    action: "retire-incubation",
    expected_lifecycle: current.lifecycle,
    expected_source_revision: revision,
    operator_id: "operator:source-conformance",
    correlation_id: "conformance:source",
    idempotency_key: "conformance:source",
    retirement_reason: "Local source-adapter conformance only",
    retention_plan_ref: "plan://source-conformance/retention",
    runtime_disposition_plan_ref: "plan://source-conformance/runtime",
  };
  const resolvedAuthority = {
    artifact_type: "prototype-closure-resolved-authority",
    issuer: "operator-orchestration-service",
    request_digest: closureDigest(request, { ascii: true }),
    retention_plan_ref: request.retention_plan_ref,
    runtime_disposition_plan_ref: request.runtime_disposition_plan_ref,
    runtime_disposition_proof_ref: "proof://source-conformance/runtime-absent",
    verification: { state: "accepted", source_revision: revision, evidence_refs: ["proof://source-conformance/runtime-absent"] },
  };
  const record = {
    request,
    resolved_authority: resolvedAuthority,
    binding_digest: closureDigest({ request_id: request.request_id, source_revision: revision }),
  };
  assert.equal(current.source_revision, revision);
  assert.ok(["exploring", "candidate", "baseline-approved", "graduating"].includes(current.lifecycle));
  assert.equal(current.source_custody, "incubation-repo");
  const snapshot = await source.snapshot({ ...record, evaluation: { expected_record_digest: "unbound-in-source-client" } });
  assert.equal(snapshot.lifecycle, current.lifecycle);
  assert.equal(snapshot.source_custody, "incubation-repo");
  const studioState = JSON.parse(execFileSync("python3", [
    path.join(authorityRoot, "scripts/prototype_maturity.py"), "--repo-root", authorityRoot,
    "state", "--prototype-id", "prototype:client-review-portal",
  ], { encoding: "utf8" }));
  // Maturity and Closure hash different producer contracts. Compare to the
  // native Closure-compatible ASCII digest, not Maturity's UTF-8 digest.
  const registry = JSON.parse(execFileSync("python3", ["-c",
    "import json,sys,yaml;print(json.dumps(yaml.safe_load(sys.stdin)))",
  ], { input: execFileSync("git", ["-C", authorityRoot, "show", `${revision}:prototypes.yaml`]), encoding: "utf8" }));
  assert.equal(snapshot.record_digest, closureDigest(registry.prototypes.find(item => item.id === "client-review-portal"), { ascii: true }));
  assert.equal(studioState.expected_state.lifecycle, current.lifecycle);
  assert.equal(current.record_digest, snapshot.record_digest);
  const prepared = await source.prepare(record);
  assert.equal(prepared.event.event_type, "incubation-retired");
  assert.equal(prepared.event.runtime_disposition_proof_ref, resolvedAuthority.runtime_disposition_proof_ref);
  assert.deepEqual(prepared.files.map((file) => file.path).sort(), [prepared.event_path, "prototypes.yaml"].sort());
});
