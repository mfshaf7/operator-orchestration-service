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

export class RepositoryLifecycleStoreError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "RepositoryLifecycleStoreError";
    this.code = code;
  }
}

const key = (value) => createHash("sha256").update(value).digest("hex");
const repositoryKey = (identity) => `${identity.provider}:${identity.provider_repository_id}`;

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

export function repositoryLifecycleStateRoot(env = process.env) {
  if (env.OOS_REPOSITORY_LIFECYCLE_STATE_ROOT) {
    return path.resolve(env.OOS_REPOSITORY_LIFECYCLE_STATE_ROOT);
  }
  const stateHome = env.XDG_STATE_HOME
    ? path.resolve(env.XDG_STATE_HOME)
    : path.join(env.HOME ? path.resolve(env.HOME) : homedir(), ".local", "state");
  return path.join(stateHome, "operator-orchestration-service", "repository-lifecycle");
}

export function createRepositoryLifecycleStore({ root = repositoryLifecycleStateRoot() } = {}) {
  const requests = path.join(root, "requests");
  const repositories = path.join(root, "repositories");
  const locks = path.join(root, "locks");
  for (const directory of [requests, repositories, locks]) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
  }

  const requestPath = (requestId) => path.join(requests, `${key(requestId)}.json`);
  const aggregatePath = (identity) => path.join(repositories, `${key(repositoryKey(identity))}.json`);

  function read(filePath, label) {
    if (!existsSync(filePath)) return null;
    try {
      return JSON.parse(readFileSync(filePath, "utf8"));
    } catch (error) {
      throw new RepositoryLifecycleStoreError(
        "repository_lifecycle_state_corrupt",
        `${label} could not be read: ${error.message}`,
      );
    }
  }

  function withLock(identity, operation) {
    const lockPath = path.join(locks, `${key(repositoryKey(identity))}.lock`);
    if (existsSync(lockPath)) {
      let holder = {};
      try { holder = JSON.parse(readFileSync(lockPath, "utf8")); } catch {}
      if (processAlive(holder.pid)) {
        throw new RepositoryLifecycleStoreError(
          "repository_lifecycle_state_busy",
          "Repository lifecycle state is being updated concurrently.",
        );
      }
      unlinkSync(lockPath);
    }
    const token = randomUUID();
    let descriptor;
    const release = () => {
      if (descriptor !== null && descriptor !== undefined) closeSync(descriptor);
      descriptor = null;
      if (existsSync(lockPath)) {
        let holder = {};
        try { holder = JSON.parse(readFileSync(lockPath, "utf8")); } catch {}
        if (holder.token === token) unlinkSync(lockPath);
      }
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
    getRequest(requestId) {
      return read(requestPath(requestId), "Repository lifecycle request state");
    },
    getRepository(identity) {
      return read(aggregatePath(identity), "Repository lifecycle aggregate");
    },
    transact(request, operation) {
      return withLock(request.repository_identity, async () => {
        const currentRequest = read(requestPath(request.request_id), "Repository lifecycle request state");
        if (
          currentRequest &&
          currentRequest.request.request_digest !== request.request_digest
        ) {
          throw new RepositoryLifecycleStoreError(
            "repository_lifecycle_idempotency_conflict",
            "Repository lifecycle request id is already bound to different content.",
          );
        }
        const aggregate = read(
          aggregatePath(request.repository_identity),
          "Repository lifecycle aggregate",
        );
        return operation({
          aggregate,
          currentRequest,
          putAggregate(value) {
            atomicWrite(aggregatePath(request.repository_identity), value);
            return value;
          },
          putRequest(value) {
            if (value.request.request_id !== request.request_id) {
              throw new RepositoryLifecycleStoreError(
                "repository_lifecycle_state_invalid",
                "Repository lifecycle transaction cannot change request identity.",
              );
            }
            atomicWrite(requestPath(request.request_id), value);
            return value;
          },
        });
      });
    },
  };
}
