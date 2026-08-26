import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { createDeliveryArtWorkSessionController } from "../src/delivery-art/work-session-controller.js";
import {
  createDeliveryArtWorkSession,
  createDeliveryArtWorkSessionDecisionDraft,
  deliveryArtWorkNextAction,
  validateDeliveryArtWorkSession,
  validateDeliveryArtWorkSessionDecision,
} from "../src/delivery-art/work-session.js";
import {
  validateDeliveryArtWorkSessionCleanupReceipt,
  validateDeliveryArtWorkSessionResourceManifest,
} from "../src/delivery-art/work-session-resource-retirement.js";
import { artifactContentDigest } from "../src/delivery-art/contracts.js";
import {
  createDeliveryArtWorkSessionStore,
  deliveryArtWorkStateRoot,
  DeliveryArtWorkSessionStoreError,
} from "../src/delivery-art/work-session-store.js";

function continuation(workItemId = "work-item-963", status = "in-progress") {
  const id = Number.parseInt(workItemId.slice("work-item-".length), 10);
  return {
    delivery_id: "delivery-958",
    work_item_id: workItemId,
    continuation_context: {
      target_item: {
        blocked: false,
        dependency_blocked: false,
        id,
        owner_repo: "operator-orchestration-service",
        status,
        target_pi: "PI-2026-03",
      },
    },
  };
}

function acceptedDecision(workItemIds = ["work-item-963"]) {
  return {
    schema_version: 1,
    artifact_type: "delivery_art_work_session_decision",
    work_item_id: workItemIds[0],
    covered_work_item_ids: workItemIds,
    operator: {
      id: "operator:workspace-owner",
      decision_source: "operator",
    },
    landing_unit: {
      id: "delivery-958-work-item-963",
      decision: "child_isolated_landing_unit",
      split_reason: "OOS implementation and rollback are isolated from the contract owners.",
      base_ref: "origin/main",
      branch: "feature/963-resumable-delivery-art-work-lifecycle",
      rollback_boundary: "Revert the OOS source PR without changing ART or WGCF authority.",
    },
    architecture: {
      required: false,
      artifact_location: null,
    },
    human_gate_work_item_ids: {
      security_acceptance: ["work-item-962"],
    },
  };
}

function createStore(root) {
  return createDeliveryArtWorkSessionStore({
    root,
    validateCleanupReceipt: validateDeliveryArtWorkSessionCleanupReceipt,
    validateDecision: validateDeliveryArtWorkSessionDecision,
    validateResourceManifest: validateDeliveryArtWorkSessionResourceManifest,
    validateSession: validateDeliveryArtWorkSession,
  });
}

