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

test("extended native tool grammar carries groups, identity-preserving edits and explicit sizing without widening fields", () => {
  const board = { ...patch(), addTrays: [], updateTrays: [], removeTrayIds: [], updateConnections: [], arrangements: [], layers: [], placement: null };
  board.addItems.push({ id: "new-card", kind: "component", label: "Runtime", detail: "Private draft execution", x: 0, y: 0,
    width: null, height: null, tone: null, diagramType: "c4", autoSize: true });
  board.addTrays.push({ id: "private-group", label: "Private runtime", diagramType: "c4", x: 0, y: 0, width: 400, height: 260, itemIds: ["new-card"], manual: false, tone: null, autoFit: null });
  board.updateConnections.push({ id: "existing-edge", from: null, to: null, label: "Read exact source", shape: null, stroke: "dashed", tone: null, tip: null, startTip: null, relationship: "none" });
  const value = decodeNativeAdvisorReply(reply([edit("board", board)]), scope).edits[0].value;
  assert.equal(value.addItems[0].autoSize, true); assert.equal(value.addTrays[0].manual, false);
  assert.deepEqual(value.updateConnections[0], { id: "existing-edge", label: "Read exact source", stroke: "dashed", relationship: "none" });
  board.addTrays[0].manual = "yes";
  assert.throws(() => decodeNativeAdvisorReply(reply([edit("board", board)]), scope), /invalid native/);
});


test("complete structured replies retain their typed validation across both compatibility transports", async () => {
  const { assertWorkDesignAssistResult } = await import("../src/work-design/contracts.js");
  const { assertAgentConsoleContract } = await import("../src/agent-console/contracts.js");
  const tree = { addNodes: Array.from({ length: 3 }, (_, i) => ({ parentId: "epic-a", node: {
    id: `feature-${i}`, kind: "Feature", title: `Outcome ${i}`, description: "A bounded outcome",
    draftBody: "x".repeat(18000), remark: "Draft only", children: [] } })), updateNodes: [], removeNodeIds: [] };
  const native = reply([edit("tree", tree)]);
  const encoded = normalizeNativeAdvisorOutput({ text: "Short summary", draft_reply: native }, { scope, required: true });
  assert.ok(encoded.text.length > 48000);
  assertAgentConsoleContract("model-response.schema.json", encoded);
  const result = { schema_version: 1, request_id: "synthetic-large-reply", correlation_id: "synthetic-correlation",
    response_id: "synthetic-response", task_kind: "tree_advice", status: "ready", confidence: "high",
    required_operator_action: "review", ...encoded, evidence: {
      generated_at: "2026-11-18T00:00:00Z", model_profile_id: "delivery-work-design-advisor-v1",
      task_contract_ref: "oos.delivery-work-design.v1", output_schema_ref: "synthetic-output-schema",
      cgg_packet_ref: "synthetic-context", redaction_receipt_ref: "synthetic-redaction", gateway_audit_ref: "synthetic-audit" } };
  assertWorkDesignAssistResult(result);
  assert.deepEqual(JSON.parse(encoded.text).edits[0].value, tree);
  assert.throws(() => decodeNativeAdvisorReply({ ...native, message: "x".repeat(12001) }, scope), /invalid native/);
  const tooLarge = structuredClone(native);
  tooLarge.edits[0].tree_patch.addNodes = Array.from({ length: 8 }, (_, i) => ({ ...tree.addNodes[0], node: { ...tree.addNodes[0].node, id: `oversized-${i}` } }));
  assert.throws(() => normalizeNativeAdvisorOutput({ draft_reply: tooLarge }, { scope, required: true }), /bounded transport/);
  assert.throws(() => assertAgentConsoleContract("model-response.schema.json", { text: "x".repeat(128001) }));
  assert.throws(() => assertWorkDesignAssistResult({ ...result, text: "x".repeat(128001) }));
});
