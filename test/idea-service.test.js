import test from "node:test";
import assert from "node:assert/strict";

import { createIdeaService } from "../src/idea-service.js";
import { HttpError } from "../src/errors.js";

function createAudit() {
  const events = [];
  return {
    emit(event) {
      events.push(event);
    },
    events,
  };
}

test("listIdeas filters by canonical status across backend pages", async () => {
  const audit = createAudit();
  const openProjectClient = {
    async listIdeas({ limit, offset }) {
      assert.equal(limit, 25);
      if (offset === 1) {
        return {
          count: 2,
          items: [
            {
              body: "Captured one",
              createdAt: "2026-04-19T00:00:00Z",
              ideaId: "idea-4",
              recordRef: "openproject://work_packages/4",
              source: { surface: "telegram" },
              status: "captured",
              title: "Captured one",
              updatedAt: "2026-04-19T00:00:00Z",
            },
            {
              body: "Parked one",
              createdAt: "2026-04-19T00:01:00Z",
              ideaId: "idea-3",
              recordRef: "openproject://work_packages/3",
              source: { surface: "telegram" },
              status: "parked",
              title: "Parked one",
              updatedAt: "2026-04-19T00:01:00Z",
            },
          ],
          limit,
          offset,
          total: 4,
        };
      }

      return {
        count: 2,
        items: [
          {
            body: "Captured two",
            createdAt: "2026-04-19T00:02:00Z",
            ideaId: "idea-2",
            recordRef: "openproject://work_packages/2",
            source: { surface: "telegram" },
            status: "captured",
            title: "Captured two",
            updatedAt: "2026-04-19T00:02:00Z",
          },
          {
            body: "Captured three",
            createdAt: "2026-04-19T00:03:00Z",
            ideaId: "idea-1",
            recordRef: "openproject://work_packages/1",
            source: { surface: "telegram" },
            status: "captured",
            title: "Captured three",
            updatedAt: "2026-04-19T00:03:00Z",
          },
        ],
        limit,
        offset,
        total: 4,
      };
    },
  };

  const service = createIdeaService({ openProjectClient, audit });

  const result = await service.listIdeas({
    callerId: "openclaw-telegram-enhanced",
    correlationId: "corr-1",
    limit: 2,
    offset: 1,
    status: "captured",
  });

  assert.deepEqual(
    result.ideas.map((entry) => entry.idea_id),
    ["idea-4", "idea-2"],
  );
  assert.equal(result.page.count, 2);
  assert.equal(result.page.has_more, true);
  assert.equal(result.page.next_offset, 3);
  assert.equal(result.page.total, 3);
  assert.equal(audit.events.at(-1)?.status_filter, "captured");
});

test("triageIdea records operator-authored framing for captured ideas", async () => {
  const audit = createAudit();
  const calls = [];
  const openProjectClient = {
    async getIdea(recordId) {
      calls.push(["getIdea", recordId]);
      return {
        ideaId: "idea-41",
        recordRef: "openproject://work_packages/41",
        status: "captured",
      };
    },
    async triageIdea({ recordId, summary }) {
      calls.push(["triageIdea", recordId, summary]);
      return {
        ideaId: "idea-41",
        recordRef: "openproject://work_packages/41",
        status: "triaged",
        triageSummary: summary,
        updatedAt: "2026-04-19T12:00:00Z",
      };
    },
  };

  const service = createIdeaService({ openProjectClient, audit });
  const result = await service.triageIdea({
    callerId: "openclaw-telegram-enhanced",
    correlationId: "corr-2",
    ideaId: "idea-41",
    operator: {
      handle: "mfshaf7",
      id: "1338752889",
    },
    summary: "Needs a bounded broker workflow before later decision handling.",
  });

  assert.deepEqual(calls, [
    ["getIdea", 41],
    ["triageIdea", 41, "Needs a bounded broker workflow before later decision handling."],
  ]);
  assert.equal(result.workflow_id, "idea-triage");
  assert.equal(result.status, "triaged");
  assert.equal(
    result.triage_summary,
    "Needs a bounded broker workflow before later decision handling.",
  );
  assert.equal(audit.events[0]?.event_type, "idea.triage.requested");
  assert.equal(audit.events.at(-1)?.event_type, "idea.triage.recorded");
});

