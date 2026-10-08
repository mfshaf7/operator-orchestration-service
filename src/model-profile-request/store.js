import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import path from "node:path";
import { modelProfileDigest, modelProfileRequestError } from "./contracts.js";

async function acquire(lockPath) {
  const child = spawn(
    "flock",
    ["-n", "-E", "75", lockPath, process.execPath, "-e", "process.stdout.write('locked\\n'); process.stdin.resume();"],
    { stdio: ["pipe", "pipe", "ignore"] },
  );
  let live = true;
  const closed = new Promise((resolve) => child.once("close", () => {
    live = false;
    resolve();
  }));
  await new Promise((resolve, reject) => {
    child.once("error", () => reject(modelProfileRequestError(
      "storage_unavailable",
      "Model-profile request transaction lock is unavailable.",
      503,
    )));
    child.stdout.once("data", resolve);
    child.once("close", () => reject(modelProfileRequestError(
      "busy",
      "A model-profile request transaction is running; retry.",
      409,
    )));
  });
  return {
    assertHeld() {
      if (!live || child.exitCode !== null) {
        throw modelProfileRequestError("lock_lost", "Model-profile request transaction lock was lost.", 503);
      }
    },
    async release() {
      child.stdin.end();
      await closed;
    },
  };
}

const emptyState = () => ({ schema_version: 1, records: {}, idempotency_keys: {} });

export function createModelProfileRequestStore({ root }) {
  const statePath = path.join(root, "state.json");
  async function initialize() {
    await mkdir(root, { recursive: true, mode: 0o700 });
  }
  async function load() {
    try {
      const value = JSON.parse(await readFile(statePath, "utf8"));
      if (
        value.schema_version !== 1 ||
        !value.records ||
        !value.idempotency_keys ||
        value.digest !== modelProfileDigest(value, "digest")
      ) throw new Error("integrity");
      return value;
    } catch (error) {
      if (error.code === "ENOENT") return emptyState();
      throw modelProfileRequestError(
        "storage_invalid",
        "Persisted model-profile request state failed integrity validation.",
        503,
      );
    }
  }
  async function save(value) {
    const temporary = path.join(root, `.${randomUUID()}.tmp`);
    let file;
    try {
      file = await open(temporary, "wx", 0o600);
      await file.writeFile(`${JSON.stringify({ ...value, digest: modelProfileDigest(value, "digest") })}\n`);
      await file.sync();
      await file.close();
      file = null;
      await rename(temporary, statePath);
      const directory = await open(root, "r");
      try { await directory.sync(); } finally { await directory.close(); }
    } finally {
      if (file) await file.close();
      await unlink(temporary).catch((error) => {
        if (error.code !== "ENOENT") throw error;
      });
    }
  }
  async function transact(operation) {
    await initialize();
    const lock = await acquire(path.join(root, "transaction.lock"));
    try {
      const state = await load();
      return await operation({
        assertHeld: lock.assertHeld,
        get(requestId) {
          return structuredClone(state.records[requestId] ?? null);
        },
        idempotency(callerId, key) {
          return structuredClone(state.idempotency_keys[`${callerId}:${key}`] ?? null);
        },
        list() {
          return Object.values(state.records).map((record) => structuredClone(record));
        },
        async put(record, { createKey = null } = {}) {
          lock.assertHeld();
          state.records[record.request.request_id] = structuredClone(record);
          if (createKey) state.idempotency_keys[createKey] = {
            digest: record.request_digest,
            request_id: record.request.request_id,
          };
          await save(state);
        },
      });
    } finally {
      await lock.release();
    }
  }
  return {
    transact,
    async get(requestId) {
      await initialize();
      return structuredClone((await load()).records[requestId] ?? null);
    },
    async list() {
      await initialize();
      return Object.values((await load()).records).map((record) => structuredClone(record));
    },
  };
}
