import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import path from "node:path";

import {
  lifecycleTransitionDigest,
  lifecycleTransitionError,
} from "./contracts.js";

const key = (value) => createHash("sha256").update(value).digest("hex");

async function acquire(lockPath) {
  const child = spawn("flock", [
    "-n",
    "-E",
    "75",
    lockPath,
    process.execPath,
    "-e",
    "process.stdout.write('locked\\n'); process.stdin.resume();",
  ], { stdio: ["pipe", "pipe", "ignore"] });
  let live = true;
  const closed = new Promise((resolve) => child.once("close", () => {
    live = false;
    resolve();
  }));
  await new Promise((resolve, reject) => {
    child.once("error", () => reject(lifecycleTransitionError(
      "storage_unavailable",
      "Lifecycle Transition journal lock is unavailable.",
      503,
    )));
    child.stdout.once("data", resolve);
    child.once("close", () => reject(lifecycleTransitionError(
      "busy",
      "A Lifecycle Transition journal transaction is running; retry.",
      409,
    )));
  });
  return {
    assertHeld() {
      if (!live || child.exitCode !== null) {
        throw lifecycleTransitionError(
          "lock_lost",
          "Lifecycle Transition journal lock was lost.",
          503,
        );
      }
    },
    async release() {
      child.stdin.end();
      await closed;
    },
  };
}

export function createLifecycleTransitionStore({ root }) {
  async function initialize() {
    await mkdir(root, { recursive: true, mode: 0o700 });
  }

  async function load() {
    try {
      const value = JSON.parse(await readFile(path.join(root, "journal.json"), "utf8"));
      if (
        value.schema_version !== 1 ||
        value.digest !== lifecycleTransitionDigest(value, "digest") ||
        !value.records ||
        !value.idempotency_keys
      ) {
        throw new Error("integrity");
      }
      return value;
    } catch (error) {
      if (error.code === "ENOENT") {
        return {
          schema_version: 1,
          records: {},
          idempotency_keys: {},
        };
      }
      throw lifecycleTransitionError(
        "storage_invalid",
        "Persisted Lifecycle Transition journal failed integrity validation.",
        503,
      );
    }
  }

  async function save(value) {
    const temporary = path.join(root, `.${randomUUID()}.tmp`);
    let file;
    try {
      file = await open(temporary, "wx", 0o600);
      await file.writeFile(`${JSON.stringify({
        ...value,
        digest: lifecycleTransitionDigest(value, "digest"),
      })}\n`);
      await file.sync();
      await file.close();
      file = null;
      await rename(temporary, path.join(root, "journal.json"));
      const directory = await open(root, "r");
      try {
        await directory.sync();
      } finally {
        await directory.close();
      }
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
      const data = await load();
      const transaction = {
        assertHeld: lock.assertHeld,
        get(transitionId) {
          return structuredClone(data.records[key(transitionId)] ?? null);
        },
        findByIdempotency(idempotencyKey) {
          const recordKey = data.idempotency_keys[key(idempotencyKey)];
          return structuredClone(recordKey ? data.records[recordKey] ?? null : null);
        },
        list() {
          return structuredClone(Object.values(data.records));
        },
        put(record) {
          lock.assertHeld();
          const recordKey = key(record.transition_id);
          const idempotencyKey = key(record.request.idempotency_key);
          const boundRecordKey = data.idempotency_keys[idempotencyKey];
          if (boundRecordKey && boundRecordKey !== recordKey) {
            throw lifecycleTransitionError(
              "idempotency_conflict",
              "Lifecycle Transition idempotency key is already bound to another transition.",
            );
          }
          data.records[recordKey] = structuredClone(record);
          data.idempotency_keys[idempotencyKey] = recordKey;
        },
      };
      const result = await operation(transaction);
      lock.assertHeld();
      await save(data);
      return result;
    } finally {
      await lock.release();
    }
  }

  return {
    transact,
    async get(transitionId) {
      await initialize();
      return structuredClone((await load()).records[key(transitionId)] ?? null);
    },
    async list() {
      await initialize();
      return structuredClone(Object.values((await load()).records));
    },
  };
}
