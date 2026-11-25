import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  agentActionArtifactDigest,
  agentActionRequestRef,
} from "../src/agent-action/contracts.js";
import { createAgentConsoleService } from "../src/agent-console/service.js";
import { createAgentConsoleStore } from "../src/agent-console/store.js";

const OPENED = "2026-10-09T12:00:00.000Z";
const REQUESTED = "2026-10-09T12:00:01.000Z";
const PROJECTED = "2026-10-09T12:00:02.000Z";
const GENERATED = "2026-10-09T12:00:02.500Z";
const NOW = new Date("2026-10-09T12:00:03.000Z");
const DIGEST = `sha256:${"a".repeat(64)}`;

function ref(uri, character) {
  return { uri, digest: `sha256:${character.repeat(64)}` };
}

function seal(artifact) {
  artifact.integrity.content_digest = agentActionArtifactDigest(artifact);
  return artifact;
}

function actionRequest(sessionRef, overrides = {}) {
  return seal({
    schema_version: 1,
    artifact_type: "agent_action_request",
    request_id: "agent-action-request:console-1",
    requested_at: REQUESTED,
    expires_at: "2026-10-09T13:00:00.000Z",
    action_class: "read",
    operator: {
      principal_id: "operator-1",
      session_ref: sessionRef,
      acceptance_ref: ref("oos://agent-console/acceptance/1", "1"),
    },
    caller: {
      workload_id: "console-caller",
      credential_binding_ref: ref("oos://identities/console", "2"),
    },
    agent: { logical_agent_id: "agent-console", instance_id: "agent-instance-1" },
    model_invocation_ref: null,
    workflow: {
      workflow_id: "agent-console",
      workflow_version: "1",
      execution_id: "agent-console-execution-1",
      command: "read-current-state",
    },
    target: {
      owner_repo: "operator-orchestration-service",
      resource_type: "agent-console-session",
      resource_id: "session-1",
      source_version: "revision:1",
    },
    intent: { summary: "Read current state.", digest: DIGEST },
    context: { packet_ref: null, receipt_ref: null },
    authority: {
      delegation_ref: ref("wgcf://delegations/console", "5"),
      policy_profile_ref: ref("wgcf://policy-profiles/agent-action-v1", "3"),
      approval_ref: null,
    },
    correlation: { correlation_id: "correlation-action-1", causation_id: null },
    idempotency_key: "agent-console-action-1",
    integrity: { canonicalization: "RFC8785", algorithm: "sha256", content_digest: "" },
    ...overrides,
  });
}

function denyDecision(request) {
  return seal({
    schema_version: 1,
    artifact_type: "agent_action_policy_decision",
    decision_id: "agent-action-decision:console-deny-1",
    request_ref: agentActionRequestRef(request),
    action_class: request.action_class,
    outcome: "deny",
    reason_codes: ["owner-workflow-not-admitted"],
    obligations: [
      "record-terminal-action-receipt",
      "require-current-source-version",
      "deny-raw-context-projection",
    ],
    decided_at: "2026-10-09T12:00:02.000Z",
    expires_at: "2026-10-09T13:00:00.000Z",
    bindings: {
      operator_principal_id: request.operator.principal_id,
      operator_session_ref: request.operator.session_ref,
      caller_workload_id: request.caller.workload_id,
      agent_instance_id: request.agent.instance_id,
      workflow_execution_id: request.workflow.execution_id,
      target_owner_repo: request.target.owner_repo,
      target_resource_id: request.target.resource_id,
      source_version: request.target.source_version,
      approval_ref: null,
    },
    policy_refs: [ref("repo://workspace-governance/contracts/agent-action-authority.yaml", "4")],
    integrity: { canonicalization: "RFC8785", algorithm: "sha256", content_digest: "" },
  });
}

test("Agent Console pins the merged CGG contract and packages its runtime bundle", () => {
  const manifest = JSON.parse(readFileSync(
    new URL("../contracts/agent-console/manifest.json", import.meta.url),
    "utf8",
  ));
  assert.equal(
    manifest.cgg_source.commit,
    "7f9ca084cc1e41f360d3d27eb780ddebf11d2772",
  );
  const dockerfile = readFileSync(new URL("../Dockerfile", import.meta.url), "utf8");
  assert.match(dockerfile, /COPY --chown=node:node contracts\/agent-console/);
});

