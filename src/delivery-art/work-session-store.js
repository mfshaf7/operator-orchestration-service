import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import path from "node:path";

const INDEX = Object.freeze({ aliases: {}, schema_version: 1 });
const FORBIDDEN_KEY = /(credential|password|secret|token)/i;

export class DeliveryArtWorkSessionStoreError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = "DeliveryArtWorkSessionStoreError";
    this.code = code;
    this.details = details;
  }
}

function atomicWrite(filePath, value) {
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  try {
    writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    renameSync(temporaryPath, filePath);
  } finally {
    if (existsSync(temporaryPath)) {
      unlinkSync(temporaryPath);
    }
  }
}

function readJson(filePath, { missing = null } = {}) {
  if (!existsSync(filePath)) {
    return missing;
  }
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new DeliveryArtWorkSessionStoreError(
      "delivery_art_work_session_state_corrupt",
      `Delivery ART work-session state is not valid JSON: ${filePath}`,
      { cause: error.message },
    );
  }
}

function storageName(value) {
  return encodeURIComponent(String(value));
}

function assertCoordinationOnly(value, location = "session") {
  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      assertCoordinationOnly(entry, `${location}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") {
    if (
      typeof value === "string" &&
      (path.isAbsolute(value) || /^[A-Za-z]:[\\/]/.test(value))
    ) {
      throw new DeliveryArtWorkSessionStoreError(
        "delivery_art_work_session_absolute_path_forbidden",
        `${location} must not persist an absolute path.`,
      );
    }
    return;
  }
  for (const [key, entry] of Object.entries(value)) {
    if (FORBIDDEN_KEY.test(key)) {
      throw new DeliveryArtWorkSessionStoreError(
        "delivery_art_work_session_secret_field_forbidden",
        `${location}.${key} is not allowed in reconstructable coordination state.`,
      );
    }
    assertCoordinationOnly(entry, `${location}.${key}`);
  }
}

function processAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

export function deliveryArtWorkStateRoot(env = process.env) {
  if (env.OOS_ART_WORK_STATE_ROOT) {
    return path.resolve(env.OOS_ART_WORK_STATE_ROOT);
  }
  const stateHome = env.XDG_STATE_HOME
    ? path.resolve(env.XDG_STATE_HOME)
    : path.join(env.HOME ? path.resolve(env.HOME) : homedir(), ".local", "state");
  return path.join(
    stateHome,
    "operator-orchestration-service",
    "delivery-art",
    "work",
  );
}

export function createDeliveryArtWorkSessionStore({
  root = deliveryArtWorkStateRoot(),
  validateDecision,
  validateSession,
} = {}) {
  if (typeof validateDecision !== "function" || typeof validateSession !== "function") {
    throw new Error("validateDecision and validateSession are required");
  }
  const indexPath = path.join(root, "index.json");

  function sessionDirectory(sessionId) {
    return path.join(root, "sessions", storageName(sessionId));
  }

  function sessionPath(sessionId) {
    return path.join(sessionDirectory(sessionId), "session.json");
  }

  function decisionPath(workItemId) {
    return path.join(root, "decisions", `${storageName(workItemId)}.json`);
  }

  function artifactPath(session, relativeFile) {
    const rootPath = sessionDirectory(session.session_id);
    const resolved = path.resolve(rootPath, relativeFile);
    if (resolved !== rootPath && !resolved.startsWith(`${rootPath}${path.sep}`)) {
      throw new DeliveryArtWorkSessionStoreError(
        "delivery_art_work_session_artifact_path_invalid",
        "Work-session artifact path escapes its session directory.",
      );
    }
    return resolved;
  }

  function readIndex() {
    const index = readJson(indexPath, { missing: structuredClone(INDEX) });
    if (
      index?.schema_version !== 1 ||
      !index.aliases ||
      typeof index.aliases !== "object" ||
      Array.isArray(index.aliases)
    ) {
      throw new DeliveryArtWorkSessionStoreError(
        "delivery_art_work_session_index_corrupt",
        "Delivery ART work-session index is invalid.",
      );
    }
    for (const [alias, sessionIds] of Object.entries(index.aliases)) {
      if (
        !Array.isArray(sessionIds) ||
        sessionIds.some((sessionId) => typeof sessionId !== "string" || !sessionId)
      ) {
        throw new DeliveryArtWorkSessionStoreError(
          "delivery_art_work_session_index_corrupt",
          `Delivery ART work-session index entry is invalid for ${alias}.`,
        );
      }
    }
    return index;
  }

  function indexedSessionIds(index, alias) {
    return Object.hasOwn(index.aliases, alias) ? index.aliases[alias] : [];
  }

  function readSessionFile(filePath) {
    const session = readJson(filePath);
    if (!session) {
      return null;
    }
    const validation = validateSession(session);
    if (!validation.valid) {
      throw new DeliveryArtWorkSessionStoreError(
        "delivery_art_work_session_state_invalid",
        "Delivery ART work-session state failed its contract.",
        validation,
      );
    }
    assertCoordinationOnly(session);
    return session;
  }

  function readBySessionId(sessionId) {
    return readSessionFile(sessionPath(sessionId));
  }

  function discoverSessionIds(alias) {
    const sessionsRoot = path.join(root, "sessions");
    if (!existsSync(sessionsRoot)) {
      return [];
    }
    return readdirSync(sessionsRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) =>
        readSessionFile(path.join(sessionsRoot, entry.name, "session.json")))
      .filter((session) => session?.aliases.includes(alias))
      .map((session) => session.session_id);
  }

  function readByAlias(alias) {
    const index = readIndex();
    const indexed = indexedSessionIds(index, alias);
    const matches = [...new Set([
      ...indexed,
      ...discoverSessionIds(alias),
    ])]
      .filter((sessionId) => readBySessionId(sessionId) !== null)
      .sort();
    if (matches.length > 1) {
      throw new DeliveryArtWorkSessionStoreError(
        "delivery_art_work_session_alias_ambiguous",
        `Alias ${alias} resolves to more than one active work session.`,
        { session_ids: matches },
      );
    }
    return matches.length === 1 ? readBySessionId(matches[0]) : null;
  }

  function writeSession(session) {
    const validation = validateSession(session);
    if (!validation.valid) {
      throw new DeliveryArtWorkSessionStoreError(
        "delivery_art_work_session_state_invalid",
        "Delivery ART work-session state failed its contract.",
        validation,
      );
    }
    assertCoordinationOnly(session);
    atomicWrite(sessionPath(session.session_id), session);
    const index = readIndex();
    for (const alias of session.aliases) {
      const existing = indexedSessionIds(index, alias);
      index.aliases[alias] = [...new Set([...existing, session.session_id])].sort();
    }
    atomicWrite(indexPath, index);
    return session;
  }

  function removeSession(session) {
    const index = readIndex();
    for (const [alias, sessionIds] of Object.entries(index.aliases)) {
      const remaining = sessionIds.filter((entry) => entry !== session.session_id);
      if (remaining.length > 0) {
        index.aliases[alias] = remaining;
      } else {
        delete index.aliases[alias];
      }
    }
    rmSync(sessionDirectory(session.session_id), { force: true, recursive: true });
    atomicWrite(indexPath, index);
  }

  function writeDecisionDraft(workItemId, decision) {
    const validation = validateDecision(decision, { allowIncomplete: true });
    if (!validation.valid) {
      throw new DeliveryArtWorkSessionStoreError(
        "delivery_art_work_session_decision_draft_invalid",
        "Delivery ART work-session decision draft failed its contract.",
        validation,
      );
    }
    atomicWrite(decisionPath(workItemId), decision);
    return decisionPath(workItemId);
  }

  function readDecision(filePath) {
    const decision = readJson(path.resolve(filePath));
    const validation = validateDecision(decision);
    if (!validation.valid) {
      throw new DeliveryArtWorkSessionStoreError(
        "delivery_art_work_session_decision_invalid",
        "Delivery ART work-session decision failed its contract.",
        validation,
      );
    }
    return decision;
  }

  function writeArtifact(session, relativeFile, value) {
    atomicWrite(artifactPath(session, relativeFile), value);
  }

  function readArtifact(session, relativeFile) {
    return readJson(artifactPath(session, relativeFile));
  }

  async function withLock(alias, operation) {
    const lockPath = path.join(root, "locks", `${storageName(alias)}.lock`);
    const token = randomUUID();
    mkdirSync(path.dirname(lockPath), { recursive: true, mode: 0o700 });
    if (existsSync(lockPath)) {
      const lock = readJson(lockPath, { missing: {} });
      if (processAlive(lock?.pid)) {
        throw new DeliveryArtWorkSessionStoreError(
          "delivery_art_work_session_locked",
          `Another work-session operation is active for ${alias}.`,
          lock,
        );
      }
      unlinkSync(lockPath);
    }
    let descriptor;
    let acquired = false;
    let ownerWritten = false;
    try {
      try {
        descriptor = openSync(lockPath, "wx", 0o600);
        acquired = true;
      } catch (error) {
        if (error?.code !== "EEXIST") {
          throw error;
        }
        throw new DeliveryArtWorkSessionStoreError(
          "delivery_art_work_session_locked",
          `Another work-session operation is active for ${alias}.`,
          readJson(lockPath, { missing: {} }),
        );
      }
      writeFileSync(
        descriptor,
        `${JSON.stringify({ pid: process.pid, token })}\n`,
        "utf8",
      );
      ownerWritten = true;
      closeSync(descriptor);
      descriptor = null;
      return await operation();
    } finally {
      if (descriptor !== null && descriptor !== undefined) {
        closeSync(descriptor);
      }
      if (acquired && existsSync(lockPath)) {
        let stillOwned = !ownerWritten;
        if (ownerWritten) {
          try {
            stillOwned = readJson(lockPath, { missing: {} })?.token === token;
          } catch {
            stillOwned = false;
          }
        }
        if (stillOwned) {
          unlinkSync(lockPath);
        }
      }
    }
  }

  return {
    artifactPath,
    decisionPath,
    readArtifact,
    readByAlias,
    readBySessionId,
    readDecision,
    removeSession,
    root,
    withLock,
    writeArtifact,
    writeDecisionDraft,
    writeSession,
  };
}
