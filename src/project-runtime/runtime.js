import path from "node:path";

import { canonicalDigest } from "../delivery-art/canonical-json.js";
import { HttpError } from "../errors.js";
import { projectSourceSnapshotSchema } from "./contracts.js";
import { createProjectRuntimeCommands } from "./source-commands.js";

// Use the source executor's existing bounded Git output size. Platform owns
// the number and total bytes of files that may enter the runtime snapshot.
const MAX_TREE_BYTES = 1024 * 1024;
const identifier = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const recordKeys = (value, fields) => value && typeof value === "object" &&
  Object.keys(value).length === fields.length && fields.every(field => Object.hasOwn(value, field));
const unavailable = () => new HttpError(409, "project_runtime_setup_unavailable", "A reviewed project setup is required before running saved source.");
const missing = () => new HttpError(404, "project_runtime_command_not_found", "No original command was admitted for this project.");

function admittedBindings(raw) {
  try {
    const rows = JSON.parse(raw);
    if (!Array.isArray(rows) || !rows.length) throw new TypeError();
    const bindings = new Map();
    const subjects = new Set();
    for (const binding of rows) {
      const subject = binding?.subject;
      if (!recordKeys(binding, ["scope", "subject", "project_ref"]) ||
          !recordKeys(subject, ["kind", "ref"]) || !["prototype", "delivery"].includes(subject.kind) ||
          typeof subject.ref !== "string" || !identifier.test(subject.ref) ||
          typeof binding.project_ref !== "string" || !identifier.test(binding.project_ref) ||
          !projectSourceSnapshotSchema.scope(binding.scope)) throw new TypeError();
      const key = `${subject.kind}:${subject.ref}`;
      if (subjects.has(key) || bindings.has(binding.project_ref)) throw new TypeError();
      subjects.add(key);
      bindings.set(binding.project_ref, binding);
    }
    return bindings;
  } catch {
    throw new HttpError(503, "project_runtime_admission_invalid", "Platform's saved-project admission is unavailable.");
  }
}

export function createProjectRuntime({ root, rawBindings, prototype, delivery, provider, operatorBindings }) {
  if (!rawBindings?.trim()) return null;
  const bindings = admittedBindings(rawBindings);
  const prototypeProjects = new Map([...bindings.values()].filter(binding => binding.subject.kind === "prototype")
    .map(binding => [binding.subject.ref, binding]));

  function authorizedOperator(callerId, operatorId) {
    if (!operatorId || operatorBindings[callerId] !== operatorId) {
      throw new HttpError(403, "project_runtime_operator_forbidden", "The project operator is not admitted for this caller.");
    }
  }

  async function resolveSetup({ callerId, operatorId, projectRef }) {
    authorizedOperator(callerId, operatorId);
    const binding = bindings.get(projectRef);
    if (!binding) throw unavailable();
    const selected = await provider.readProjectRuntimeSetup(binding);
    if (!recordKeys(selected, ["project_ref", "subject", "scope", "setup", "limits"]) ||
        selected.project_ref !== binding.project_ref ||
        canonicalDigest(selected.scope) !== canonicalDigest(binding.scope) ||
        canonicalDigest(selected.subject) !== canonicalDigest(binding.subject) ||
        !projectSourceSnapshotSchema.setup(selected.setup) ||
        !recordKeys(selected.limits, ["max_files", "max_bytes"]) ||
        !Object.values(selected.limits).every(value => Number.isSafeInteger(value) && value > 0)) {
      throw new HttpError(502, "project_runtime_setup_mismatch", "The setup read did not match the exact admitted project.");
    }
    return { ...selected, limits: { ...selected.limits, max_tree_bytes: MAX_TREE_BYTES } };
  }

  const commands = createProjectRuntimeCommands({
    root: path.join(root, "saved-project-runtime"),
    delivery, prototype, readSetup: resolveSetup,
    platform: { submit: provider.submitProjectRuntime, read: provider.readProjectRuntime },
  });

  async function selectPrototype({ callerId, operatorId, requestId }) {
    authorizedOperator(callerId, operatorId);
    const request = await prototype?.read({ callerId, operatorId, requestId });
    const selection = prototypeProjects.get(requestId);
    if (!request?.session_id || request.source_request?.owner_preparation || !selection) throw unavailable();
    return selection;
  }

  async function overview(input) {
    const selection = await selectPrototype(input);
    const setup = await resolveSetup({ ...input, projectRef: selection.project_ref });
    const limit = input.limit ?? 20;
    const before = input.before ?? null;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50 ||
        (before !== null && (!Number.isSafeInteger(before) || before < 1))) {
      throw new HttpError(400, "project_runtime_history_invalid", "Choose a valid project history page.");
    }
    const history = commands.history({ ...input, selection, limit, before });
    return { project_ref: selection.project_ref, setup: setup.setup, ...history };
  }

  async function run(input) {
    const selection = await selectPrototype(input);
    if (!recordKeys(input.command, ["command_id", "expected_revision", "source_revision", "source_digest", "configuration_revision"])) {
      throw new HttpError(400, "project_runtime_command_invalid", "Run requires the exact saved source and reviewed setup.");
    }
    const request = { ...input.command, project_ref: selection.project_ref };
    await commands.accept({ ...input, request });
    return commands.advance({ ...input, selection, commandId: request.command_id });
  }

  async function reconcile(input, advance = false) {
    const selection = await selectPrototype(input);
    if (typeof input.commandId !== "string" || !identifier.test(input.commandId)) throw missing();
    return commands[advance ? "advance" : "read"]({ ...input, selection });
  }

  return { overview, run, reconcile };
}