function createHarness(
  root,
  {
    covered = ["work-item-963"],
    ownedResource = false,
    retirementActive = false,
    retirementPreparationFailures = 0,
    retirementFailures = 0,
  } = {},
) {
  const store = createStore(root);
  let repoRoot = null;
  let targetStatus = "in-progress";
  let resourceRetired = false;
  let pullRequest = {
    state: "merged",
    head_commit: "a".repeat(40),
    merge_commit: "b".repeat(40),
    url: "https://example.test/pr/1",
  };
  let remainingRetirementFailures = retirementFailures;
  let remainingPreparationFailures = retirementPreparationFailures;
  let retirementExecutionPrepared = false;
  let projection = {
    complete: false,
    gate: "source-work",
    next_action: null,
    state: "source-work-required",
    summary: "Source implementation remains a human-owned gate.",
  };
  const lifecycleController = {
    async inspect(plan) {
      return {
        facts: { source: "pushed" },
        paths: plan.artifacts,
        plan,
        projection,
        pull_request: { state: "missing", url: null },
        source: { state: "pushed" },
      };
    },
    async reconcile(plan) {
      return this.inspect(plan);
    },
  };
  const artifactAdapter = {
    async draftWorkStart() {
      return {
        artifact_type: "delivery_art_work_start_record",
        custody: { state: "local-draft" },
        readiness: { level: "draft" },
      };
    },
    async evaluateWorkStart(artifact) {
      return {
        ...artifact,
        custody: { state: "durable" },
        readiness: { level: "implementation-ready" },
      };
    },
    async persistArchitecture({ artifact }) {
      return artifact;
    },
    async statuses(ids) {
      return ids.map((id) =>
        id === "work-item-970" && !retirementActive ? "new" : "done");
    },
  };
  const sourceAdapter = {
    async ensureOwnedWorktree() {
      repoRoot = "/tmp/reconstructed-oos-worktree";
      const provenance = ownedResource ? "session-created" : "ambiguous";
      const retention = ownedResource
        ? "retire-on-terminal-close"
        : "policy-retained";
      const ownershipMarker =
        "work-session:delivery-958:delivery-958-work-item-963";
      return {
        path: repoRoot,
        resources: [
          {
            resource_id: "resource:worktree:operator-orchestration-service",
            resource_type: "git-worktree",
            ownership_provenance: provenance,
            retention_class: retention,
            outcome: "pending",
            locator: {
              kind: "worktree",
              repo: "operator-orchestration-service",
              workspace_relative_path: ".worktrees/delivery-958-work-item-963/operator-orchestration-service",
              expected_head_commit: "a".repeat(40),
              ownership_marker: ownershipMarker,
            },
            last_error: null,
          },
          {
            resource_id: "resource:local-branch:operator-orchestration-service",
            resource_type: "git-local-branch",
            ownership_provenance: provenance,
            retention_class: retention,
            outcome: "pending",
            locator: {
              kind: "local-branch",
              repo: "operator-orchestration-service",
              branch: "feature/963-resumable-delivery-art-work-lifecycle",
              base_ref: "origin/main",
              expected_head_commit: "a".repeat(40),
              ownership_marker: ownershipMarker,
            },
            last_error: null,
          },
          {
            resource_id: "resource:remote-branch:operator-orchestration-service",
            resource_type: "git-remote-branch",
            ownership_provenance: provenance,
            retention_class: retention,
            outcome: "pending",
            locator: {
              kind: "remote-branch",
              repo: "operator-orchestration-service",
              remote: "origin",
              branch: "feature/963-resumable-delivery-art-work-lifecycle",
              expected_head_commit: "a".repeat(40),
              pull_request_ref: `pending:${ownershipMarker}`,
              ownership_marker: ownershipMarker,
            },
            last_error: null,
          },
        ],
      };
    },
    async ensureWorktree() {
      repoRoot = "/tmp/reconstructed-oos-worktree";
      return repoRoot;
    },
    async inspectPullRequest() {
      return structuredClone(pullRequest);
    },
    async inspectResourceOwnership(session) {
      return this.ensureOwnedWorktree(session);
    },
    async planResourceRetirement({ manifest }) {
      assert.equal(retirementExecutionPrepared, true);
      return manifest.resources.map((resource) => ({
        ...resource,
        last_error: null,
        outcome: ownedResource
          ? resourceRetired
            ? "removed"
            : "eligible"
          : "retained",
      }));
    },
    async readArtifact() {
      throw new Error("architecture is not required in this harness");
    },
    async prepareResourceRetirementExecution() {
      if (remainingPreparationFailures > 0) {
        remainingPreparationFailures -= 1;
        throw new Error("simulated cleanup execution handoff failure");
      }
      retirementExecutionPrepared = true;
    },
    async resolveBase() {
      return { commit: "a".repeat(40) };
    },
    async resolveWorktree() {
      return repoRoot;
    },
    async retireResource() {
      if (remainingRetirementFailures > 0) {
        remainingRetirementFailures -= 1;
        throw new Error("simulated resource deletion failure");
      }
      resourceRetired = true;
    },
  };
  const contextAdapter = {
    async continuation(workItemId) {
      return continuation(workItemId, targetStatus);
    },
  };
  const closeAdapter = {
    async close() {
      targetStatus = "done";
      return { complete: true };
    },
  };
  const controller = createDeliveryArtWorkSessionController({
    artifactAdapter,
    closeAdapter,
    contextAdapter,
    lifecycleController,
    resourceRetirementCapability: {
      activation_work_item_id: "work-item-970",
      normal_path: true,
      state: "human-gated",
    },
    sourceAdapter,
    store,
  });
  return {
    controller,
    relocate(value) {
      repoRoot = value;
    },
    setPullRequest(value) {
      pullRequest = structuredClone(value);
    },
    setProjection(value) {
      projection = value;
      if (value.gate === "art-closeout") {
        const session = store.readByAlias(covered[0]);
        const reviewPacket = {
          status: "finalized",
          artifact_type: "art_review_packet",
          delivery_id: session.delivery_id,
          covered_work_item_ids: session.covered_work_item_ids,
          operator: structuredClone(session.operator),
          landing_unit: {
            decision: session.landing_unit.decision,
            evidence_kind: "merged_pr",
            rollback_boundary: session.landing_unit.rollback_boundary,
            repos: [
              {
                repo_name: session.owner_repo,
                branch: session.landing_unit.branch,
                base_ref: session.landing_unit.base_ref,
                pr_url: pullRequest.url,
                head_commit: pullRequest.head_commit,
                merge_commit: pullRequest.merge_commit,
              },
            ],
          },
          integrity: { content_digest: null },
          custody: {
            state: "durable",
            backend: "wgcf-artifact-registry",
            uri: null,
          },
        };
        reviewPacket.integrity.content_digest = artifactContentDigest(reviewPacket);
        reviewPacket.custody.uri =
          `wgcf://artifacts/delivery-art/sha256/${reviewPacket.integrity.content_digest.slice("sha256:".length)}`;
        store.writeArtifact(
          session,
          session.artifacts.review_packet_file,
          reviewPacket,
        );
      }
    },
    store,
    workItemIds: covered,
  };
}

