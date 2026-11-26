import { createHash } from "node:crypto";
import { mkdirSync, readdirSync } from "node:fs";
import path from "node:path";

import { canonicalDigest } from "../delivery-art/canonical-json.js";
import { HttpError } from "../errors.js";
import { createPrivateFileTransactions, syncPrivateDirectory } from "../persistence/private-file-transactions.js";
import { projectSourceSnapshotSchema } from "./contracts.js";

const identifier = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const digest = /^sha256:[a-f0-9]{64}$/;
const ownerStates = new Set(["preparing", "building", "starting", "ready", "failed", "stopped", "stale", "unknown"]);
const fail = (status, code, detail) => {
  throw new HttpError(status, `project_runtime_${code}`, detail);
};
const hash = value => createHash("sha256").update(value).digest("hex");
const scopeIdentity = ({ installation_id, project_custody_ref, app_root, environment_ref }) =>
  canonicalDigest({ installation_id, project_custody_ref, app_root, environment_ref });

function retainedIntent(record) {
  const { caller_id, operator_id, request, scope, subject, source, setup, snapshot, operation_id, accepted_at } = record;
  return canonicalDigest({ caller_id, operator_id, request, scope, subject, source, setup, snapshot, operation_id, accepted_at });
}

function assertRequest(value) {
  const fields = ["command_id", "project_ref", "expected_revision", "source_revision", "source_digest", "configuration_revision"];
  if (!value || typeof value !== "object" || Object.keys(value).length !== fields.length ||
      !fields.every(field => Object.hasOwn(value, field)) ||
      !["command_id", "project_ref"].every(field => typeof value[field] === "string" && identifier.test(value[field])) ||
      !["source_revision", "configuration_revision"].every(field => typeof value[field] === "string" && value[field].length > 0 && value[field].length <= 256) ||
      typeof value.source_digest !== "string" || !digest.test(value.source_digest) ||
      !Number.isSafeInteger(value.expected_revision) || value.expected_revision < 0 || value.expected_revision >= Number.MAX_SAFE_INTEGER) {
    fail(400, "command_invalid", "Run saved source requires the exact project, acknowledged source, setup and expected revision.");
  }
  return structuredClone(value);
}

function statePath(projectDirectory, revision) {
  return path.join(projectDirectory, `${String(revision).padStart(16, "0")}.json`);
}

function projectRevision(directory) {
  let names;
  try {
    names = readdirSync(directory);
  } catch (error) {
    if (error.code === "ENOENT") return 0;
    throw error;
  }
  return names.reduce((highest, name) => {
    if (!/^\d{16}\.json$/.test(name)) return highest;
    return Math.max(highest, Number(name.slice(0, -5)));
  }, 0);
}

function receipt(record) {
  return {
    command_id: record.request.command_id, operation_id: record.operation_id,
    scope_revision: record.scope_revision, accepted_at: record.accepted_at, snapshot: record.snapshot,
  };
}

function project(record) {
  return {
    acknowledgement: receipt(record),
    status: record.dispatch === "observed" ? record.observation.state :
      record.dispatch === "retained" ? "acknowledged" :
        record.dispatch === "superseded" ? "stale" : "unknown",
    observation: record.dispatch === "observed" ? record.observation : null,
    last_observation: record.dispatch === "unknown" ? record.observation : null,
  };
}

function safeObservation(value, command) {
  // Owner responses are projected as observations only after their identity
  // matches both the original source and setup. Unexpected/private fields
  // from the provider cannot be returned by the broker.
  if (!value || !ownerStates.has(value.state) ||
      value.operation_id !== command.operation_id ||
      value.command_id !== command.command_id ||
      value.scope_digest !== command.scope_digest ||
      value.manifest_digest !== command.snapshot.manifest_digest ||
      value.configuration_revision !== command.setup.configuration_revision ||
      typeof value.observed_at !== "string" || !Number.isFinite(Date.parse(value.observed_at))) {
    fail(502, "observation_mismatch", "The owner observation does not bind the original operation, source and setup.");
  }
  const observation = { state: value.state, observed_at: value.observed_at };
  for (const field of ["instance_ref", "owner_receipt_ref", "log_ref", "endpoint_ref"]) {
    if (typeof value[field] === "string" && value[field].length <= 512 && /^[A-Za-z][A-Za-z0-9._:/%-]*$/.test(value[field])) {
      observation[field] = value[field];
    }
  }
  if (value.state === "ready" && (!observation.instance_ref || !observation.owner_receipt_ref)) {
    fail(502, "observation_incomplete", "Ready requires an observed instance and a matching owner receipt.");
  }
  return observation;
}

