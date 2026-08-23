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

import { canonicalDigest } from "./canonical-json.js";

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
  validateCleanupReceipt,
  validateDecision,
  validateResourceManifest,
  validateSession,
} = {}) {
  if (
    typeof validateCleanupReceipt !== "function" ||
    typeof validateDecision !== "function" ||
    typeof validateResourceManifest !== "function" ||
    typeof validateSession !== "function"
  ) {
    throw new Error(
      "validateCleanupReceipt, validateDecision, validateResourceManifest, and validateSession are required",
    );
  }
  const indexPath = path.join(root, "index.json");
  const cleanupIndexPath = path.join(root, "cleanup-receipts", "index.json");

  function sessionDirectory(sessionId) {
    return path.join(root, "sessions", storageName(sessionId));
  }

  function sessionPath(sessionId) {
    return path.join(sessionDirectory(sessionId), "session.json");
  }

  function decisionPath(workItemId) {
    return path.join(root, "decisions", `${storageName(workItemId)}.json`);
  }

  function cleanupReceiptPath(sessionId) {
    return path.join(
      root,
      "cleanup-receipts",
      `${storageName(sessionId)}.json`,
    );
  }

  function cleanupManifestPath(sessionId) {
    return path.join(
      root,
      "cleanup-receipts",
      "manifests",
      `${storageName(sessionId)}.json`,
    );
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

  function readCleanupIndex() {
    const index = readJson(cleanupIndexPath, { missing: structuredClone(INDEX) });
    if (
      index?.schema_version !== 1 ||
      !index.aliases ||
      typeof index.aliases !== "object" ||
      Array.isArray(index.aliases)
    ) {
      throw new DeliveryArtWorkSessionStoreError(
        "delivery_art_work_session_cleanup_index_corrupt",
        "Delivery ART cleanup-receipt index is invalid.",
      );
    }
    for (const [alias, sessionIds] of Object.entries(index.aliases)) {
      if (
        !Array.isArray(sessionIds) ||
        sessionIds.some((sessionId) => typeof sessionId !== "string" || !sessionId)
      ) {
        throw new DeliveryArtWorkSessionStoreError(
          "delivery_art_work_session_cleanup_index_corrupt",
          `Delivery ART cleanup-receipt index entry is invalid for ${alias}.`,
        );
      }
    }
    return index;
  }

  function indexedSessionIds(index, alias) {
    return Object.hasOwn(index.aliases, alias) ? index.aliases[alias] : [];
  }

  function readSessionFile(filePath) {
    const persisted = readJson(filePath);
    if (!persisted) {
      return null;
    }
    const session =
      persisted.schema_version === 1 &&
      persisted.artifacts &&
      typeof persisted.artifacts === "object" &&
      !Object.hasOwn(persisted.artifacts, "resource_manifest_file")
        ? {
            ...persisted,
            artifacts: {
              ...persisted.artifacts,
              resource_manifest_file: "resource-manifest.json",
            },
          }
        : persisted;
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

  function assertResourceManifestBinding(session, manifest) {
    const bindingErrors = [];
    if (
      manifest.session_id !== session.session_id ||
      manifest.delivery_id !== session.delivery_id ||
      manifest.landing_unit_id !== session.landing_unit_id
    ) {
      bindingErrors.push("manifest identity does not match the work session");
    }
    const gitTypes = [
      "git-worktree",
      "git-local-branch",
      "git-remote-branch",
    ];
    for (const resourceType of gitTypes) {
      const resources = manifest.resources.filter(
        (resource) => resource.resource_type === resourceType,
      );
      if (resources.length !== 1) {
        bindingErrors.push(`manifest requires exactly one ${resourceType}`);
        continue;
      }
      const [resource] = resources;
      if (resource.locator.repo !== session.owner_repo) {
        bindingErrors.push(`${resourceType} repo does not match the session owner`);
      }
      if (
        resourceType === "git-worktree" &&
        resource.locator.workspace_relative_path !==
          path.posix.join(
            ".worktrees",
            session.landing_unit_id,
            session.owner_repo,
          )
      ) {
        bindingErrors.push("git-worktree path does not match the Landing Unit");
      }
      if (
        resourceType !== "git-worktree" &&
        resource.locator.branch !== session.landing_unit.branch
      ) {
        bindingErrors.push(`${resourceType} branch does not match the Landing Unit`);
      }
      if (
        resourceType === "git-local-branch" &&
        resource.locator.base_ref !== session.landing_unit.base_ref
      ) {
        bindingErrors.push("git-local-branch base does not match the Landing Unit");
      }
      if (
        resourceType === "git-remote-branch" &&
        resource.locator.remote !== "origin"
      ) {
        bindingErrors.push("git-remote-branch must use the governed origin remote");
      }
    }
    const managedResources = manifest.resources.filter(
      (resource) => resource.resource_type === "managed-session-state",
    );
    if (managedResources.length > 1) {
      bindingErrors.push("manifest permits at most one managed-session-state resource");
    }
    if (
      managedResources[0] &&
      managedResources[0].locator.relative_path !==
        path.posix.join("managed", storageName(session.session_id))
    ) {
      bindingErrors.push("managed-session-state path does not match the session allowlist");
    }
    if (bindingErrors.length > 0) {
      throw new DeliveryArtWorkSessionStoreError(
        "delivery_art_work_session_resource_manifest_mismatch",
        "Resource manifest authority does not match this work session.",
        { errors: bindingErrors },
      );
    }
  }

  function readResourceManifest(session) {
    const manifest = readArtifact(session, session.artifacts.resource_manifest_file);
    if (!manifest) {
      return null;
    }
    const validation = validateResourceManifest(manifest);
    if (!validation.valid) {
      throw new DeliveryArtWorkSessionStoreError(
        "delivery_art_work_session_resource_manifest_invalid",
        "Delivery ART work-session resource manifest failed its contract.",
        validation,
      );
    }
    assertResourceManifestBinding(session, manifest);
    return manifest;
  }

  function writeResourceManifest(session, manifest) {
    const validation = validateResourceManifest(manifest);
    if (!validation.valid) {
      throw new DeliveryArtWorkSessionStoreError(
        "delivery_art_work_session_resource_manifest_invalid",
        "Delivery ART work-session resource manifest failed its contract.",
        validation,
      );
    }
    assertResourceManifestBinding(session, manifest);
    assertCoordinationOnly(manifest, "resource_manifest");
    writeArtifact(session, session.artifacts.resource_manifest_file, manifest);
    return manifest;
  }

  function readCleanupReceiptBySessionId(sessionId) {
    const receipt = readJson(cleanupReceiptPath(sessionId));
    if (!receipt) {
      return null;
    }
    const validation = validateCleanupReceipt(receipt);
    if (!validation.valid) {
      throw new DeliveryArtWorkSessionStoreError(
        "delivery_art_work_session_cleanup_receipt_invalid",
        "Delivery ART work-session cleanup receipt failed its contract.",
        validation,
      );
    }
    if (receipt.session_id !== sessionId) {
      throw new DeliveryArtWorkSessionStoreError(
        "delivery_art_work_session_cleanup_receipt_mismatch",
        "Cleanup receipt does not match its retained session identity.",
      );
    }
    return receipt;
  }

  function readCleanupReceiptByAlias(alias) {
    const sessionIds = readCleanupIndex().aliases[alias] ?? [];
    const receipts = sessionIds
      .map((sessionId) => readCleanupReceiptBySessionId(sessionId))
      .filter(Boolean);
    if (receipts.length > 1) {
      throw new DeliveryArtWorkSessionStoreError(
        "delivery_art_work_session_cleanup_alias_ambiguous",
        `Alias ${alias} resolves to more than one cleanup receipt.`,
      );
    }
    return receipts[0] ?? null;
  }

  function readCleanupManifestBySessionId(sessionId) {
    const manifest = readJson(cleanupManifestPath(sessionId));
    if (!manifest) {
      return null;
    }
    const validation = validateResourceManifest(manifest);
    if (!validation.valid || manifest.session_id !== sessionId) {
      throw new DeliveryArtWorkSessionStoreError(
        "delivery_art_work_session_cleanup_manifest_invalid",
        "Retained cleanup manifest failed its contract or session binding.",
        validation,
      );
    }
    return manifest;
  }

  function writeCleanupManifest(session, manifest, receipt) {
    const validation = validateResourceManifest(manifest);
    if (!validation.valid) {
      throw new DeliveryArtWorkSessionStoreError(
        "delivery_art_work_session_cleanup_manifest_invalid",
        "Terminal cleanup manifest failed its contract.",
        validation,
      );
    }
    assertResourceManifestBinding(session, manifest);
    if (
      manifest.cleanup.state !== "complete" ||
      receipt.manifest.generation !== manifest.generation ||
      receipt.manifest.content_digest !== canonicalDigest(manifest)
    ) {
      throw new DeliveryArtWorkSessionStoreError(
        "delivery_art_work_session_cleanup_manifest_mismatch",
        "Terminal cleanup manifest does not match its cleanup receipt.",
      );
    }
    assertCoordinationOnly(manifest, "cleanup_manifest");
    const existing = readCleanupManifestBySessionId(session.session_id);
    if (existing && JSON.stringify(existing) !== JSON.stringify(manifest)) {
      throw new DeliveryArtWorkSessionStoreError(
        "delivery_art_work_session_cleanup_manifest_conflict",
        "A different terminal cleanup manifest already exists for this session.",
      );
    }
    if (!existing) {
      atomicWrite(cleanupManifestPath(session.session_id), manifest);
    }
    return existing ?? manifest;
  }

  function writeCleanupReceipt(session, receipt) {
    const validation = validateCleanupReceipt(receipt);
    if (!validation.valid) {
      throw new DeliveryArtWorkSessionStoreError(
        "delivery_art_work_session_cleanup_receipt_invalid",
        "Delivery ART work-session cleanup receipt failed its contract.",
        validation,
      );
    }
    if (receipt.session_id !== session.session_id) {
      throw new DeliveryArtWorkSessionStoreError(
        "delivery_art_work_session_cleanup_receipt_mismatch",
        "Cleanup receipt does not belong to this work session.",
      );
    }
    assertCoordinationOnly(receipt, "cleanup_receipt");
    const existing = readCleanupReceiptBySessionId(session.session_id);
    if (existing && JSON.stringify(existing) !== JSON.stringify(receipt)) {
      throw new DeliveryArtWorkSessionStoreError(
        "delivery_art_work_session_cleanup_receipt_conflict",
        "A different terminal cleanup receipt already exists for this session.",
      );
    }
    if (!existing) {
      atomicWrite(cleanupReceiptPath(session.session_id), receipt);
    }
    const index = readCleanupIndex();
    for (const alias of session.aliases) {
      index.aliases[alias] = [
        ...new Set([...(index.aliases[alias] ?? []), session.session_id]),
      ].sort();
    }
    atomicWrite(cleanupIndexPath, index);
    return existing ?? receipt;
  }

  function managedStateRoot(session) {
    return path.join(root, "managed", storageName(session.session_id));
  }

  function managedStatePath(session, relativePath) {
    const managedRoot = managedStateRoot(session);
    const expectedPrefix = path.posix.join(
      "managed",
      storageName(session.session_id),
    );
    if (
      relativePath !== expectedPrefix &&
      !relativePath.startsWith(`${expectedPrefix}/`)
    ) {
      throw new DeliveryArtWorkSessionStoreError(
        "delivery_art_work_session_managed_state_outside_allowlist",
        "Managed session state is outside the session allowlist.",
      );
    }
    const resolved = path.resolve(root, relativePath);
    if (resolved !== managedRoot && !resolved.startsWith(`${managedRoot}${path.sep}`)) {
      throw new DeliveryArtWorkSessionStoreError(
        "delivery_art_work_session_managed_state_outside_allowlist",
        "Managed session state escapes the session allowlist.",
      );
    }
    return resolved;
  }

  function inspectManagedResource(session, resource) {
    if (
      resource.ownership_provenance !== "session-created" ||
      resource.retention_class !== "retire-on-terminal-close"
    ) {
      return { ...resource, outcome: "retained", last_error: null };
    }
    if (resource.locator.ownership_marker !== session.session_id) {
      return {
        ...resource,
        outcome: "blocked",
        last_error: "managed-state ownership marker does not match the session",
      };
    }
    let target;
    try {
      target = managedStatePath(session, resource.locator.relative_path);
    } catch (error) {
      return { ...resource, outcome: "blocked", last_error: error.message };
    }
    if (!existsSync(target)) {
      return { ...resource, outcome: "removed", last_error: null };
    }
    const marker = readJson(path.join(managedStateRoot(session), ".ownership.json"));
    if (marker?.session_id !== session.session_id) {
      return {
        ...resource,
        outcome: "blocked",
        last_error: "managed-state ownership marker is missing or mismatched",
      };
    }
    return { ...resource, outcome: "eligible", last_error: null };
  }

  function retireManagedResource(session, resource) {
    const inspected = inspectManagedResource(session, resource);
    if (inspected.outcome === "removed") {
      return;
    }
    if (inspected.outcome !== "eligible") {
      throw new DeliveryArtWorkSessionStoreError(
        "delivery_art_work_session_managed_state_not_eligible",
        inspected.last_error ?? "Managed state is not eligible for retirement.",
      );
    }
    rmSync(managedStatePath(session, resource.locator.relative_path), {
      recursive: true,
    });
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
    cleanupManifestPath,
    cleanupReceiptPath,
    decisionPath,
    inspectManagedResource,
    managedStateRoot,
    readArtifact,
    readByAlias,
    readBySessionId,
    readCleanupReceiptByAlias,
    readCleanupReceiptBySessionId,
    readCleanupManifestBySessionId,
    readDecision,
    readResourceManifest,
    removeSession,
    retireManagedResource,
    root,
    withLock,
    writeArtifact,
    writeCleanupReceipt,
    writeCleanupManifest,
    writeDecisionDraft,
    writeResourceManifest,
    writeSession,
  };
}