test("triageIdea rejects later-decision states", async () => {
  const audit = createAudit();
  const openProjectClient = {
    async getIdea() {
      return {
        ideaId: "idea-41",
        recordRef: "openproject://work_packages/41",
        status: "accepted",
      };
    },
  };

  const service = createIdeaService({ openProjectClient, audit });

  await assert.rejects(
    () =>
      service.triageIdea({
        callerId: "openclaw-telegram-enhanced",
        correlationId: "corr-3",
        ideaId: "idea-41",
        operator: {
          handle: "mfshaf7",
          id: "1338752889",
        },
        summary: "This should not overwrite a later decision state.",
      }),
    (error) =>
      error instanceof HttpError &&
      error.code === "triage_status_invalid",
  );
});

test("decideIdea records a bounded durable outcome for triaged ideas", async () => {
  const audit = createAudit();
  const calls = [];
  const openProjectClient = {
    async getIdea(recordId) {
      calls.push(["getIdea", recordId]);
      return {
        ideaId: "idea-41",
        recordRef: "openproject://work_packages/41",
        status: "triaged",
      };
    },
    async decideIdea({ recordId, status, notes }) {
      calls.push(["decideIdea", recordId, status, notes]);
      return {
        ideaId: "idea-41",
        operatorDecisionNotes: notes,
        recordRef: "openproject://work_packages/41",
        status,
        updatedAt: "2026-04-19T12:30:00Z",
      };
    },
  };

  const service = createIdeaService({ openProjectClient, audit });
  const result = await service.decideIdea({
    callerId: "openclaw-telegram-enhanced",
    correlationId: "corr-4",
    ideaId: "idea-41",
    operator: {
      handle: "mfshaf7",
      id: "1338752889",
    },
    notes: "Revisit this after the owner-assigned vocabulary lands.",
    status: "parked",
  });

  assert.deepEqual(calls, [
    ["getIdea", 41],
    [
      "decideIdea",
      41,
      "parked",
      "Revisit this after the owner-assigned vocabulary lands.",
    ],
  ]);
  assert.equal(result.workflow_id, "idea-decision");
  assert.equal(result.status, "parked");
  assert.equal(
    result.operator_decision_notes,
    "Revisit this after the owner-assigned vocabulary lands.",
  );
  assert.equal(audit.events[0]?.event_type, "idea.decision.requested");
  assert.equal(audit.events.at(-1)?.event_type, "idea.decision.recorded");
});

test("decideIdea rejects captured ideas before triage", async () => {
  const audit = createAudit();
  const openProjectClient = {
    async getIdea() {
      return {
        ideaId: "idea-41",
        recordRef: "openproject://work_packages/41",
        status: "captured",
      };
    },
  };

  const service = createIdeaService({ openProjectClient, audit });

  await assert.rejects(
    () =>
      service.decideIdea({
        callerId: "openclaw-telegram-enhanced",
        correlationId: "corr-5",
        ideaId: "idea-41",
        operator: {
          handle: "mfshaf7",
          id: "1338752889",
        },
        notes: "This should require triage first.",
        status: "accepted",
      }),
    (error) =>
      error instanceof HttpError &&
      error.code === "decision_status_invalid",
  );
});

