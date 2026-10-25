import { readFileSync } from "node:fs";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { canonicalDigest } from "../delivery-art/canonical-json.js";

const schema = JSON.parse(readFileSync(new URL("../../contracts/delivery-art-work-session/operator-source-draft.schema.json", import.meta.url), "utf8"));
const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validate = ajv.compile(schema);

// This kernel retains inert operator input in the subject owner's existing
// private artifacts. It cannot select a repository, obtain a credential,
// invoke a model, accept a draft or perform a source action.
export function assertOperatorDraftCommand(value, error) {
  if (!validate(value) || !value.objective.isWellFormed() || !value.commit_message.isWellFormed() ||
      new Set(value.operations.map(operation => operation.path)).size !== value.operations.length ||
      value.operations.some(operation => typeof operation.content === "string" &&
        (!operation.content.isWellFormed() || operation.content.includes("\0") || Buffer.byteLength(operation.content) > 65_536)) ||
      value.operations.reduce((size, operation) => size + (typeof operation.content === "string" ? Buffer.byteLength(operation.content) : 0), 0) > 512 * 1024) {
    throw error("draft_invalid", "Use the exact bounded text-source draft contract, distinct paths and valid UTF-8 content.", { statusCode: 400 });
  }
  return structuredClone(value);
}

export function createOperatorDraftEditor({ enabled, sessionFor, assertIdentity, readRecord, writeRecord,
  withLock, putArtifact, readArtifact, validateDraft, project, nextRevision, clock = () => new Date(),
  canonicalObjective = () => null, assertEditable = () => {}, commitRecord = null, error }) {
  return async function save({ callerId, operatorId, subjectRef, request: input }) {
    const command = assertOperatorDraftCommand(input, error);
    const session = await sessionFor(subjectRef);
    assertIdentity(session, callerId, operatorId);
    return withLock(session, async () => {
      const current = await readRecord(session, subjectRef);
      const commandDigest = canonicalDigest(command);
      const previous = current.operator_saves?.find(entry => entry.command_id === command.command_id);
      if (previous) {
        if (previous.command_digest !== commandDigest) throw error("replay_conflict", "This save identity already names different immutable input.", { statusCode: 409 });
        // Replaying a saved acknowledgement is a read, including after source
        // approval expires or a later draft revision has been saved.
        const acknowledgement = await readArtifact(session, previous.ack_ref);
        if (!acknowledgement || canonicalDigest(acknowledgement) !== previous.ack_digest) {
          throw error("acknowledgement_invalid", "The retained save acknowledgement is missing or changed; recover owner storage before retrying.", { statusCode: 503 });
        }
        return { ...acknowledgement, replayed: true };
      }
      if (!enabled) throw error("runtime_unavailable", "The owner source composition is unavailable.", { statusCode: 503 });
      await assertEditable(session);
      const prior = current.attempts.at(-1) ?? null;
      const editing = prior?.state === "draft-ready";
      if (current.revision !== command.expected_revision ||
          command.expected_change_set_digest !== (editing ? prior.change_set_digest : null)) {
        throw error("revision_stale", "Reload the current owner draft before saving; its revision or digest changed.", { statusCode: 409 });
      }
      if (prior && !["draft-ready", "failed", "cancelled"].includes(prior.state)) {
        throw error("draft_not_editable", "Recover or finish the original source action before editing its draft.", { statusCode: 409 });
      }
      if (command.retry_of !== (!editing && prior ? prior.request_id : null)) {
        throw error("retry_binding_invalid", "A new draft must explicitly follow the immediately preceding terminal attempt.", { statusCode: 409 });
      }
      if (editing && command.execution_id !== prior.execution_id) {
        throw error("execution_changed", "Amend the draft within its original source execution.", { statusCode: 409 });
      }
      const requiredObjective = canonicalObjective(session);
      const objectiveDigest = canonicalDigest(command.objective);
      if ((requiredObjective !== null && requiredObjective !== command.objective) ||
          (editing && prior.objective_digest !== objectiveDigest)) {
        throw error("objective_changed", "Keep the accepted source objective when amending its draft; cancel first to start a different objective.", { statusCode: 409 });
      }
      const at = clock().toISOString();
      if (Date.parse(command.requested_at) > Date.parse(at) ||
          Date.parse(command.requested_at) < Date.parse(prior?.requested_at ?? session.created_at)) {
        throw error("timeline_invalid", "Draft save time is outside the current source-session timeline.", { statusCode: 409 });
      }
      const changeSet = { schema_version: 1, change_set_id: `operator-change-set:${commandDigest.slice(7)}`,
        session_id: session.session_id, base_commit: session.landing_unit.base_commit,
        objective_digest: objectiveDigest, commit_message: command.commit_message, operations: command.operations };
      // The same owner executor performs the exact read-only path/base/digest
      // preflight used by apply. Invalid input cannot poison the private draft.
      await validateDraft(session, changeSet, command);
      const record = structuredClone(current);
      const retained = editing ? await putArtifact(session, `draft-history-${prior.change_set_digest.slice(7)}.json`, prior) : null;
      const attempt = editing ? structuredClone(prior) : {
        request_id: command.command_id, execution_id: command.execution_id, request_digest: commandDigest,
        request: { kind: "operator", command_id: command.command_id, execution_id: command.execution_id, objective: command.objective },
        requested_at: command.requested_at, retry_of: command.retry_of, objective_digest: objectiveDigest,
        context_request_ref: null, model_request_ref: null, source_receipt: null, failure: null,
      };
      const originalModel = prior?.operator_draft?.original_model ?? prior?.model ?? null;
      attempt.operator_draft = { origin: originalModel ? "operator-amended-model" : "operator",
        input_origin: command.input_origin, operator_id: operatorId, command_id: command.command_id,
        amended_at: at, previous_draft_ref: retained, previous_draft_digest: editing ? prior.change_set_digest : null,
        original_model: originalModel };
      attempt.change_set = changeSet;
      attempt.change_set_digest = canonicalDigest(changeSet);
      attempt.context = null;
      attempt.model = null; // Original model evidence never attests edited bytes.
      attempt.state = "draft-ready";
      attempt.completed_at = at;
      if (editing) record.attempts[record.attempts.length - 1] = attempt;
      else record.attempts.push(attempt);
      if (commitRecord) return commitRecord(session, record, command, commandDigest);
      record.revision = nextRevision(current, session);
      const acknowledgement = project(record);
      const ackRef = await putArtifact(session, `draft-ack-${commandDigest.slice(7)}.json`, acknowledgement);
      record.operator_saves = [...(record.operator_saves ?? []), { command_id: command.command_id, command_digest: commandDigest, ack_ref: ackRef, ack_digest: canonicalDigest(acknowledgement) }];
      // The acknowledgement is reachable only through this atomic owner
      // record. An interrupted earlier artifact write cannot claim a save.
      await writeRecord(session, record);
      return acknowledgement;
    });
  };
}