test("decision drafts stop before source work and accepted decisions are explicit", () => {
  const draft = createDeliveryArtWorkSessionDecisionDraft({
    continuation: continuation(),
  });
  assert.equal(
    validateDeliveryArtWorkSessionDecision(draft, { allowIncomplete: true }).valid,
    true,
  );
  assert.equal(validateDeliveryArtWorkSessionDecision(draft).valid, false);
  assert.match(draft.landing_unit.split_reason, /^REQUIRED:/);
  assert.equal(draft.architecture.required, null);
  assert.equal(validateDeliveryArtWorkSessionDecision(acceptedDecision()).valid, true);
});

test("work-session state rejects absolute paths and secret-shaped fields", async () => {
  assert.equal(
    deliveryArtWorkStateRoot({ HOME: "/home/operator" }),
    "/home/operator/.local/state/operator-orchestration-service/delivery-art/work",
  );
  const root = await mkdtemp(path.join(tmpdir(), "oos-work-state-"));
  const store = createStore(root);
  const session = createDeliveryArtWorkSession({
    architectureFile: null,
    baseCommit: "a".repeat(40),
    continuation: continuation(),
    decision: acceptedDecision(),
  });
  assert.throws(
    () => store.writeSession({ ...session, owner_repo: "/tmp/repo" }),
    (error) =>
      error instanceof DeliveryArtWorkSessionStoreError &&
      error.code === "delivery_art_work_session_state_invalid",
  );
  store.writeSession(session);
  const sessionDirectory = path.join(
    root,
    "sessions",
    encodeURIComponent(session.session_id),
  );
  assert.equal((await stat(sessionDirectory)).mode & 0o777, 0o700);
  assert.equal(
    (await stat(path.join(sessionDirectory, "session.json"))).mode & 0o777,
    0o600,
  );
  assert.throws(
    () => store.writeSession({ ...session, api_token: "not-allowed" }),
    (error) =>
      error instanceof DeliveryArtWorkSessionStoreError &&
      error.code === "delivery_art_work_session_state_invalid",
  );
});

test("schema-v1 session state gains the resource manifest path on read", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "oos-work-session-migrate-"));
  const store = createStore(root);
  const session = createDeliveryArtWorkSession({
    architectureFile: null,
    baseCommit: "a".repeat(40),
    continuation: continuation(),
    decision: acceptedDecision(),
  });
  const persisted = structuredClone(session);
  delete persisted.artifacts.resource_manifest_file;
  const sessionDirectory = path.join(
    root,
    "sessions",
    encodeURIComponent(session.session_id),
  );
  await mkdir(sessionDirectory, { recursive: true });
  await writeFile(
    path.join(sessionDirectory, "session.json"),
    `${JSON.stringify(persisted, null, 2)}\n`,
    "utf8",
  );

  const restored = store.readBySessionId(session.session_id);

  assert.equal(
    restored.artifacts.resource_manifest_file,
    "resource-manifest.json",
  );
  assert.equal(validateDeliveryArtWorkSession(restored).valid, true);
});

