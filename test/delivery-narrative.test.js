import test from "node:test";
import assert from "node:assert/strict";

import { validateDoneNarrativeState } from "../src/delivery-narrative.js";

test("validateDoneNarrativeState rejects weak execution context bullets", () => {
  const result = validateDoneNarrativeState({
    deliveryTeam: "Workflow Integration",
    iteration: "PI-2026-02 / local follow-on",
    ownerRepo: "operator-orchestration-service",
    parentId: 213,
    rawDescription: [
      "## What This Achieves",
      "",
      "Tightens the done-state ART narrative contract.",
      "",
      "## Why This Matters Now",
      "",
      "Weak done-state bodies were still slipping through.",
      "",
      "## Evidence Expectation",
      "",
      "The broker rejects weak done-state narrative bodies before patching OpenProject.",
      "",
      "## Execution Context",
      "",
      "- Owner repo: `operator-orchestration-service`",
    ].join("\n"),
    typeName: "Task",
  });

  assert.equal(result.formattingValid, false);
  assert.match(result.issues.join("\n"), /Execution Context: missing bullet `Parent item:`/);
  assert.match(result.issues.join("\n"), /Execution Context: missing bullet `Delivery team:`/);
  assert.match(result.issues.join("\n"), /Execution Context: missing bullet `Iteration:`/);
});

test("validateDoneNarrativeState accepts the stronger done-state template", () => {
  const result = validateDoneNarrativeState({
    deliveryTeam: "Workflow Integration",
    iteration: "PI-2026-02 / local follow-on",
    ownerRepo: "operator-orchestration-service",
    parentId: 213,
    rawDescription: [
      "## What This Achieves",
      "",
      "Tightens the done-state ART narrative contract.",
      "",
      "## Why This Matters Now",
      "",
      "Weak done-state bodies were still slipping through.",
      "",
      "## Evidence Expectation",
      "",
      "The broker rejects weak done-state narrative bodies before patching OpenProject.",
      "",
      "## Execution Context",
      "",
      "- Owner repo: `operator-orchestration-service`",
      "- Parent item: #213",
      "- Delivery team: Workflow Integration",
      "- Iteration: PI-2026-02 / local follow-on",
      "- Coordination note: The broker slice owns the fail-closed validation path.",
    ].join("\n"),
    typeName: "Task",
  });

  assert.equal(result.formattingValid, true);
  assert.deepEqual(result.issues, []);
});

test("validateDoneNarrativeState accepts parent item bullets with the subject appended", () => {
  const result = validateDoneNarrativeState({
    deliveryTeam: "Platform Engineering",
    iteration: "PI-2026-02 / Iteration 2",
    ownerRepo: "platform-engineering",
    parentId: 265,
    rawDescription: [
      "## What This Achieves",
      "",
      "Defines the structural type set.",
      "",
      "## Why This Matters Now",
      "",
      "The ART needs one machine-readable taxonomy.",
      "",
      "## Evidence Expectation",
      "",
      "The live ART tree can be filtered by true type and classification.",
      "",
      "## Execution Context",
      "",
      "- Owner repo: `platform-engineering`",
      "- Parent item: `#265` Define the canonical ART structural type, classification, and hierarchy contract",
      "- Delivery team: Platform Engineering",
      "- Iteration: PI-2026-02 / Iteration 2",
    ].join("\n"),
    typeName: "User story",
  });

  assert.equal(result.formattingValid, true);
  assert.deepEqual(result.issues, []);
});
