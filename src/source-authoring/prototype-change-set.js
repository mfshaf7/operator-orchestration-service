import { validateDeliveryArtSourceRealizationChangeSet } from "../delivery-art/source-realization.js";
import { prototypeSourcePathAllowed } from "./prototype-context.js";
import { prototypeAuthoringError } from "./prototype-contracts.js";

// Reuse the existing closed change-set wire and the actual Git executor's
// UTF-8 byte limits. A draft must satisfy apply constraints BEFORE acceptance,
// not become apply-unknown for a deterministically denied oversized operation.
export function assertPrototypeChangeSet(value, session, { status = 400, code = "change_set_scope_denied" } = {}) {
  if (!validateDeliveryArtSourceRealizationChangeSet(value).valid || value.session_id !== session.session_id ||
      value.base_commit !== session.landing_unit.base_commit || value.objective_digest !== session.objective_digest ||
      new Set(value.operations.map(operation => operation.path)).size !== value.operations.length ||
      value.operations.some(operation => !prototypeSourcePathAllowed(operation.path, session.model_source_scope) ||
        (typeof operation.content === "string" && (!operation.content.isWellFormed() || Buffer.byteLength(operation.content) > 65_536))) ||
      value.operations.reduce((sum, operation) => sum + (typeof operation.content === "string" ? Buffer.byteLength(operation.content) : 0), 0) > 512 * 1024) {
    throw prototypeAuthoringError(code, "Only the exact session-bound Prototype app/design change set within the existing executor's path, operation and UTF-8 byte limits is admitted.", status);
  }
  return value;
}