test("work start, restart, relocation, and continue preserve one reconstructable session", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "oos-work-controller-"));
  const first = createHarness(root);
  const decisionRequired = await first.controller.start("963");
  assert.equal(decisionRequired.state, "decision-required");
  assert.equal(decisionRequired.next_action.code, "landing-unit-decision-required");

  const decisionPath = first.store.decisionPath("work-item-963");
  await writeFile(decisionPath, `${JSON.stringify(acceptedDecision(), null, 2)}\n`);
  const started = await first.controller.start("963", { decisionPath });
  assert.equal(started.state, "implementation-ready");
  assert.equal(started.next_action.code, "source-worktree-required");

  const persisted = first.store.readByAlias("work-item-963");
  const persistedText = await readFile(
    path.join(root, "sessions", encodeURIComponent(persisted.session_id), "session.json"),
    "utf8",
  );
  assert.equal(persistedText.includes("/tmp/reconstructed-oos-worktree"), false);

  const restarted = createHarness(root);
  restarted.relocate("/tmp/relocated-oos-worktree");
  const resumed = await restarted.controller.status("963");
  assert.equal(resumed.state, "source-work");
  assert.equal(resumed.next_action.code, "source-work-required");
  assert.match(resumed.next_action.command, /relocated-oos-worktree/);
  assert.equal(Object.hasOwn(resumed.projection, "next_action"), false);

  restarted.relocate(null);
  const continued = await restarted.controller.continue("963");
  assert.equal(continued.state, "source-work");
  assert.equal(restarted.store.readByAlias("delivery-958-work-item-963").session_id, persisted.session_id);
});

test("work start accepts an API decision object and binds decision drafts to the caller", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "oos-work-controller-api-"));
  const harness = createHarness(root);
  const drafted = await harness.controller.start("963", {
    operatorId: "operator:console-user",
  });

  assert.equal(drafted.decision_draft.operator.id, "operator:console-user");
  assert.equal(drafted.session_revision, null);
  const accepted = acceptedDecision();
  accepted.operator.id = "operator:console-user";
  const started = await harness.controller.start("963", {
    decision: accepted,
  });

  assert.equal(started.state, "implementation-ready");
  assert.equal(typeof started.session_revision, "string");
  assert.equal(
    harness.store.readByAlias("work-item-963").operator.id,
    "operator:console-user",
  );
});

test("one Landing Unit can be resumed from every covered work-item alias", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "oos-work-multi-"));
  const harness = createHarness(root, {
    covered: ["work-item-963", "work-item-965"],
  });
  await harness.controller.start("963");
  const decisionPath = harness.store.decisionPath("work-item-963");
  await writeFile(
    decisionPath,
    `${JSON.stringify(acceptedDecision(["work-item-963", "work-item-965"]), null, 2)}\n`,
  );
  await harness.controller.start("963", { decisionPath });
  assert.equal(
    harness.store.readByAlias("work-item-965").landing_unit_id,
    "delivery-958-work-item-963",
  );
});

test("distinct valid Landing Unit ids retain distinct persisted session identities", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "oos-work-session-identity-"));
  const store = createStore(root);
  const firstDecision = {
    ...acceptedDecision(),
    landing_unit: {
      ...acceptedDecision().landing_unit,
      id: "delivery-958-unit:one",
    },
  };
  const secondDecision = {
    ...acceptedDecision(["work-item-965"]),
    landing_unit: {
      ...acceptedDecision(["work-item-965"]).landing_unit,
      id: "delivery-958-unit-one",
    },
  };
  const first = createDeliveryArtWorkSession({
    architectureFile: null,
    baseCommit: "a".repeat(40),
    continuation: continuation(),
    decision: firstDecision,
  });
  const second = createDeliveryArtWorkSession({
    architectureFile: null,
    baseCommit: "a".repeat(40),
    continuation: continuation("work-item-965"),
    decision: secondDecision,
  });

  store.writeSession(first);
  store.writeSession(second);

  assert.notEqual(first.session_id, second.session_id);
  assert.equal(store.readBySessionId(first.session_id).landing_unit_id, firstDecision.landing_unit.id);
  assert.equal(store.readBySessionId(second.session_id).landing_unit_id, secondDecision.landing_unit.id);
});

