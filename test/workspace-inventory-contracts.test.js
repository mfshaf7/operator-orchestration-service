import assert from "node:assert/strict";
import test from "node:test";
import {
  assertInventory,
  bindInventory,
  createInventoryEvaluation,
  inventoryDigest,
  inventoryStringify,
} from "../src/workspace-inventory/contracts.js";
import { caller, inputFixture } from "../test-fixtures/workspace-inventory/fixture.js";

test("Workspace Inventory contracts are deterministic and caller-bound", () => {
  const input = inputFixture();
  const evaluation = createInventoryEvaluation(input, caller);
  assert.equal(assertInventory("request", input.request), input.request);
  assert.equal(assertInventory("evaluation", evaluation), evaluation);
  assert.equal(evaluation.request.request_digest, input.request.request_digest);
  assert.equal(inventoryDigest({ b: 2, a: 1 }), inventoryDigest({ a: 1, b: 2 }));
  assert.equal(inventoryStringify({ b: 2, a: 1 }), '{"a":1,"b":2}');
  assert.throws(() => createInventoryEvaluation(input, "operator:other"), /authenticated operator/);
  assert.throws(() => createInventoryEvaluation({ ...input, extra: true }, caller), /Supply request/);
  assert.throws(() => assertInventory("request", bindInventory({ ...input.request, target: { ...input.request.target, name: "Invalid Name" } }, "request_digest")), /Invalid Workspace Inventory request/);
});
