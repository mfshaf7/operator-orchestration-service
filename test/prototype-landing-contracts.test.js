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

test("Prototype Landing source activation remains bounded by runtime configuration", () => {
  assert.equal(createPrototypeLandingRuntime({ config: { enabled: false } }), null);
  assert.throws(
    () => createPrototypeLandingRuntime({ config: { enabled: true, profile: "stage" } }),
    /awaits the reviewed Platform activation/,
  );
  assert.throws(
    () => createPrototypeLandingRuntime({ config: { enabled: true, profile: "dev-integration" } }),
    /requires stateRoot/,
  );
  const runtime = createPrototypeLandingRuntime({
    audit: () => {},
    config: {
      enabled: true,
      profile: "dev-integration",
      stateRoot: "/tmp/oos-prototype-landing-state",
      authorityRoot: "/srv/workspace-prototype-studio",
      tokenFile: "/run/secrets/prototype-landing-token",
      owner: "mfshaf7",
      repositoryId: "123",
      wgcfBaseUrl: "http://127.0.0.1:8080",
      wgcfCallerId: "operator-orchestration-service",
      wgcfCallerSecret: "s".repeat(32),
      wgcfImplementationRef: "c099752592825e8988dca32a1a0e40c590cd9d66",
      wgcfServiceIdentityRef: "spiffe://workspace/wgcf/prototype-landing",
    },
    fetchImpl: async () => { throw new Error("not invoked during construction"); },
  });
  assert.ok(runtime);
});

test("Prototype Landing pins the merged normal-availability review and WGCF activation", () => {
  const manifest = JSON.parse(readFileSync(new URL("../contracts/prototype-landing/manifest.json", import.meta.url), "utf8"));
  assert.equal(manifest.runtime_activation, true);
  assert.equal(manifest.activation_work_item, "openproject://work_packages/1113");
  assert.deepEqual(manifest.activation_review, {
    repo: "security-architecture",
    commit: "7acfd9f86c24e8d454c7df8ee29abfbf2ad8ae20",
    path: "docs/reviews/components/2026-09-08-prototype-landing-normal-availability.md",
    content_sha256: "80091cb2ac0154711ed011edd832d07ef540ad7e9732e9eae2c68b9c237d076f",
    decision: "approved-with-findings",
  });
  assert.equal(
    manifest.files["evaluation.schema.json"].commit,
    "c099752592825e8988dca32a1a0e40c590cd9d66",
  );
});

test("runtime image carries the pinned Prototype Landing contract bundle", () => {
  const dockerfile = readFileSync(new URL("../Dockerfile", import.meta.url), "utf8");
  const pinnedNodeBase = "node:22.22.0-bookworm-slim@sha256:dd9d21971ec4395903fa6143c2b9267d048ae01ca6d3ea96f16cb30df6187d94";
  assert.equal(dockerfile.split(`FROM ${pinnedNodeBase}`).length - 1, 2);
  assert.match(dockerfile, /await mkdir\(root \+ '\/a\/b', \{ recursive: true \}\)/);
  assert.match(dockerfile, /COPY --chown=node:node contracts\/prototype-landing \.\/contracts\/prototype-landing/);
});
