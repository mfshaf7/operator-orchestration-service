import test from "node:test";
import assert from "node:assert/strict";

import {
  buildCompletionSections,
  validateCompletionSections,
} from "../src/completion-evidence.js";

test("validateCompletionSections rejects raw command bullets for closeout evidence", () => {
  const result = validateCompletionSections(
    buildCompletionSections({
      changedSurfaces: "- docs/api/openapi.json",
      completionSummary: "Tightened the completion write preflight.",
      testResultEvidence: "- npm test",
      validationEvidence: "- git diff --check",
    }),
  );

  assert.equal(result.formattingValid, false);
  assert.deepEqual(result.sections, {
    "Changed Surfaces": true,
    "Completion Summary": true,
    "Test Result Evidence": true,
    "Validation Evidence": true,
    "Residual Follow-Up": false,
  });
  assert.match(result.issues.join("\n"), /Changed Surfaces: changed surface bullet must explain/);
  assert.match(result.issues.join("\n"), /Changed Surfaces: changed surface paths must be code-formatted/);
  assert.match(result.issues.join("\n"), /Test Result Evidence: line does not match/);
  assert.match(result.issues.join("\n"), /Validation Evidence: line does not match/);
});

test("validateCompletionSections accepts prefixed evidence bullets and attached artifacts", () => {
  const result = validateCompletionSections(
    buildCompletionSections({
      changedSurfaces:
        "- `docs/api/openapi.json`: documents the completion route contract.\n- `scripts/validate_completion_evidence.mjs`: runs the local evidence preflight before the broker write.",
      completionSummary: "Added a local completion-evidence preflight.",
      testResultArtifact: {
        file_name: "proof.txt",
      },
      testResultEvidence: "- PASS: `npm test`",
      validationEvidence:
        "- PASS: `npm run validate:completion-evidence -- payload.json`\n- CHECK: `git diff --check`",
    }),
  );

  assert.equal(result.formattingValid, true);
  assert.deepEqual(result.issues, []);
});

test("validateCompletionSections accepts code-formatted paths with prose slash terms", () => {
  const result = validateCompletionSections(
    buildCompletionSections({
      changedSurfaces:
        "- `operator-orchestration-service/src/art-workflow-artifacts.js`: backs the CLI with managed draft read/write behavior, route metadata, validation state, and submission results.\n- `operator-orchestration-service/docs/operations/delivery-workflow-operator-surface.md`: documents the routine draft path and keeps export/import framed as compatibility or debug actions, not the default evidence path.",
      completionSummary: "Repaired done-state notes to match the closeout standard.",
      testResultEvidence: "- PASS: `npm test`",
      validationEvidence: "- PASS: `npm run art -- draft validate .art/drafts/example.json`",
    }),
  );

  assert.equal(result.formattingValid, true);
  assert.deepEqual(result.issues, []);
});

test("validateCompletionSections rejects unexplained changed-surface references", () => {
  const result = validateCompletionSections(
    buildCompletionSections({
      changedSurfaces:
        "- `src/openproject-client.js`\n- PR #76\n- operator-orchestration-service/docs/api/openapi.json",
      completionSummary: "Closed the broker-side completion quality guard.",
      testResultEvidence: "- PASS: `npm test`",
      validationEvidence: "- PASS: `git diff --check`",
    }),
  );

  assert.equal(result.formattingValid, false);
  assert.match(result.issues.join("\n"), /must explain what changed/);
  assert.match(result.issues.join("\n"), /PR references must use a markdown link or URL/);
  assert.match(result.issues.join("\n"), /paths must be code-formatted/);
});
