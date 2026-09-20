import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import path from "node:path";
import { closureDigest, closureError } from "./contracts.js";

const key = (value) => createHash("sha256").update(value).digest("hex");

async function acquire(lockPath) {
  const child = spawn("flock", ["-n", "-E", "75", lockPath, process.execPath, "-e", "process.stdout.write('locked\\n'); process.stdin.resume();"], {
    stdio: ["pipe", "pipe", "ignore"],
  });
  let live = true;
  const closed = new Promise((resolve) => child.once("close", () => { live = false; resolve(); }));
  await new Promise((resolve, reject) => {
    child.once("error", () => reject(closureError("storage_unavailable", "Closure transaction lock is unavailable.", 503)));
    child.stdout.once("data", resolve);
    child.once("close", () => reject(closureError("busy", "A Closure transaction is running; retry.")));
  });
  return {
    assertHeld() {
      if (!live || child.exitCode !== null) throw closureError("lock_lost", "Closure transaction lock was lost.", 503);
    },
    async release() { child.stdin.end(); await closed; },
  };
}

export function createPrototypeClosureStore({ root }) {
  async function initialize() { await mkdir(root, { recursive: true, mode: 0o700 }); }
  async function load() {
    try {
      const value = JSON.parse(await readFile(path.join(root, "state.json"), "utf8"));
      if (value.schema_version !== 1 || value.digest !== closureDigest(value, { omit: "digest" })) {
        throw new Error("integrity");
      }
      return value;
    } catch (error) {
      if (error.code === "ENOENT") return { schema_version: 1, records: {}, keys: {} };
      throw closureError("storage_invalid", "Persisted Closure state failed integrity validation.", 503);
    }
  }
  async function save(value) {
    const temporary = path.join(root, `.${randomUUID()}.tmp`);
    let file;
    try {
      file = await open(temporary, "wx", 0o600);
      await file.writeFile(`${JSON.stringify({ ...value, digest: closureDigest(value, { omit: "digest" }) })}\n`);
      await file.sync();
      await file.close();
      file = null;
      await rename(temporary, path.join(root, "state.json"));
      const directory = await open(root, "r");
      try { await directory.sync(); } finally { await directory.close(); }
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
        get(requestId) { return structuredClone(data.records[key(requestId)] ?? null); },
        async put(record) {
          lock.assertHeld();
          const id = key(record.request.request_id);
          const idempotency = key(record.request.idempotency_key);
          const existing = data.records[id];
          if ((existing && existing.binding_digest !== record.binding_digest) ||
              (data.keys[idempotency] && data.keys[idempotency] !== id)) {
            throw closureError("idempotency_conflict", "Closure request or key is already bound to different input.");
          }
          data.records[id] = structuredClone(record);
          data.keys[idempotency] = id;
          await save(data);
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
    async readRetirementReceipt({ ref, prototypeId, retirementRef }) {
      if (!/^receipt:\/\/prototype-closure\/[0-9a-f]{64}$/.test(ref) ||
          typeof prototypeId !== "string" || !prototypeId ||
          typeof retirementRef !== "string" || !retirementRef) {
        throw closureError("retirement_lookup_invalid", "Closure retirement lookup is invalid.", 400);
      }
      await initialize();
      const matches = Object.values((await load()).records).filter((record) =>
        record.status === "succeeded" && record.request.action === "retire-incubation" &&
        record.receipt?.outcome === "completed" && record.receipt.receipt_id === ref &&
        record.receipt.prototype_id === prototypeId &&
        retirementRef === `record://prototype-closure/${prototypeId}/history/${record.receipt.source_event_ref}` &&
        record.readback?.source_event_ref === record.receipt.source_event_ref &&
        record.readback?.merged_source_revision === record.receipt.merged_source_revision,
      );
      if (matches.length !== 1) {
        throw closureError("retirement_receipt_not_found", "No completed Closure retirement receipt binds this Studio event.", 404);
      }
      const receipt = matches[0].receipt;
      return {
        ref,
        owner_ref: "operator-orchestration-service",
        digest: closureDigest(receipt, { ascii: true }),
        state: "accepted",
        subject_ref: retirementRef,
        source_revision: null,
        source_packet_ref: null,
        prototype_id: prototypeId,
      };
    },
  };
}
