import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { SOURCE_OWNER_BOOTSTRAP_TEMPLATE } from "../src/repository-owner-bootstrap/scaffold.js";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const up = readFileSync(path.join(repo, "dev-integration/profiles/accepted-idea-delivery/scripts/up.sh"), "utf8");
// Execute the native source-copy stanza, not a second hand-maintained file list.
// Ownership/state initialization and lockfile installation are independent of
// file-copy completeness; dependencies here are the test run's installed set.
const copies = [...up.matchAll(/              cp \/source\/package\.json[^]*?(?=              (?:chown|cd) )/g)]
  .map(match => match[0].replace(/^              /gm, ""));

test("all native source-mounted runtimes carry trusted assets and load their real entry modules", t => {
  assert.equal(copies.length, 3, "API, orchestration and Refinement preparations");
  const root = mkdtempSync(path.join(os.tmpdir(), "oos-native-runtime-copy-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const [index, copy] of copies.entries()) {
    const runtime = path.join(root, `runtime-${index}`);
    mkdirSync(runtime);
    const command = copy.replaceAll("/source/", `${repo}/`).replaceAll("/runtime/", `${runtime}/`);
    const prepared = spawnSync("/bin/sh", ["-ec", command], { encoding: "utf8" });
    assert.equal(prepared.status, 0, prepared.stderr);
    symlinkSync(path.join(repo, "node_modules"), path.join(runtime, "node_modules"), "dir");
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", `
      import assert from "node:assert/strict";
      import http from "node:http";
      const {SOURCE_OWNER_BOOTSTRAP_TEMPLATE: template} = await import("./src/repository-owner-bootstrap/scaffold.js");
      assert.equal(template.digest, ${JSON.stringify(SOURCE_OWNER_BOOTSTRAP_TEMPLATE.digest)});
      await import("./src/orchestration-worker.js");
      // The Refinement executable immediately starts authorized work; load
      // its native implementation without invoking that live worker loop.
      await import("./src/refinement/worker.js");
      const {createRuntime} = await import("./src/runtime.js");
      const runtime = createRuntime({env: {}, auditLogger: {log() {}}});
      const server = http.createServer(runtime.app);
      await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
      try {
        const response = await fetch("http://127.0.0.1:" + server.address().port + "/healthz");
        assert.equal(response.status, 200);
        assert.equal((await response.json()).status, "live");
      } finally { await new Promise(resolve => server.close(resolve)); }
      console.log("native-runtime-live");
    `], { cwd: runtime, encoding: "utf8", timeout: 20000, env: { PATH: process.env.PATH } });
    assert.equal(result.status, 0, `native preparation ${index}: ${result.stderr}`);
    assert.match(result.stdout, /native-runtime-live/);
    // Missing trusted assets must remain a visible error, never substituted
    // with caller text or an image asset hidden behind the runtime mount.
    rmSync(path.join(runtime, "templates/source-owner-bootstrap/AGENTS.md.template"));
    const denied = spawnSync(process.execPath, ["--input-type=module", "-e",
      'await import("./src/repository-owner-bootstrap/scaffold.js")'],
    { cwd: runtime, encoding: "utf8", timeout: 10000, env: { PATH: process.env.PATH } });
    assert.notEqual(denied.status, 0);
    assert.match(denied.stderr, /ENOENT/);
  }
});
