import assert from "node:assert/strict";
import test from "node:test";

import { canonicalDigest } from "../src/delivery-art/canonical-json.js";
import {
  createDeliveryArtSourceRealizationService,
} from "../src/delivery-art/source-realization.js";

function fixture({ applyFailures = 0, gatewayResult = null, modelAvailable = true } = {}) {
  const session = {
    created_at: "2026-10-14T00:00:00.000Z",
    session_id: "work-session:delivery-1275:delivery-1275-source-realization",
    covered_work_item_ids: ["work-item-1285"],
    caller_id: "governance-operations-console",
    operator: { id: "operator:workspace-owner" },
    landing_unit_id: "delivery-1275-source-realization",
    landing_unit: { base_commit: "a".repeat(40) },
  };
  let artifact = null;
  const privateArtifacts = new Map();
  let applyCount = 0;
  let remainingApplyFailures = applyFailures;
  let projectionInput = null;
  const timestamps = [
    "2026-10-14T01:00:00.000Z",
    "2026-10-14T01:00:01.000Z",
    "2026-10-14T01:00:02.000Z",
    "2026-10-14T01:00:03.000Z",
    "2026-10-14T01:00:04.000Z",
  ];
  const objective = "Implement the smallest bounded source change with real tests.";
  const changeSet = {
    schema_version: 1,
    change_set_id: "change-set:1285:1",
    session_id: session.session_id,
    base_commit: session.landing_unit.base_commit,
    objective_digest: canonicalDigest(objective),
    commit_message: "feat: add bounded realization",
    operations: [{
      action: "create",
      path: "src/realized.js",
      content: "export const realized = true;\n",
      expected_digest: null,
    }],
  };
  const service = createDeliveryArtSourceRealizationService({
    clock: () => new Date(timestamps.shift() ?? "2026-10-14T01:00:05.000Z"),
    enabled: true,
    gatewayClient: {
      configured: modelAvailable,
      async invoke(request) {
        assert.equal(request.caller_identity.caller_workflow,
          request.caller_identity.caller_id.split("/")[1]);
        assert.equal(request.provider_output_schema_ref,
          "platform-engineering/security/schemas/source-realization-change-set.schema.json");
        assert.equal(request.task.kind, "source_realization");
        assert.equal(request.task.contract_ref, "oos.delivery-art.source-realization.v1");
        return gatewayResult ?? {
          policy_decision: "allow",
          policy_status: "active",
          profile_id: "source-realization-v1",
          decision_id: request.caller_identity.decision_or_correlation_id,
          caller_id: "operator-orchestration-service/source-realization",
          invocation_path: "governed-ai-gateway",
          generated_at: "2026-10-14T01:00:00.000Z",
          binding_selection_ref: "profile-binding://source-realization-v1",
          effective_selection: { revision: 2, configuration_digest: `sha256:${"a".repeat(64)}`, task: "source-realization-v1/source_realization",
            selection_ref: `ai-routing-selection:${"b".repeat(64)}`, attempts: [{ backend_id: "codex", model: "test-model", effort: "high", outcome: "suggestion-produced" }] },
          audit_ref: "audit://source-realization/1285-1",
          output: changeSet,
        };
      },
    },
    lifecycleContext: {
      async project(input) {
        projectionInput = input;
        return {
          content: "model-safe work-session and repository context",
          binding: {
            captured_at: "2026-10-14T01:00:00.000Z",
            packet_ref: "/v1/context/packets/source-realization-1285-1",
            redaction_receipt_ref: "/v1/context/receipts/source-realization-1285-1",
            projection_receipt_ref: "/v1/context/lifecycle/projections/source-realization-1285-1",
            artifact_digest: `sha256:${"b".repeat(64)}`,
          },
        };
      },
    },
    sourceAdapter: {
      async validateSourceRealization(selected, change) {
        return { valid: true, session_id: selected.session_id, base_commit: selected.landing_unit.base_commit, change_set_digest: canonicalDigest(change) };
      },
      async captureRealizationContext() {
        return {
          schema_version: 1,
          session_id: session.session_id,
          head_commit: session.landing_unit.base_commit,
          clean: true,
          tree: { paths: ["README.md"], total_path_count: 1, truncated: false },
          files: [],
          admitted_bytes: 0,
          context_digest: `sha256:${"c".repeat(64)}`,
        };
      },
      async applySourceRealization(_session, observed) {
        applyCount += 1;
        assert.deepEqual(observed, changeSet);
        if (remainingApplyFailures > 0) {
          remainingApplyFailures -= 1;
          throw Object.assign(new Error("Source executor response was interrupted."), {
            code: "delivery_art_work_session_executor_unavailable",
          });
        }
        return {
          schema_version: 1,
          receipt_id: "source-realization-receipt:1285",
          base_commit: session.landing_unit.base_commit,
          head_commit: "d".repeat(40),
          changed_files: ["src/realized.js"],
          author: "Agent Gary <agent-gary@example.test>",
          outcome: "committed",
          receipt_digest: `sha256:${"e".repeat(64)}`,
        };
      },
    },
    store: {
      readArtifact(_session, file) { return file === "source-realization.json" ? artifact ? structuredClone(artifact) : null : structuredClone(privateArtifacts.get(file)); },
      readByAlias() { return session; },
      async withLock(_key, operation) { return operation(); },
      writeArtifact(_session, file, value) { if (file === "source-realization.json") artifact = structuredClone(value); else privateArtifacts.set(file, structuredClone(value)); },
    },
    workSessionController: {
      async status() {
        return {
          session_revision: "2026-10-14T00:59:00.000Z",
          next_action: { code: "source-work-required" },
          source: { head_commit: session.landing_unit.base_commit },
          agent_source: { state: "ready" },
        };
      },
    },
  });
  return {
    changeSet, session, privateArtifacts,
    getApplyCount: () => applyCount,
    getProjectionInput: () => projectionInput,
    objective,
    service,
    updateArtifact(update) {
      const next = structuredClone(artifact);
      update(next);
      artifact = next;
    },
  };
}

