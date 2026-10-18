import { createHash } from "node:crypto";
import { mkdirSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { createPrivateFileTransactions } from "../persistence/private-file-transactions.js";

export class PlatformOperationStoreError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "PlatformOperationStoreError";
    this.code = code;
  }
}

const key = (value) => createHash("sha256").update(value).digest("hex");


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
  const sourcePreparations = path.join(root, "source-preparations");
  for (const directory of [records, idempotency, locks, sourcePreparations]) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
  }

  const recordPath = (operationId) => path.join(records, `${key(operationId)}.json`);
  const idempotencyPath = (idempotencyKey) => path.join(idempotency, `${key(idempotencyKey)}.json`);

  const { read, withLock, write: atomicWrite } = createPrivateFileTransactions({
    root, failure: (code, message) => new PlatformOperationStoreError(`platform_operation_${code}`, message),
  });

  return {
    sourcePreparation(intentId) {
      return read(path.join(sourcePreparations, `${key(intentId)}.json`), "Source credential preparation");
    },
    listSourcePreparations({ limit = 100 } = {}) {
      return readdirSync(sourcePreparations, { withFileTypes: true })
        .filter(entry => entry.isFile() && entry.name.endsWith(".json"))
        .map(entry => read(path.join(sourcePreparations, entry.name), "Source credential preparation"))
        .filter(Boolean).sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, limit);
    },
    transactSourcePreparation(intentId, operation) {
      return withLock(`source-intent:${intentId}`, async () => {
        const target = path.join(sourcePreparations, `${key(intentId)}.json`);
        const current = read(target, "Source credential preparation");
        return operation({ current, put(value) {
          if (value.source_intent?.intent_id !== intentId ||
              (current && (current.request_digest !== value.request_digest || current.source_intent_digest !== value.source_intent_digest))) {
            throw new PlatformOperationStoreError("platform_source_preparation_conflict", "Source preparation identity is immutable.");
          }
          atomicWrite(target, value);
          return value;
        } });
      });
    },
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
