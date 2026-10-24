import { readFileSync } from "node:fs";
import Ajv2020 from "ajv/dist/2020.js";
import { HttpError } from "../errors.js";

const schema = JSON.parse(readFileSync(new URL("../../contracts/governed-ai/effective-selection.schema.json", import.meta.url), "utf8"));
const validate = new Ajv2020({ strict: true }).compile(schema);

// Optional for historical records and older owner replies. When present this
// metadata must bind the existing logical task; it never replaces task output,
// context admission or the source-policy binding_selection_ref.
export function selectionEvidence(response, { profileId, taskKind }) {
  if (!Object.hasOwn(response, "effective_selection")) return {};
  const evidence = response.effective_selection;
  if (!validate(evidence) || evidence.task !== `${profileId}/${taskKind}` ||
      response.output && (evidence.attempts.length === 0 || evidence.attempts.at(-1).outcome !== "suggestion-produced" || evidence.attempts.slice(0, -1).some(attempt => !["provider-unavailable", "provider-busy"].includes(attempt.outcome)))) {
    throw new HttpError(502, "governed_ai_selection_invalid", "Effective model selection evidence does not bind the admitted workflow result.");
  }
  return { effective_selection: structuredClone(evidence) };
}
