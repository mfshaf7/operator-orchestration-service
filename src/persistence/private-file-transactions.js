import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
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
    const prefix = path.join(locks, key(lockKey));
    // A legacy PID record cannot prove ownership across PID namespaces or
    // process reuse. Migration requires quiescing the old writers; never guess
    // that a legacy holder is dead and unlink its lock during a transaction.
    if (existsSync(`${prefix}.lock`)) {
      throw failure("state_busy", "A legacy private transaction lock requires verified recovery.");
    }
    let descriptor;
    try {
      descriptor = openSync(`${prefix}.flock`, "a", 0o600);
      // flock(1) and this process share the inherited open file description.
      // Its lock remains held by our descriptor after flock exits and is
      // released by the kernel on close or process death, including PID reuse.
      const result = spawnSync("flock", ["-n", "-E", "75", "3"], {
        stdio: ["ignore", "ignore", "ignore", descriptor],
      });
      if (result.status !== 0) {
        throw failure(
          result.status === 75 ? "state_busy" : "state_unavailable",
          result.status === 75
            ? "Private workflow state is being updated concurrently."
            : "Private workflow transaction locking is unavailable.",
        );
      }
    } catch (error) {
      if (descriptor !== undefined) closeSync(descriptor);
      throw error;
    }
    const release = () => {
      if (descriptor !== undefined) closeSync(descriptor);
      descriptor = undefined;
      // Never unlink a flock inode: waiters and new owners must use the same
      // inode. Persistent empty .flock files are coordination state, not leases.
    };
    try {
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
