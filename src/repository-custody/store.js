import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
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

  function persist(record, { replaceMutable = false, replaceRetryable = false } = {}) {
    const requestId = record?.request?.request_id;
    if (typeof requestId !== "string" || !requestId) {
      throw new RepositoryCustodyStoreError(
        "repository_custody_state_invalid",
        "Repository custody state requires a request identity.",
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
      if (
        (replaceMutable && (existing.status === "applying" || existing.retryable === true)) ||
        (replaceRetryable && existing.retryable === true)
      ) {
        atomicWrite(recordPath(requestId), record);
        return record;
      }
      return existing;
    }
    atomicWrite(recordPath(requestId), record);
    return record;
  }

  function withRequestLock(requestId, operation) {
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
    const release = () => {
      if (descriptor !== null && descriptor !== undefined) closeSync(descriptor);
      descriptor = null;
      if (acquired && existsSync(lock) && readLock(lock).token === token) {
        unlinkSync(lock);
      }
    };
    try {
      try {
        descriptor = openSync(lock, "wx", 0o600);
      } catch (error) {
        if (error?.code === "EEXIST") {
          throw new RepositoryCustodyStoreError(
            "repository_custody_state_busy",
            "Repository custody state is being updated concurrently.",
          );
        }
        throw error;
      }
      acquired = true;
      writeFileSync(descriptor, `${JSON.stringify({ pid: process.pid, token })}\n`);
      closeSync(descriptor);
      descriptor = null;
      const result = operation({
        current: read(requestId),
        put(record, options = {}) {
          if (record?.request?.request_id !== requestId) {
            throw new RepositoryCustodyStoreError(
              "repository_custody_state_invalid",
              "Repository custody transaction cannot change request identity.",
            );
          }
          return persist(record, options);
        },
      });
      if (result && typeof result.then === "function") {
        return result.finally(release);
      }
      release();
      return result;
    } catch (error) {
      release();
      throw error;
    }
  }

  return {
    get: read,
    list({ cursor = null, limit = 25 } = {}) {
      if (
        (cursor !== null && !/^[a-f0-9]{64}$/.test(cursor)) ||
        !Number.isInteger(limit) || limit < 1 || limit > 25
      ) {
        throw new RepositoryCustodyStoreError(
          "repository_custody_page_invalid",
          "Repository custody pages require a valid cursor and a limit from 1 to 25.",
        );
      }
      const keys = readdirSync(records)
        .filter((name) => /^[a-f0-9]{64}\.json$/.test(name))
        .map((name) => name.slice(0, -5))
        .filter((key) => cursor === null || key > cursor)
        .sort();
      const page = keys.slice(0, limit).map((key) => {
        try {
          const value = JSON.parse(readFileSync(path.join(records, `${key}.json`), "utf8"));
          if (storageKey(value?.request?.request_id ?? "") !== key) {
            throw new Error("request identity mismatch");
          }
          return read(value.request.request_id);
        } catch (error) {
          throw new RepositoryCustodyStoreError(
            "repository_custody_state_corrupt",
            `Repository custody state could not be read: ${error.message}`,
          );
        }
      });
      return {
        records: page,
        next_cursor: keys.length > limit ? keys[limit - 1] : null,
      };
    },
    put(record, options = {}) {
      const requestId = record?.request?.request_id;
      return withRequestLock(requestId, ({ put }) => put(record, options));
    },
    transact(requestId, operation) {
      return withRequestLock(requestId, operation);
    },
  };
}
