import assert from "node:assert/strict";
import test from "node:test";
import {
  assertInventoryRegistry,
  assertInventory,
  bindInventory,
  createInventoryEvaluation,
  inventoryDigest,
  inventoryStringify,
  registryProjectionDigest,
} from "../src/workspace-inventory/contracts.js";
import { caller, inputFixture, registryFixture } from "../test-fixtures/workspace-inventory/fixture.js";

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

test("Workspace Inventory registry contracts reject altered source projections", () => {
  const registry = registryFixture();
  assert.equal(assertInventoryRegistry(registry), registry);
  assert.throws(
    () => assertInventoryRegistry({ ...registry, authority_revision: "2".repeat(40) }),
    /projection digest/,
  );
  const altered = structuredClone(registry);
  altered.eligible_promotions[0].active_record.value.owner_repo = "other-repo";
  altered.projection_digest = registryProjectionDigest(altered);
  altered.projection_id = `workspace-inventory-registry:${altered.projection_digest.slice(7, 31)}`;
  assert.throws(() => assertInventoryRegistry(altered), /promotion candidate/);
});