test("source realization stages CGG-bound output before exact acceptance and creates Agent Gary source once", async () => {
  const { changeSet, getApplyCount, getProjectionInput, objective, service } = fixture();
  const initial = await service.read({
    callerId: "governance-operations-console",
    operatorId: "operator:workspace-owner",
    workItemId: "work-item-1285",
  });
  assert.equal(initial.state, "not-started");
  assert.equal(initial.session_id, "work-session:delivery-1275:delivery-1275-source-realization");
  assert.equal(initial.work_item_id, "work-item-1285");
  const startRequest = {
    schema_version: 1,
    request_id: "realization-1285-1",
    execution_id: "console-execution-1285-1",
    expected_session_revision: "2026-10-14T00:59:00.000Z",
    objective,
    requested_at: "2026-10-14T00:59:30.000Z",
    budget_tokens: 3000,
    retry_of: null,
  };
  const started = await service.start({
    callerId: "governance-operations-console",
    operatorId: "operator:workspace-owner",
    request: startRequest,
    workItemId: "work-item-1285",
  });
  assert.equal(started.state, "draft-ready");
  assert.equal(started.next_action.code, "source-realization-acceptance-required");
  assert.equal(getApplyCount(), 0);
  assert.equal(started.attempt.change_set.operations[0].content, undefined);
  assert.equal(getProjectionInput().sourceRealization.objective, objective);
  assert.equal((await service.draft({ callerId: "governance-operations-console", operatorId: "operator:workspace-owner", workItemId: "work-item-1285" })).objective, objective);
  assert.equal(getProjectionInput().sourceRealization.repository_context.clean, true);

  const replayed = await service.start({
    callerId: "governance-operations-console",
    operatorId: "operator:workspace-owner",
    request: startRequest,
    workItemId: "work-item-1285",
  });
  assert.equal(replayed.replayed, true);

  await assert.rejects(
    service.continue({
      callerId: "governance-operations-console",
      operatorId: "operator:workspace-owner",
      request: {
        schema_version: 1,
        command_id: "accept-1285-wrong",
        expected_revision: started.revision,
        accepted_change_set_digest: `sha256:${"0".repeat(64)}`,
        requested_at: "2026-10-14T01:00:02.000Z",
      },
      workItemId: "work-item-1285",
    }),
    { code: "delivery_art_source_realization_acceptance_mismatch" },
  );

  const acceptRequest = {
    schema_version: 1,
    command_id: "accept-1285-1",
    expected_revision: started.revision,
    accepted_change_set_digest: canonicalDigest(changeSet),
    requested_at: "2026-10-14T01:00:02.000Z",
  };
  const completed = await service.continue({
    callerId: "governance-operations-console",
    operatorId: "operator:workspace-owner",
    request: acceptRequest,
    workItemId: "work-item-1285",
  });
  assert.equal(completed.state, "source-created");
  assert.equal(completed.next_action.code, "work-session-continue-required");
  assert.equal(getApplyCount(), 1);
  const historical = await service.readCompletedCommand({ action: "continue", callerId: "governance-operations-console", operatorId: "operator:workspace-owner", request: acceptRequest, workItemId: "work-item-1285" });
  assert.equal(historical.replayed, true);
  assert.equal(historical.source_receipt, undefined);
  assert.equal(historical.attempt.source_receipt.outcome, "committed");
  await assert.rejects(service.readCompletedCommand({ action: "continue", callerId: "another-caller", operatorId: "operator:workspace-owner", request: acceptRequest, workItemId: "work-item-1285" }), { code: "delivery_art_source_realization_identity_mismatch" });
  await assert.rejects(service.readCompletedCommand({ action: "continue", callerId: "governance-operations-console", operatorId: "operator:workspace-owner", request: { ...acceptRequest, accepted_change_set_digest: `sha256:${"f".repeat(64)}` }, workItemId: "work-item-1285" }), { code: "delivery_art_source_realization_replay_conflict" });
  const replayedAcceptance = await service.continue({
    callerId: "governance-operations-console",
    operatorId: "operator:workspace-owner",
    request: acceptRequest,
    workItemId: "work-item-1285",
  });
  assert.equal(replayedAcceptance.replayed, true);
  assert.equal(getApplyCount(), 1);
});

