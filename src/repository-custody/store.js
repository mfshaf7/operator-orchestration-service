import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

export class RepositoryCustodyStoreError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "RepositoryCustodyStoreError";
    this.code = code;
  }
}

function storageKey(requestId) {
  return createHash("sha256").update(requestId).digest("hex");
}

function atomicWrite(filePath, value) {
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  try {
    writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    renameSync(temporary, filePath);
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}

function processAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

function readLock(lockPath) {
  try {
    return JSON.parse(readFileSync(lockPath, "utf8"));
  } catch {
    return {};
  }
}

export function repositoryCustodyStateRoot(env = process.env) {
  if (env.OOS_REPOSITORY_CUSTODY_STATE_ROOT) {
    return path.resolve(env.OOS_REPOSITORY_CUSTODY_STATE_ROOT);
  }
  const stateHome = env.XDG_STATE_HOME
    ? path.resolve(env.XDG_STATE_HOME)
    : path.join(env.HOME ? path.resolve(env.HOME) : homedir(), ".local", "state");
  return path.join(stateHome, "operator-orchestration-service", "repository-custody");
}

export function createRepositoryCustodyStore({ root = repositoryCustodyStateRoot() } = {}) {
  const records = path.join(root, "records");
  const locks = path.join(root, "locks");
  mkdirSync(records, { recursive: true, mode: 0o700 });
  mkdirSync(locks, { recursive: true, mode: 0o700 });

  function recordPath(requestId) {
    return path.join(records, `${storageKey(requestId)}.json`);
  }

  function read(requestId) {
    const target = recordPath(requestId);
    if (!existsSync(target)) return null;
    try {
      const record = JSON.parse(readFileSync(target, "utf8"));
      if (record?.request?.request_id !== requestId) {
        throw new Error("request identity mismatch");
      }
      return record;
    } catch (error) {
      throw new RepositoryCustodyStoreError(
        "repository_custody_state_corrupt",
        `Repository custody state could not be read: ${error.message}`,
      );
    }
  }

  return {
    get: read,
    put(record, { replaceRetryable = false } = {}) {
      const requestId = record?.request?.request_id;
      if (typeof requestId !== "string" || !requestId) {
        throw new RepositoryCustodyStoreError(
          "repository_custody_state_invalid",
          "Repository custody state requires a request identity.",
        );
      }
      const lock = path.join(locks, `${storageKey(requestId)}.lock`);
      if (existsSync(lock)) {
        if (processAlive(readLock(lock).pid)) {
          throw new RepositoryCustodyStoreError(
            "repository_custody_state_busy",
            "Repository custody state is being updated concurrently.",
          );
        }
        unlinkSync(lock);
      }
      const token = randomUUID();
      let descriptor;
      let acquired = false;
      try {
        try {
          descriptor = openSync(lock, "wx", 0o600);
          acquired = true;
          writeFileSync(descriptor, `${JSON.stringify({ pid: process.pid, token })}\n`);
          closeSync(descriptor);
          descriptor = null;
        } catch (error) {
          if (error?.code !== "EEXIST") throw error;
          throw new RepositoryCustodyStoreError(
            "repository_custody_state_busy",
            "Repository custody state is being updated concurrently.",
          );
        }
        const existing = read(requestId);
        if (existing) {
          if (existing.request.request_digest !== record.request.request_digest) {
            throw new RepositoryCustodyStoreError(
              "repository_custody_idempotency_conflict",
              "Repository custody request id is already bound to different content.",
            );
          }
          if (replaceRetryable && existing.retryable === true) {
            atomicWrite(recordPath(requestId), record);
            return record;
          }
          return existing;
        }
        atomicWrite(recordPath(requestId), record);
        return record;
      } finally {
        if (descriptor !== null && descriptor !== undefined) closeSync(descriptor);
        if (acquired && existsSync(lock) && readLock(lock).token === token) {
          unlinkSync(lock);
        }
      }
    },
  };
}
