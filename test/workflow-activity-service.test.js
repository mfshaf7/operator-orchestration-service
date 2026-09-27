import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

import {
  WorkflowActivityError,
  createWorkflowActivityService,
} from "../src/workflow-activity/service.js";
import {
  createLifecycleTransitionActivitySource,
  createOrchestrationActivitySource,
} from "../src/workflow-activity/sources.js";

const NOW = "2026-09-28T01:00:00.000Z";
const schema = JSON.parse(readFileSync(
  new URL("../contracts/workflow-activity/workflow-activity-page.schema.json", import.meta.url),
  "utf8",
));
const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
const validatePage = ajv.compile(schema);

function event(id, occurredAt, overrides = {}) {
  return {
    event_id: id,
    action: { id: "state-changed", label: "State changed" },
    actor: { kind: "system", ref: "owner:test" },
    category: "state-change",
    outcome: "succeeded",
    occurred_at: occurredAt,
    correlation_id: "correlation:test",
    causation_id: null,
    evidence_refs: [],
    receipt_ref: null,
    next_actions: [],
    source_ref: "alpha:oos://alpha/1",
    source_revision: "revision:1",
    subject: { kind: "test", label: "Test subject", ref: "subject:1" },
    summary: "State changed.",
    ...overrides,
  };
}

function source(id, events, overrides = {}) {
  return {
    id,
    label: `${id} label`,
    authority: "operator-orchestration-service",
    owner: "operator-orchestration-service",
    async read() {
      return {
        state: "current",
        observed_at: NOW,
        source_revision: `${id}:revision:1`,
        truncated: false,
        events,
      };
    },
    ...overrides,
  };
}

test("workflow activity composes owner events with stable keyset pagination", async () => {
  const alphaEvents = [
    event("alpha:3", "2026-09-28T00:03:00.000Z"),
    event("alpha:1", "2026-09-28T00:01:00.000Z"),
  ];
  const service = createWorkflowActivityService({
    clock: () => new Date(NOW),
    sources: [
      source("alpha", alphaEvents),
      source("beta", [event("beta:2", "2026-09-28T00:02:00.000Z", {
        source_ref: "beta:oos://beta/2",
      })]),
    ],
  });

  const first = await service.list({ callerId: "console", limit: 2 });
  assert.equal(first.projection_status, "current");
  assert.deepEqual(first.events.map((entry) => entry.event_id), ["alpha:3", "beta:2"]);
  assert.ok(first.next_cursor);
  assert.equal(validatePage(first), true, JSON.stringify(validatePage.errors));

  alphaEvents.unshift(event("alpha:4", "2026-09-28T00:04:00.000Z"));
  const second = await service.list({
    callerId: "console",
    cursor: first.next_cursor,
    limit: 2,
  });
  assert.deepEqual(second.events.map((entry) => entry.event_id), ["alpha:1"]);
  assert.equal(second.next_cursor, null);
});

test("workflow activity remains explicitly partial without synthetic events", async () => {
  const unavailable = source("broken", [], {
    async read() {
      const error = new Error("private upstream detail");
      error.code = "owner_unavailable";
      throw error;
    },
  });
  const service = createWorkflowActivityService({
    clock: () => new Date(NOW),
    sources: [source("alpha", [event("alpha:1", NOW)]), unavailable],
  });
  const result = await service.list({ callerId: "console" });
  assert.equal(result.projection_status, "partial");
  assert.equal(result.events.length, 1);
  assert.deepEqual(result.sources.find((entry) => entry.source_id === "broken"), {
    source_id: "broken",
    authority: "operator-orchestration-service",
    owner: "operator-orchestration-service",
    state: "unavailable",
    observed_at: NOW,
    source_revision: "unavailable",
    event_count: 0,
    truncated: false,
    error_code: "owner_unavailable",
  });
});

test("workflow activity fails closed on authorization and conflicting identities", async () => {
  const forbidden = source("forbidden", [], {
    async read() {
      throw new WorkflowActivityError("caller_forbidden", "Forbidden.", 403);
    },
  });
  await assert.rejects(
    createWorkflowActivityService({ sources: [forbidden] }).list({ callerId: "bad" }),
    { code: "caller_forbidden" },
  );

  const conflicting = createWorkflowActivityService({
    sources: [
      source("alpha", [event("shared", NOW)]),
      source("beta", [event("shared", NOW, { summary: "Different." })]),
    ],
  });
  await assert.rejects(
    conflicting.list({ callerId: "console" }),
    { code: "workflow_activity_event_conflict" },
  );
});

