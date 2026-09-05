import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import path from "node:path";
import { intakeDigest, intakeError } from "./contracts.js";

const key = (value) => createHash("sha256").update(value).digest("hex");

// Kernel-owned lock survives neither process death nor host restart. No stale
// PID-file deletion can race a second owner acquiring the same transaction.
async function acquire(lockPath) {
  const child = spawn("flock", ["-n", "-E", "75", lockPath, process.execPath, "-e", "process.stdout.write('locked\\n'); process.stdin.resume();"], { stdio: ["pipe", "pipe", "ignore"] });
  let live = true;
  const closed = new Promise((resolve) => child.once("close", () => { live = false; resolve(); }));
  await new Promise((resolve, reject) => {
    child.once("error", () => reject(intakeError("storage_unavailable", "Intake transaction lock is unavailable.", 503)));
    child.stdout.once("data", () => resolve());
    child.once("close", () => reject(intakeError("busy", "An intake transaction is running; retry.", 409)));
  });
  return {
    assertHeld() {
      if (!live || child.exitCode !== null) throw intakeError("lock_lost", "Intake transaction lock was lost.", 503);
    },
    async release() { child.stdin.end(); await closed; },
  };
}

export function createWorkspaceIntakeStore({ root }) {
  async function initialize() { await mkdir(root, { recursive: true, mode: 0o700 }); }
  async function load() {
    try {
      const value = JSON.parse(await readFile(path.join(root, "state.json"), "utf8"));
      if (value.schema_version !== 1 || value.digest !== intakeDigest(value, "digest")) throw new Error("integrity");
      return value;
    } catch (error) {
      if (error.code === "ENOENT") return { schema_version: 1, records: {}, keys: {} };
      throw intakeError("storage_invalid", "Persisted intake workflow state failed integrity validation.", 503);
    }
  }
  async function save(value) {
    const temp = path.join(root, `.${randomUUID()}.tmp`);
    let file;
    try {
      file = await open(temp, "wx", 0o600);
      await file.writeFile(`${JSON.stringify({ ...value, digest: intakeDigest(value, "digest") })}\n`);
      await file.sync();
      await file.close(); file = null;
      await rename(temp, path.join(root, "state.json"));
      const directory = await open(root, "r");
      try { await directory.sync(); } finally { await directory.close(); }
    } finally {
      if (file) await file.close();
      await unlink(temp).catch((error) => { if (error.code !== "ENOENT") throw error; });
    }
  }
  async function transact(operation) {
    await initialize();
    const lock = await acquire(path.join(root, "transaction.lock"));
    try {
      const data = await load();
      return await operation({
        assertHeld: lock.assertHeld,
        get(requestId) { return structuredClone(data.records[key(requestId)] ?? null); },
        async put(record) {
          lock.assertHeld();
          const id = key(record.request.request_id);
          const idempotency = key(record.request.idempotency_key);
          const existing = data.records[id];
          if ((existing && existing.binding_digest !== record.binding_digest) ||
              (data.keys[idempotency] && data.keys[idempotency] !== id)) {
            throw intakeError("idempotency_conflict", "The request or idempotency key is already bound to another command.");
          }
          data.records[id] = structuredClone(record);
          data.keys[idempotency] = id;
          await save(data);
        },
      });
    } finally { await lock.release(); }
  }
  return { transact, async get(requestId) { await initialize(); return structuredClone((await load()).records[key(requestId)] ?? null); } };
}
