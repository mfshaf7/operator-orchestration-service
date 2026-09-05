import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { assertIntake, bindIntake, createIntakeEvaluation, intakeDigest, intakeStringify } from "../src/workspace-intake/contracts.js";
import { createWorkspaceIntakeRuntime } from "../src/workspace-intake/runtime.js";
import { caller, inputFixture } from "../test-fixtures/workspace-intake/fixture.js";

test("intake uses Python-compatible Unicode canonical JSON without changing ART", () => {
  const value = { "\u{10000}": "non-BMP", "\ue000": "BMP", text: "quoted\nvalue", array: [1, true, null] };
  const expected = execFileSync("python3", ["-c", "import json,sys; print(json.dumps(json.loads(sys.argv[1]),ensure_ascii=False,sort_keys=True,separators=(',',':')))", JSON.stringify(value)], { encoding: "utf8" }).trim();
  assert.equal(intakeStringify(value), expected);
  for (const invalid of [1.1, NaN, Infinity, 2 ** 54, "\ud800", undefined]) assert.throws(() => intakeDigest(invalid));
});

test("request and evaluation bind exact decision, caller, session and execution", () => {
  const input = inputFixture();
  const result = createIntakeEvaluation(input, caller);
  assertIntake("evaluation", result);
  assert.equal(result.evaluation_digest, intakeDigest(result, "evaluation_digest"));
  assert.throws(() => createIntakeEvaluation(input, "operator:other"), /authenticated operator/);
  assert.throws(() => createIntakeEvaluation({ ...input, extra: true }, caller));
  const changed = structuredClone(input);
  changed.request.requested_record.notes = "tampered";
  assert.throws(() => createIntakeEvaluation(changed, caller), /digest/);
  changed.request = bindIntake(changed.request, "request_digest");
  assert.throws(() => createIntakeEvaluation(changed, caller), /exact request/);
  assert.notEqual(result.evaluation_digest, createIntakeEvaluation({ ...input, session_ref: "session:other" }, caller).evaluation_digest);
});

test("runtime stays off and configuration cannot bypass activation", () => {
  assert.equal(createWorkspaceIntakeRuntime({ config: { enabled: false } }), null);
  assert.throws(() => createWorkspaceIntakeRuntime({ config: { enabled: true, profile: "dev-integration" } }), /activation/);
});
