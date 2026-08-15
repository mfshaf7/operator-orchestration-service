import test from "node:test";
import assert from "node:assert/strict";

import { HttpError } from "../src/errors.js";
import { encodeProposalEvent } from "../src/proposal-workflow/event-codec.js";
import { createProposalWorkflowService } from "../src/proposal-workflow/service.js";
import {
  defaultProposalState,
  proposalCommandReceiptRef,
  proposalEventId,
} from "../src/proposal-workflow/state.js";

const NOW = "2026-08-16T03:10:00.000Z";
const AUTOMATION_USER_REF = "/api/v3/users/5";

function record(overrides = {}) {
  return {
    body: "Build the live Proposal integration.",
    deliveryCloseoutNotes: null,
    evaluation: { notes: null },
    ideaId: "idea-851",
    lockVersion: 17,
    operator: { handle: "mfshaf7", id: "operator:workspace-owner" },
    operatorDecisionNotes: null,
    recordRef: "openproject://work_packages/851",
    source: {
      context_ref: { conversation_id: "proposal-851" },
      native_ref: { message_id: "851" },
      surface: "governance-operations-console",
    },
    status: "captured",
    title: "Live Proposal integration",
    triageSummary: null,
    updatedAt: NOW,
    workflowState: null,
    ...overrides,
  };
}

function triageCommand(overrides = {}) {
  return {
    schema_version: 1,
    command_id: "proposal-command:851:triage-1",
    authority: {
      record_system: "openproject",
      record_project: "workspace-proposals",
      mutation_adapter: "operator-orchestration-service",
    },
    proposal_id: "idea-851",
    source: {
      record_ref: "openproject://work_packages/851",
      record_version: "version-17",
      projection_state: "current",
      status: "captured",
    },
    operator: {
      id: "operator:workspace-owner",
      handle: "mfshaf7",
    },
    command: {
      type: "triage",
      summary: "The Proposal is ready for a bounded disposition decision.",
    },
    ...overrides,
  };
}

function createHarness({ activities = [], currentRecord = record() } = {}) {
  const calls = [];
  let storedRecord = structuredClone(currentRecord);
  const openProjectClient = {
    async addProposalEvent(input) {
      calls.push(["addProposalEvent", input]);
      activities.push({
        comment: input.raw,
        createdAt: NOW,
        id: 301,
        userRef: AUTOMATION_USER_REF,
        version: storedRecord.lockVersion,
      });
    },
    async applyProposalWorkflowMutation(input) {
      calls.push(["applyProposalWorkflowMutation", input]);
      storedRecord = {
        ...storedRecord,
        lockVersion: storedRecord.lockVersion + 1,
        operatorDecisionNotes:
          input.decisionNotes ?? storedRecord.operatorDecisionNotes,
        status: input.status,
        triageSummary: input.triageSummary ?? storedRecord.triageSummary,
        updatedAt: input.workflowState.updated_at,
        workflowState: JSON.stringify(input.workflowState),
      };
      return structuredClone(storedRecord);
    },
    async getIdea() {
      calls.push(["getIdea"]);
      return structuredClone(storedRecord);
    },
    async getProposalAutomationUserRef() {
      return AUTOMATION_USER_REF;
    },
    async listProposalActivities({ offset, pageSize }) {
      calls.push(["listProposalActivities", offset, pageSize]);
      return {
        count: activities.length,
        items: structuredClone(activities),
        offset,
        pageSize,
        total: activities.length,
      };
    },
  };
  return {
    calls,
    service: createProposalWorkflowService({ openProjectClient }),
    storedRecord: () => structuredClone(storedRecord),
  };
}

test("Proposal command applies once and returns projection, event, history, and owner receipt", async () => {
  const harness = createHarness();
  const command = triageCommand();
  const result = await harness.service.applyCommand({
    callerId: "operator:workspace-owner",
    command,
    correlationId: "correlation:proposal-851",
    proposalId: "idea-851",
  });

  assert.equal(result.replayed, false);
  assert.equal(result.projection.status, "triaged");
  assert.equal(result.projection.record_version, "version-18");
  assert.equal(result.event.event_type, "triaged");
  assert.equal(result.history.events.length, 1);
  assert.equal(result.receipt.owner, "operator-orchestration-service");
  assert.equal(
    result.receipt.receipt_ref,
    proposalCommandReceiptRef("idea-851", command),
  );
  assert.equal(
    harness.calls.filter(([name]) => name === "applyProposalWorkflowMutation").length,
    1,
  );
  assert.equal(
    harness.calls.filter(([name]) => name === "addProposalEvent").length,
    1,
  );
});