function candidate(content = "bounded context") {
  return {
    candidate_id: "candidate-1",
    scope: "page",
    source_authority: "governance-operations-console",
    source_mode: "live",
    source_ref: "console://pages/1",
    source_revision: "revision-7",
    captured_at: OPENED,
    content,
    content_digest: `sha256:${createHash("sha256").update(content, "utf8").digest("hex")}`,
  };
}

function sessionRequest(overrides = {}) {
  return {
    schema_version: 1,
    session_id: "session-1",
    operator_id: "operator-1",
    agent: {
      logical_agent_id: "agent-console",
      instance_id: "agent-instance-1",
    },
    interaction_mode: "focused",
    opened_at: OPENED,
    idempotency_key: "session-key-1",
    ...overrides,
  };
}

function invocationRequest(overrides = {}) {
  return {
    schema_version: 1,
    invocation_id: "invocation-1",
    correlation_id: "correlation-1",
    idempotency_key: "invocation-key-1",
    requested_at: REQUESTED,
    prompt: "Summarize the admitted context.",
    candidate: candidate(),
    budget_tokens: 1000,
    ...overrides,
  };
}

function projectionFor(request) {
  const safeCandidate = structuredClone(request.candidate);
  delete safeCandidate.content;
  return {
    schema_version: 1,
    status: "ready",
    replayed: false,
    request_id: request.request_id,
    correlation_id: request.correlation_id,
    idempotency_key: request.idempotency_key,
    request_digest: DIGEST,
    binding: {
      request_id: request.request_id,
      correlation_id: request.correlation_id,
      idempotency_key: request.idempotency_key,
      session_id: request.session_id,
      invocation_id: request.invocation_id,
      operator_id: request.operator_id,
      caller_id: "operator-orchestration-service",
      interaction_mode: request.interaction_mode,
      requested_at: request.requested_at,
      candidate: safeCandidate,
      budget_tokens: request.budget_tokens,
    },
    artifact_id: "agent-console-projection-1",
    artifact_digest: DIGEST,
    packet_ref: "/v1/context/packets/packet-1",
    redaction_receipt_ref: "/v1/context/receipts/receipt-1",
    projection_receipt_ref: `/v1/context/agent-console/projections/${request.idempotency_key}`,
    content: "model-safe context",
    admission_decision: {
      profile: "developer",
      raw_projection: "denied",
      redaction_safe: true,
    },
    timeline: { requested_at: request.requested_at, projected_at: PROJECTED },
    authority: {
      may_select_or_invoke_model: false,
      may_approve_suggestion: false,
      may_mutate_delivery: false,
    },
    agent_context: {
      session_id: request.session_id,
      invocation_id: request.invocation_id,
      interaction_mode: request.interaction_mode,
      candidate: safeCandidate,
    },
    classification: {
      context_type: "agent-console",
      scope: request.candidate.scope,
      source_mode: request.candidate.source_mode,
      signal_ids: [],
    },
    budget: { requested_tokens: request.budget_tokens, estimated_tokens: 4, truncated: false },
    projection_safety: { raw_context_exposed: false, redaction_applied: true, custody_bound: true },
    agent_context_authority: {
      may_select_or_invoke_model: false,
      may_authorize_action: false,
      may_mutate_owner_state: false,
      may_choose_raw_fallback: false,
    },
  };
}

function gatewayFor(request, overrides = {}) {
  return {
    profile_id: "agent-console-assistant-v1",
    policy_status: "active",
    policy_decision: "allow",
    decision_id: request.caller_identity.decision_or_correlation_id,
    generated_at: GENERATED,
    caller_id: "operator-orchestration-service/agent-console",
    invocation_path: "governed-ai-gateway",
    binding_selection_ref: "platform://profiles/agent-console-assistant-v1",
    effective_selection: { revision: 2, configuration_digest: `sha256:${"a".repeat(64)}`, task: `agent-console-assistant-v1/${request.task.kind}`,
      selection_ref: `ai-routing-selection:${"b".repeat(64)}`, attempts: [{ backend_id: "codex", model: "test-model", effort: "medium", outcome: "suggestion-produced" }] },
    task: request.task,
    output: { text: "The admitted context is healthy." },
    audit_ref: "local-ledger:agent-console-1",
    ...overrides,
  };
}

