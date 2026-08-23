import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  AGENT_ACTION_SOURCE_COMMIT,
  agentActionArtifactDigest,
  agentActionDecisionRef,
  agentActionRequestRef,
  assertAgentActionArtifact,
} from "../src/agent-action/contracts.js";
import { canonicalDigest } from "../src/delivery-art/canonical-json.js";
import {
  AgentActionEnforcementError,
  AgentActionOwnerNotInvokedError,
  createAgentActionEnforcer,
} from "../src/agent-action/enforcement.js";
import { createWgcfAgentActionClient } from "../src/agent-action/wgcf-client.js";

const NOW = "2026-08-23T12:00:02.000Z";

function ref(uri, digit) {
  return { uri, digest: `sha256:${digit.repeat(64)}` };
}

function seal(artifact) {
  artifact.integrity.content_digest = agentActionArtifactDigest(artifact);
  return artifact;
}

function sealWithWgcfProjection(artifact) {
  const projection = structuredClone(artifact);
  delete projection.integrity.content_digest;
  artifact.integrity.content_digest = canonicalDigest(projection);
  return artifact;
}

function request(actionClass = "mutate", overrides = {}) {
  const mutation = actionClass === "mutate";
  return seal({
    schema_version: 1,
    artifact_type: "agent_action_request",
    request_id: `agent-action-request:test-${actionClass}`,
    requested_at: "2026-08-23T12:00:00.000Z",
    expires_at: "2026-08-23T13:00:00.000Z",
    action_class: actionClass,
    operator: {
      principal_id: "operator:workspace-owner",
      session_ref: ref("wgcf://sessions/test", "1"),
      acceptance_ref: ref("wgcf://acceptance/test", "2"),
    },
    caller: {
      workload_id: "operator-orchestration-service",
      credential_binding_ref: ref("wgcf://identities/oos", "3"),
    },
    agent: {
      logical_agent_id: "agent:planning-assistant",
      instance_id: "agent-instance:test",
    },
    model_invocation_ref: actionClass === "read"
      ? null
      : ref("platform://model-invocations/test", "4"),
    workflow: {
      workflow_id: "delivery-art-work-item-update",
      workflow_version: "1",
      execution_id: "workflow-execution:test",
      command: "update-work-item",
    },
    target: {
      owner_repo: "operator-orchestration-service",
      resource_type: "delivery-work-item",
      resource_id: "work-item-953",
      source_version: "lock-version:7",
    },
    intent: {
      summary: "Apply the bounded test action.",
      digest: `sha256:${"5".repeat(64)}`,
    },
    context: {
      packet_ref: mutation || actionClass !== "read"
        ? ref("cgg://packets/test", "6")
        : null,
      receipt_ref: mutation || actionClass !== "read"
        ? ref("cgg://receipts/test", "7")
        : null,
    },
    authority: {
      delegation_ref: ref("wgcf://delegations/test", "8"),
      policy_profile_ref: ref("wgcf://policy-profiles/agent-action-v1", "9"),
      approval_ref: mutation ? ref("wgcf://approvals/test", "a") : null,
    },
    correlation: {
      correlation_id: "correlation:test",
      causation_id: "causation:test",
    },
    idempotency_key: `agent-action:test-${actionClass}`,
    integrity: {
      canonicalization: "RFC8785",
      algorithm: "sha256",
      content_digest: "",
    },
    ...overrides,
  });
}

function currentFor(candidate, overrides = {}) {
  return {
    operator_principal_id: candidate.operator.principal_id,
    operator_session_ref: candidate.operator.session_ref,
    operator_acceptance_ref: candidate.operator.acceptance_ref,
    caller_workload_id: candidate.caller.workload_id,
    caller_credential_binding_ref: candidate.caller.credential_binding_ref,
    agent_instance_id: candidate.agent.instance_id,
    model_invocation_ref: candidate.model_invocation_ref,
    workflow_id: candidate.workflow.workflow_id,
    workflow_version: candidate.workflow.workflow_version,
    admitted_commands: [candidate.workflow.command],
    target_owner_repo: candidate.target.owner_repo,
    target_resource_id: candidate.target.resource_id,
    source_version: candidate.target.source_version,
    context_packet_ref: candidate.context.packet_ref,
    context_receipt_ref: candidate.context.receipt_ref,
    delegation_ref: candidate.authority.delegation_ref,
    policy_profile_ref: candidate.authority.policy_profile_ref,
    approval_ref: candidate.authority.approval_ref,
    approval_expires_at: "2026-08-23T13:00:00.000Z",
    consumed_idempotency: [],
    ...overrides,
  };
}