test("concurrent starts through different aliases execute one Landing Unit", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "oos-work-duplicate-"));
  const harness = createHarness(root, {
    covered: ["work-item-963", "work-item-965"],
  });
  await harness.controller.start("963");
  await harness.controller.start("965");
  const firstPath = harness.store.decisionPath("work-item-963");
  const secondPath = harness.store.decisionPath("work-item-965");
  await writeFile(
    firstPath,
    `${JSON.stringify(acceptedDecision(["work-item-963", "work-item-965"]), null, 2)}\n`,
  );
  await writeFile(
    secondPath,
    `${JSON.stringify(acceptedDecision(["work-item-965", "work-item-963"]), null, 2)}\n`,
  );
  const results = await Promise.allSettled([
    harness.controller.start("963", { decisionPath: firstPath }),
    harness.controller.start("965", { decisionPath: secondPath }),
  ]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  const rejected = results.find((result) => result.status === "rejected");
  assert.equal(rejected.reason.code, "delivery_art_work_session_locked");
  assert.equal(
    harness.store.readByAlias("work-item-963").session_id,
    harness.store.readByAlias("work-item-965").session_id,
  );
});

test("concurrent continuation through covered aliases serializes one session", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "oos-work-continue-alias-"));
  const harness = createHarness(root, {
    covered: ["work-item-963", "work-item-965"],
  });
  await harness.controller.start("963");
  const decisionPath = harness.store.decisionPath("work-item-963");
  await writeFile(
    decisionPath,
    `${JSON.stringify(acceptedDecision(["work-item-963", "work-item-965"]), null, 2)}\n`,
  );
  await harness.controller.start("963", { decisionPath });
  harness.relocate("/tmp/oos-worktree");

  const results = await Promise.allSettled([
    harness.controller.continue("963"),
    harness.controller.continue("965"),
  ]);

  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  const rejected = results.find((result) => result.status === "rejected");
  assert.equal(rejected.reason.code, "delivery_art_work_session_locked");
});

test("conflicting concurrent Landing Unit ids cannot create overlapping sessions", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "oos-work-overlap-"));
  const harness = createHarness(root, {
    covered: ["work-item-963", "work-item-965"],
  });
  await harness.controller.start("963");
  await harness.controller.start("965");
  const firstPath = harness.store.decisionPath("work-item-963");
  const secondPath = harness.store.decisionPath("work-item-965");
  const firstDecision = acceptedDecision(["work-item-963", "work-item-965"]);
  const secondDecision = {
    ...acceptedDecision(["work-item-965", "work-item-963"]),
    landing_unit: {
      ...acceptedDecision(["work-item-965", "work-item-963"]).landing_unit,
      id: "delivery-958-conflicting-unit",
    },
  };
  await writeFile(firstPath, `${JSON.stringify(firstDecision, null, 2)}\n`);
  await writeFile(secondPath, `${JSON.stringify(secondDecision, null, 2)}\n`);

  await Promise.allSettled([
    harness.controller.start("963", { decisionPath: firstPath }),
    harness.controller.start("965", { decisionPath: secondPath }),
  ]);

  const sessions = await readdir(path.join(root, "sessions"));
  assert.equal(sessions.length, 1);
  assert.equal(
    harness.store.readByAlias("work-item-963").session_id,
    harness.store.readByAlias("work-item-965").session_id,
  );
});

test("valid identifier names do not collide with inherited object properties", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "oos-work-alias-name-"));
  const store = createStore(root);
  const decision = {
    ...acceptedDecision(),
    landing_unit: {
      ...acceptedDecision().landing_unit,
      id: "constructor",
    },
  };
  const session = createDeliveryArtWorkSession({
    architectureFile: null,
    baseCommit: "a".repeat(40),
    continuation: continuation(),
    decision,
  });

  store.writeSession(session);

  assert.equal(store.readByAlias("constructor").session_id, session.session_id);
});

test("ambiguous aliases and concurrent mutations fail closed", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "oos-work-ambiguous-"));
  const store = createStore(root);
  const first = createDeliveryArtWorkSession({
    architectureFile: null,
    baseCommit: "a".repeat(40),
    continuation: continuation(),
    decision: acceptedDecision(),
  });
  store.writeSession(first);
  const second = {
    ...first,
    session_id: "work-session:delivery-958:delivery-958-work-item-963-second",
    landing_unit_id: "delivery-958-work-item-963-second",
    aliases: ["delivery-958-work-item-963-second", "work-item-963"],
  };
  store.writeSession(second);
  assert.throws(
    () => store.readByAlias("work-item-963"),
    (error) =>
      error instanceof DeliveryArtWorkSessionStoreError &&
      error.code === "delivery_art_work_session_alias_ambiguous",
  );
  await store.withLock("work-item-965", async () => {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await assert.rejects(
        () => store.withLock("work-item-965", async () => null),
        (error) =>
          error instanceof DeliveryArtWorkSessionStoreError &&
          error.code === "delivery_art_work_session_locked",
      );
    }
  });
});