test("recordIdeaEvaluation preserves lifecycle status and records internal metadata", async () => {
  const audit = createAudit();
  const calls = [];
  const openProjectClient = {
    async getIdea(recordId) {
      calls.push(["getIdea", recordId]);
      return {
        ideaId: "idea-41",
        recordRef: "openproject://work_packages/41",
        status: "triaged",
      };
    },
    async recordIdeaEvaluation({ evaluation, recordId }) {
      calls.push(["recordIdeaEvaluation", recordId, evaluation]);
      return {
        evaluation: {
          affectedScope: [
            "repo:operator-orchestration-service",
            "repo:openclaw-telegram-enhanced",
          ],
          aiAssistLane: "local",
          confidence: "medium",
          notes: "Broker owns the workflow contract and Telegram is a thin adapter.",
          suspectedOwner: "repo:operator-orchestration-service",
          trustBoundaryAreas: ["runtime", "ai"],
        },
        ideaId: "idea-41",
        recordRef: "openproject://work_packages/41",
        status: "triaged",
        updatedAt: "2026-04-19T13:00:00Z",
      };
    },
  };

  const service = createIdeaService({ openProjectClient, audit });
  const result = await service.recordIdeaEvaluation({
    callerId: "codex-local",
    correlationId: "corr-6",
    evaluation: {
      affectedScope: [
        "repo:operator-orchestration-service",
        "repo:openclaw-telegram-enhanced",
      ],
      aiAssistLane: "local",
      confidence: "medium",
      notes: "Broker owns the workflow contract and Telegram is a thin adapter.",
      suspectedOwner: "repo:operator-orchestration-service",
      trustBoundaryAreas: ["runtime", "ai"],
    },
    ideaId: "idea-41",
  });

  assert.deepEqual(calls, [
    ["getIdea", 41],
    [
      "recordIdeaEvaluation",
      41,
      {
        affectedScope: [
          "repo:operator-orchestration-service",
          "repo:openclaw-telegram-enhanced",
        ],
        aiAssistLane: "local",
        confidence: "medium",
        notes: "Broker owns the workflow contract and Telegram is a thin adapter.",
        suspectedOwner: "repo:operator-orchestration-service",
        trustBoundaryAreas: ["runtime", "ai"],
      },
    ],
  ]);
  assert.equal(result.workflow_id, "idea-evaluation-metadata");
  assert.equal(result.status, "triaged");
  assert.equal(
    result.evaluation.suspected_owner,
    "repo:operator-orchestration-service",
  );
  assert.equal(audit.events[0]?.event_type, "idea.evaluation.requested");
  assert.equal(audit.events.at(-1)?.event_type, "idea.evaluation.recorded");
});

test("consumeIdea creates a linked delivery record for accepted ideas", async () => {
  const audit = createAudit();
  const calls = [];
  const openProjectClient = {
    async getIdea(recordId) {
      calls.push(["getIdea", recordId]);
      return {
        deliveryRef: null,
        ideaId: "idea-41",
        recordRef: "openproject://work_packages/41",
        status: "accepted",
        updatedAt: "2026-04-19T14:00:00Z",
      };
    },
    async consumeAcceptedIdea({ currentRecord, ownerRepo, recordId, targetPi }) {
      calls.push([
        "consumeAcceptedIdea",
        recordId,
        currentRecord.ideaId,
        ownerRepo,
        targetPi,
      ]);
      return {
        deliveryCreated: true,
        deliveryRecord: {
          ownerRepo,
          pm2Phase: "Initiating",
          recordRef: "openproject://work_packages/77",
          status: "new",
          targetPi,
        },
        sourceRecord: {
          deliveryRef: "openproject://work_packages/77",
          ideaId: "idea-41",
          recordRef: "openproject://work_packages/41",
          status: "accepted",
          updatedAt: "2026-04-19T14:05:00Z",
        },
        sourceUpdated: true,
      };
    },
  };

  const service = createIdeaService({ openProjectClient, audit });
  const result = await service.consumeIdea({
    callerId: "codex-local",
    correlationId: "corr-7",
    ideaId: "idea-41",
    operator: {
      handle: "mfshaf7",
      id: "1338752889",
    },
    ownerRepo: "operator-orchestration-service",
    targetPi: "PI-2026-02",
  });

  assert.deepEqual(calls, [
    ["getIdea", 41],
    [
      "consumeAcceptedIdea",
      41,
      "idea-41",
      "operator-orchestration-service",
      "PI-2026-02",
    ],
  ]);
  assert.equal(result.workflow_id, "accepted-idea-delivery-consume");
  assert.equal(result.delivery_created, true);
  assert.equal(result.delivery_record_ref, "openproject://work_packages/77");
  assert.equal(result.delivery_pm2_phase, "Initiating");
  assert.equal(result.delivery_ref, "openproject://work_packages/77");
  assert.equal(result.owner_repo, "operator-orchestration-service");
  assert.equal(result.target_pi, "PI-2026-02");
  assert.equal(audit.events[0]?.event_type, "idea.consume.requested");
  assert.equal(audit.events.at(-1)?.event_type, "idea.consume.recorded");
});