function decisionFor(candidate, outcome = "allow", overrides = {}) {
  const obligations = [
    "record-terminal-action-receipt",
    "require-current-source-version",
    "deny-raw-context-projection",
    ...(candidate.action_class === "mutate"
      ? [
          "require-exact-operator-approval",
          "require-owner-receipt-after-invocation",
        ]
      : []),
  ];
  return seal({
    schema_version: 1,
    artifact_type: "agent_action_policy_decision",
    decision_id: `agent-action-decision:test-${candidate.action_class}-${outcome}`,
    request_ref: agentActionRequestRef(candidate),
    action_class: candidate.action_class,
    outcome,
    reason_codes: outcome === "allow"
      ? ["authority-bindings-current", "owner-workflow-admitted"]
      : [outcome === "deny" ? "source-version-mismatch" : "source-version-unverified"],
    obligations,
    decided_at: "2026-08-23T12:00:01.000Z",
    expires_at: "2026-08-23T13:00:00.000Z",
    bindings: {
      operator_principal_id: candidate.operator.principal_id,
      operator_session_ref: candidate.operator.session_ref,
      caller_workload_id: candidate.caller.workload_id,
      agent_instance_id: candidate.agent.instance_id,
      workflow_execution_id: candidate.workflow.execution_id,
      target_owner_repo: candidate.target.owner_repo,
      target_resource_id: candidate.target.resource_id,
      source_version: candidate.target.source_version,
      approval_ref: candidate.authority.approval_ref,
    },
    policy_refs: [ref("repo://workspace-governance/contracts/agent-action-authority.yaml", "b")],
    integrity: {
      canonicalization: "RFC8785",
      algorithm: "sha256",
      content_digest: "",
    },
    ...overrides,
  });
}

function ownerReceiptFor(candidate, decision, overrides = {}) {
  return seal({
    schema_version: 1,
    artifact_type: "agent_action_owner_receipt",
    receipt_id: "agent-action-owner-receipt:test",
    request_ref: agentActionRequestRef(candidate),
    decision_ref: agentActionDecisionRef(decision),
    action_class: "mutate",
    owner: {
      repo: candidate.target.owner_repo,
      adapter: "openproject-delivery-adapter-v1",
      authority_ref: ref("openproject://authorities/delivery-work-item-update", "c"),
    },
    target: {
      resource_id: candidate.target.resource_id,
      before_version: candidate.target.source_version,
      after_version: "lock-version:8",
    },
    mutation_outcome: "applied",
    result_ref: ref("openproject://work_packages/953?lockVersion=8", "d"),
    audit_ref: ref("openproject://activities/953-8", "e"),
    executed_at: "2026-08-23T12:00:02.000Z",
    idempotency_key: candidate.idempotency_key,
    failure: null,
    integrity: {
      canonicalization: "RFC8785",
      algorithm: "sha256",
      content_digest: "",
    },
    ...overrides,
  });
}

function harness({
  candidate = request(),
  clock = () => NOW,
  decision = null,
  currents = null,
} = {}) {
  const resolvedDecision = decision ?? decisionFor(candidate);
  const receipts = [];
  let currentIndex = 0;
  return {
    decision: resolvedDecision,
    enforcer: createAgentActionEnforcer({
      clock,
      evaluatorClient: {
        async evaluate(input) {
          assert.deepEqual(input.request, candidate);
          return { decision: structuredClone(resolvedDecision), ledger_event: {} };
        },
      },
      recordReceipt(receipt) {
        receipts.push(receipt);
      },
    }),
    receipts,
    resolveCurrent() {
      const values = currents ?? [currentFor(candidate), currentFor(candidate)];
      const value = values[Math.min(currentIndex, values.length - 1)];
      currentIndex += 1;
      return structuredClone(value);
    },
  };
}

test("runtime image carries the exact pinned agent-action schema bundle", () => {
  assert.equal(
    AGENT_ACTION_SOURCE_COMMIT,
    "d6e5a5bf0cac6ddfbf127f5826159556971c3718",
  );
  const dockerfile = readFileSync(new URL("../Dockerfile", import.meta.url), "utf8");
  assert.match(dockerfile, /COPY --chown=node:node contracts\/agent-action/);
  assert.doesNotThrow(() => assertAgentActionArtifact("agent_action_request", request()));
});

test("OOS accepts request and decision digests sealed with the WGCF projection", () => {
  const candidate = request();
  sealWithWgcfProjection(candidate);
  const decision = decisionFor(candidate);
  sealWithWgcfProjection(decision);

  assert.doesNotThrow(() =>
    assertAgentActionArtifact("agent_action_request", candidate)
  );
  assert.doesNotThrow(() =>
    assertAgentActionArtifact("agent_action_policy_decision", decision)
  );
});

