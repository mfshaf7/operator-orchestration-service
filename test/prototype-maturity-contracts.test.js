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

test("Prototype Maturity remains unavailable until explicit activation", () => {
  assert.equal(createPrototypeMaturityRuntime({ config: { enabled: false } }), null);
  assert.throws(
    () =>
      createPrototypeMaturityRuntime({
        config: { enabled: true, profile: "dev-integration" },
      }),
    /awaits the reviewed Platform activation/,
  );
});

test("runtime image carries the pinned Prototype Maturity contract bundle", () => {
  const dockerfile = readFileSync(new URL("../Dockerfile", import.meta.url), "utf8");
  assert.match(
    dockerfile,
    /COPY --chown=node:node contracts\/prototype-maturity \.\/contracts\/prototype-maturity/,
  );
});
