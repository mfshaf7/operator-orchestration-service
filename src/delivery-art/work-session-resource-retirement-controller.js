import {
  completeDeliveryArtWorkSessionCleanup,
  createDeliveryArtWorkSessionCleanupReceipt,
  createDeliveryArtWorkSessionResourceManifest,
  prepareDeliveryArtWorkSessionCleanup,
  recordDeliveryArtWorkSessionCleanupFailure,
  recordDeliveryArtWorkSessionResourceOutcome,
  startDeliveryArtWorkSessionCleanup,
} from "./work-session-resource-retirement.js";
import { artifactContentDigest } from "./contracts.js";

function assertAdapter(adapter, methods, name) {
  for (const method of methods) {
    if (typeof adapter?.[method] !== "function") {
      throw new Error(`${name}.${method} is required`);
    }
  }
}

export function createDeliveryArtWorkSessionResourceRetirementController({
  clock = () => new Date(),
  sourceAdapter,
  store,
} = {}) {
  assertAdapter(sourceAdapter, [
    "ensureOwnedWorktree",
    "inspectResourceOwnership",
    "planResourceRetirement",
    "prepareResourceRetirementExecution",
    "resolveWorktree",
    "retireResource",
  ], "sourceAdapter");
  assertAdapter(store, [
    "inspectManagedResource",
    "readArtifact",
    "readCleanupReceiptByAlias",
    "readCleanupReceiptBySessionId",
    "readResourceManifest",
    "removeSession",
    "retireManagedResource",
    "writeCleanupManifest",
    "writeCleanupReceipt",
    "writeResourceManifest",
    "writeSession",
  ], "store");

  function protectedEvidenceRefs(session) {
    const refs = session.covered_work_item_ids.map((workItemId) =>
      `openproject://work_packages/${workItemId.slice("work-item-".length)}`);
    const architecture = session.architecture.artifact_file
      ? store.readArtifact(session, session.architecture.artifact_file)
      : null;
    const reviewPacket = store.readArtifact(
      session,
      session.artifacts.review_packet_file,
    );
    for (const value of [
      architecture?.custody?.uri,
      reviewPacket?.custody?.uri,
      reviewPacket?.source_snapshot?.repos?.[0]?.revision
        ? `git://${session.owner_repo}/commit/${reviewPacket.source_snapshot.repos[0].revision}`
        : null,
    ]) {
      if (value) {
        refs.push(value);
      }
    }
    return refs;
  }

  function updateSessionState(session, state) {
    const updated = {
      ...session,
      state,
      updated_at: clock().toISOString(),
    };
    store.writeSession(updated);
    return updated;
  }

  function sourceBindingError(session, pullRequest) {
    const reviewPacket = store.readArtifact(
      session,
      session.artifacts.review_packet_file,
    );
    const source = reviewPacket?.landing_unit?.repos?.find(
      (entry) => entry.repo_name === session.owner_repo,
    );
    const expectedDigest = reviewPacket
      ? artifactContentDigest(reviewPacket)
      : null;
    if (
      reviewPacket?.status !== "finalized" ||
      reviewPacket?.custody?.state !== "durable" ||
      reviewPacket?.custody?.backend !== "wgcf-artifact-registry" ||
      reviewPacket?.landing_unit?.evidence_kind !== "merged_pr" ||
      !source
    ) {
      return "resource retirement requires one durable finalized merged-PR Review Packet";
    }
    if (
      reviewPacket.integrity?.content_digest !== expectedDigest ||
      reviewPacket.custody.uri !==
        `wgcf://artifacts/delivery-art/sha256/${expectedDigest.slice("sha256:".length)}`
    ) {
      return "finalized Review Packet integrity or WGCF custody binding is invalid";
    }
    if (
      reviewPacket.delivery_id !== session.delivery_id ||
      reviewPacket.operator?.id !== session.operator.id ||
      reviewPacket.landing_unit?.decision !== session.landing_unit.decision ||
      reviewPacket.landing_unit?.rollback_boundary !==
        session.landing_unit.rollback_boundary ||
      source.branch !== session.landing_unit.branch ||
      source.base_ref !== session.landing_unit.base_ref ||
      reviewPacket.covered_work_item_ids?.length !==
        session.covered_work_item_ids.length ||
      !session.covered_work_item_ids.every((workItemId) =>
        reviewPacket.covered_work_item_ids.includes(workItemId))
    ) {
      return "finalized Review Packet does not match the work-session authority boundary";
    }
    for (const [packetField, liveField] of [
      ["pr_url", "url"],
      ["head_commit", "head_commit"],
      ["merge_commit", "merge_commit"],
    ]) {
      if (
        !source[packetField] ||
        source[packetField] !== pullRequest?.[liveField]
      ) {
        return [
          `current pull-request ${packetField} does not match the finalized Review Packet`,
          `(current=${pullRequest?.[liveField] ?? "missing"}, expected=${source[packetField] ?? "missing"})`,
        ].join(" ");
      }
    }
    if (pullRequest?.state !== "merged") {
      return "current pull request is not merged";
    }
    return null;
  }

  function blockRetirement(manifest, message) {
    return manifest.resources.map((resource) =>
      resource.ownership_provenance === "session-created" &&
      resource.retention_class === "retire-on-terminal-close"
        ? { ...resource, outcome: "blocked", last_error: message }
        : { ...resource, outcome: "retained", last_error: null });
  }

  async function ensureTrackedWorktree(session) {
    let repoRoot = await sourceAdapter.resolveWorktree(session);
    let ownership = null;
    if (!repoRoot) {
      ownership = await sourceAdapter.ensureOwnedWorktree(session);
      repoRoot = ownership.path;
    }
    if (!store.readResourceManifest(session)) {
      ownership ??= await sourceAdapter.inspectResourceOwnership(session);
      store.writeResourceManifest(
        session,
        createDeliveryArtWorkSessionResourceManifest({
          clock,
          resources: ownership.resources,
          session,
        }),
      );
    }
    return repoRoot;
  }

  async function ensureManifest(session) {
    const existing = store.readResourceManifest(session);
    if (existing) {
      return existing;
    }
    const ownership = await sourceAdapter.inspectResourceOwnership(session);
    const manifest = createDeliveryArtWorkSessionResourceManifest({
      clock,
      resources: ownership.resources,
      session,
    });
    store.writeResourceManifest(session, manifest);
    return manifest;
  }

  async function retire({ pullRequest, session }) {
    const existingReceipt = store.readCleanupReceiptBySessionId(session.session_id);
    if (existingReceipt) {
      const terminalManifest = store.readResourceManifest(session);
      if (terminalManifest) {
        store.writeCleanupManifest(session, terminalManifest, existingReceipt);
      }
      const retainedReceipt = store.writeCleanupReceipt(session, existingReceipt);
      store.removeSession(session);
      return {
        receipt: retainedReceipt,
        session: { ...session, state: "closed" },
        state: "closed",
      };
    }

    let manifest = await ensureManifest(session);
    const bindingError = sourceBindingError(session, pullRequest);
    let executionError = null;
    if (!bindingError) {
      try {
        await sourceAdapter.prepareResourceRetirementExecution(session);
      } catch (error) {
        executionError = `resource retirement execution handoff failed: ${error.message}`;
      }
    }
    let resources = bindingError || executionError
      ? blockRetirement(manifest, bindingError ?? executionError)
      : await sourceAdapter.planResourceRetirement({
          manifest,
          pullRequest,
          session,
        });
    resources = resources.map((resource) =>
      resource.resource_type === "managed-session-state"
        ? store.inspectManagedResource(session, resource)
        : resource);
    manifest = prepareDeliveryArtWorkSessionCleanup({ clock, manifest, resources });
    store.writeResourceManifest(session, manifest);
    if (manifest.cleanup.state === "blocked") {
      return {
        manifest,
        session: updateSessionState(session, "cleanup-blocked"),
        state: "cleanup-blocked",
      };
    }

    manifest = startDeliveryArtWorkSessionCleanup(manifest, { clock });
    store.writeResourceManifest(session, manifest);
    let runningSession = updateSessionState(session, "cleanup-running");
    const order = new Map([
      ["git-worktree", 1],
      ["git-local-branch", 2],
      ["git-remote-branch", 3],
      ["managed-session-state", 4],
    ]);
    const eligible = manifest.resources
      .filter((resource) => resource.outcome === "eligible")
      .sort((left, right) =>
        (order.get(left.resource_type) ?? 99) -
        (order.get(right.resource_type) ?? 99));
    for (const resource of eligible) {
      try {
        if (resource.resource_type === "managed-session-state") {
          store.retireManagedResource(session, resource);
        } else {
          await sourceAdapter.retireResource({ pullRequest, resource, session });
        }
        manifest = recordDeliveryArtWorkSessionResourceOutcome({
          clock,
          manifest,
          outcome: "removed",
          resourceId: resource.resource_id,
        });
        store.writeResourceManifest(session, manifest);
      } catch (error) {
        manifest = recordDeliveryArtWorkSessionResourceOutcome({
          clock,
          error: error.message,
          manifest,
          outcome: "blocked",
          resourceId: resource.resource_id,
        });
        store.writeResourceManifest(session, manifest);
        return {
          manifest,
          session: updateSessionState(runningSession, "cleanup-blocked"),
          state: "cleanup-blocked",
        };
      }
    }

    manifest = completeDeliveryArtWorkSessionCleanup(manifest, { clock });
    store.writeResourceManifest(session, manifest);
    const receipt = createDeliveryArtWorkSessionCleanupReceipt({
      clock,
      closedBy: session.operator.id,
      manifest,
      protectedEvidenceRefs: protectedEvidenceRefs(session),
    });
    try {
      store.writeCleanupManifest(session, manifest, receipt);
      const retainedReceipt = store.writeCleanupReceipt(session, receipt);
      store.removeSession(session);
      return {
        receipt: retainedReceipt,
        session: { ...session, state: "closed" },
        state: "closed",
      };
    } catch (error) {
      manifest = recordDeliveryArtWorkSessionCleanupFailure({
        clock,
        error: error.message,
        manifest,
      });
      store.writeResourceManifest(session, manifest);
      runningSession = updateSessionState(runningSession, "cleanup-blocked");
      return { manifest, session: runningSession, state: "cleanup-blocked" };
    }
  }

  return {
    ensureTrackedWorktree,
    readManifest: (session) => store.readResourceManifest(session),
    readReceiptByAlias: (alias) => store.readCleanupReceiptByAlias(alias),
    readReceiptBySessionId: (sessionId) =>
      store.readCleanupReceiptBySessionId(sessionId),
    retire,
  };
}
