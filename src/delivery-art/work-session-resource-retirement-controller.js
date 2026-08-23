import {
  completeDeliveryArtWorkSessionCleanup,
  createDeliveryArtWorkSessionCleanupReceipt,
  createDeliveryArtWorkSessionResourceManifest,
  prepareDeliveryArtWorkSessionCleanup,
  recordDeliveryArtWorkSessionCleanupFailure,
  recordDeliveryArtWorkSessionResourceOutcome,
  startDeliveryArtWorkSessionCleanup,
} from "./work-session-resource-retirement.js";

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
      const retainedReceipt = store.writeCleanupReceipt(session, existingReceipt);
      store.removeSession(session);
      return {
        receipt: retainedReceipt,
        session: { ...session, state: "closed" },
        state: "closed",
      };
    }

    let manifest = await ensureManifest(session);
    let resources = await sourceAdapter.planResourceRetirement({
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
