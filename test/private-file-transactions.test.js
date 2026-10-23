import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createPrivateFileTransactions } from "../src/persistence/private-file-transactions.js";

const failure = (code, message) => Object.assign(new Error(message), { code });
const helper = new URL("../src/persistence/private-file-transactions.js", import.meta.url).href;
const hash = createHash("sha256").update("same-request").digest("hex");

function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), "oos-private-transactions-"));
  return { root, store: createPrivateFileTransactions({ root, failure }), cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function holder(root) {
  return spawn(process.execPath, ["--input-type=module", "-e", `
    import { createPrivateFileTransactions } from ${JSON.stringify(helper)};
    const store = createPrivateFileTransactions({root:process.argv[1],failure:(code,message)=>Object.assign(new Error(message),{code})});
    await store.withLock("same-request", async () => {
      process.stdout.write("held\\n");
      await new Promise(resolve => { process.stdin.resume(); process.stdin.once("end",resolve); });
    });
  `, root], { stdio: ["pipe", "pipe", "pipe"] });
}

test("same-process asynchronous contention holds through settlement and preserves the lock inode", async () => {
  const f = fixture();
  let release;
  try {
    const pending = f.store.withLock("same-request", () => new Promise(resolve => { release = resolve; }));
    const inode = statSync(path.join(f.root, "locks", `${hash}.flock`)).ino;
    assert.throws(() => f.store.withLock("same-request", () => assert.fail("entered")), { code: "state_busy" });
    assert.equal(f.store.withLock("independent-request", () => "independent"), "independent");
    release(); await pending;
    assert.equal(f.store.withLock("same-request", () => "recovered"), "recovered");
    assert.equal(statSync(path.join(f.root, "locks", `${hash}.flock`)).ino, inode);
  } finally { release?.(); f.cleanup(); }
});

test("throwing and rejected operations release the kernel lock", async () => {
  const f = fixture();
  try {
    assert.throws(() => f.store.withLock("same-request", () => { throw new Error("sync"); }), /sync/);
    await assert.rejects(f.store.withLock("same-request", async () => { throw new Error("async"); }), /async/);
    assert.equal(f.store.withLock("same-request", () => "available"), "available");
  } finally { f.cleanup(); }
});

for (const exit of ["graceful", "SIGKILL"]) {
  test(`cross-process exclusion and recovery after ${exit} need no PID or stale-age guess`, { timeout: 10000 }, async () => {
    const f = fixture();
    const child = holder(f.root);
    const closed = once(child, "close");
    try {
      await once(child.stdout, "data");
      assert.throws(() => f.store.withLock("same-request", () => assert.fail("overlapping writer")), { code: "state_busy" });
      if (exit === "graceful") child.stdin.end(); else child.kill(exit);
      await closed;
      const reconstructed = createPrivateFileTransactions({ root: f.root, failure });
      assert.equal(reconstructed.withLock("same-request", () => "recovered"), "recovered");
    } finally { child.kill("SIGKILL"); await closed; f.cleanup(); }
  });
}

test("legacy PID records including a reused live PID fail closed without deletion", () => {
  const f = fixture();
  const legacy = path.join(f.root, "locks", `${hash}.lock`);
  try {
    for (const contents of [JSON.stringify({ pid: process.pid, token: "old-incarnation" }), JSON.stringify({ pid: 999999999, token: "unknown-namespace" }), "invalid"]) {
      writeFileSync(legacy, contents);
      assert.throws(() => f.store.withLock("same-request", () => assert.fail("legacy bypass")), { code: "state_busy" });
      assert.equal(readFileSync(legacy, "utf8"), contents);
    }
    rmSync(legacy); // Models the documented quiesced, verified legacy migration.
    assert.equal(f.store.withLock("same-request", () => "migrated"), "migrated");
  } finally { f.cleanup(); }
});

test("missing kernel lock tooling never executes the protected effect", () => {
  const f = fixture();
  const original = process.env.PATH;
  try {
    process.env.PATH = f.root;
    assert.throws(() => f.store.withLock("same-request", () => assert.fail("unlocked effect")), { code: "state_unavailable" });
  } finally { process.env.PATH = original; f.cleanup(); }
});
