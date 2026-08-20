import test from "node:test";
import assert from "node:assert/strict";

import { HttpError } from "../src/errors.js";
import { encodeProposalEvent } from "../src/proposal-workflow/event-codec.js";
import { createProposalWorkflowService } from "../src/proposal-workflow/service.js";
import {
  defaultProposalState,
  proposalCommandReceiptRef,
  proposalEventId,
  proposalHandoffApplicationReceiptRef,
} from "../src/proposal-workflow/state.js";

const NOW = "2026-08-16T03:10:00.000Z";
const AUTOMATION_USER_REF = "/api/v3/users/5";

function record(overrides = {}) {
  return {
    body: "Build the live Proposal integration.",
    deliveryRef: null,
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

function readyDeliveryState(overrides = {}) {
  const state = defaultProposalState(NOW);
  state.route = {
    rationale: "The accepted Proposal extends the Console product.",
    source_custody: {
      classification: "existing-repo",
      owner: "governance-operations-console",
      rationale: "The existing product repository owns the source.",
      repository_gate_state: "resolved",
      repository_mode: "existing",
      source_ref: "repo:governance-operations-console",
    },
    target: "delivery",
  };
  state.handoff = {
    packet_ref: "proposal-packet:851",
    state: "ready",
    target_receipt_ref: null,
    target_record_ref: null,
  };
  return { ...state, ...overrides };
}

function handoffApplication(overrides = {}) {
  return {
    application_id: "proposal-application:851:delivery-1",
    authority: {
      mutation_adapter: "operator-orchestration-service",
      record_project: "workspace-proposals",
      record_system: "openproject",
    },
    operator: {
      handle: "mfshaf7",
      id: "operator:workspace-owner",
    },
    proposal_id: "idea-851",
    schema_version: 1,
    source: {
      handoff_packet_ref: "proposal-packet:851",
      record_ref: "openproject://work_packages/851",
      record_version: "version-19",
      status: "accepted",
    },
    ...overrides,
  };
}

function createHarness({
  activities = [],
  addEventFailureAfterCommit = false,
  consumeFailures = 0,
  currentRecord = record(),
  mutationFailureAfterCommit = false,
} = {}) {
  const calls = [];
  let storedRecord = structuredClone(currentRecord);
  let remainingConsumeFailures = consumeFailures;
  let shouldFailAddEvent = addEventFailureAfterCommit;
  let shouldFailMutation = mutationFailureAfterCommit;
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
      if (shouldFailAddEvent) {
        shouldFailAddEvent = false;
        throw new Error("socket closed after event commit");
      }
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
      if (shouldFailMutation) {
        shouldFailMutation = false;
        throw new Error("socket closed after workflow mutation commit");
      }
      return structuredClone(storedRecord);
    },
    async consumeAcceptedIdea(input) {
      calls.push(["consumeAcceptedIdea", input]);
      if (remainingConsumeFailures > 0) {
        remainingConsumeFailures -= 1;
        throw new Error("delivery target unavailable");
      }
      if (!storedRecord.deliveryRef) {
        storedRecord = {
          ...storedRecord,
          deliveryRef: "openproject://work_packages/901",
          lockVersion: storedRecord.lockVersion + 1,
        };
      }
      return {
        deliveryRecord: {
          recordRef: storedRecord.deliveryRef,
          status: "new",
        },
        sourceRecord: structuredClone(storedRecord),
      };
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

function readyRecord(overrides = {}) {
  return record({
    lockVersion: 19,
    operatorDecisionNotes: "Accepted for governed Delivery.",
    status: "accepted",
    triageSummary: "The Proposal is ready for a target application.",
    workflowState: JSON.stringify(readyDeliveryState()),
    ...overrides,
  });
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

test("Proposal handoff application creates Delivery once and replays from durable state", async () => {
  const harness = createHarness({ currentRecord: readyRecord() });
  const application = handoffApplication();

  const first = await harness.service.applyHandoff({
    application,
    callerId: "operator:workspace-owner",
    correlationId: "correlation:proposal-851-application",
    proposalId: "idea-851",
  });

  assert.equal(first.replayed, false);
  assert.equal(first.projection.status, "accepted");
  assert.equal(first.projection.handoff.state, "applied");
  assert.equal(
    first.projection.handoff.target_record_ref,
    "openproject://work_packages/901",
  );
  assert.equal(first.projection.record_version, "version-21");
  assert.equal(first.event.event_type, "handoff-applied");
  assert.equal(
    harness.calls.filter(([name]) => name === "consumeAcceptedIdea").length,
    1,
  );
  assert.equal(
    harness.calls.find(([name]) => name === "consumeAcceptedIdea")[1].ownerRepo,
    "governance-operations-console",
  );

  const second = await harness.service.applyHandoff({
    application,
    callerId: "operator:workspace-owner",
    correlationId: "correlation:proposal-851-application-replay",
    proposalId: "idea-851",
  });

  assert.equal(second.replayed, true);
  assert.equal(second.receipt.receipt_ref, first.receipt.receipt_ref);
  assert.equal(second.receipt.target_record_ref, first.receipt.target_record_ref);
  assert.equal(
    harness.calls.filter(([name]) => name === "consumeAcceptedIdea").length,
    1,
  );
  assert.equal(
    harness.calls.filter(([name]) => name === "applyProposalWorkflowMutation").length,
    1,
  );
});

test("Proposal handoff application rejects stale, spoofed, and unready requests", async () => {
  const staleHarness = createHarness({ currentRecord: readyRecord() });
  await assert.rejects(
    () => staleHarness.service.applyHandoff({
      application: handoffApplication({
        source: {
          ...handoffApplication().source,
          record_version: "version-18",
        },
      }),
      callerId: "operator:workspace-owner",
      correlationId: "correlation:proposal-851-stale-application",
      proposalId: "idea-851",
    }),
    (error) => error instanceof HttpError && error.code === "proposal_version_stale",
  );
  await assert.rejects(
    () => staleHarness.service.applyHandoff({
      application: handoffApplication(),
      callerId: "governance-operations-console",
      correlationId: "correlation:proposal-851-spoofed-application",
      proposalId: "idea-851",
    }),
    (error) =>
      error instanceof HttpError &&
      error.code === "proposal_handoff_operator_binding_mismatch",
  );

  const unresolvedState = readyDeliveryState();
  unresolvedState.handoff.state = "blocked";
  unresolvedState.route.source_custody = {
    classification: "new-repo-required",
    owner: null,
    rationale: "Repository custody is not resolved.",
    repository_gate_state: "pending",
    repository_mode: "new",
    source_ref: "repo-request:proposal-851",
  };
  const unresolvedHarness = createHarness({
    currentRecord: readyRecord({ workflowState: JSON.stringify(unresolvedState) }),
  });
  await assert.rejects(
    () => unresolvedHarness.service.applyHandoff({
      application: handoffApplication(),
      callerId: "operator:workspace-owner",
      correlationId: "correlation:proposal-851-unresolved-repo",
      proposalId: "idea-851",
    }),
    (error) =>
      error instanceof HttpError &&
      error.code === "proposal_handoff_not_ready",
  );
  assert.equal(
    staleHarness.calls.some(([name]) => name === "consumeAcceptedIdea"),
    false,
  );
  assert.equal(
    unresolvedHarness.calls.some(([name]) => name === "consumeAcceptedIdea"),
    false,
  );
});

test("Proposal handoff application repairs target-backlink partial success", async () => {
  const harness = createHarness({
    currentRecord: readyRecord({
      deliveryRef: "openproject://work_packages/901",
      lockVersion: 20,
    }),
  });

  const result = await harness.service.applyHandoff({
    application: handoffApplication(),
    callerId: "operator:workspace-owner",
    correlationId: "correlation:proposal-851-backlink-recovery",
    proposalId: "idea-851",
  });

  assert.equal(result.replayed, false);
  assert.equal(result.projection.record_version, "version-21");
  assert.equal(result.projection.handoff.state, "applied");
  assert.equal(
    harness.calls.filter(([name]) => name === "consumeAcceptedIdea").length,
    1,
  );
});

test("Proposal handoff application records a target failure and permits version-refreshed retry", async () => {
  const harness = createHarness({
    consumeFailures: 1,
    currentRecord: readyRecord(),
  });
  const application = handoffApplication();

  await assert.rejects(
    () => harness.service.applyHandoff({
      application,
      callerId: "operator:workspace-owner",
      correlationId: "correlation:proposal-851-target-failure",
      proposalId: "idea-851",
    }),
    (error) =>
      error instanceof HttpError &&
      error.code === "proposal_target_application_failed" &&
      error.details?.retryable === true,
  );

  const blockedRecord = harness.storedRecord();
  const blockedState = JSON.parse(blockedRecord.workflowState);
  assert.equal(blockedRecord.status, "accepted");
  assert.equal(blockedState.handoff.state, "blocked");
  assert.match(
    blockedState.receipt_refs.at(-1),
    /^proposal-target-failure-receipt:/,
  );

  const retry = await harness.service.applyHandoff({
    application: handoffApplication({
      source: {
        ...application.source,
        record_version: "version-20",
      },
    }),
    callerId: "operator:workspace-owner",
    correlationId: "correlation:proposal-851-target-retry",
    proposalId: "idea-851",
  });

  assert.equal(retry.replayed, false);
  assert.equal(retry.projection.handoff.state, "applied");
  assert.deepEqual(
    retry.history.events.map((event) => event.event_type),
    ["target-application-failed", "handoff-applied"],
  );
  assert.equal(
    harness.calls.filter(([name]) => name === "consumeAcceptedIdea").length,
    2,
  );
});

test("Proposal handoff application recovers committed state and event writes", async () => {
  for (const failureMode of ["mutation", "event"]) {
    const harness = createHarness({
      addEventFailureAfterCommit: failureMode === "event",
      currentRecord: readyRecord(),
      mutationFailureAfterCommit: failureMode === "mutation",
    });
    const result = await harness.service.applyHandoff({
      application: handoffApplication(),
      callerId: "operator:workspace-owner",
      correlationId: `correlation:proposal-851-${failureMode}-recovery`,
      proposalId: "idea-851",
    });

    assert.equal(result.replayed, false);
    assert.equal(result.projection.handoff.state, "applied");
    assert.equal(result.history.events.at(-1).event_type, "handoff-applied");
  }
});

test("Proposal handoff application repairs a missing event but rejects a new application id", async () => {
  const application = handoffApplication();
  const receiptRef = proposalHandoffApplicationReceiptRef(
    "idea-851",
    application.application_id,
    application.source.handoff_packet_ref,
  );
  const state = readyDeliveryState();
  state.handoff = {
    packet_ref: application.source.handoff_packet_ref,
    state: "applied",
    target_receipt_ref: receiptRef,
    target_record_ref: "openproject://work_packages/901",
  };
  state.receipt_refs = [receiptRef];
  const harness = createHarness({
    currentRecord: readyRecord({
      deliveryRef: "openproject://work_packages/901",
      lockVersion: 21,
      workflowState: JSON.stringify(state),
    }),
  });

  const replay = await harness.service.applyHandoff({
    application,
    callerId: "operator:workspace-owner",
    correlationId: "correlation:proposal-851-event-repair",
    proposalId: "idea-851",
  });
  assert.equal(replay.replayed, true);
  assert.equal(
    harness.calls.filter(([name]) => name === "addProposalEvent").length,
    1,
  );

  await assert.rejects(
    () => harness.service.applyHandoff({
      application: handoffApplication({
        application_id: "proposal-application:851:delivery-2",
      }),
      callerId: "operator:workspace-owner",
      correlationId: "correlation:proposal-851-conflicting-application",
      proposalId: "idea-851",
    }),
    (error) =>
      error instanceof HttpError &&
      error.code === "proposal_handoff_already_applied",
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
