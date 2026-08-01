import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  GENERATION_START_REGISTRY_WORKFLOW_TYPE,
} from "../src/orchestration/constants.js";
import {
  assertGenerationStartRegistration,
  assertGenerationStartRegistryInput,
  assertGenerationStartRegistryMatches,
  assertGenerationStartRegistryResult,
  assertGenerationStartRegistrySeal,
} from "../src/orchestration/generation-start-registry.js";
import {
  TEST_ACTIVATION_EVIDENCE_DIGEST,
  TEST_GENERATION_START_REGISTRY_ID,
  TEST_GENERATION_START_REGISTRY_QUEUE,
  TEST_VALIDATION_READINESS_WORKFLOW_QUEUE,
  validGenerationStartRegistration,
  validGenerationStartRegistryInput,
} from "../test-fixtures/orchestration.js";

const RETIREMENT_ID =
  "platform-engineering://retirement/validation-readiness-run/v1/dev-integration/1";

test("generation registry input is derived entirely from activation evidence", () => {
  const input = validGenerationStartRegistryInput();

  assert.equal(input.registry_id, TEST_GENERATION_START_REGISTRY_ID);
  assert.equal(input.registry_task_queue, TEST_GENERATION_START_REGISTRY_QUEUE);
  assert.equal(
    input.business_workflow_task_queue,
    TEST_VALIDATION_READINESS_WORKFLOW_QUEUE,
  );
  assert.deepEqual(assertGenerationStartRegistryInput(input), input);
  assertMatchesPublishedSchema(
    input,
    "generation-start-registry-input.schema.json",
  );
});

test("generation start registration accepts only this definition run identity", () => {
  const registration = validGenerationStartRegistration();

  assert.deepEqual(
    assertGenerationStartRegistration(registration),
    registration,
  );
  assertMatchesPublishedSchema(
    registration,
    "generation-start-registration.schema.json",
  );
  assert.throws(
    () => assertGenerationStartRegistration({
      ...registration,
      workflow_id: "another-workflow",
    }),
    /must identify a bounded OOS durable run/,
  );
});

test("generation registry seal and result remain strict machine contracts", () => {
  const seal = {
    retirement_id: RETIREMENT_ID,
    schema_version: 1,
  };
  const result = validRegistryResult();

  assert.deepEqual(assertGenerationStartRegistrySeal(seal), seal);
  assert.deepEqual(assertGenerationStartRegistryResult(result), result);
  assert.deepEqual(
    assertGenerationStartRegistryMatches(
      result,
      TEST_ACTIVATION_EVIDENCE_DIGEST,
    ),
    result,
  );
  assertMatchesPublishedSchema(
    seal,
    "generation-start-registry-seal.schema.json",
  );
  assertMatchesPublishedSchema(
    result,
    "generation-start-registry-result.schema.json",
  );
});

test("generation registry result rejects ambiguity or poisoned registrations", () => {
  const result = validRegistryResult();

  assert.throws(
    () => assertGenerationStartRegistryResult({
      ...result,
      registered_workflow_ids: [
        result.registered_workflow_ids[0],
        result.registered_workflow_ids[0],
      ],
    }),
    /unique and canonically sorted/,
  );
  assert.throws(
    () => assertGenerationStartRegistryMatches(
      { ...result, invalid_registration_count: 1 },
      TEST_ACTIVATION_EVIDENCE_DIGEST,
    ),
    /contains invalid registrations/,
  );
});

function validRegistryResult() {
  return {
    activation_evidence_digest: TEST_ACTIVATION_EVIDENCE_DIGEST,
    business_workflow_task_queue: TEST_VALIDATION_READINESS_WORKFLOW_QUEUE,
    invalid_registration_count: 0,
    registered_workflow_ids: [
      validGenerationStartRegistration().workflow_id,
    ],
    registry_id: TEST_GENERATION_START_REGISTRY_ID,
    registry_task_queue: TEST_GENERATION_START_REGISTRY_QUEUE,
    registry_workflow_type: GENERATION_START_REGISTRY_WORKFLOW_TYPE,
    schema_version: 1,
    seal_ref: RETIREMENT_ID,
    sealed_at: "2026-07-31T12:00:30.000Z",
  };
}

function assertMatchesPublishedSchema(value, schemaName) {
  const schema = JSON.parse(
    readFileSync(
      new URL(`../contracts/orchestration/${schemaName}`, import.meta.url),
      "utf8",
    ),
  );
  assert.deepEqual(Object.keys(value).sort(), [...schema.required].sort());
  assert.deepEqual(
    Object.keys(schema.properties).sort(),
    [...schema.required].sort(),
  );
}
