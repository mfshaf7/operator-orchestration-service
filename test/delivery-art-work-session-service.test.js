import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  createDeliveryArtWorkSessionService,
  DeliveryArtWorkSessionServiceError,
} from "../src/delivery-art/work-session-service.js";
import { createDeliveryArtWorkSessionStore } from "../src/delivery-art/work-session-store.js";

function valid() {
  return { errors: [], valid: true };
}

function createStore(root) {
  return createDeliveryArtWorkSessionStore({
    root,
    validateCleanupReceipt: valid,
    validateDecision: valid,
    validateResourceManifest: valid,
    validateSession: valid,
  });
}

function session(revision = "2026-08-27T01:00:00.000Z") {
  return {
    schema_version: 1,
    artifact_type: "delivery_art_work_session",
    session_id: "work-session:delivery-886:delivery-886-api",
    delivery_id: "delivery-886",
    landing_unit_id: "delivery-886-api",
    covered_work_item_ids: ["work-item-1024"],
    aliases: ["delivery-886-api", "work-item-1024"],
    owner_repo: "operator-orchestration-service",
    target_pi: "PI-2026-03",
    caller_id: "operator:workspace-owner",
    operator: {
      id: "operator:workspace-owner",
      decision_source: "operator",
    },
    landing_unit: {
      decision: "child_isolated_landing_unit",
      split_reason: "The API is independently reviewable.",
      base_ref: "origin/main",
      base_commit: "a".repeat(40),
      branch: "feature/1024-delivery-work-session-api",
      rollback_boundary: "Revert the API landing unit.",
    },
    architecture: { required: false, artifact_file: null },
    artifacts: {
      work_start_file: "artifacts/work-start.json",
      review_packet_file: "artifacts/review-packet.json",
      readiness_receipt_file: "artifacts/readiness-receipt.json",
      evidence_file: "artifacts/evidence.json",
      resource_manifest_file: "resource-manifest.json",
    },
    human_gate_work_item_ids: { security_acceptance: [] },
    state: "source-work",
    created_at: "2026-08-27T01:00:00.000Z",
    updated_at: revision,
  };
}

function result(current) {
  return {
    workflow_id: "delivery-art-work-session",
    delivery_id: current.delivery_id,
    work_item_id: "work-item-1024",
    landing_unit_id: current.landing_unit_id,
    session_id: current.session_id,
    session_revision: current.updated_at,
    state: current.state,
    next_action: {
      code: "source-work-required",
      command: "git -C '/private/worktree' status --short",
      reason: "Complete the source change.",
      authority: current.owner_repo,
    },
    source: {
      base_commit: current.landing_unit.base_commit,
      branch: current.landing_unit.branch,
      changed_files: ["src/delivery-art/work-session-service.js"],
      head_commit: "b".repeat(40),
      state: "unpushed",
      upstream_commit: null,
    },
  };
}

function createHarness(store, { available = true } = {}) {
  const controller = {
    async start() {
      const current = session();
      store.writeSession(current);
      return result(current);
    },
    async status() {
      return result(store.readByAlias("work-item-1024") ?? session());
    },
    async continue() {
      const current = {
        ...store.readByAlias("work-item-1024"),
        updated_at: "2026-08-27T01:01:00.000Z",
      };
      store.writeSession(current);
      return result(current);
    },
    async close() {
      return {
        ...result(store.readByAlias("work-item-1024")),
        state: "closed",
      };
    },
  };
  return createDeliveryArtWorkSessionService({
    controller,
    executor: { available, id: "source-executor:test" },
    store,
  });
}

