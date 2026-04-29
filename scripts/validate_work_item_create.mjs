import fs from "node:fs";

import { validateWorkItemCreateInput } from "../src/work-item-create-preflight.js";

function usage() {
  console.error(
    "usage: node scripts/validate_work_item_create.mjs [payload.json|-]\n" +
      "Reads either a full create-route request ({ input: { ... } }) or the inner input object.\n" +
      "Examples:\n" +
      "  node scripts/validate_work_item_create.mjs payload.json\n" +
      "  cat payload.json | node scripts/validate_work_item_create.mjs -",
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
    return JSON.parse(source);
  } catch (error) {
    fail(`could not parse JSON payload: ${error.message}`);
  }
}

const args = process.argv.slice(2);
if (args.length > 1 || args.includes("--help")) {
  usage();
}

const result = validateWorkItemCreateInput(parsePayload(readSource(args)));
if (!result.valid) {
  console.error("ART work-item create payload invalid.");
  for (const issue of result.issues) {
    console.error(`- ${issue}`);
  }
  process.exit(1);
}

console.log("ART work-item create payload valid.");
