import { canonicalDigest } from "../delivery-art/canonical-json.js";
import { HttpError } from "../errors.js";
import { createSavedProjectRuntimeCommands } from "./commands.js";

// A runtime composition supplies Platform setup and observation clients over
// its existing private owner connection. Each domain supplies its saved
// source and source-session lease. Browser input names their references.
export function createProjectRuntimeCommands({ root, delivery, prototype, readSetup, platform, clock }) {
  function selectOwner(subject) {
    if (subject?.kind === "delivery" && delivery) {
      return { api: delivery, selection: { workItemId: subject.ref }, readDraft: args => delivery.readRealizationSource({ ...args, kind: "draft" }) };
    }
    if (subject?.kind === "prototype" && prototype) {
      return { api: prototype, selection: { requestId: subject.ref }, readDraft: args => prototype.draft(args) };
    }
    throw new HttpError(409, "project_runtime_source_unavailable", "The current project has no admitted source owner.");
  }
  const authority = {
    async resolve({ callerId, operatorId, request }) {
      const selection = await readSetup({ callerId, operatorId, projectRef: request.project_ref });
      if (!selection || selection.project_ref !== request.project_ref ||
          selection.setup?.configuration_revision !== request.configuration_revision) return null;
      const owner = selectOwner(selection.subject);
      const draft = await owner.readDraft({ callerId, operatorId, ...owner.selection });
      if (!draft?.operator_draft || draft.accepted || draft.revision !== request.source_revision ||
          draft.digest !== request.source_digest) return null;
      return {
        project_ref: selection.project_ref, subject: selection.subject, scope: selection.scope, setup: selection.setup,
        limits: selection.limits,
        source: { kind: "saved-draft", session_id: draft.session_id, base_commit: draft.change_set.base_commit,
          revision: draft.revision, change_set_digest: draft.digest },
      };
    },
    async capture({ callerId, operatorId, commandId, selection }) {
      const owner = selectOwner(selection.subject);
      return owner.api.captureProjectRuntimeSource({
        callerId, operatorId, ...owner.selection,
        selection: { command_id: commandId, scope: selection.scope, setup: selection.setup,
          limits: selection.limits, source: selection.source },
      });
    },
    async withCurrentScope({ callerId, operatorId, command }, operation) {
      const current = await readSetup({ callerId, operatorId, projectRef: command.project_ref });
      if (!current || current.project_ref !== command.project_ref ||
          canonicalDigest(current.scope) !== canonicalDigest(command.scope) ||
          canonicalDigest(current.setup) !== canonicalDigest(command.setup) ||
          canonicalDigest(current.subject) !== canonicalDigest(command.subject)) {
        throw new HttpError(409, "project_runtime_setup_changed", "Current project custody or setup no longer matches the acknowledged command.");
      }
      const owner = selectOwner(command.subject);
      return owner.api.withAuthorizedProjectSource({
        callerId, operatorId, ...owner.selection,
        commandId: command.command_id, source: command.source,
      }, operation);
    },
  };
  return createSavedProjectRuntimeCommands({ root, authority, platform, clock });
}
