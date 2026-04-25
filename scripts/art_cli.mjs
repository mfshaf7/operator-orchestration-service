#!/usr/bin/env node

import { spawn } from "node:child_process";

import { artCliUsage, runArtCliCommand } from "../src/art-cli.js";

async function main() {
  try {
    const exitCode = await runArtCliCommand({
      argv: process.argv.slice(2),
      spawnImpl: spawn,
      stderr: process.stderr,
      stdout: process.stdout,
    });
    process.exit(exitCode);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n\n${artCliUsage()}`);
    process.exit(1);
  }
}

await main();