async function harness(overrides = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "oos-agent-console-"));
  const calls = [];
  const contextClient = overrides.contextClient ?? {
    async project(request) {
      calls.push(["context", structuredClone(request)]);
      return projectionFor(request);
    },
  };
  const gatewayClient = overrides.gatewayClient ?? {
    async invoke(request) {
      calls.push(["gateway", structuredClone(request)]);
      return gatewayFor(request);
    },
  };
  return {
    calls,
    service: createAgentConsoleService({
      actionAdapter: overrides.actionAdapter,
      clock: overrides.clock ?? (() => NOW),
      contextClient,
      evaluatorClient: overrides.evaluatorClient,
      gatewayClient,
      operatorBindings: { "console-caller": "operator-1" },
      store: createAgentConsoleStore({ root }),
    }),
  };
}

async function createSession(service, input = sessionRequest()) {
  return service.createSession({ callerId: "console-caller", operatorId: "operator-1", input });
}

async function invoke(service, input = invocationRequest()) {
  return service.invoke({
    callerId: "console-caller",
    operatorId: "operator-1",
    sessionId: "session-1",
    input,
  });
}

test("Agent Console orders CGG before governed AI and seals deterministic replay evidence", async () => {
  const { calls, service } = await harness();
  const created = await createSession(service);
  const replayedSession = await createSession(service);
  assert.deepEqual(replayedSession, created);

  const completed = await invoke(service);
  assert.deepEqual(calls.map(([kind]) => kind), ["context", "gateway"]);
  assert.equal(completed.latest_invocation.state, "completed");
  assert.equal(completed.latest_invocation.model.effective_selection.attempts[0].effort, "medium");
  assert.deepEqual(completed.latest_invocation.result, { text: "The admitted context is healthy." });
  assert.match(completed.latest_invocation.receipt_ref.digest, /^sha256:[0-9a-f]{64}$/);
  assert.equal(calls[0][1].caller_id, undefined);
  assert.equal(calls[1][1].input.model_safe_packet.content, "model-safe context");

  const replay = await invoke(service);
  assert.equal(replay.latest_invocation.replayed, true);
  assert.equal(calls.length, 2);
});

test("Agent Console persists the validated native draft envelope and fails closed on missing structure", async () => {
  const scope = { role: "proposal-triage", ref: "proposal:1", fields: [{ key: "summary", value: "Manual draft" }] };
  const native = { intent: "draft", message: "Requested summary", edits: [{ field: "summary", value_type: "text",
    text_value: "Suggested summary", board_patch: null, tree_patch: null }] };
  const input = invocationRequest({ prompt: "Draft a summary", candidate: candidate(JSON.stringify({ operator_draft: scope })) });
  const { service } = await harness({ gatewayClient: { async invoke(request) {
    return gatewayFor(request, { output: { text: "Outer summary", draft_reply: native } });
  } } });
  await createSession(service);
  const completed = await invoke(service, input);
  assert.equal(completed.latest_invocation.state, "completed");
  assert.deepEqual(JSON.parse(completed.latest_invocation.result.text).edits, [{ field: "summary", value: "Suggested summary" }]);
  assert.equal("draft_reply" in completed.latest_invocation.result, false);
  const replay = await invoke(service, input);
  assert.equal(replay.latest_invocation.replayed, true);
  assert.deepEqual(replay.latest_invocation.result, completed.latest_invocation.result);

  const broken = await harness();
  await createSession(broken.service);
  const failed = await invoke(broken.service, input);
  assert.equal(failed.latest_invocation.state, "failed");
  assert.equal(failed.latest_invocation.failure.code, "advisor_draft_output_invalid");
  assert.equal(failed.latest_invocation.result, null);
});

const sharedDraftAdvisors = [
  ["proposal-triage", "summary"],
  ["proposal-disposition", "notes"],
  ["prototype-candidate", "objective"],
  ["prototype-baseline", "baselineStatement"],
  ["execution-tree", "title"],
  ["execution-architecture", "sectionJson"],
  ["execution-architecture", "planSummary"],
  ["work-design-blocker", "justification"],
  ["refinement-blocker", "justification"],
  ["definition-design", "identityOwnership.purpose"],
];

for(const content of [{conversation:[{role:"operator",text:"Earlier working decision"}]},{selected_project:{selection:{kind:"proposal",id:"idea-851"},observations:{body:"Selected current facts"}}}])test("shortened conversation or selected-project facts stop before inference",async()=>{
  let modelCalls=0;
  const {service}=await harness({contextClient:{async project(request){const response=projectionFor(request);response.budget.truncated=true;return response;}},
    gatewayClient:{async invoke(request){modelCalls++;return gatewayFor(request);}}});
  await createSession(service);
  const result=await invoke(service,invocationRequest({candidate:candidate(JSON.stringify(content))}));
  assert.equal(result.latest_invocation.state,"failed");assert.equal(modelCalls,0);
});