test("corrupt coordination state and missing durable artifacts fail closed", async () => {
  const corruptRoot = await mkdtemp(path.join(tmpdir(), "oos-work-corrupt-"));
  const corruptStore = createStore(corruptRoot);
  const corruptSession = createDeliveryArtWorkSession({
    architectureFile: null,
    baseCommit: "a".repeat(40),
    continuation: continuation(),
    decision: acceptedDecision(),
  });
  corruptStore.writeSession(corruptSession);
  await writeFile(
    path.join(
      corruptRoot,
      "sessions",
      encodeURIComponent(corruptSession.session_id),
      "session.json",
    ),
    "{not-json\n",
  );
  assert.throws(
    () => corruptStore.readByAlias("work-item-963"),
    (error) =>
      error instanceof DeliveryArtWorkSessionStoreError &&
      error.code === "delivery_art_work_session_state_corrupt",
  );

  const missingRoot = await mkdtemp(path.join(tmpdir(), "oos-work-missing-"));
  const harness = createHarness(missingRoot);
  await harness.controller.start("963");
  const decisionPath = harness.store.decisionPath("work-item-963");
  await writeFile(decisionPath, `${JSON.stringify(acceptedDecision(), null, 2)}\n`);
  await harness.controller.start("963", { decisionPath });
  const session = harness.store.readByAlias("work-item-963");
  await rm(
    harness.store.artifactPath(session, session.artifacts.work_start_file),
  );
  await assert.rejects(
    () => harness.controller.status("963"),
    (error) =>
      error.code === "delivery_art_work_session_artifact_missing" &&
      error.details.artifact === "work-start",
  );
});

test("a torn alias index does not hide a durable session", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "oos-work-index-recovery-"));
  const store = createStore(root);
  const session = createDeliveryArtWorkSession({
    architectureFile: null,
    baseCommit: "a".repeat(40),
    continuation: continuation(),
    decision: acceptedDecision(),
  });
  store.writeSession(session);
  await writeFile(
    path.join(root, "index.json"),
    `${JSON.stringify({ aliases: {}, schema_version: 1 }, null, 2)}\n`,
  );
  assert.equal(store.readByAlias("work-item-963").session_id, session.session_id);
});

test("Security acceptance overrides merge until its recorded ART item closes", () => {
  const session = createDeliveryArtWorkSession({
    architectureFile: null,
    baseCommit: "a".repeat(40),
    continuation: continuation(),
    decision: acceptedDecision(),
  });
  const action = deliveryArtWorkNextAction({
    artifactPaths: { evidence: "/tmp/evidence.json" },
    context: {
      projection: {
        complete: false,
        gate: "source-merge",
        next_action: null,
        state: "source-merge-approval-required",
        summary: "Source is merge-ready.",
      },
      pull_request: { state: "open", url: "https://example.test/pr/1" },
      repo_root: "/tmp/repo",
      session,
    },
    securityStatuses: ["in-progress"],
    workItemId: "work-item-963",
  });
  assert.equal(action.code, "security-acceptance-required");
  assert.match(action.command, /item continuation work-item-962/);
});

test("explicit closeout retires local coordination only after ART close succeeds", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "oos-work-close-"));
  const harness = createHarness(root);
  await harness.controller.start("963");
  const decisionPath = harness.store.decisionPath("work-item-963");
  await writeFile(decisionPath, `${JSON.stringify(acceptedDecision(), null, 2)}\n`);
  await harness.controller.start("963", { decisionPath });
  await assert.rejects(
    () => harness.controller.close("963"),
    (error) => error.code === "delivery_art_work_session_closeout_not_ready",
  );
  assert.notEqual(harness.store.readByAlias("work-item-963"), null);
  harness.relocate("/tmp/oos-worktree");
  harness.setProjection({
    complete: false,
    gate: "art-closeout",
    next_action: null,
    state: "art-closeout-approval-required",
    summary: "Finalized evidence is ready for explicit ART closeout.",
  });
  const closed = await harness.controller.close("963");
  assert.equal(closed.state, "closed", JSON.stringify(closed, null, 2));
  assert.equal(harness.store.readByAlias("work-item-963"), null);
});

