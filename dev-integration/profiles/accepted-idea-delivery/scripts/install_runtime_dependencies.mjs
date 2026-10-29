import { spawnSync } from "node:child_process";
import { lstatSync } from "node:fs";

// Only package downloads persist. npm ci reconstructs node_modules from the
// selected lockfile and verifies package integrity on every container start.
const cache = "/npm-cache";
const state = lstatSync(cache);
if (!state.isDirectory() || state.isSymbolicLink() || state.uid !== 1000) {
  throw new Error("Runtime dependency cache is not the operator-owned directory");
}
if (process.getuid() === 0) {
  process.setgid(1000);
  process.setuid(1000);
}
const result = spawnSync("/usr/local/bin/npm", [
  "ci", "--omit=dev", "--prefer-offline", `--cache=${cache}`,
  "--fetch-timeout=30000", "--fetch-retries=1",
], {
  cwd: "/runtime",
  env: { ...process.env, HOME: "/tmp" },
  stdio: "inherit",
  timeout: 480_000,
  killSignal: "SIGKILL",
});
if (result.error) console.error("Runtime dependency preparation failed:", result.error.code);
process.exit(result.status ?? 1);