test("budget-trimmed draft context stops before model dispatch while ordinary bounded overview remains available", async () => {
  for (const draft of [false, true]) {
    let gatewayCalls = 0;
    const { service } = await harness({
      contextClient: { async project(request) { const response = projectionFor(request); response.budget.truncated = true; return response; } },
      gatewayClient: { async invoke(request) { gatewayCalls += 1;
        assert.match(request.input.task_instruction, /Console workflow orientation:/);
        assert.match(request.input.task_instruction, /Work Design explains architecture/);
        return gatewayFor(request); } },
    });
    await createSession(service);
    const input = invocationRequest(draft ? { candidate: candidate(JSON.stringify({ operator_draft: {
      role: "proposal-triage", ref: "proposal:1", fields: [{ key: "summary", value: "Manual draft" }] } })) } : {});
    const result = await invoke(service, input);
    assert.equal(result.latest_invocation.state, draft ? "failed" : "completed");
    assert.equal(gatewayCalls, draft ? 0 : 1);
    if (draft) assert.equal(result.latest_invocation.failure.code, "agent_console_advisor_context_incomplete");
  }
});

for (const [role, field] of sharedDraftAdvisors) {
  test(`${role} (${field}): native drafting, replay and explanation retain their scope; legacy text fails without blocking the next request`, async () => {
    const scope = { role, ref: `${role}:selected-record`, sourceRef: "audit:source", sourceRevision: "version-1",
      fields: [{ key: field, label: "Selected explanatory draft", maxLength: 100, value: "Retained manual draft" }] };
    const input = invocationRequest({ prompt: "Draft the selected explanatory field", candidate: candidate(JSON.stringify({ operator_draft: scope })) });
    const suggestion = field === "planSummary" ? "Publish the verified homepage.\n\nCheck links before release." : "Suggested explanatory draft";
    const native = { intent: "draft", message: "Requested local draft", edits: [{ field, value_type: "text",
      text_value: suggestion, board_patch: null, tree_patch: null }] };
    let output = { text: "Outer summary", draft_reply: native }, gatewayCalls = 0;
    const { service } = await harness({ gatewayClient: { async invoke(request) {
      gatewayCalls += 1;
      assert.ok(request.input.task_instruction.includes(`role=${role}.`), "The real gateway request must carry the selected workflow guide.");
      assert.match(request.input.task_instruction, /separate distinct points with blank lines/);
      if (field === "planSummary") {
        assert.match(request.input.task_instruction, /planSummary is the editable local summary/);
      }
      return gatewayFor(request, { output });
    } } });
    await createSession(service);
    const completed = await invoke(service, input);
    assert.equal(completed.latest_invocation.state, "completed");
    assert.deepEqual(JSON.parse(completed.latest_invocation.result.text), { intent: "draft", message: native.message,
      edits: [{ field, value: suggestion }] });
    const replay = await invoke(service, input);
    assert.equal(replay.latest_invocation.replayed, true);
    assert.deepEqual(replay.latest_invocation.result, completed.latest_invocation.result);
    assert.equal(gatewayCalls, 1, "An identical retry must use its retained result.");

    output = { text: JSON.stringify({ intent: "draft", message: "Legacy nested edit envelope", edits: [{ field, value: "Unvalidated draft" }] }) };
    const brokenInput = { ...input, invocation_id: "invocation-broken", correlation_id: "correlation-broken", idempotency_key: "invocation-key-broken" };
    const failed = await invoke(service, brokenInput);
    assert.equal(failed.latest_invocation.state, "failed");
    assert.equal(failed.latest_invocation.failure.code, "advisor_draft_output_invalid");
    assert.equal(failed.latest_invocation.result, null);
    const failedReplay = await invoke(service, brokenInput);
    assert.equal(failedReplay.latest_invocation.replayed, true);
    assert.equal(failedReplay.latest_invocation.state, "failed");
    assert.equal(gatewayCalls, 2, "A failed request replay must not silently make a new model call.");

    output = { text: "Summary", draft_reply: { intent: "answer", message: "Explanation only; the draft stays intact.", edits: [] } };
    const answered = await invoke(service, { ...input, prompt: "Explain this field without changing it",
      invocation_id: "invocation-answer", correlation_id: "correlation-answer", idempotency_key: "invocation-key-answer" });
    assert.equal(answered.latest_invocation.state, "completed", "Malformed output must release the invocation reservation.");
    assert.deepEqual(JSON.parse(answered.latest_invocation.result.text).edits, []);
    assert.equal(scope.fields[0].value, "Retained manual draft");
    assert.equal(gatewayCalls, 3);
  });
}

