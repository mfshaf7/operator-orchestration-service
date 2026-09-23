import assert from "node:assert/strict";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { closureDigest } from "../src/prototype-closure/contracts.js";
import { createPrototypeClosureSourceClient } from "../src/prototype-closure/source-client.js";

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
  await assert.rejects(source.readAt(baselineRevision, "sample-tool"));
});

test("Prototype Studio accepts an exact retirement in an isolated clone", { skip: !authorityRoot }, async () => {
  await access(path.join(authorityRoot, "scripts/prototype_closure.py"));
  const revision = execFileSync("git", ["-C", authorityRoot, "rev-parse", "refs/remotes/origin/main"], { encoding: "utf8" }).trim();
  const request = {
    schema_version: 2,
    artifact_type: "prototype-closure-request",
    request_id: "prototype-closure-request:client-review-portal:retire-conformance",
    prototype_id: "client-review-portal",
    action: "retire-incubation",
    expected_lifecycle: "baseline-approved",
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
  const source = createPrototypeClosureSourceClient({
    authorityRoot,
    provider: { mainRevision: async () => revision },
  });
  const current = await source.state("client-review-portal");
  assert.equal(current.source_revision, revision);
  assert.equal(current.lifecycle, "baseline-approved");
  assert.equal(current.source_custody, "incubation-repo");
  assert.deepEqual(current.history, []);
  const snapshot = await source.snapshot({ ...record, evaluation: { expected_record_digest: "unbound-in-source-client" } });
  assert.equal(snapshot.lifecycle, "baseline-approved");
  assert.equal(snapshot.source_custody, "incubation-repo");
  const studioState = JSON.parse(execFileSync("python3", [
    path.join(authorityRoot, "scripts/prototype_maturity.py"), "--repo-root", authorityRoot,
    "state", "--prototype-id", "prototype:client-review-portal",
  ], { encoding: "utf8" }));
  assert.equal(snapshot.record_digest, studioState.expected_state.record_digest);
  assert.equal(current.record_digest, snapshot.record_digest);
  const prepared = await source.prepare(record);
  assert.equal(prepared.event.event_type, "incubation-retired");
  assert.equal(prepared.event.runtime_disposition_proof_ref, resolvedAuthority.runtime_disposition_proof_ref);
  assert.deepEqual(prepared.files.map((file) => file.path).sort(), [prepared.event_path, "prototypes.yaml"].sort());
});
