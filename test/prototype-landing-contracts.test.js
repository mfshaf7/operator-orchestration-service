import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  assertPrototypeLandingArtifact,
  bindPrototypeLanding,
  createPrototypeLandingEvaluation,
  prototypeLandingDigest,
} from "../src/prototype-landing/contracts.js";
import { caller, commandFixture } from "../test-fixtures/prototype-landing/fixture.js";
import { createPrototypeLandingRuntime } from "../src/prototype-landing/runtime.js";

test("Prototype Landing validates exact artifacts and operator-bound evaluation", () => {
  const input = commandFixture();
  const evaluation = createPrototypeLandingEvaluation(input, caller);
  assert.equal(evaluation.artifact_type, "wgcf-prototype-landing-evaluation");
  assert.equal(evaluation.authority_revision, input.request.expected_state.source_revision);
  assertPrototypeLandingArtifact(input.entry_packet);
  assertPrototypeLandingArtifact(input.request);
  assertPrototypeLandingArtifact(input.plan);
  const changed = structuredClone(input);
  changed.request.prototype.name = "Browser replacement";
  changed.request = bindPrototypeLanding(changed.request, "request_digest");
  assert.throws(() => createPrototypeLandingEvaluation(changed, caller), /artifacts do not bind/);
  assert.throws(() => createPrototypeLandingEvaluation(input, "operator:other"), /authenticated operator/);
});

test("Prototype Landing canonical JSON is deterministic and rejects lossy values", () => {
  assert.equal(prototypeLandingDigest({ b: 2, a: 1 }), prototypeLandingDigest({ a: 1, b: 2 }));
  assert.throws(() => prototypeLandingDigest({ value: 1.5 }), /lossless integral/);
});

test("Prototype Landing cannot activate before the Platform gate updates its pinned manifest", () => {
  assert.equal(createPrototypeLandingRuntime({ config: { enabled: false } }), null);
  assert.throws(() => createPrototypeLandingRuntime({ config: { enabled: true, profile: "dev-integration" } }), /awaits the reviewed Platform activation/);
});

test("runtime image carries the pinned Prototype Landing contract bundle", () => {
  const dockerfile = readFileSync(new URL("../Dockerfile", import.meta.url), "utf8");
  assert.match(dockerfile, /COPY --chown=node:node contracts\/prototype-landing \.\/contracts\/prototype-landing/);
});