test("source realization cancellation is replay-safe and a retry binds the terminal attempt", async () => {
  const { objective, service } = fixture();
  const start = await service.start({
    callerId: "governance-operations-console",
    operatorId: "operator:workspace-owner",
    request: {
      schema_version: 1,
      request_id: "realization-1285-cancelled",
      execution_id: "console-execution-1285-cancelled",
      expected_session_revision: "2026-10-14T00:59:00.000Z",
      objective,
      requested_at: "2026-10-14T00:59:30.000Z",
      budget_tokens: 3000,
      retry_of: null,
    },
    workItemId: "work-item-1285",
  });
  const cancelRequest = {
    schema_version: 1,
    command_id: "cancel-1285-1",
    expected_revision: start.revision,
    reason: "The operator rejected this exact draft after review.",
    requested_at: "2026-10-14T01:00:02.000Z",
  };
  const cancelled = await service.cancel({
    callerId: "governance-operations-console",
    operatorId: "operator:workspace-owner",
    request: cancelRequest,
    workItemId: "work-item-1285",
  });
  assert.equal(cancelled.state, "cancelled");
  assert.equal(cancelled.next_action.code, "source-realization-retry-available");

  const replay = await service.cancel({
    callerId: "governance-operations-console",
    operatorId: "operator:workspace-owner",
    request: cancelRequest,
    workItemId: "work-item-1285",
  });
  assert.equal(replay.replayed, true);

  const retry = await service.start({
    callerId: "governance-operations-console",
    operatorId: "operator:workspace-owner",
    request: {
      schema_version: 1,
      request_id: "realization-1285-retry",
      execution_id: "console-execution-1285-retry",
      expected_session_revision: "2026-10-14T00:59:00.000Z",
      objective,
      requested_at: "2026-10-14T01:00:04.000Z",
      budget_tokens: 3000,
      retry_of: "realization-1285-cancelled",
    },
    workItemId: "work-item-1285",
  });
  assert.equal(retry.state, "draft-ready");
  assert.equal(retry.attempt.retry_of, "realization-1285-cancelled");
});

