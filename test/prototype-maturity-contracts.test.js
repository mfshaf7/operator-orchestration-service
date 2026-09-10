import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  assertPrototypeMaturityArtifact,
  bindPrototypeMaturity,
  createPrototypeMaturityEvaluation,
  prototypeMaturityDigest,
} from "../src/prototype-maturity/contracts.js";
import { createPrototypeMaturityRuntime } from "../src/prototype-maturity/runtime.js";
import {
  caller,
  commandFixture,
} from "../test-fixtures/prototype-maturity/fixture.js";

test("Prototype Maturity validates both transition commands and caller binding", () => {
  for (const transition of ["candidate-promotion", "baseline-promotion"]) {
    const input = commandFixture(transition, transition === "candidate-promotion" ? 1 : 2);
    const evaluation = createPrototypeMaturityEvaluation(input, caller);
    assert.equal(evaluation.artifact_type, "wgcf-prototype-maturity-evaluation");
    assert.equal(evaluation.request.transition, transition);
    assertPrototypeMaturityArtifact(input.request);
    assertPrototypeMaturityArtifact(input.packet);
  }
  assert.throws(
    () => createPrototypeMaturityEvaluation(commandFixture(), "operator:other"),
    /authenticated operator/,
  );
  const changed = commandFixture();
  changed.request.inputs.editable_values["prototype-objective"] = "Changed";
  changed.request = bindPrototypeMaturity(changed.request, "request_digest");
  assert.throws(
    () => createPrototypeMaturityEvaluation(changed, caller),
    /do not bind the same request/,
  );
});

test("Prototype Maturity canonical JSON is deterministic and lossless", () => {
  assert.equal(
    prototypeMaturityDigest({ b: 2, a: 1 }),
    prototypeMaturityDigest({ a: 1, b: 2 }),
  );
  assert.throws(
    () => prototypeMaturityDigest({ value: 1.5 }),
    /lossless integral/,
  );
});

test("Prototype Maturity source activation remains bounded by runtime configuration", () => {
  assert.equal(createPrototypeMaturityRuntime({ config: { enabled: false } }), null);
  assert.throws(
    () =>
      createPrototypeMaturityRuntime({
        config: { enabled: true, profile: "stage" },
      }),
    /approved dev-integration runtime composition/,
  );
  assert.throws(
    () =>
      createPrototypeMaturityRuntime({
        config: { enabled: true, profile: "dev-integration" },
      }),
    /requires stateRoot/,
  );
  const runtime = createPrototypeMaturityRuntime({
    audit: () => {},
    config: {
      enabled: true,
      profile: "dev-integration",
      stateRoot: "/tmp/oos-prototype-maturity-state",
      authorityRoot: "/srv/workspace-prototype-studio",
      tokenFile: "/run/secrets/prototype-maturity-token",
      owner: "mfshaf7",
      repositoryId: "1231020532",
      wgcfBaseUrl: "http://127.0.0.1:8080",
      wgcfCallerId: "operator-orchestration-service",
      wgcfCallerSecret: "s".repeat(32),
      wgcfImplementationRef: "4136e643dc05b0df02cf860c3cbd3052fae8df55",
      wgcfServiceIdentityRef:
        "service-identity://workspace-governance-control-fabric/dev-integration",
    },
    fetchImpl: async () => {
      throw new Error("not invoked during construction");
    },
  });
  assert.ok(runtime);
});

test("Prototype Maturity pins the approved activation chain", () => {
  const manifest = JSON.parse(
    readFileSync(
      new URL("../contracts/prototype-maturity/manifest.json", import.meta.url),
      "utf8",
    ),
  );
  assert.equal(manifest.runtime_activation, true);
  assert.equal(manifest.activation_work_item, "openproject://work_packages/1130");
  assert.equal(
    manifest.readiness_authority.minimum_commit,
    "4136e643dc05b0df02cf860c3cbd3052fae8df55",
  );
  assert.deepEqual(manifest.activation_review, {
    repo: "security-architecture",
    commit: "087118a5f79034684f0ca895a85cb735d1298627",
    path: "docs/reviews/components/2026-09-10-prototype-maturity-normal-availability.md",
    content_sha256: "e0923786d5e19f7843ec4a8941fc007c701dec55e7b3d523695d2049923665da",
    decision: "approved-with-findings",
  });
  assert.equal(
    manifest.activation_evidence.readiness_activation_review_packet.digest,
    "sha256:9a081dfab86b71176fb11aca5e8bc7565a5543532cb329a9e3f44d95b6b8ca6c",
  );
  assert.equal(
    manifest.files["evaluation.schema.json"].commit,
    "4136e643dc05b0df02cf860c3cbd3052fae8df55",
  );
});

test("runtime image carries the pinned Prototype Maturity contract bundle", () => {
  const dockerfile = readFileSync(new URL("../Dockerfile", import.meta.url), "utf8");
  assert.match(
    dockerfile,
    /COPY --chown=node:node contracts\/prototype-maturity \.\/contracts\/prototype-maturity/,
  );
});
