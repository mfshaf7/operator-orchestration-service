import { readFileSync } from "node:fs";
import Ajv2020 from "ajv/dist/2020.js";
import { HttpError } from "./errors.js";

const schema = JSON.parse(readFileSync(new URL("../contracts/work-design/advisor-draft-reply.schema.json", import.meta.url), "utf8"));
const validate = new Ajv2020({ allErrors: true, strict: false }).compile(schema);
const invalid = message => { throw new HttpError(502, "advisor_draft_output_invalid", message); };
const compact = value => Array.isArray(value) ? value.map(compact)
  : value && typeof value === "object" ? Object.fromEntries(Object.entries(value)
    .filter(([, child]) => child !== null).map(([key, child]) => [key, compact(child)])) : value;

/** Retained completed v1 replies keep their original meaning after extension. */
function legacyBoardReply(reply) {
  const result = structuredClone(reply);
  if (!Array.isArray(result?.edits)) return result;
  const previous = ["addItems", "updateItems", "removeItemIds", "addConnections", "removeConnectionIds"];
  for (const edit of result.edits) {
    const board = edit?.board_patch;
    if (!board || typeof board !== "object" || Array.isArray(board) || Object.keys(board).length !== previous.length || !previous.every(key => Array.isArray(board[key]))) continue;
    for (const key of ["addTrays", "updateTrays", "removeTrayIds", "updateConnections", "arrangements", "layers"]) board[key] = [];
    board.placement = null;
    for (const item of [...board.addItems, ...board.updateItems]) if (item && typeof item === "object" && !Object.hasOwn(item, "autoSize")) item.autoSize = null;
  }
  return result;
}

export const nativeAdvisorInstruction = `The provider schema contains a required native draft_reply object. Always fill it directly; never put JSON, JSON Patch or the edit envelope inside text.
Legacy requested_response_format/response_format strings inside packet data describe the compatibility HTTP envelope. They do not override this native provider schema.
Use intent=answer or clarify with edits=[] for questions or missing information. Only an explicit request to edit an admitted operator draft permits intent=draft and nonempty edits. Never approve, execute, publish, apply canonical changes or invent authority.
Each edit names one admitted field and value_type=text, board or tree. Populate exactly the matching text_value, board_patch or tree_patch; set the other two to null. Optional item/style/update properties use null when unchanged. Board patches use the native addItems/updateItems/removeItemIds/addConnections/updateConnections/removeConnectionIds/addTrays/updateTrays/removeTrayIds/arrangements/layers arrays and nullable placement. Leave unused arrays empty. Follow the selected editor's supplied operation and rendering facts: trays group actual member IDs, removing a frame preserves its cards, connector updates preserve IDs, autoSize=true restores text sizing, and new diagrams center by default. Use as-authored placement only for an explicit positioning request. Use current supported kinds and unique IDs. Do not replace meaningful architecture with generic template examples. Preserve unrelated content and other views. Tree additions are individual Feature/User story/Risk nodes with children=[] and the ID of an existing or earlier-added parent in parentId. The Epic root already exists; never insert or remove it. Updates preserve IDs and hierarchy. No shell, browser, repository inspection or other diagrams are available unless supplied in the admitted packet.
For ordinary chat without an operator draft, return answer/clarify and edits=[]; message is the human-readable answer. text may repeat a short human-readable summary, never an encoded edit object.`;

export function nativeAdvisorScopeFromCandidate(candidate) {
  let value;
  try { value = JSON.parse(candidate?.content); } catch { return null; }
  const scope = value?.operator_draft;
  if (scope === undefined) return null;
  if (!scope || typeof scope !== "object" || Array.isArray(scope) ||
    typeof scope.role !== "string" || typeof scope.ref !== "string" || !Array.isArray(scope.fields))
    throw new HttpError(400, "advisor_draft_scope_invalid", "An operator draft must contain its bound role, reference and fields.");
  return scope;
}

export function decodeNativeAdvisorReply(reply, scope) {
  reply = legacyBoardReply(reply);
  if (!validate(reply)) invalid("The provider returned an invalid native advisor reply. No draft was changed.");
  if ((reply.intent !== "draft" && reply.edits.length) || (reply.intent === "draft" && !reply.edits.length))
    invalid("An answer cannot contain draft edits, and a draft reply requires its explicit edit batch.");
  if ((!scope || scope.readOnly) && reply.edits.length)
    invalid("No editable operator draft was admitted for these proposed edits.");
  const seen = new Set();
  const edits = reply.edits.map(edit => {
    const field = scope?.fields.find(field => field.key === edit.field);
    if (!field || seen.has(edit.field) || (field.kind ?? "text") !== edit.value_type)
      invalid("The advisor proposed an unavailable, duplicate or incorrectly typed draft field.");
    seen.add(edit.field);
    const choices = [edit.text_value, edit.board_patch, edit.tree_patch];
    const selected = { text: 0, board: 1, tree: 2 }[edit.value_type];
    if (choices[selected] === null || choices.some((value, index) => index !== selected && value !== null))
      invalid("An advisor edit must carry exactly its declared typed value.");
    const value = compact(choices[selected]);
    if (edit.value_type === "text" && (value.length > (field.maxLength ?? 24000) ||
      (field.allowedValues?.length && !field.allowedValues.includes(value))))
      invalid("The advisor proposed text outside the selected field's admitted choices or length.");
    if (edit.value_type === "board" && field.allowedValues?.length &&
      [...value.addItems, ...value.updateItems].some(item => item.kind && !field.allowedValues.includes(item.kind)))
      invalid("The advisor proposed a card kind outside the admitted diagram vocabulary.");
    return { field: edit.field, value };
  });
  return { intent: reply.intent, message: reply.message, edits };
}

/** Existing HTTP clients retain their envelope; native structure is validated first. */
export function normalizeNativeAdvisorOutput(output, { scope = null, required = false } = {}) {
  const { draft_reply, ...rest } = output;
  if (draft_reply === undefined) {
    if (required) invalid("The provider omitted its native advisor reply. No draft was changed.");
    return rest;
  }
  const reply = decodeNativeAdvisorReply(draft_reply, scope);
  return { ...rest, text: scope ? JSON.stringify(reply) : reply.message };
}