test("work-session commands retain one durable replay result and bounded source truth", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "oos-work-session-service-"));
  const store = createStore(root);
  const service = createHarness(store);
  const command = {
    command_id: "work-session-command:start-1024-1",
    expected_session_revision: null,
    decision: {
      caller_id: "operator:workspace-owner",
      operator: { id: "operator:workspace-owner" },
    },
  };

  const first = await service.execute({
    action: "start",
    callerId: "operator:workspace-owner",
    command,
    workItemId: "1024",
  });
  const replay = await createHarness(store).execute({
    action: "start",
    callerId: "operator:workspace-owner",
    command,
    workItemId: "work-item-1024",
  });

  assert.equal(first.replayed, false);
  assert.equal(replay.replayed, true);
  assert.deepEqual(replay.source, first.source);
  assert.equal(first.next_action.command, undefined);
  assert.equal(replay.command_receipt.digest, first.command_receipt.digest);
});

test("work-session commands reject stale revisions and caller mismatches", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "oos-work-session-stale-"));
  const store = createStore(root);
  store.writeSession(session());
  const service = createHarness(store);

  await assert.rejects(
    service.execute({
      action: "continue",
      callerId: "operator:workspace-owner",
      command: {
        command_id: "work-session-command:continue-stale-1",
        expected_session_revision: "2026-08-27T00:00:00.000Z",
      },
      workItemId: "1024",
    }),
    (error) =>
      error instanceof DeliveryArtWorkSessionServiceError &&
      error.code === "delivery_art_work_session_revision_stale" &&
      error.statusCode === 409,
  );
  await assert.rejects(
    service.read({ callerId: "operator:other", workItemId: "1024" }),
    (error) =>
      error instanceof DeliveryArtWorkSessionServiceError &&
      error.code === "delivery_art_work_session_caller_mismatch" &&
      error.statusCode === 403,
  );
});

test("work-session API service fails closed when the source executor is unavailable", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "oos-work-session-unavailable-"));
  const service = createHarness(createStore(root), { available: false });

  await assert.rejects(
    service.read({ callerId: "operator:workspace-owner", workItemId: "1024" }),
    (error) =>
      error instanceof DeliveryArtWorkSessionServiceError &&
      error.code === "delivery_art_work_session_executor_unavailable" &&
      error.statusCode === 503,
  );
});

test("work-session execution failures are bounded and replay without another action", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "oos-work-session-failure-"));
  const store = createStore(root);
  store.writeSession(session());
  let attempts = 0;
  const controller = {
    async start() {},
    async status() {},
    async continue() {
      attempts += 1;
      const error = new Error("The source executor rejected the observation.");
      error.code = "delivery_art_work_session_source_observation_invalid";
      throw error;
    },
    async close() {},
  };
  const service = createDeliveryArtWorkSessionService({ controller, store });
  const input = {
    action: "continue",
    callerId: "operator:workspace-owner",
    command: {
      command_id: "work-session-command:continue-failure-1",
      expected_session_revision: "2026-08-27T01:00:00.000Z",
    },
    workItemId: "1024",
  };

  for (let index = 0; index < 2; index += 1) {
    await assert.rejects(
      service.execute(input),
      (error) =>
        error instanceof DeliveryArtWorkSessionServiceError &&
        error.code === "delivery_art_work_session_source_observation_invalid" &&
        error.statusCode === 400,
    );
  }
  assert.equal(attempts, 1);
});

test("work-session mutations serialize revision checks per work item", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "oos-work-session-concurrent-"));
  const store = createStore(root);
  store.writeSession(session());
  let release;
  const blocked = new Promise((resolve) => {
    release = resolve;
  });
  let entered = false;
  const controller = {
    async start() {},
    async status() {},
    async continue() {
      entered = true;
      await blocked;
      return result(session("2026-08-27T01:01:00.000Z"));
    },
    async close() {},
  };
  const service = createDeliveryArtWorkSessionService({ controller, store });
  const command = (id) => ({
    action: "continue",
    callerId: "operator:workspace-owner",
    command: {
      command_id: `work-session-command:${id}`,
      expected_session_revision: "2026-08-27T01:00:00.000Z",
    },
    workItemId: "1024",
  });

  const first = service.execute(command("continue-concurrent-1"));
  while (!entered) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  await assert.rejects(
    service.execute(command("continue-concurrent-2")),
    (error) => error.code === "delivery_art_work_session_locked",
  );
  release();
  await first;
});