test("Agent Console accepts CGG whole-second precision and rejects projections beyond its bounded tolerance", async () => {
  const accepted = await harness({
    contextClient: {
      async project(request) {
        const projection = projectionFor(request);
        projection.timeline.projected_at = "2026-10-09T12:00:00.001Z";
        return projection;
      },
    },
  });
  await createSession(accepted.service);
  const completed = await invoke(
    accepted.service,
    invocationRequest({ requested_at: "2026-10-09T12:00:01.000Z" }),
  );
  assert.equal(completed.latest_invocation.state, "completed");

  const rejected = await harness({
    contextClient: {
      async project(request) {
        const projection = projectionFor(request);
        projection.timeline.projected_at = "2026-10-09T11:59:59.999Z";
        return projection;
      },
    },
  });
  await createSession(rejected.service);
  const failed = await invoke(
    rejected.service,
    invocationRequest({ requested_at: "2026-10-09T12:00:01.000Z" }),
  );
  assert.equal(failed.latest_invocation.state, "failed");
  assert.equal(failed.latest_invocation.failure.code, "agent_console_context_projection_invalid");
});

test("Agent Console rejects conflicting identities and exact CGG binding drift", async () => {
  const { service } = await harness({
    contextClient: {
      async project(request) {
        const projection = projectionFor(request);
        projection.binding.candidate.source_ref = "console://pages/other";
        return projection;
      },
    },
  });
  await createSession(service);
  await assert.rejects(
    () => createSession(service, sessionRequest({ interaction_mode: "workspace" })),
    (error) => error.code === "agent_console_idempotency_conflict",
  );
  await assert.rejects(
    () => invoke(service, invocationRequest({
      candidate: { ...candidate(), content_digest: `sha256:${"0".repeat(64)}` },
    })),
    (error) => error.code === "agent_console_candidate_digest_mismatch",
  );
  const result = await invoke(service);
  assert.equal(result.latest_invocation.state, "failed");
  assert.equal(result.latest_invocation.failure.code, "agent_console_context_projection_invalid");
  assert.equal(result.latest_invocation.result, null);
  assert.equal(result.current_invocation_id, null);
});

test("Agent Console maps unexpected upstream failure and cancellation to bounded terminal states", async () => {
  const unavailable = await harness({
    contextClient: { async project() { throw new TypeError("network details must not escape"); } },
  });
  await createSession(unavailable.service);
  const failed = await invoke(unavailable.service);
  assert.equal(failed.latest_invocation.state, "failed");
  assert.deepEqual(failed.latest_invocation.failure, {
    code: "upstream_unavailable",
    message: "Agent Console upstream processing was unavailable.",
    retryable: true,
  });
  assert.equal(failed.current_invocation_id, null);

  const cancelled = await harness({
    contextClient: { async project() { throw new DOMException("cancelled", "AbortError"); } },
  });
  await createSession(cancelled.service);
  const result = await invoke(cancelled.service);
  assert.equal(result.latest_invocation.state, "cancelled");
  assert.equal(result.latest_invocation.failure.code, "invocation_cancelled");
  assert.equal(result.latest_invocation.result, null);
});

