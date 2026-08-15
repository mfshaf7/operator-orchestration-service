import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const baseProfileRoot = path.join(
  repoRoot,
  "dev-integration/profiles/accepted-idea-delivery",
);
const proofProfileRoot = path.join(
  repoRoot,
  "dev-integration/profiles/accepted-idea-delivery-mutation-smoke",
);

test("Proposal workflow state field is injected into the disposable broker runtime", () => {
  const upSource = readFileSync(path.join(baseProfileRoot, "scripts/up.sh"), "utf8");
  assert.match(
    upSource,
    /OPENPROJECT_CUSTOM_FIELD_PROPOSAL_WORKFLOW_STATE_ID=\{backlog_custom_fields\['Proposal Workflow State'\]\}/,
  );
});

test("Proposal live proof enters through the Console and never embeds caller credentials", () => {
  const shellSource = readFileSync(
    path.join(proofProfileRoot, "scripts/proposal-live-e2e.sh"),
    "utf8",
  );
  const scenarioSource = readFileSync(
    path.join(proofProfileRoot, "scripts/proposal-live-e2e.mjs"),
    "utf8",
  );

  assert.match(shellSource, /OOS_BASE_URL=/);
  assert.match(shellSource, /GOVERNANCE_CONSOLE_OPERATOR_ID=/);
  assert.match(shellSource, /scale_if_present deployment "\$\{BROKER_DEPLOYMENT\}" 0/);
  assert.match(shellSource, /--outage-only/);
  assert.match(scenarioSource, /\/api\/proposals/);
  assert.match(scenarioSource, /proveBackendOutage/);
  assert.match(scenarioSource, /status === "offline"/);
  assert.doesNotMatch(scenarioSource, /\/v1\/ideas|\/v1\/proposals/);
  assert.doesNotMatch(scenarioSource, /OOS_CALLER_SECRET|x-oos-caller-secret/);
});

test("disposable smoke runs both consume and graduated Proposal proofs", () => {
  const commonSource = readFileSync(path.join(proofProfileRoot, "scripts/common.sh"), "utf8");
  const profileSource = readFileSync(path.join(proofProfileRoot, "profile.yaml"), "utf8");
  const smokeSource = readFileSync(path.join(proofProfileRoot, "scripts/smoke.sh"), "utf8");
  assert.match(commonSource, /DEVINT_OPENPROJECT_NODE_PORT=.*32283/);
  assert.match(profileSource, /backend-outage rejection/);
  assert.match(smokeSource, /smoke_mutating\.sh/);
  assert.match(smokeSource, /proposal-live-e2e\.sh/);
});
