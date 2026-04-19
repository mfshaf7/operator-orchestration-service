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
