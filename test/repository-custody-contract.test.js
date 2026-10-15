import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  assertRepositoryCustodyDecision,
  assertRepositoryCustodyRequest,
  assertRepositoryCustodyWorkflowResult,
  repositoryCustodyAuthority,
  repositoryCustodyRuntimeActivation,
} from "../src/repository-custody/contracts.js";
import { custodyDecision, custodyRequest } from "../test-fixtures/repository-custody.js";

test("repository custody contract validates exact canonical artifacts", () => {
  const request = custodyRequest();
  const decision = custodyDecision(request);
  assert.equal(assertRepositoryCustodyRequest(request), request);
  assert.equal(assertRepositoryCustodyDecision(decision), decision);
  assert.match(repositoryCustodyAuthority().digest, /^sha256:[0-9a-f]{64}$/);
});

test("repository custody OpenAPI examples satisfy the canonical contract", () => {
  const spec = JSON.parse(
    readFileSync(new URL("../docs/api/openapi.json", import.meta.url), "utf8"),
  );
  const operation = spec.paths["/v1/repository-custody/requests"].post;
  const request = operation.requestBody.content["application/json"].example;
  const result = operation.responses["200"].content["application/json"].example;

  assert.equal(assertRepositoryCustodyRequest(request), request);
  assert.equal(assertRepositoryCustodyWorkflowResult(result), result);
});

test("repository custody contract rejects digest and integrity drift", () => {
  const request = custodyRequest();
  request.request_digest = `sha256:${"0".repeat(64)}`;
  assert.throws(
    () => assertRepositoryCustodyRequest(request),
    (error) => error.code === "repository_custody_request_digest_invalid",
  );

  const valid = custodyRequest();
  const decision = custodyDecision(valid);
  decision.evaluated_at = "2026-08-29T08:01:00.000Z";
  assert.throws(
    () => assertRepositoryCustodyDecision(decision),
    (error) => error.code === "repository_custody_integrity_invalid",
  );
});

test("repository custody activation is bound to the reviewed local profile and capabilities", () => {
  assert.deepEqual(repositoryCustodyRuntimeActivation(), {
    enabled: true,
    current_maturity: "security-reviewed-dev-integration",
    active_capabilities: ["link-existing", "provision-new"],
    first_active_capability: "link-existing",
    activation_owner: "platform-engineering",
    allowed_runtime_profile: "dev-integration",
    activation_work_item: "openproject://work_packages/1288",
    platform_commissioning_work_item: "openproject://work_packages/1291",
    operating_proof_work_item: "openproject://work_packages/1298",
    security_review: {
      decision: "approved-with-findings",
      work_item: "openproject://work_packages/1302",
      repo: "security-architecture",
      commit: "3b110925ebf7088242f62f821e8959c59c2bf07d",
      path: "docs/reviews/components/2026-10-15-repository-custody-controlled-activation.md",
    },
  });
});

test("runtime image carries both custody contract layers", () => {
  const dockerfile = readFileSync(new URL("../Dockerfile", import.meta.url), "utf8");
  assert.match(dockerfile, /COPY --chown=node:node contracts\/repository-custody \.\/contracts\/repository-custody/);
  assert.match(dockerfile, /COPY --chown=node:node contracts\/repository-custody-workflow \.\/contracts\/repository-custody-workflow/);
});
