import fs from "node:fs";

import {
  buildCompletionSections,
  DELIVERY_COMPLETION_REQUIRED_SECTION_NAMES,
  DELIVERY_COMPLETION_SECTION_RULE_GUIDANCE,
  validateCompletionSections,
} from "../src/completion-evidence.js";

function usage() {
  console.error(
    "usage: node scripts/validate_completion_evidence.mjs [payload.json|-]\n" +
      "Reads either a full complete-route request ({ input: { ... } }) or the inner input object.\n" +
      "Examples:\n" +
      "  node scripts/validate_completion_evidence.mjs payload.json\n" +
      "  cat payload.json | node scripts/validate_completion_evidence.mjs -",
  );
  process.exit(1);
}

function fail(message) {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

function readSource(args) {
  if (args.length === 0 || args[0] === "-") {
    return fs.readFileSync(0, "utf8");
  }

  if (args.length === 1) {
    return fs.readFileSync(args[0], "utf8");
  }

  usage();
}

function parsePayload(source) {
  try {
    const parsed = JSON.parse(source);
    if (parsed && typeof parsed === "object" && parsed.input && typeof parsed.input === "object") {
      return parsed.input;
    }
    return parsed;
  } catch (error) {
    fail(`could not parse JSON payload: ${error.message}`);
  }
}

function requireString(payload, key) {
  if (typeof payload?.[key] !== "string") {
    fail(`payload is missing required string field ${key}`);
  }

  return payload[key];
}

const args = process.argv.slice(2);
if (args.length > 1 || args.includes("--help")) {
  usage();
}

const payload = parsePayload(readSource(args));
if (!payload || typeof payload !== "object") {
  fail("payload must be a JSON object or an { input: ... } envelope");
}

const completionSections = buildCompletionSections({
  changedSurfaces: requireString(payload, "changed_surfaces"),
  completionSummary: requireString(payload, "completion_summary"),
  residualFollowUp:
    typeof payload.residual_follow_up === "string" ? payload.residual_follow_up : null,
  testResultArtifact:
    payload.test_result_artifact && typeof payload.test_result_artifact === "object"
      ? payload.test_result_artifact
      : null,
  testResultEvidence: requireString(payload, "test_result_evidence"),
  validationEvidence: requireString(payload, "validation_evidence"),
});

const result = validateCompletionSections(completionSections);
if (!result.formattingValid) {
  console.error("ART completion evidence invalid.");
  for (const issue of result.issues) {
    console.error(`- ${issue}`);
  }
  console.error("\nRequired section guidance:");
  for (const heading of DELIVERY_COMPLETION_REQUIRED_SECTION_NAMES) {
    console.error(`- ${heading}: ${DELIVERY_COMPLETION_SECTION_RULE_GUIDANCE[heading]}`);
  }
  process.exit(1);
}

console.log("ART completion evidence valid.");
for (const heading of DELIVERY_COMPLETION_REQUIRED_SECTION_NAMES) {
  console.log(`- PASS: ${heading}`);
}
