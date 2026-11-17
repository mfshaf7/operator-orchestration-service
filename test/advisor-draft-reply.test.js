import test from "node:test";
import assert from "node:assert/strict";
import { decodeNativeAdvisorReply, normalizeNativeAdvisorOutput, nativeAdvisorScopeFromCandidate } from "../src/advisor-draft-reply.js";

const scope = { role: "work-design-context", ref: "project/diagram-a", fields: [
  { key: "note", label: "Note", maxLength: 20, value: "Original" },
  { key: "board", label: "Selected diagram", kind: "board", allowedValues: ["component"], value: {} },
  { key: "tree", label: "Tree", kind: "tree", value: {} }] };
const patch = () => ({ addItems: [], updateItems: [], removeItemIds: [], addConnections: [], removeConnectionIds: [] });
const edit = (kind, value, field = kind === "text" ? "note" : kind) => ({ field, value_type: kind,
  text_value: kind === "text" ? value : null, board_patch: kind === "board" ? value : null, tree_patch: kind === "tree" ? value : null });
const reply = edits => ({ intent: edits.length ? "draft" : "answer", message: "A bounded inert suggestion", edits });

test("typed text advice retains the existing client envelope without parsing model-authored JSON text", () => {
  const native = reply([edit("text", "Requested draft")]);
  const result = normalizeNativeAdvisorOutput({ text: "Untrusted alternative prose", draft_reply: native }, { scope, required: true });
  assert.deepEqual(JSON.parse(result.text), { intent: "draft", message: native.message, edits: [{ field: "note", value: "Requested draft" }] });
  assert.equal("draft_reply" in result, false);
});

test("ordinary chat stays human-readable and cannot propose edits without a draft", () => {
  assert.deepEqual(normalizeNativeAdvisorOutput({ text: "Outer summary", draft_reply: reply([]) }), { text: "A bounded inert suggestion" });
  assert.deepEqual(normalizeNativeAdvisorOutput({ text: "Legacy normal answer" }), { text: "Legacy normal answer" });
  assert.throws(() => normalizeNativeAdvisorOutput({ draft_reply: reply([edit("text", "Must not edit")]) }), /No editable/);
});

test("required draft advice rejects missing native structure, malformed intent and JSON Patch arrays", () => {
  assert.throws(() => normalizeNativeAdvisorOutput({ text: JSON.stringify({ intent: "draft", edits: [] }) }, { scope, required: true }), /omitted/);
  assert.throws(() => decodeNativeAdvisorReply({ message: "Missing intent", edits: [] }, scope), /invalid native/);
  assert.throws(() => decodeNativeAdvisorReply(reply([edit("board", [{ op: "add", path: "/customItems/-" }])]), scope), /invalid native/);
});

test("mixed payloads, unavailable targets and wrong field types fail atomically", () => {
  const mixed = edit("text", "One value"); mixed.board_patch = patch();
  for (const edits of [[mixed], [edit("text", "Unknown", "other-view-field")],
    [edit("text", "Original valid"), edit("text", "Duplicate")], [edit("text", "Wrong type", "board")]])
    assert.throws(() => decodeNativeAdvisorReply(reply(edits), scope));
  assert.equal(scope.fields[0].value, "Original");
});

test("answer/clarify, readonly and field-length guards retain their original authority boundary", () => {
  const draft = reply([edit("text", "Requested")]);
  assert.throws(() => decodeNativeAdvisorReply({ ...draft, intent: "answer" }, scope), /answer cannot/);
  assert.throws(() => decodeNativeAdvisorReply({ ...reply([]), intent: "draft" }, scope), /requires/);
  assert.throws(() => decodeNativeAdvisorReply(draft, { ...scope, readOnly: true }), /No editable/);
  assert.throws(() => decodeNativeAdvisorReply(reply([edit("text", "x".repeat(21))]), scope), /length/);
});

test("board decoding preserves fractional geometry and strips only unused nullable properties", () => {
  const board = patch(); board.addItems.push({ id: "component-a", kind: "component", label: "Runner", detail: "Exact source",
    x: 12.5, y: 33.125, width: null, height: null, tone: null, diagramType: null });
  const value = decodeNativeAdvisorReply(reply([edit("board", board)]), scope).edits[0].value;
  assert.deepEqual(value.addItems[0], { id: "component-a", kind: "component", label: "Runner", detail: "Exact source", x: 12.5, y: 33.125 });
  board.addItems[0].kind = "invented-box";
  assert.throws(() => decodeNativeAdvisorReply(reply([edit("board", board)]), scope), /vocabulary/);
});

test("tree additions require an explicit parent and cannot insert a second Epic root", () => {
  const tree = { addNodes: [{ parentId: "epic-a", node: { id: "feature-a", kind: "Feature", title: "Project capability", description: "", draftBody: "", remark: "", children: [] } }], updateNodes: [], removeNodeIds: [] };
  assert.deepEqual(decodeNativeAdvisorReply(reply([edit("tree", tree)]), scope).edits[0].value, tree);
  tree.addNodes[0].parentId = null;
  assert.throws(() => decodeNativeAdvisorReply(reply([edit("tree", tree)]), scope), /invalid native/);
  tree.addNodes[0].parentId = "epic-a";
  tree.addNodes[0].node.kind = "Epic";
  assert.throws(() => decodeNativeAdvisorReply(reply([edit("tree", tree)]), scope), /invalid native/);
});

test("scope extraction uses the existing admitted draft envelope and leaves normal candidates alone", () => {
  assert.equal(nativeAdvisorScopeFromCandidate({ content: "Ordinary context" }), null);
  assert.deepEqual(nativeAdvisorScopeFromCandidate({ content: JSON.stringify({ operator_draft: scope }) }), scope);
  assert.throws(() => nativeAdvisorScopeFromCandidate({ content: '{"operator_draft":{}}' }), /bound role/);
});