test("workflow activity binds cursors to filters and rejects unsupported filters", async () => {
  const service = createWorkflowActivityService({
    sources: [source("alpha", [
      event("alpha:2", "2026-09-28T00:02:00.000Z"),
      event("alpha:1", "2026-09-28T00:01:00.000Z"),
    ])],
  });
  const first = await service.list({ callerId: "console", limit: 1 });
  await assert.rejects(
    service.list({
      callerId: "console",
      cursor: first.next_cursor,
      filters: { outcome: "blocked" },
      limit: 1,
    }),
    { code: "workflow_activity_cursor_invalid" },
  );
  await assert.rejects(
    service.list({ callerId: "console", filters: { sourceId: "unknown" } }),
    { code: "workflow_activity_filter_invalid" },
  );
});

test("canonical sources map lifecycle and orchestration chronology without raw payloads", async () => {
  const lifecycle = createLifecycleTransitionActivitySource({
    async list() {
      return {
        next_cursor: null,
        transitions: [{
          binding: { authority: "operator-orchestration-service" },
          freshness: { observed_at: NOW },
          revision: { event_sequence: 1, source_revision: "transition:2" },
          projection: {
            transition_id: "transition:1",
            route_id: "prototype-to-delivery",
            correlation_id: "correlation:1",
            validation: { receipt_ref: "receipt:validation" },
            admission: { receipt_ref: null },
            application: { receipt_ref: null },
            authority_decisions: [],
            next_action: { action: "record-authority-decision", owner_ref: "security", review_at: null },
            history: {
              truncated: false,
              entries: [{
                artifact_id: "validation:1",
                artifact_kind: "validation-completed",
                authority: { owner_ref: "wgcf", role: "validation-authority" },
                evidence_refs: ["evidence:1"],
                recorded_at: NOW,
                sequence: 1,
              }],
            },
          },
        }],
      };
    },
  }, { clock: () => new Date(NOW) });
  const lifecycleResult = await lifecycle.read({ callerId: "console", limit: 50 });
  assert.equal(lifecycleResult.events[0].receipt_ref, "receipt:validation");
  assert.equal(lifecycleResult.events[0].next_actions[0].owner_ref, "security");

  const orchestration = createOrchestrationActivitySource({
    async listRuns() {
      return [{
        run_id: "run:1",
        definition_id: "readiness",
        definition_version: 1,
        correlation_ref: "correlation:1",
        causation_ref: "causation:1",
        last_projected_at: NOW,
        artifact_refs: ["artifact:1"],
        receipt_refs: [{ receipt_id: "receipt:owner", digest: "sha256:test" }],
        aggregate_receipt: { receipt_id: "receipt:aggregate" },
        control_availability: [{ action: "resume", authority: "operator", available: true }],
        controls: [],
        events: [{
          event_id: "event:run:1:1",
          sequence: 1,
          state: "completed",
          node_id: "node:1",
          summary: "Run completed.",
          occurred_at: NOW,
        }],
      }];
    },
  }, { clock: () => new Date(NOW) });
  const orchestrationResult = await orchestration.read({ callerId: "console", limit: 50 });
  assert.equal(orchestrationResult.events[0].receipt_ref, "receipt:aggregate");
  assert.deepEqual(orchestrationResult.events[0].evidence_refs, ["artifact:1", "receipt:owner"]);
});

test("inactive canonical owners remain explicit instead of projecting empty freshness", async () => {
  const service = createWorkflowActivityService({
    clock: () => new Date(NOW),
    sources: [
      createLifecycleTransitionActivitySource(null, { clock: () => new Date(NOW) }),
      createOrchestrationActivitySource(null, {
        available: false,
        clock: () => new Date(NOW),
      }),
    ],
  });
  const result = await service.list({ callerId: "console" });
  assert.equal(result.projection_status, "partial");
  assert.deepEqual(result.sources.map((entry) => entry.error_code), [
    "orchestration_runtime_not_active",
    "lifecycle_transition_not_active",
  ]);
});

test("runtime image carries the Workflow Activity contract bundle", () => {
  const dockerfile = readFileSync(new URL("../Dockerfile", import.meta.url), "utf8");
  assert.match(
    dockerfile,
    /COPY --chown=node:node contracts\/workflow-activity \.\/contracts\/workflow-activity/,
  );
});