test("activated close retains ambiguous resources and replays one terminal receipt", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "oos-work-cleanup-receipt-"));
  const harness = createHarness(root, { retirementActive: true });
  await harness.controller.start("963");
  const decisionPath = harness.store.decisionPath("work-item-963");
  await writeFile(decisionPath, `${JSON.stringify(acceptedDecision(), null, 2)}\n`);
  await harness.controller.start("963", { decisionPath });
  harness.relocate("/tmp/oos-worktree");
  harness.setProjection({
    complete: false,
    gate: "art-closeout",
    next_action: null,
    state: "art-closeout-approval-required",
    summary: "Finalized evidence is ready for explicit ART closeout.",
  });

  const closed = await harness.controller.close("963");
  assert.equal(closed.state, "closed");
  assert.equal(
    closed.cleanup_receipt.outcome,
    "complete-with-retained-resources",
  );
  assert.equal(closed.cleanup_receipt.resources[0].outcome, "retained");
  const retainedManifest = harness.store.readCleanupManifestBySessionId(
    "work-session:delivery-958:delivery-958-work-item-963",
  );
  assert.equal(retainedManifest.cleanup.state, "complete");
  assert.equal(
    closed.cleanup_receipt.manifest.content_digest,
    artifactContentDigest(retainedManifest),
  );
  assert.equal(harness.store.readByAlias("work-item-963"), null);

  const replay = await harness.controller.close("963");
  assert.deepEqual(replay.cleanup_receipt, closed.cleanup_receipt);
});

test("partial cleanup failure remains retryable from cleanup-blocked", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "oos-work-cleanup-retry-"));
  const harness = createHarness(root, {
    ownedResource: true,
    retirementActive: true,
    retirementFailures: 1,
  });
  await harness.controller.start("963");
  const decisionPath = harness.store.decisionPath("work-item-963");
  await writeFile(decisionPath, `${JSON.stringify(acceptedDecision(), null, 2)}\n`);
  await harness.controller.start("963", { decisionPath });
  await harness.controller.continue("963");
  harness.setProjection({
    complete: false,
    gate: "art-closeout",
    next_action: null,
    state: "art-closeout-approval-required",
    summary: "Finalized evidence is ready for explicit ART closeout.",
  });

  const blocked = await harness.controller.close("963");
  assert.equal(blocked.state, "cleanup-blocked");
  assert.equal(blocked.next_action.code, "cleanup-retry-required");
  assert.equal(blocked.cleanup.resources[0].outcome, "blocked");
  assert.notEqual(harness.store.readByAlias("work-item-963"), null);

  const closed = await harness.controller.close("963");
  assert.equal(closed.state, "closed", JSON.stringify(closed, null, 2));
  assert.equal(closed.cleanup_receipt.outcome, "complete");
  assert.equal(closed.cleanup_receipt.resources[0].outcome, "removed");
  assert.equal(harness.store.readByAlias("work-item-963"), null);
});

test("cleanup execution handoff failure blocks before deletion and remains retryable", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "oos-work-cleanup-handoff-retry-"));
  const harness = createHarness(root, {
    ownedResource: true,
    retirementActive: true,
    retirementPreparationFailures: 1,
  });
  await harness.controller.start("963");
  const decisionPath = harness.store.decisionPath("work-item-963");
  await writeFile(decisionPath, `${JSON.stringify(acceptedDecision(), null, 2)}\n`);
  await harness.controller.start("963", { decisionPath });
  await harness.controller.continue("963");
  harness.setProjection({
    complete: false,
    gate: "art-closeout",
    next_action: null,
    state: "art-closeout-approval-required",
    summary: "Finalized evidence is ready for explicit ART closeout.",
  });

  const blocked = await harness.controller.close("963");
  assert.equal(blocked.state, "cleanup-blocked");
  assert.equal(blocked.next_action.code, "cleanup-retry-required");
  assert.equal(
    blocked.cleanup.resources.every((resource) => resource.outcome === "blocked"),
    true,
  );
  assert.match(
    blocked.cleanup.resources[0].last_error,
    /execution handoff failed/,
  );

  const closed = await harness.controller.close("963");
  assert.equal(closed.state, "closed", JSON.stringify(closed, null, 2));
  assert.equal(closed.cleanup_receipt.outcome, "complete");
});

