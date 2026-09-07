import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  bindPrototypeLanding,
  createPrototypeLandingApply,
  createPrototypeLandingEvaluation,
  prototypeLandingDigest,
  prototypeLandingReference,
} from "../src/prototype-landing/contracts.js";
import { createPrototypeLandingSourceClient } from "../src/prototype-landing/source-client.js";
import { readinessFixture } from "../test-fixtures/prototype-landing/fixture.js";
import { commandFixture, caller } from "../test-fixtures/prototype-landing/fixture.js";

const index = process.argv.indexOf("--authority-root");
if (index < 0) throw new Error("Provide --authority-root for the committed Prototype Studio source.");
const authorityRoot = path.resolve(process.argv[index + 1]);
const base = execFileSync("git", ["-C", authorityRoot, "rev-parse", "refs/remotes/origin/main"], { encoding: "utf8" }).trim();
const root = await mkdtemp(path.join(tmpdir(), "prototype-landing-conformance-"));
try {
  const provider = {
    async mainRevision() { return base; },
  };
  const client = createPrototypeLandingSourceClient({ authorityRoot, provider, clock: () => new Date("2026-09-07T12:00:00Z") });
  const state = await client.state("prototype:oos-landing-proof");
  const input = commandFixture();
  input.authority_revision = base;
  input.entry_packet.entry_id = "prototype-entry:direct:oos-landing-proof";
  input.entry_packet = bindPrototypeLanding(input.entry_packet, "packet_digest");
  input.request.request_id = "prototype-landing-request:oos-landing-proof:1";
  input.request.entry_packet_ref = prototypeLandingReference(input.entry_packet);
  input.request.prototype = { id: "prototype:oos-landing-proof", name: "OOS Landing Proof", objective: "Prove the durable source adapter." };
  input.request.source_plan.source_ref = "repo://workspace-prototype-studio/prototypes/oos-landing-proof";
  input.request.expected_state = state.expected_state;
  input.request.idempotency_key = "landing:oos-landing-proof:1";
  input.request.correlation_id = "correlation:oos-landing-proof:1";
  input.request = bindPrototypeLanding(input.request, "request_digest");
  input.plan.plan_id = "prototype-landing-plan:oos-landing-proof:1";
  input.plan.request_ref = prototypeLandingReference(input.request);
  input.plan.prototype_id = input.request.prototype.id;
  input.plan.source_plan = structuredClone(input.request.source_plan);
  input.plan.expected_outputs = input.plan.expected_outputs.map((output) => ({ ...output, target_ref: output.target_ref.replaceAll("sample-tool", "oos-landing-proof") }));
  input.plan = bindPrototypeLanding(input.plan, "plan_digest");
  const evaluation = createPrototypeLandingEvaluation(input, caller);
  const readiness = readinessFixture(evaluation);
  readiness.readiness.readiness_id = "prototype-landing-readiness:oos-landing-proof:1";
  readiness.readiness = bindPrototypeLanding(readiness.readiness, "readiness_digest");
  const record = {
    binding_digest: prototypeLandingDigest({ caller_id: caller, evaluation, operator_approval_ref: input.operator_approval_ref }),
    evaluation,
    operator_approval_ref: input.operator_approval_ref,
    readiness,
  };
  record.apply = createPrototypeLandingApply({
    evaluation,
    readiness: readiness.readiness,
    operatorApprovalRef: input.operator_approval_ref,
    sourceBranch: client.branch(record),
    requestedAt: "2026-09-07T12:00:00Z",
  });
  const prepared = await client.prepare(record, () => {});
  assert.equal(prepared.branch, client.branch(record));
  assert.ok(prepared.file_count >= 8);
  assert.ok(prepared.changed_paths.includes("prototypes.yaml"));
  assert.ok(prepared.changed_paths.includes("records/prototype-landings/oos-landing-proof/record.json"));
  assert.equal(prepared.readback.authority_state, "review-branch");
  assert.equal(prepared.receipt.outcome, "prepared");
  console.log(`Prototype Landing source conformance: ${prepared.file_count} bounded files prepared from ${base}.`);
} finally {
  await rm(root, { recursive: true, force: true });
}
