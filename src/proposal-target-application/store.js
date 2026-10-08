import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import path from "node:path";
import { proposalTargetDigest, proposalTargetError, proposalTargetRestartIdentity } from "./contracts.js";

const key = (value) => createHash("sha256").update(value).digest("hex");

async function acquire(lockPath) {
  const child = spawn("flock", ["-n", "-E", "75", lockPath, process.execPath, "-e", "process.stdout.write('locked\\n'); process.stdin.resume();"], { stdio: ["pipe", "pipe", "ignore"] });
  let live = true;
  const closed = new Promise((resolve) => child.once("close", () => { live = false; resolve(); }));
  await new Promise((resolve, reject) => {
    child.once("error", () => reject(proposalTargetError("storage_unavailable", "Proposal target transaction lock is unavailable.", 503)));
    child.stdout.once("data", resolve);
    child.once("close", () => reject(proposalTargetError("busy", "A Proposal target transaction is running; retry.", 409)));
  });
  return { assertHeld() { if (!live || child.exitCode !== null) throw proposalTargetError("lock_lost", "Proposal target transaction lock was lost.", 503); }, async release() { child.stdin.end(); await closed; } };
}

export function createProposalTargetStore({ root }) {
  async function initialize() { await mkdir(root, { recursive: true, mode: 0o700 }); }
  async function load() {
    try {
      const value = JSON.parse(await readFile(path.join(root, "state.json"), "utf8"));
      if (value.schema_version !== 1 || value.digest !== proposalTargetDigest(value, "digest")) throw new Error("integrity");
      return value;
    } catch (error) {
      if (error.code === "ENOENT") return { schema_version: 1, records: {}, keys: {} };
      throw proposalTargetError("storage_invalid", "Persisted Proposal target state failed integrity validation.", 503);
    }
  }
  async function save(value) {
    const temporary = path.join(root, `.${randomUUID()}.tmp`);
    let file;
    try {
      file = await open(temporary, "wx", 0o600);
      await file.writeFile(`${JSON.stringify({ ...value, digest: proposalTargetDigest(value, "digest") })}\n`);
      await file.sync(); await file.close(); file = null;
      await rename(temporary, path.join(root, "state.json"));
      const directory = await open(root, "r"); try { await directory.sync(); } finally { await directory.close(); }
    } finally {
      if (file) await file.close();
      await unlink(temporary).catch((error) => { if (error.code !== "ENOENT") throw error; });
    }
  }
  async function transact(operation) {
    await initialize();
    const lock = await acquire(path.join(root, "transaction.lock"));
    try {
      const data = await load();
      return await operation({
        assertHeld: lock.assertHeld,
        get(id) { return structuredClone(data.records[key(id)] ?? null); },
        async put(record) {
          lock.assertHeld();
          const id = key(record.evaluation.application_id);
          const idempotency = key(record.evaluation.idempotency_key);
          const existing = data.records[id];
          if ((existing && existing.binding_digest !== record.binding_digest) || (data.keys[idempotency] && data.keys[idempotency] !== id)) {
            throw proposalTargetError("idempotency_conflict", "The application or idempotency key is bound to different target input.");
          }
          data.records[id] = structuredClone(record); data.keys[idempotency] = id; await save(data);
        },
        async restart(record) {
          lock.assertHeld();
          const id = key(record.evaluation.application_id);
          const idempotency = key(record.evaluation.idempotency_key);
          const existing = data.records[id];
          const restartable = existing?.status === "cancelled" &&
            !existing.preparation && !existing.review && !existing.target_result && !existing.proposal_acknowledgement &&
            proposalTargetRestartIdentity(existing.evaluation) === proposalTargetRestartIdentity(record.evaluation) &&
            proposalTargetDigest(existing.proposal) === proposalTargetDigest(record.proposal) &&
            data.keys[idempotency] === id;
          if (!restartable || existing.binding_digest === record.binding_digest) {
            throw proposalTargetError("idempotency_conflict", "The application or idempotency key cannot be restarted with different target input.");
          }
          data.records[id] = structuredClone(record); await save(data);
        },
      });
    } finally { await lock.release(); }
  }
  return { transact, async get(id) { await initialize(); return structuredClone((await load()).records[key(id)] ?? null); } };
}
