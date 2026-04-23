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
  assert.match(result.issues.join("\n"), /Test Result Evidence: line does not match/);
  assert.match(result.issues.join("\n"), /Validation Evidence: line does not match/);
});

test("validateCompletionSections accepts prefixed evidence bullets and attached artifacts", () => {
  const result = validateCompletionSections(
    buildCompletionSections({
      changedSurfaces: "- docs/api/openapi.json\n- scripts/validate_completion_evidence.mjs",
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
