import { createHash, randomUUID } from "node:crypto";
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";

const key = value => createHash("sha256").update(value).digest("hex");

function atomicWrite(filePath, value) {
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  try {
    const descriptor = openSync(temporary, "wx", 0o600);
    try {
      writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`, "utf8");
      fsyncSync(descriptor);
    } finally { closeSync(descriptor); }
    renameSync(temporary, filePath);
    const parent = openSync(path.dirname(filePath), "r");
    try { fsyncSync(parent); } finally { closeSync(parent); }
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}

function processAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid < 1) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

// Reuse existing private per-file broker persistence. Large payloads remain
// separate from bounded metadata indexes, not in one growing register.
export function createPrivateFileTransactions({ root, failure }) {
  if (typeof failure !== "function") throw new TypeError("A workflow-owned persistence error factory is required.");
  const locks = path.join(root, "locks");
  mkdirSync(locks, { recursive: true, mode: 0o700 });
  function read(filePath, label, { maxBytes = Infinity } = {}) {
    if (!existsSync(filePath)) return null;
    try {
      if (statSync(filePath).size > maxBytes) throw new Error("Private record exceeds its admitted read bound.");
      return JSON.parse(readFileSync(filePath, "utf8"));
    } catch (error) {
      throw failure(
        "state_corrupt",
        `${label} could not be read.`,
      );
    }
  }

  function withLock(lockKey, operation) {
    const lockPath = path.join(locks, `${key(lockKey)}.lock`);
    if (existsSync(lockPath)) {
      let holder = {};
      try { holder = JSON.parse(readFileSync(lockPath, "utf8")); } catch {}
      if (processAlive(holder.pid)) {
        throw failure(
          "state_busy",
          "Private workflow state is being updated concurrently.",
        );
      }
      unlinkSync(lockPath);
    }
    const token = randomUUID();
    let descriptor = null;
    const release = () => {
      if (descriptor !== null) closeSync(descriptor);
      descriptor = null;
      if (!existsSync(lockPath)) return;
      let holder = {};
      try { holder = JSON.parse(readFileSync(lockPath, "utf8")); } catch {}
      if (holder.token === token) unlinkSync(lockPath);
    };
    try {
      descriptor = openSync(lockPath, "wx", 0o600);
      writeFileSync(descriptor, `${JSON.stringify({ pid: process.pid, token })}\n`);
      closeSync(descriptor);
      descriptor = null;
      const result = operation();
      if (result && typeof result.then === "function") return result.finally(release);
      release();
      return result;
    } catch (error) {
      release();
      throw error;
    }
  }

  return { read, withLock, write: atomicWrite };
}