test("source realization fails closed on an incorrectly bound governed-model result", async () => {
  const { objective, service } = fixture({
    gatewayResult: {
      policy_decision: "allow",
      policy_status: "active",
      profile_id: "wrong-profile",
      decision_id: "realization-1285-invalid",
      caller_id: "operator-orchestration-service/source-realization",
      invocation_path: "governed-ai-gateway",
      generated_at: "2026-10-14T01:00:00.000Z",
      binding_selection_ref: "profile-binding://wrong-profile",
      audit_ref: "audit://source-realization/invalid",
      output: {},
    },
  });
  await assert.rejects(
    service.start({
      callerId: "governance-operations-console",
      operatorId: "operator:workspace-owner",
      request: {
        schema_version: 1,
        request_id: "realization-1285-invalid",
        execution_id: "console-execution-1285-invalid",
        expected_session_revision: "2026-10-14T00:59:00.000Z",
        objective,
        requested_at: "2026-10-14T00:59:30.000Z",
        budget_tokens: 3000,
        retry_of: null,
      },
      workItemId: "work-item-1285",
    }),
    { code: "delivery_art_source_realization_model_result_invalid" },
  );
  const status = await service.read({
    callerId: "governance-operations-console",
    operatorId: "operator:workspace-owner",
    workItemId: "work-item-1285",
  });
  assert.equal(status.state, "failed");
  assert.equal(status.next_action.code, "source-realization-retry-available");
});

test("source realization reconciles one unknown apply through the same accepted action", async () => {
  const { changeSet, getApplyCount, objective, service } = fixture({ applyFailures: 1 });
  const started = await service.start({
    callerId: "governance-operations-console",
    operatorId: "operator:workspace-owner",
    request: {
      schema_version: 1,
      request_id: "realization-1285-recover",
      execution_id: "console-execution-1285-recover",
      expected_session_revision: "2026-10-14T00:59:00.000Z",
      objective,
      requested_at: "2026-10-14T00:59:30.000Z",
      budget_tokens: 3000,
      retry_of: null,
    },
    workItemId: "work-item-1285",
  });
  await assert.rejects(
    service.continue({
      callerId: "governance-operations-console",
      operatorId: "operator:workspace-owner",
      request: {
        schema_version: 1,
        command_id: "accept-1285-recover",
        expected_revision: started.revision,
        accepted_change_set_digest: canonicalDigest(changeSet),
        requested_at: "2026-10-14T01:00:02.000Z",
      },
      workItemId: "work-item-1285",
    }),
    { code: "delivery_art_work_session_executor_unavailable" },
  );
  const unknown = await service.read({
    callerId: "governance-operations-console",
    operatorId: "operator:workspace-owner",
    workItemId: "work-item-1285",
  });
  assert.equal(unknown.state, "apply-unknown");
  assert.equal(unknown.next_action.code, "source-realization-recovery-required");
  const recoveryRequest = {
    schema_version: 1,
    command_id: "recover-1285-1",
    expected_revision: unknown.revision,
    requested_at: "2026-10-14T01:00:05.000Z",
  };
  const recovered = await service.recover({
    callerId: "governance-operations-console",
    operatorId: "operator:workspace-owner",
    request: recoveryRequest,
    workItemId: "work-item-1285",
  });
  assert.equal(recovered.state, "source-created");
  assert.equal(getApplyCount(), 2);
  const replayedRecovery = await service.recover({
    callerId: "governance-operations-console",
    operatorId: "operator:workspace-owner",
    request: recoveryRequest,
    workItemId: "work-item-1285",
  });
  assert.equal(replayedRecovery.replayed, true);
  assert.equal(getApplyCount(), 2);
});

test("interrupted accepted-only generation can be explicitly cancelled under the owner lock, without source mutation, then retried with lineage", async () => {
  const { getApplyCount, objective, service, updateArtifact } = fixture();
  const identity = { callerId: "governance-operations-console", operatorId: "operator:workspace-owner", workItemId: "work-item-1285" };
  await service.start({ ...identity, request: {
    schema_version: 1, request_id: "interrupted-generation", execution_id: "interrupted-generation-execution",
    expected_session_revision: "2026-10-14T00:59:00.000Z", objective,
    requested_at: "2026-10-14T00:59:30.000Z", budget_tokens: 3000, retry_of: null,
  } });
  updateArtifact((record) => {
    const attempt = record.attempts.at(-1);
    attempt.state = "accepted"; attempt.change_set = null; attempt.change_set_digest = null;
    attempt.context = null; attempt.model = null; attempt.completed_at = null;
  });
  const retained = await service.read(identity);
  assert.equal(retained.state, "accepted");
  const cancelled = await service.cancel({ ...identity, request: {
    schema_version: 1, command_id: "cancel-interrupted-generation", expected_revision: retained.revision,
    requested_at: "2026-10-14T01:00:02.000Z", reason: "Cancel interrupted generation before any source acceptance.",
  } });
  assert.equal(cancelled.state, "cancelled");
  assert.equal(getApplyCount(), 0);
  const retry = await service.start({ ...identity, request: {
    schema_version: 1, request_id: "generation-linked-retry", execution_id: "generation-linked-retry-execution",
    expected_session_revision: "2026-10-14T00:59:00.000Z", objective,
    requested_at: "2026-10-14T01:00:04.000Z", budget_tokens: 3000, retry_of: "interrupted-generation",
  } });
  assert.equal(retry.state, "draft-ready");
  assert.equal(retry.attempt.retry_of, "interrupted-generation");
  assert.equal(getApplyCount(), 0);
});