test("WGCF client uses authenticated bounded canonical evaluation", async () => {
  const candidate = request();
  const decision = decisionFor(candidate);
  const calls = [];
  const client = createWgcfAgentActionClient({
    baseUrl: "http://wgcf.local/",
    callerId: "operator-orchestration-service",
    callerSecret: "s".repeat(32),
    async fetchImpl(url, options) {
      calls.push({ url, options });
      return {
        ok: true,
        status: 200,
        headers: new Map(),
        async text() {
          return JSON.stringify({ evaluation: { decision, ledger_event: {} } });
        },
      };
    },
  });

  const evaluation = await client.evaluate({
    request: candidate,
    current: currentFor(candidate),
  });

  assert.deepEqual(evaluation.decision, decision);
  assert.equal(calls[0].url, "http://wgcf.local/v1/agent-actions/evaluate");
  assert.equal(
    calls[0].options.headers["x-wgcf-caller-id"],
    "operator-orchestration-service",
  );
  assert.equal(calls[0].options.headers["x-wgcf-caller-secret"], "s".repeat(32));
});

for (const outcome of ["deny", "review-required"]) {
  test(`${outcome} policy decision records denial without owner dispatch`, async () => {
    const candidate = request();
    const state = harness({
      candidate,
      decision: decisionFor(candidate, outcome),
    });
    let executed = false;

    const result = await state.enforcer.execute({
      request: candidate,
      resolveCurrent: state.resolveCurrent,
      async execute() {
        executed = true;
      },
    });

    assert.equal(executed, false);
    assert.equal(result.action_receipt.outcome, "denied");
    assert.equal(result.action_receipt.mutation_state, "not-attempted");
    assert.equal(result.action_receipt.execution.started_at, null);
    assert.equal(state.receipts.length, 1);
  });
}

test("allow mutation invokes the admitted owner once and binds both receipts", async () => {
  const candidate = request();
  const state = harness({ candidate });
  const ownerReceipt = ownerReceiptFor(candidate, state.decision);
  const ownerReceiptRef = {
    uri: "openproject://agent-actions/owner-receipts/test",
    digest: ownerReceipt.integrity.content_digest,
  };
  let executions = 0;

  const result = await state.enforcer.execute({
    request: candidate,
    resolveCurrent: state.resolveCurrent,
    async execute() {
      executions += 1;
      return {
        backend_executor_id: "owner-executor:openproject-delivery-adapter-v1",
        owner_receipt: ownerReceipt,
        owner_receipt_ref: ownerReceiptRef,
      };
    },
  });

  assert.equal(executions, 1);
  assert.equal(result.action_receipt.outcome, "succeeded");
  assert.equal(result.action_receipt.mutation_state, "applied");
  assert.deepEqual(result.action_receipt.owner_receipt_ref, ownerReceiptRef);
  assert.equal(result.action_receipt.target.after_version, "lock-version:8");
  assert.equal(state.receipts.length, 1);
});

for (const actionClass of ["read", "advise", "draft"]) {
  test(`allow ${actionClass} returns a terminal result without an owner receipt`, async () => {
    const candidate = request(actionClass);
    const state = harness({ candidate });
    const resultRef = ref(`oos://agent-actions/results/${actionClass}-test`, "f");

    const result = await state.enforcer.execute({
      request: candidate,
      resolveCurrent: state.resolveCurrent,
      async execute() {
        return {
          backend_executor_id: `oos-${actionClass}-adapter-v1`,
          outcome: "succeeded",
          result_ref: resultRef,
        };
      },
    });

    assert.equal(result.action_receipt.action_class, actionClass);
    assert.equal(result.action_receipt.outcome, "succeeded");
    assert.equal(result.action_receipt.mutation_state, "not-applicable");
    assert.equal(result.action_receipt.owner_receipt_ref, null);
    assert.deepEqual(result.action_receipt.result_ref, resultRef);
  });
}

test("source drift after evaluation blocks dispatch and records the reason", async () => {
  const candidate = request();
  const state = harness({
    candidate,
    currents: [
      currentFor(candidate),
      currentFor(candidate, { source_version: "lock-version:8" }),
    ],
  });
  let executed = false;

  const result = await state.enforcer.execute({
    request: candidate,
    resolveCurrent: state.resolveCurrent,
    async execute() {
      executed = true;
    },
  });

  assert.equal(executed, false);
  assert.equal(result.action_receipt.failure.code, "agent-action-current-binding-changed");
});

test("consumed idempotency blocks replay before owner dispatch", async () => {
  const candidate = request();
  const state = harness({
    candidate,
    currents: [
      currentFor(candidate),
      currentFor(candidate, {
        consumed_idempotency: [{
          idempotency_key: candidate.idempotency_key,
          intent_digest: candidate.intent.digest,
        }],
      }),
    ],
  });

  const result = await state.enforcer.execute({
    request: candidate,
    resolveCurrent: state.resolveCurrent,
    async execute() {
      assert.fail("owner dispatch must not run");
    },
  });

  assert.equal(
    result.action_receipt.failure.code,
    "agent-action-idempotency-unverified-or-consumed",
  );
});

