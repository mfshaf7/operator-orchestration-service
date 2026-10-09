import { randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import path from "node:path";

import { canonicalDigest } from "./canonical-json.js";

const ARTIFACT_TYPE = "delivery_art_source_action_result";
const REPLAYABLE_ACTIONS = new Set(["lifecycle.acquire-evidence"]);

function isReplayableResult(action, result) {
  if (!REPLAYABLE_ACTIONS.has(action)) return false;
  if (action === "lifecycle.acquire-evidence") {
    return result?.artifact_type === "delivery_art_owner_evidence_receipt" &&
      Array.isArray(result.results) &&
      result.results.every((entry) => entry?.result === "pass");
  }
  return true;
}

function privateDirectory(root) {
  if (!path.isAbsolute(root)) {
    throw new Error("source action result root must be absolute");
  }
  mkdirSync(root, { mode: 0o700, recursive: true });
  const state = lstatSync(root);
  if (state.isSymbolicLink() || !state.isDirectory()) {
    throw new Error("source action result root must be a private directory");
  }
  if ((state.mode & 0o777) !== 0o700 || state.uid !== process.getuid()) {
    throw new Error("source action result root must be operator-owned mode 0700");
  }
}

function contextBinding(context) {
  return {
    caller_id: context.caller_id,
    operator_id: context.operator_id,
    session_id: context.session_id ?? null,
    work_item_id: context.work_item_id,
  };
}

function recordDigest(record) {
  const { record_digest: _recordDigest, ...input } = record;
  return canonicalDigest(input);
}

export function sourceActionRequestDigest(action, context, input) {
  return canonicalDigest({
    action,
    context: contextBinding(context),
    input,
  });
}

export function createSourceActionResultStore({ root } = {}) {
  if (!root) return null;
  privateDirectory(root);

  function resultPath(requestDigest) {
    return path.join(root, `${requestDigest.slice("sha256:".length)}.json`);
  }

  function read(action, context, input) {
    if (!REPLAYABLE_ACTIONS.has(action)) return null;
    const requestDigest = sourceActionRequestDigest(action, context, input);
    const target = resultPath(requestDigest);
    if (!existsSync(target)) return null;
    const state = lstatSync(target);
    if (
      state.isSymbolicLink() ||
      !state.isFile() ||
      (state.mode & 0o777) !== 0o600 ||
      state.uid !== process.getuid()
    ) {
      throw new Error("source action result record has unsafe ownership or mode");
    }
    let record;
    try {
      record = JSON.parse(readFileSync(target, "utf8"));
    } catch {
      throw new Error("source action result record is not valid JSON");
    }
    if (
      record?.schema_version !== 1 ||
      record?.artifact_type !== ARTIFACT_TYPE ||
      record.action !== action ||
      record.request_digest !== requestDigest ||
      record.record_digest !== recordDigest(record) ||
      !Object.prototype.hasOwnProperty.call(record, "result")
    ) {
      throw new Error("source action result record failed integrity validation");
    }
    return isReplayableResult(action, record.result)
      ? structuredClone(record.result)
      : null;
  }

  function write(action, context, input, result) {
    if (!isReplayableResult(action, result)) return;
    const requestDigest = sourceActionRequestDigest(action, context, input);
    const target = resultPath(requestDigest);
    const record = {
      schema_version: 1,
      artifact_type: ARTIFACT_TYPE,
      action,
      request_digest: requestDigest,
      result: structuredClone(result),
      recorded_at: new Date().toISOString(),
      record_digest: null,
    };
    record.record_digest = recordDigest(record);
    const temporary = path.join(root, `.${path.basename(target)}.${process.pid}.${randomUUID()}`);
    let descriptor = null;
    try {
      descriptor = openSync(temporary, "wx", 0o600);
      writeSync(descriptor, `${JSON.stringify(record, null, 2)}\n`, null, "utf8");
      fsyncSync(descriptor);
      closeSync(descriptor);
      descriptor = null;
      if (existsSync(target)) {
        const existing = read(action, context, input);
        if (existing !== null && canonicalDigest(existing) !== canonicalDigest(result)) {
          throw new Error("source action result replay conflicts with durable custody");
        }
        if (existing !== null) return;
      }
      renameSync(temporary, target);
    } finally {
      if (descriptor !== null) closeSync(descriptor);
      if (existsSync(temporary)) unlinkSync(temporary);
    }
  }

  return { read, write };
}
