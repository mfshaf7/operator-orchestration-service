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

export class PlatformOperationStoreError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "PlatformOperationStoreError";
    this.code = code;
  }
}

const key = (value) => createHash("sha256").update(value).digest("hex");

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
  if (!Number.isSafeInteger(pid) || pid < 1) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

export function platformOperationStateRoot(env = process.env) {
  if (env.OOS_PLATFORM_OPERATION_STATE_ROOT?.trim()) {
    return path.resolve(env.OOS_PLATFORM_OPERATION_STATE_ROOT.trim());
  }
  const stateHome = env.XDG_STATE_HOME
    ? path.resolve(env.XDG_STATE_HOME)
    : path.join(env.HOME ? path.resolve(env.HOME) : homedir(), ".local", "state");
  return path.join(stateHome, "operator-orchestration-service", "platform-operation");
}

export function createPlatformOperationStore({ root = platformOperationStateRoot() } = {}) {
  const records = path.join(root, "records");
  const idempotency = path.join(root, "idempotency");
  const locks = path.join(root, "locks");
  for (const directory of [records, idempotency, locks]) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
  }

  const recordPath = (operationId) => path.join(records, `${key(operationId)}.json`);
  const idempotencyPath = (idempotencyKey) => path.join(idempotency, `${key(idempotencyKey)}.json`);

  function read(filePath, label) {
    if (!existsSync(filePath)) return null;
    try {
      return JSON.parse(readFileSync(filePath, "utf8"));
    } catch (error) {
      throw new PlatformOperationStoreError(
        "platform_operation_state_corrupt",
        `${label} could not be read: ${error.message}`,
      );
    }
  }

  function withLock(lockKey, operation) {
    const lockPath = path.join(locks, `${key(lockKey)}.lock`);
    if (existsSync(lockPath)) {
      let holder = {};
      try { holder = JSON.parse(readFileSync(lockPath, "utf8")); } catch {}
      if (processAlive(holder.pid)) {
        throw new PlatformOperationStoreError(
          "platform_operation_state_busy",
          "Platform operation state is being updated concurrently.",
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

  return {
    get(operationId) {
      return read(recordPath(operationId), "Platform operation record");
    },
    list({ limit = 100 } = {}) {
      return readdirSync(records, { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
        .map((entry) => read(path.join(records, entry.name), "Platform operation record"))
        .filter(Boolean)
        .sort((left, right) => String(right.updated_at).localeCompare(String(left.updated_at)))
        .slice(0, limit);
    },
    transactCommand(command, operationId, operation) {
      return withLock(`command:${command.idempotency_key}`, async () => {
        const pointerPath = idempotencyPath(command.idempotency_key);
        const pointer = read(pointerPath, "Platform operation idempotency binding");
        if (pointer && pointer.intent_digest !== command.intent_digest) {
          throw new PlatformOperationStoreError(
            "platform_operation_idempotency_conflict",
            "Platform operation idempotency key is already bound to different command intent.",
          );
        }
        const current = pointer ? read(recordPath(pointer.operation_id), "Platform operation record") : null;
        return operation({
          current,
          put(value) {
            if (value.operation_id !== operationId || value.command.intent_digest !== command.intent_digest) {
              throw new PlatformOperationStoreError(
                "platform_operation_state_invalid",
                "Platform operation transaction cannot change immutable command identity.",
              );
            }
            atomicWrite(recordPath(operationId), value);
            atomicWrite(pointerPath, {
              idempotency_key: command.idempotency_key,
              intent_digest: command.intent_digest,
              operation_id: operationId,
            });
            return value;
          },
        });
      });
    },
    transactOperation(operationId, operation) {
      const discovered = read(recordPath(operationId), "Platform operation record");
      if (!discovered) return operation({ current: null, put: () => null });
      return withLock(`command:${discovered.command.idempotency_key}`, async () => {
        const current = read(recordPath(operationId), "Platform operation record");
        if (!current) return operation({ current: null, put: () => null });
        return operation({
          current,
          put(value) {
            if (
              value.operation_id !== current.operation_id ||
              value.command.intent_digest !== current.command.intent_digest
            ) {
              throw new PlatformOperationStoreError(
                "platform_operation_state_invalid",
                "Platform operation transaction cannot change immutable operation identity.",
              );
            }
            atomicWrite(recordPath(operationId), value);
            return value;
          },
        });
      });
    },
  };
}