export function createSavedProjectRuntimeCommands({
  root, authority, platform, clock = () => new Date(),
}) {
  const bindingRoot = path.join(root, "by-command");
  const projectRoot = path.join(root, "by-project");
  mkdirSync(bindingRoot, { recursive: true, mode: 0o700 });
  mkdirSync(projectRoot, { recursive: true, mode: 0o700 });
  syncPrivateDirectory(root);
  const tx = createPrivateFileTransactions({ root,
    failure: (code, message) => new HttpError(503, `project_runtime_${code}`, message),
  });
  const bindingFile = commandId => path.join(bindingRoot, `${hash(commandId)}.json`);
  const directory = scopeDigest => path.join(projectRoot, scopeDigest.slice(7));
  const readBinding = id => tx.read(bindingFile(id), "Project runtime command identity", { maxBytes: 4096 });

  function requireOwned(binding, callerId, operatorId) {
    if (!binding || binding.caller_id !== callerId || binding.operator_id !== operatorId ||
        !digest.test(binding.scope_digest) || !Number.isSafeInteger(binding.scope_revision) || binding.scope_revision <= 0) {
      fail(404, "command_not_found", "No original command was admitted for this operator.");
    }
  }

  function readOriginal(binding) {
    const file = statePath(directory(binding.scope_digest), binding.scope_revision);
    const record = tx.read(file, "Original project runtime command", { maxBytes: 32_768 });
    if (!record || record.intent_digest !== binding.intent_digest || record.request.command_id !== binding.command_id ||
        record.scope_revision !== binding.scope_revision || record.scope_digest !== binding.scope_digest ||
        record.caller_id !== binding.caller_id || record.operator_id !== binding.operator_id) return null;
    if (retainedIntent(record) !== binding.retained_intent_digest ||
        scopeIdentity(record.scope) !== binding.scope_digest) {
      fail(503, "state_corrupt", "The retained command no longer matches the approved source and setup.");
    }
    return { file, record };
  }

  async function accept({ callerId, operatorId, request }) {
    const command = assertRequest(request);
    if (typeof callerId !== "string" || !callerId || typeof operatorId !== "string" || !operatorId) {
      fail(403, "caller_forbidden", "The authenticated caller and operator must be bound to the source session.");
    }
    const intentDigest = canonicalDigest({ caller_id: callerId, operator_id: operatorId, request: command });
    return tx.withLock(`command:${command.command_id}`, async () => {
      const held = readBinding(command.command_id);
      if (held) {
        requireOwned(held, callerId, operatorId);
        if (held.intent_digest !== intentDigest) fail(409, "command_conflict", "This command ID already names different immutable input.");
        const original = readOriginal(held);
        if (original) return receipt(original.record);
      }
      // The owner obtains these from current source custody, the caller-bound
      // acknowledged draft, and the latest admitted Platform setup selection.
      const selection = await authority.resolve({ callerId, operatorId, request: command });
      if (!selection || selection.project_ref !== command.project_ref ||
          selection.source?.kind !== "saved-draft" || selection.source.revision !== command.source_revision ||
          selection.source.change_set_digest !== command.source_digest ||
          selection.setup?.configuration_revision !== command.configuration_revision) {
        fail(409, "selection_changed", "Save and review the exact source and setup before running it.");
      }
      const scopeDigest = scopeIdentity(selection.scope);
      if (held && held.scope_digest !== scopeDigest) fail(409, "scope_changed", "The original command cannot change its project scope.");
      return tx.withLock(`project:${scopeDigest}`, async () => {
        const projectDirectory = directory(scopeDigest);
        const current = projectRevision(projectDirectory);
        if (current !== command.expected_revision) {
          fail(409, "revision_stale", "The project command revision changed. Read current owner state before running again.");
        }
        const captured = await authority.capture({ callerId, operatorId, selection, commandId: command.command_id });
        if (!projectSourceSnapshotSchema.reference(captured) ||
            captured.snapshot_id !== `project-source:${captured.manifest_digest.slice(7)}`) {
          fail(502, "snapshot_invalid", "Source capture did not return an exact immutable snapshot.");
        }
        const snapshot = { snapshot_id: captured.snapshot_id, manifest_digest: captured.manifest_digest };
        const binding = { caller_id: callerId, operator_id: operatorId, command_id: command.command_id,
          scope_digest: scopeDigest, intent_digest: intentDigest, scope_revision: current + 1 };
        const record = { schema_version: 1, ...binding, request: command, snapshot,
          scope: selection.scope, subject: selection.subject, source: selection.source, setup: selection.setup,
          operation_id: `project-operation:${hash(intentDigest)}`, accepted_at: held?.accepted_at ?? clock().toISOString(),
          dispatch: "retained", observation: null };
        binding.accepted_at = record.accepted_at;
        binding.retained_intent_digest = retainedIntent(record);
        if (held && held.retained_intent_digest !== binding.retained_intent_digest) {
          fail(409, "selection_changed", "The interrupted original command must retain the same source, setup and snapshot.");
        }
        mkdirSync(projectDirectory, { recursive: true, mode: 0o700 });
        syncPrivateDirectory(projectRoot);
        // The binding reserves the original ID. The revision file is the
        // commit point. A binding alone admits no effect and returns no ack.
        if (!held) tx.write(bindingFile(command.command_id), binding);
        tx.write(statePath(projectDirectory, binding.scope_revision), record);
        return receipt(record);
      });
    });
  }

  function original({ callerId, operatorId, commandId }) {
    const binding = readBinding(commandId);
    requireOwned(binding, callerId, operatorId);
    const entry = readOriginal(binding);
    if (!entry) fail(404, "command_not_found", "No durable acknowledgement was recorded for this command.");
    return entry;
  }

  function read(input) {
    const { record } = original(input);
    return project(record);
  }

  async function advance(input) {
    return tx.withLock(`command:${input.commandId}`, async () => {
      const { file, record } = original(input);
      if (record.dispatch === "superseded") return project(record);
      const payload = {
        command_id: record.request.command_id, project_ref: record.request.project_ref, operation_id: record.operation_id,
        scope: record.scope, scope_digest: record.scope_digest, scope_revision: record.scope_revision, snapshot: record.snapshot,
        subject: record.subject, source: record.source, setup: record.setup,
      };
      let outcome;
      if (record.dispatch === "retained") {
        // Recheck current source/custody authority under its own lease before
        // the first dispatch. Recovery reads cannot perform a second effect.
        outcome = await tx.withLock(`project:${record.scope_digest}`, async () => {
          if (projectRevision(directory(record.scope_digest)) !== record.scope_revision) {
            record.dispatch = "superseded";
            tx.write(file, record);
            return null;
          }
          return authority.withCurrentScope({
            callerId: input.callerId, operatorId: input.operatorId, command: payload,
          }, async () => {
            record.dispatch = "unknown";
            tx.write(file, record);
            return platform.submit(payload);
          });
        }).catch(error => {
          if (record.dispatch === "retained") throw error;
          return null;
        });
        if (record.dispatch === "superseded") return project(record);
      } else {
        outcome = await platform.read(payload).catch(() => null);
      }
      if (outcome) {
        try {
          const observation = safeObservation(outcome, payload);
          const prior = record.observation;
          const delta = prior ? Date.parse(observation.observed_at) - Date.parse(prior.observed_at) : 1;
          if (prior && (delta < 0 || (delta === 0 && canonicalDigest(observation) !== canonicalDigest(prior)))) {
            fail(409, "observation_stale", "Platform returned an older or conflicting observation.");
          }
          if (observation.state === "unknown") {
            record.dispatch = "unknown";
          } else {
            record.observation = observation;
            record.dispatch = "observed";
          }
        } catch (error) {
          record.dispatch = "unknown";
          tx.write(file, record);
          throw error;
        }
      } else {
        // Keep previously observed source evidence with its original time.
        // Mark the latest attempt unknown when the owner cannot be reached.
        record.dispatch = "unknown";
      }
      tx.write(file, record);
      return project(record);
    });
  }

  return { accept, advance, read };
}