test("source realization recovers a process crash retained in applying state", async () => {
  const { getApplyCount, objective, service, updateArtifact } = fixture();
  await service.start({
    callerId: "governance-operations-console",
    operatorId: "operator:workspace-owner",
    request: {
      schema_version: 1,
      request_id: "realization-1285-process-crash",
      execution_id: "console-execution-1285-process-crash",
      expected_session_revision: "2026-10-14T00:59:00.000Z",
      objective,
      requested_at: "2026-10-14T00:59:30.000Z",
      budget_tokens: 3000,
      retry_of: null,
    },
    workItemId: "work-item-1285",
  });
  updateArtifact((record) => {
    const attempt = record.attempts.at(-1);
    attempt.apply_command_id = "accept-1285-process-crash";
    attempt.apply_command_digest = `sha256:${"f".repeat(64)}`;
    attempt.state = "applying";
    record.revision = "2026-10-14T01:00:02.000Z";
  });
  const status = await service.read({
    callerId: "governance-operations-console",
    operatorId: "operator:workspace-owner",
    workItemId: "work-item-1285",
  });
  assert.equal(status.next_action.code, "source-realization-recovery-required");
  const recovered = await service.recover({
    callerId: "governance-operations-console",
    operatorId: "operator:workspace-owner",
    request: {
      schema_version: 1,
      command_id: "recover-1285-process-crash",
      expected_revision: status.revision,
      requested_at: "2026-10-14T01:00:02.000Z",
    },
    workItemId: "work-item-1285",
  });
  assert.equal(recovered.state, "source-created");
  assert.equal(getApplyCount(), 1);
});

test('ordinary Delivery manual/import drafts have the same retained amendment/replay path without a model',async()=>{
  const f=fixture({modelAvailable:false});const args={callerId:f.session.caller_id,operatorId:f.session.operator.id,workItemId:f.session.covered_work_item_ids[0]};
  const initial=await f.service.read(args);const command={schema_version:1,command_id:'save:delivery:1',execution_id:'execution:delivery:1',expected_revision:initial.revision,
    expected_change_set_digest:null,requested_at:'2026-10-14T00:59:00Z',objective:f.objective,input_origin:'manual',retry_of:null,commit_message:'feat: author actual application source',operations:f.changeSet.operations};
  const saved=await f.service.saveDraft({...args,request:command});assert.equal(saved.state,'draft-ready');assert.equal(saved.attempt.model,null);assert.equal(saved.attempt.context,null);assert.equal(f.getApplyCount(),0);
  const changed={...command,command_id:'save:delivery:2',expected_revision:saved.revision,expected_change_set_digest:saved.attempt.change_set.digest,
    input_origin:'import',operations:[{...command.operations[0],content:'export const imported = true;\r\n'}]};
  const amended=await f.service.saveDraft({...args,request:changed});assert.notEqual(amended.attempt.change_set.digest,saved.attempt.change_set.digest);
  assert.deepEqual(await f.service.saveDraft({...args,request:command}),{...saved,replayed:true});
  const draft=await f.service.draft(args);assert.equal(draft.revision,amended.revision);assert.equal(draft.change_set.operations[0].content,changed.operations[0].content);
  assert.equal(draft.operator_draft.input_origin,'import');
  assert.equal(draft.objective, command.objective);
  await assert.rejects(f.service.draft({...args,operatorId:'other'}),{code:'delivery_art_source_realization_identity_mismatch'});
  await assert.rejects(f.service.files({...args,callerId:'other'}),{code:'delivery_art_source_realization_identity_mismatch'});
  await assert.rejects(f.service.saveDraft({...args,request:{...changed,command_id:'save:delivery:stale'}}),{code:'delivery_art_source_realization_revision_stale'});
  assert.equal((await f.service.read(args)).revision,amended.revision);
});