test("resource retirement blocks when current PR truth differs from finalized evidence", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "oos-work-cleanup-source-binding-"));
  const harness = createHarness(root, {
    ownedResource: true,
    retirementActive: true,
  });
  await harness.controller.start("963");
  const decisionPath = harness.store.decisionPath("work-item-963");
  await writeFile(decisionPath, `${JSON.stringify(acceptedDecision(), null, 2)}\n`);
  await harness.controller.start("963", { decisionPath });
  await harness.controller.continue("963");
  harness.setProjection({
    complete: false,
    gate: "art-closeout",
    next_action: null,
    state: "art-closeout-approval-required",
    summary: "Finalized evidence is ready for explicit ART closeout.",
  });
  harness.setPullRequest({
    state: "merged",
    head_commit: "c".repeat(40),
    merge_commit: "d".repeat(40),
    url: "https://example.test/pr/2",
  });

  const blocked = await harness.controller.close("963");

  assert.equal(blocked.state, "cleanup-blocked");
  assert.equal(blocked.next_action.code, "cleanup-retry-required");
  assert.equal(
    blocked.cleanup.resources.every((resource) => resource.outcome === "blocked"),
    true,
  );
  assert.match(blocked.cleanup.resources[0].last_error, /current=https:\/\/example\.test\/pr\/2/);
  assert.notEqual(harness.store.readByAlias("work-item-963"), null);
});

test("resource retirement rejects a locally modified finalized Review Packet", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "oos-work-cleanup-packet-integrity-"));
  const harness = createHarness(root, {
    ownedResource: true,
    retirementActive: true,
  });
  await harness.controller.start("963");
  const decisionPath = harness.store.decisionPath("work-item-963");
  await writeFile(decisionPath, `${JSON.stringify(acceptedDecision(), null, 2)}\n`);
  await harness.controller.start("963", { decisionPath });
  await harness.controller.continue("963");
  harness.setProjection({
    complete: false,
    gate: "art-closeout",
    next_action: null,
    state: "art-closeout-approval-required",
    summary: "Finalized evidence is ready for explicit ART closeout.",
  });
  const session = harness.store.readByAlias("work-item-963");
  const packet = harness.store.readArtifact(
    session,
    session.artifacts.review_packet_file,
  );
  packet.landing_unit.repos[0].pr_url = "https://example.test/pr/2";
  harness.store.writeArtifact(session, session.artifacts.review_packet_file, packet);
  harness.setPullRequest({
    state: "merged",
    head_commit: "a".repeat(40),
    merge_commit: "b".repeat(40),
    url: "https://example.test/pr/2",
  });

  const blocked = await harness.controller.close("963");

  assert.equal(blocked.state, "cleanup-blocked");
  assert.match(
    blocked.cleanup.resources[0].last_error,
    /integrity or WGCF custody binding is invalid/,
  );
});

test("resource manifests cannot redirect cleanup outside the Landing Unit", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "oos-work-cleanup-binding-"));
  const harness = createHarness(root, { ownedResource: true });
  await harness.controller.start("963");
  const decisionPath = harness.store.decisionPath("work-item-963");
  await writeFile(decisionPath, `${JSON.stringify(acceptedDecision(), null, 2)}\n`);
  await harness.controller.start("963", { decisionPath });
  await harness.controller.continue("963");
  const session = harness.store.readByAlias("work-item-963");
  const manifest = harness.store.readResourceManifest(session);

  for (const mutate of [
    (candidate) => {
      candidate.resources[0].locator.repo = "workspace-governance";
    },
    (candidate) => {
      candidate.resources[1].locator.branch = "feature/unowned";
    },
    (candidate) => {
      candidate.resources[2].locator.remote = "untrusted";
    },
  ]) {
    const candidate = structuredClone(manifest);
    mutate(candidate);
    assert.throws(
      () => harness.store.writeResourceManifest(session, candidate),
      (error) =>
        error instanceof DeliveryArtWorkSessionStoreError &&
        error.code === "delivery_art_work_session_resource_manifest_mismatch",
    );
  }
});