test("invalid refreshed approval expiry blocks owner dispatch", async () => {
  const candidate = request();
  const state = harness({
    candidate,
    currents: [
      currentFor(candidate),
      currentFor(candidate, { approval_expires_at: "not-a-timestamp" }),
    ],
  });

  const result = await state.enforcer.execute({
    request: candidate,
    resolveCurrent: state.resolveCurrent,
    async execute() {
      assert.fail("owner dispatch must not run");
    },
  });

  assert.equal(
    result.action_receipt.failure.code,
    "agent-action-approval-expiry-invalid",
  );
});

test("expired allow decision becomes a terminal denial", async () => {
  const candidate = request();
  const decision = decisionFor(candidate, "allow", {
    expires_at: "2026-08-23T12:00:02.000Z",
  });
  const state = harness({ candidate, decision });

  const result = await state.enforcer.execute({
    request: candidate,
    resolveCurrent: state.resolveCurrent,
    async execute() {
      assert.fail("owner dispatch must not run");
    },
  });

  assert.equal(result.action_receipt.failure.code, "agent-action-decision-expired");
});

test("decision expiry crossed during current-state refresh blocks dispatch", async () => {
  const candidate = request("mutate", {
    expires_at: "2026-08-23T12:00:03.000Z",
  });
  const decision = decisionFor(candidate, "allow", {
    expires_at: "2026-08-23T12:00:03.000Z",
  });
  const timestamps = [
    "2026-08-23T12:00:00.500Z",
    "2026-08-23T12:00:01.000Z",
    "2026-08-23T12:00:03.000Z",
    "2026-08-23T12:00:03.001Z",
  ];
  const state = harness({
    candidate,
    clock: () => timestamps.shift() ?? "2026-08-23T12:00:03.001Z",
    decision,
  });

  const result = await state.enforcer.execute({
    request: candidate,
    resolveCurrent: state.resolveCurrent,
    async execute() {
      assert.fail("owner dispatch must not run");
    },
  });

  assert.equal(result.action_receipt.failure.code, "agent-action-decision-expired");
});

for (const field of ["source_version", "approval_ref"]) {
  test(`decision ${field} mismatch is rejected before dispatch`, async () => {
    const candidate = request();
    const decision = decisionFor(candidate);
    decision.bindings[field] = field === "source_version"
      ? "lock-version:99"
      : ref("wgcf://approvals/other", "0");
    seal(decision);
    const state = harness({ candidate, decision });

    await assert.rejects(
      () => state.enforcer.execute({
        request: candidate,
        resolveCurrent: state.resolveCurrent,
        async execute() {
          assert.fail("owner dispatch must not run");
        },
      }),
      (error) =>
        error instanceof AgentActionEnforcementError &&
        error.code === "agent_action_decision_binding_mismatch",
    );
  });
}

test("missing mutate obligation is rejected before dispatch", async () => {
  const candidate = request();
  const decision = decisionFor(candidate);
  decision.obligations = decision.obligations.filter(
    (entry) => entry !== "require-owner-receipt-after-invocation",
  );
  seal(decision);
  const state = harness({ candidate, decision });

  await assert.rejects(
    () => state.enforcer.execute({
      request: candidate,
      resolveCurrent: state.resolveCurrent,
      async execute() {},
    }),
    (error) => error?.code === "agent_action_artifact_invalid",
  );
});

test("known pre-invocation rejection still records a terminal failure", async () => {
  const candidate = request();
  const state = harness({ candidate });

  const result = await state.enforcer.execute({
    request: candidate,
    resolveCurrent: state.resolveCurrent,
    async execute() {
      throw new AgentActionOwnerNotInvokedError(
        "owner-workflow-not-admitted",
        "Owner workflow is not admitted.",
      );
    },
  });

  assert.equal(result.action_receipt.outcome, "failed");
  assert.equal(result.action_receipt.mutation_state, "not-attempted");
  assert.equal(result.action_receipt.failure.code, "owner-workflow-not-admitted");
});

test("mutate execution cannot complete without the exact owner receipt", async () => {
  const candidate = request();
  const state = harness({ candidate });

  await assert.rejects(
    () => state.enforcer.execute({
      request: candidate,
      resolveCurrent: state.resolveCurrent,
      async execute() {
        return { backend_executor_id: "owner-executor:test" };
      },
    }),
    (error) => error?.code === "agent_action_artifact_invalid",
  );
  assert.equal(state.receipts.length, 0);
});
