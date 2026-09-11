#!/usr/bin/env node

import { readFileSync } from "node:fs";

const credentialPath = process.env.OOS_AGENT_SOURCE_CREDENTIAL_FILE;
if (!credentialPath) process.exit(2);

const prompt = process.argv.slice(2).join(" ").toLowerCase();
if (prompt.includes("username")) {
  process.stdout.write("x-access-token\n");
  process.exit(0);
}

try {
  const credential = JSON.parse(readFileSync(credentialPath, "utf8"));
  if (typeof credential.token !== "string" || !credential.token) process.exit(2);
  process.stdout.write(`${credential.token}\n`);
} catch {
  process.exit(2);
}
