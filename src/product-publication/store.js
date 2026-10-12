import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import path from "node:path";
import { productPublicationDigest, productPublicationError } from "./contracts.js";

const key = (value) => createHash("sha256").update(value).digest("hex");
const MAX_PUBLICATION_HISTORY = 50;

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
    child.once("error", () => reject(productPublicationError(
      "storage_unavailable",
      "Product Publication transaction lock is unavailable.",
      503,
    )));
    child.stdout.once("data", resolve);
    child.once("close", () => reject(productPublicationError(
      "busy",
      "A Product Publication transaction is running; retry.",
      409,
    )));
  });
  return {
    assertHeld() {
      if (!live || child.exitCode !== null) {
        throw productPublicationError("lock_lost", "Product Publication transaction lock was lost.", 503);
      }
    },
    async release() {
      child.stdin.end();
      await closed;
    },
  };
}

const emptyState = () => ({
  schema_version: 1,
  records: {},
  idempotency_keys: {},
  products: {},
});

export function createProductPublicationStore({ root }) {
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
        !value.products ||
        value.digest !== productPublicationDigest(value, "digest")
      ) throw new Error("integrity");
      return value;
    } catch (error) {
      if (error.code === "ENOENT") return emptyState();
      throw productPublicationError(
        "storage_invalid",
        "Persisted Product Publication journal failed integrity validation.",
        503,
      );
    }
  }
  async function save(value) {
    const temporary = path.join(root, `.${randomUUID()}.tmp`);
    let file;
    try {
      file = await open(temporary, "wx", 0o600);
      const stored = { ...value, digest: productPublicationDigest(value, "digest") };
      await file.writeFile(`${JSON.stringify(stored)}\n`);
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
          return structuredClone(state.records[key(requestId)] ?? null);
        },
        idempotency(callerId, idempotencyKey) {
          return structuredClone(state.idempotency_keys[key(`${callerId}:${idempotencyKey}`)] ?? null);
        },
        product(productId) {
          return structuredClone(state.products[key(productId)] ?? null);
        },
        async put(record) {
          lock.assertHeld();
          const requestKey = key(record.command.request_id);
          const idempotencyKey = key(`${record.owner_caller_id}:${record.command.idempotency_key}`);
          const existing = state.records[requestKey];
          const replay = state.idempotency_keys[idempotencyKey];
          if (
            (existing && existing.command_digest !== record.command_digest) ||
            (replay && (replay.request_id !== record.command.request_id || replay.command_digest !== record.command_digest))
          ) {
            throw productPublicationError(
              "idempotency_conflict",
              "The request or idempotency key is already bound to different Product Publication content.",
            );
          }
          const previous = state.products[key(record.receipt.product_id)];
          record.publication_history = structuredClone(previous?.publication_history ?? []);
          state.records[requestKey] = structuredClone(record);
          state.idempotency_keys[idempotencyKey] = {
            request_id: record.command.request_id,
            command_digest: record.command_digest,
          };
          if (record.receipt.outcome === "applied") {
            const publicationHistory = [
              ...(previous?.publication_history ?? []),
              {
                sequence: (previous?.publication_history?.at(-1)?.sequence ?? 0) + 1,
                action: record.command.action,
                publication_version: record.receipt.publication_version,
                publication_posture: record.receipt.publication_posture,
                receipt_ref: {
                  id: record.receipt.receipt_id,
                  digest: record.receipt_digest,
                },
                inventory_lifecycle_receipt_ref:
                  structuredClone(record.receipt.lifecycle_history_binding?.inventory_lifecycle_receipt_ref ?? null),
                inventory_history_event_ref:
                  structuredClone(record.receipt.lifecycle_history_binding?.inventory_history_event_ref ?? null),
                recorded_at: record.receipt.recorded_at,
              },
            ].slice(-MAX_PUBLICATION_HISTORY);
            record.publication_history = publicationHistory;
            state.records[requestKey] = structuredClone(record);
            state.products[key(record.receipt.product_id)] = {
              request_id: record.command.request_id,
              receipt_id: record.receipt.receipt_id,
              receipt_digest: record.receipt_digest,
              publication_version: record.receipt.publication_version,
              publication_posture: record.receipt.publication_posture,
              publication_history: publicationHistory,
            };
          }
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
      return structuredClone((await load()).records[key(requestId)] ?? null);
    },
  };
}