test("consumeIdea rejects non-accepted ideas", async () => {
  const audit = createAudit();
  const openProjectClient = {
    async getIdea() {
      return {
        deliveryRef: null,
        ideaId: "idea-41",
        recordRef: "openproject://work_packages/41",
        status: "triaged",
      };
    },
  };

  const service = createIdeaService({ openProjectClient, audit });

  await assert.rejects(
    () =>
      service.consumeIdea({
        callerId: "codex-local",
        correlationId: "corr-8",
        ideaId: "idea-41",
        operator: {
          handle: "mfshaf7",
          id: "1338752889",
        },
      }),
    (error) =>
      error instanceof HttpError &&
      error.code === "consume_status_invalid",
  );
});

test("closeoutIdea marks an accepted source idea implemented after delivery is done", async () => {
  const audit = createAudit();
  const calls = [];
  const openProjectClient = {
    async getIdea(recordId) {
      calls.push(["getIdea", recordId]);
      return {
        deliveryRef: "openproject://work_packages/77",
        ideaId: "idea-41",
        operatorDecisionNotes: "Ready to move this into tracked delivery.",
        recordRef: "openproject://work_packages/41",
        status: "accepted",
      };
    },
    async closeAcceptedIdeaDelivery({ currentRecord, recordId, closeoutNotes }) {
      calls.push([
        "closeAcceptedIdeaDelivery",
        recordId,
        currentRecord.ideaId,
        closeoutNotes,
      ]);
      return {
        deliveryRecord: {
          recordRef: "openproject://work_packages/77",
          status: "done",
        },
        sourceRecord: {
          deliveryCloseoutNotes: closeoutNotes,
          deliveryRef: "openproject://work_packages/77",
          ideaId: "idea-41",
          operatorDecisionNotes: "Ready to move this into tracked delivery.",
          recordRef: "openproject://work_packages/41",
          status: "implemented",
          updatedAt: "2026-04-21T09:00:00Z",
        },
      };
    },
  };

  const service = createIdeaService({ openProjectClient, audit });
  const result = await service.closeoutIdea({
    callerId: "codex-local",
    closeoutNotes: "Delivered through the first bounded productization execution slice.",
    correlationId: "corr-9",
    ideaId: "idea-41",
    operator: {
      handle: "mfshaf7",
      id: "1338752889",
    },
  });

  assert.deepEqual(calls, [
    ["getIdea", 41],
    [
      "closeAcceptedIdeaDelivery",
      41,
      "idea-41",
      "Delivered through the first bounded productization execution slice.",
    ],
  ]);
  assert.equal(result.workflow_id, "accepted-idea-delivery-closeout");
  assert.equal(result.status, "implemented");
  assert.equal(result.delivery_record_ref, "openproject://work_packages/77");
  assert.equal(
    result.delivery_closeout_notes,
    "Delivered through the first bounded productization execution slice.",
  );
  assert.equal(audit.events[0]?.event_type, "idea.closeout.requested");
  assert.equal(audit.events.at(-1)?.event_type, "idea.closeout.recorded");
});

test("closeoutIdea replays an already implemented closeout without another write", async () => {
  const audit = createAudit();
  const openProjectClient = {
    async getIdea() {
      return {
        deliveryRef: "openproject://work_packages/77",
        ideaId: "idea-41",
        recordRef: "openproject://work_packages/41",
        status: "implemented",
      };
    },
    async closeAcceptedIdeaDelivery({ currentRecord }) {
      return {
        deliveryRecord: {
          recordRef: currentRecord.deliveryRef,
          status: "done",
        },
        replayed: true,
        sourceRecord: currentRecord,
      };
    },
  };

  const service = createIdeaService({ openProjectClient, audit });

  const result = await service.closeoutIdea({
    callerId: "codex-local",
    closeoutNotes: "Already complete.",
    correlationId: "corr-10",
    ideaId: "idea-41",
    operator: {
      handle: "mfshaf7",
      id: "1338752889",
    },
  });

  assert.equal(result.closeout_outcome, "replayed");
  assert.equal(result.status, "implemented");
});

