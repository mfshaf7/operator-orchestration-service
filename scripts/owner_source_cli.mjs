#!/usr/bin/env node

import {
  OWNER_SOURCE_USAGE,
  runOwnerSourceCommand,
} from "../src/owner-source-cli.js";

try {
  process.exitCode = await runOwnerSourceCommand({ argv: process.argv.slice(2) });
} catch (error) {
  process.stderr.write(`${error.code ? `${error.code}: ` : ""}${error.message}\n\n${OWNER_SOURCE_USAGE}`);
  process.exitCode = 1;
}
