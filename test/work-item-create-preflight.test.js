import assert from "node:assert/strict";
import test from "node:test";

import { validateWorkItemCreateInput } from "../src/work-item-create-preflight.js";

const validPiObjectivePayload = {
  input: {
    acceptance_criteria: "- Architecture slice can start from this objective.",
    actual_business_value: 0,
    assignee_login: "Workspace Governance",
    definition_of_done: "- Design artifacts are merged and reviewed.",
    definition_of_ready: "- Admission foundation is complete.",
    delivery_team: "Platform Architecture",
    description: [
      "## Outcome",
      "",
      "Define the architecture and trust-boundary foundation.",
      "",
      "## Why This PI",
      "",
      "Implementation depends on stable architecture truth.",
      "",
      "## Success Signal",
      "",
      "Runtime features can consume the design without chat memory.",
      "",
      "## Execution Context",
      "",
      "- Owner Repo: workspace-governance",
      "- Parent Item: #420 Build Workspace Governance Control Fabric foundation",
      "- Delivery Team: Platform Architecture",
      "- Iteration: PI-2026-03 / Iteration 1",
    ].join("\n"),
    iteration: "PI-2026-03 / Iteration 1",
    owner_repo: "workspace-governance",
    parent_work_item_id: "work-item-420",
    pi_objective_type: "Committed",
    planned_business_value: 8,
    responsible_login: "Workspace Governance",
    status: "in-progress",
    subject: "Define the control-fabric architecture foundation",
    target_pi: "PI-2026-03",
    type: "PI Objective",
  },
};

test("validateWorkItemCreateInput accepts an active PI Objective with required narrative", () => {
  const result = validateWorkItemCreateInput(validPiObjectivePayload);

  assert.equal(result.valid, true);
  assert.deepEqual(result.issues, []);
});

test("validateWorkItemCreateInput rejects active PI Objective missing narrative headings", () => {
  const payload = structuredClone(validPiObjectivePayload);
  payload.input.description = "Create the PI objective.";

  const result = validateWorkItemCreateInput(payload);

  assert.equal(result.valid, false);
  assert.equal(
    result.issues.some((entry) => entry.includes("Description heading start")),
    true,
  );
  assert.equal(
    result.issues.some((entry) =>
      entry.includes("Narrative headings: Outcome, Why This PI, Success Signal, Execution Context"),
    ),
    true,
  );
});

test("validateWorkItemCreateInput rejects active PI Objective missing business value", () => {
  const payload = structuredClone(validPiObjectivePayload);
  delete payload.input.actual_business_value;

  const result = validateWorkItemCreateInput(payload);

  assert.equal(result.valid, false);
  assert.equal(
    result.issues.includes(
      "Actual Business Value: input.actual_business_value is required for active PI Objective creation",
    ),
    true,
  );
});