test("reconcileIdeaDeliveryCloseouts dry-runs exact backlinks and excludes retired delivery", async () => {
  const audit = createAudit();
  const openProjectClient = {
    async listIdeas({ limit, offset }) {
      return {
        count: 2,
        items: [
          {
            deliveryRef: "openproject://work_packages/77",
            ideaId: "idea-41",
            status: "accepted",
          },
          {
            deliveryRef: "openproject://work_packages/78",
            ideaId: "idea-42",
            status: "accepted",
          },
        ],
        limit,
        offset,
        total: 2,
      };
    },
    async inspectAcceptedIdeaDelivery({ currentRecord }) {
      const retired = currentRecord.ideaId === "idea-42";
      return {
        deliveryRecord: {
          recordRef: currentRecord.deliveryRef,
          status: retired ? "retired" : "done",
        },
        eligible: !retired,
        reason: retired ? "delivery_retired" : null,
      };
    },
  };
  const service = createIdeaService({ audit, openProjectClient });

  const result = await service.reconcileIdeaDeliveryCloseouts({
    apply: false,
    callerId: "codex-local",
    closeoutNotes: "Dry run only.",
    correlationId: "corr-reconcile-1",
    operator: { handle: "mfshaf7", id: "1338752889" },
  });

  assert.equal(result.applied, false);
  assert.equal(result.summary.eligible_count, 1);
  assert.equal(result.summary.retired_count, 1);
  assert.equal(result.items[0].action, "would_close");
  assert.equal(result.items[1].outcome, "delivery_retired");
});

test("reconcileIdeaDeliveryCloseouts applies only backlink-proven completed delivery", async () => {
  const audit = createAudit();
  let closeCount = 0;
  const openProjectClient = {
    async listIdeas({ limit, offset }) {
      return {
        count: 1,
        items: [
          {
            deliveryRef: "openproject://work_packages/77",
            ideaId: "idea-41",
            status: "accepted",
          },
        ],
        limit,
        offset,
        total: 1,
      };
    },
    async inspectAcceptedIdeaDelivery({ currentRecord }) {
      return {
        deliveryRecord: { recordRef: currentRecord.deliveryRef, status: "done" },
        eligible: true,
        reason: null,
      };
    },
    async closeAcceptedIdeaDelivery({ currentRecord, recordId }) {
      closeCount += 1;
      assert.equal(recordId, 41);
      return {
        deliveryRecord: { recordRef: currentRecord.deliveryRef, status: "done" },
        replayed: false,
        sourceRecord: { ...currentRecord, status: "implemented" },
      };
    },
  };
  const service = createIdeaService({ audit, openProjectClient });

  const dryRun = await service.reconcileIdeaDeliveryCloseouts({
    apply: false,
    callerId: "codex-local",
    closeoutNotes: "Dry run.",
    correlationId: "corr-reconcile-2-dry-run",
    expectedCandidateDigest: null,
    operator: { handle: "mfshaf7", id: "1338752889" },
  });
  const result = await service.reconcileIdeaDeliveryCloseouts({
    apply: true,
    callerId: "codex-local",
    closeoutNotes: "Reconciled from completed delivery.",
    correlationId: "corr-reconcile-2",
    expectedCandidateDigest: dryRun.candidate_digest,
    operator: { handle: "mfshaf7", id: "1338752889" },
  });

  assert.equal(closeCount, 1);
  assert.equal(result.summary.implemented_count, 1);
  assert.equal(result.items[0].outcome, "implemented");
});

test("reconcileIdeaDeliveryCloseouts rejects a stale dry-run digest before mutation", async () => {
  let closeCount = 0;
  const openProjectClient = {
    async listIdeas({ limit, offset }) {
      return {
        count: 1,
        items: [
          {
            deliveryRef: "openproject://work_packages/77",
            ideaId: "idea-41",
            status: "accepted",
          },
        ],
        limit,
        offset,
        total: 1,
      };
    },
    async inspectAcceptedIdeaDelivery({ currentRecord }) {
      return {
        deliveryRecord: { recordRef: currentRecord.deliveryRef, status: "done" },
        eligible: true,
        reason: null,
      };
    },
    async closeAcceptedIdeaDelivery() {
      closeCount += 1;
    },
  };
  const service = createIdeaService({
    audit: createAudit(),
    openProjectClient,
  });

  await assert.rejects(
    () =>
      service.reconcileIdeaDeliveryCloseouts({
        apply: true,
        callerId: "codex-local",
        closeoutNotes: "Do not apply stale plan.",
        correlationId: "corr-reconcile-stale",
        expectedCandidateDigest: "sha256:stale",
        operator: { handle: "mfshaf7", id: "1338752889" },
      }),
    (error) =>
      error instanceof HttpError && error.code === "reconciliation_plan_changed",
  );
  assert.equal(closeCount, 0);
});