test("Agent Console permits one active invocation and closes with revision and timeline checks", async () => {
  let release;
  let started;
  const startedPromise = new Promise((resolve) => { started = resolve; });
  const projectionPromise = new Promise((resolve) => { release = resolve; });
  const { service } = await harness({
    contextClient: {
      async project(request) {
        started(request);
        return projectionPromise;
      },
    },
  });
  await createSession(service);
  const first = invoke(service);
  const projectedRequest = await startedPromise;
  await assert.rejects(
    () => invoke(service, invocationRequest({
      invocation_id: "invocation-2",
      correlation_id: "correlation-2",
      idempotency_key: "invocation-key-2",
    })),
    (error) => error.code === "agent_console_session_busy",
  );
  release(projectionFor(projectedRequest));
  const completed = await first;
  await assert.rejects(
    () => service.closeSession({
      callerId: "console-caller",
      operatorId: "operator-1",
      sessionId: "session-1",
      expectedRevision: completed.revision - 1,
      closedAt: NOW.toISOString(),
    }),
    (error) => error.code === "agent_console_revision_conflict",
  );
  const closed = await service.closeSession({
    callerId: "console-caller",
    operatorId: "operator-1",
    sessionId: "session-1",
    expectedRevision: completed.revision,
    closedAt: NOW.toISOString(),
  });
  assert.equal(closed.state, "closed");
  const replay = await service.closeSession({
    callerId: "console-caller",
    operatorId: "operator-1",
    sessionId: "session-1",
    expectedRevision: completed.revision,
    closedAt: NOW.toISOString(),
  });
  assert.equal(replay.revision, closed.revision);
});

test("Agent Console action enforcement records denial and replays without reevaluation", async () => {
  let evaluations = 0;
  const { service } = await harness({
    actionAdapter: {
      async execute() { throw new Error("must not execute"); },
      async resolveCurrent() { return {}; },
    },
    evaluatorClient: {
      async evaluate({ request }) {
        evaluations += 1;
        return { decision: denyDecision(request) };
      },
    },
  });
  const created = await createSession(service);
  const request = actionRequest(created.session_ref);
  const denied = await service.executeAction({
    callerId: "console-caller",
    operatorId: "operator-1",
    sessionId: "session-1",
    request,
  });
  assert.equal(denied.action_receipt.outcome, "denied");
  assert.equal(denied.owner_receipt, null);
  const replay = await service.executeAction({
    callerId: "console-caller",
    operatorId: "operator-1",
    sessionId: "session-1",
    request,
  });
  assert.deepEqual(replay, denied);
  assert.equal(evaluations, 1);
  const current = await service.readSession({
    callerId: "console-caller",
    operatorId: "operator-1",
    sessionId: "session-1",
  });
  assert.equal(current.current_action_id, null);
  assert.equal(current.latest_action_receipt_ref.digest, denied.action_receipt.integrity.content_digest);
});

test("Agent Console fails closed for operator, model, and action binding mismatches", async () => {
  const { service } = await harness({
    actionAdapter: {
      async execute() { throw new Error("must not execute"); },
      async resolveCurrent() { throw new Error("must not resolve"); },
    },
    evaluatorClient: {
      async evaluate() { throw new Error("must not evaluate"); },
    },
    gatewayClient: {
      async invoke(request) {
        return gatewayFor(request, { caller_id: "wrong" });
      },
    },
  });
  await assert.rejects(
    () => service.createSession({ callerId: "console-caller", operatorId: "operator-2", input: sessionRequest() }),
    (error) => error.code === "agent_console_operator_binding_invalid",
  );
  const created = await createSession(service);
  const invalidModel = await invoke(service);
  assert.equal(invalidModel.latest_invocation.state, "failed");
  assert.equal(invalidModel.latest_invocation.failure.code, "agent_console_model_result_invalid");
  await assert.rejects(
    () => service.executeAction({
      callerId: "console-caller",
      operatorId: "operator-1",
      sessionId: "session-1",
      request: actionRequest(
        { ...created.session_ref, uri: "oos://agent-console/sessions/other" },
      ),
    }),
    (error) => error.code === "agent_console_action_binding_invalid",
  );
});

test("AI activity task identity is bound to the durable invocation and its replay digest", async () => {
  const { service, calls } = await harness();
  await createSession(service);
  const request = invocationRequest({ activity: { kind: "proposal-triage", subject_ref: "idea-1400" } });
  await service.invoke({ callerId: "console-caller", operatorId: "operator-1", sessionId: "session-1", input: request });
  const history = await service.listActivity({ callerId: "console-caller", operatorId: "operator-1" });
  assert.equal(history.items.length, 1);
  assert.equal(history.items[0].kind, "proposal-triage");
  assert.equal(history.items[0].subject_ref, "idea-1400");
  assert.equal(history.items[0].state, "completed");
  assert.ok(history.items[0].receipt_ref.uri);
  assert.equal(calls.length, 2);
  await assert.rejects(service.invoke({ callerId: "console-caller", operatorId: "operator-1", sessionId: "session-1",
    input: { ...request, activity: { kind: "proposal-triage", subject_ref: "idea-1401" } } }), /different input/);
  assert.equal(calls.length, 2);
});