test("Proposal command replay returns the durable event without another mutation", async () => {
  const command = triageCommand();
  const receiptRef = proposalCommandReceiptRef("idea-851", command);
  const event = {
    schema_version: 1,
    event_id: proposalEventId("idea-851", command.command_id),
    proposal_id: "idea-851",
    record_version: "version-18",
    event_type: "triaged",
    status_before: "captured",
    status_after: "triaged",
    actor: { kind: "operator", id: "operator:workspace-owner" },
    command_id: command.command_id,
    receipt_refs: [receiptRef],
    summary: command.command.summary,
    occurred_at: NOW,
  };
  const state = defaultProposalState(NOW);
  state.last_accepted_command = {
    command_id: command.command_id,
    command_type: "triage",
    accepted_at: NOW,
  };
  state.receipt_refs = [receiptRef];
  const harness = createHarness({
    activities: [{
      comment: encodeProposalEvent(event),
      createdAt: NOW,
      id: 301,
      userRef: AUTOMATION_USER_REF,
      version: 18,
    }],
    currentRecord: record({
      lockVersion: 19,
      status: "triaged",
      triageSummary: command.command.summary,
      workflowState: JSON.stringify(state),
    }),
  });

  const result = await harness.service.applyCommand({
    callerId: "operator:workspace-owner",
    command,
    correlationId: "correlation:proposal-851-replay",
    proposalId: "idea-851",
  });

  assert.equal(result.replayed, true);
  assert.equal(result.projection.record_version, "version-19");
  assert.equal(result.receipt.record_version, "version-18");
  assert.equal(
    harness.calls.some(([name]) => name === "applyProposalWorkflowMutation"),
    false,
  );
  assert.equal(
    harness.calls.some(([name]) => name === "addProposalEvent"),
    false,
  );
});

test("Proposal replay repairs a missing durable event without reapplying state", async () => {
  const command = triageCommand();
  const receiptRef = proposalCommandReceiptRef("idea-851", command);
  const state = defaultProposalState(NOW);
  state.last_accepted_command = {
    command_id: command.command_id,
    command_type: "triage",
    accepted_at: NOW,
  };
  state.receipt_refs = [receiptRef];
  const harness = createHarness({
    currentRecord: record({
      lockVersion: 19,
      status: "triaged",
      triageSummary: command.command.summary,
      workflowState: JSON.stringify(state),
    }),
  });

  const result = await harness.service.applyCommand({
    callerId: "operator:workspace-owner",
    command,
    correlationId: "correlation:proposal-851-repair",
    proposalId: "idea-851",
  });

  assert.equal(result.replayed, true);
  assert.equal(result.event.record_version, "version-18");
  assert.equal(result.projection.record_version, "version-19");
  assert.equal(result.receipt.record_version, "version-18");
  assert.equal(
    harness.calls.some(([name]) => name === "applyProposalWorkflowMutation"),
    false,
  );
  assert.equal(
    harness.calls.filter(([name]) => name === "addProposalEvent").length,
    1,
  );
});

test("Proposal command rejects stale state and caller spoofing before mutation", async () => {
  const harness = createHarness();
  await assert.rejects(
    () => harness.service.applyCommand({
      callerId: "operator:workspace-owner",
      command: triageCommand({
        source: {
          ...triageCommand().source,
          record_version: "version-16",
        },
      }),
      correlationId: "correlation:proposal-851-stale",
      proposalId: "idea-851",
    }),
    (error) => error instanceof HttpError && error.code === "proposal_version_stale",
  );
  await assert.rejects(
    () => harness.service.applyCommand({
      callerId: "governance-operations-console",
      command: triageCommand(),
      correlationId: "correlation:proposal-851-spoof",
      proposalId: "idea-851",
    }),
    (error) =>
      error instanceof HttpError &&
      error.code === "proposal_operator_binding_mismatch",
  );
  assert.equal(
    harness.calls.some(([name]) => name === "applyProposalWorkflowMutation"),
    false,
  );
});

test("Proposal history ignores event-like comments not authored by OOS", async () => {
  const command = triageCommand();
  const receiptRef = proposalCommandReceiptRef("idea-851", command);
  const event = {
    schema_version: 1,
    event_id: proposalEventId("idea-851", command.command_id),
    proposal_id: "idea-851",
    record_version: "version-17",
    event_type: "triaged",
    status_before: "captured",
    status_after: "triaged",
    actor: { kind: "operator", id: "operator:workspace-owner" },
    command_id: command.command_id,
    receipt_refs: [receiptRef],
    summary: command.command.summary,
    occurred_at: NOW,
  };
  const harness = createHarness({
    activities: [{
      comment: encodeProposalEvent(event),
      createdAt: NOW,
      id: 301,
      userRef: "/api/v3/users/99",
      version: 17,
    }],
  });

  const history = await harness.service.getHistory({
    callerId: "operator:workspace-owner",
    correlationId: "correlation:proposal-851-history",
    cursor: null,
    proposalId: "idea-851",
  });
  assert.deepEqual(history.events, []);
});
