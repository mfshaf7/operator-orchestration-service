import {
  buildDeliveryArtLifecycleCompatibilityPlan,
  createDeliveryArtWorkSession,
  createDeliveryArtWorkSessionDecisionDraft,
  deliveryArtWorkDecisionNextAction,
  deliveryArtWorkNextAction,
  deliveryArtWorkSessionState,
  normalizeWorkItemId,
} from "./work-session.js";
import { createDeliveryArtWorkSessionResourceRetirementController } from "./work-session-resource-retirement-controller.js";

const CLOSED_ART_STATES = new Set(["closed", "done", "retired"]);

export class DeliveryArtWorkSessionError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = "DeliveryArtWorkSessionError";
    this.code = code;
    this.details = details;
  }
}

function assertAdapter(adapter, methods, name) {
  for (const method of methods) {
    if (typeof adapter?.[method] !== "function") {
      throw new Error(`${name}.${method} is required`);
    }
  }
}

function artifactReference(artifact) {
  return {
    digest: artifact?.integrity?.content_digest,
    uri: artifact?.custody?.uri,
  };
}

function resultEnvelope({
  cleanupReceipt = null,
  context = null,
  nextAction,
  resourceManifest = null,
  session = null,
  state,
  workItemId,
}) {
  const projection = context?.projection
    ? Object.fromEntries(
        Object.entries(context.projection).filter(([key]) => key !== "next_action"),
      )
    : null;
  return {
    workflow_id: "delivery-art-work-session",
    delivery_id: session?.delivery_id ?? context?.delivery_id ?? null,
    work_item_id: workItemId,
    landing_unit_id: session?.landing_unit_id ?? null,
    session_id: session?.session_id ?? null,
    state,
    next_action: nextAction,
    ...(cleanupReceipt ? { cleanup_receipt: cleanupReceipt } : {}),
    ...(resourceManifest ? {
      cleanup: {
        attempt: resourceManifest.cleanup.attempt,
        state: resourceManifest.cleanup.state,
        resources: resourceManifest.resources.map((resource) => ({
          outcome: resource.outcome,
          resource_id: resource.resource_id,
          resource_type: resource.resource_type,
        })),
      },
    } : {}),
    ...(context?.facts ? { facts: context.facts } : {}),
    ...(projection ? { projection } : {}),
    ...(context?.pull_request ? { pull_request: context.pull_request } : {}),
    ...(context?.source ? { source: context.source } : {}),
  };
}

function targetItem(continuation) {
  return continuation?.continuation_context?.target_item ?? null;
}

function assertContinuation(continuation, workItemId) {
  const target = targetItem(continuation);
  if (
    continuation?.work_item_id !== workItemId ||
    !/^delivery-[1-9][0-9]*$/.test(continuation?.delivery_id ?? "") ||
    !target ||
    `work-item-${target.id}` !== workItemId ||
    !target.owner_repo
  ) {
    throw new DeliveryArtWorkSessionError(
      "delivery_art_work_session_continuation_invalid",
      `Continuation truth for ${workItemId} is incomplete or inconsistent.`,
    );
  }
  return target;
}

function assertOpenTarget(target, workItemId) {
  if (CLOSED_ART_STATES.has(String(target.status).toLowerCase())) {
    throw new DeliveryArtWorkSessionError(
      "delivery_art_work_session_target_closed",
      `${workItemId} is already closed in Workspace Delivery ART.`,
    );
  }
  if (target.blocked || target.dependency_blocked) {
    throw new DeliveryArtWorkSessionError(
      "delivery_art_work_session_target_blocked",
      `${workItemId} is blocked by authoritative ART state.`,
      { target },
    );
  }
}

function assertArchitecture(artifact, sessionInput) {
  const covered = new Set(artifact?.covered_work_item_ids ?? []);
  if (
    artifact?.artifact_type !== "delivery_art_architecture_packet" ||
    artifact.delivery_id !== sessionInput.deliveryId ||
    artifact.decision?.status !== "architecture-ready" ||
    !sessionInput.coveredWorkItemIds.every((workItemId) => covered.has(workItemId))
  ) {
    throw new DeliveryArtWorkSessionError(
      "delivery_art_work_session_architecture_invalid",
      "The selected architecture packet does not approve the work-session scope.",
    );
  }
}

function evidenceTemplate(session) {
  return {
    evidence: {
      changed_surfaces: [],
      tests: [],
      validations: [],
      acceptance_mapping: session.covered_work_item_ids.map((workItemId) => ({
        work_item_id: workItemId,
        evidence_ids: [],
      })),
      runtime_and_live: [],
      security_and_trust: [],
    },
    exceptions: [],
    change_record_refs: [],
  };
}

export function createDeliveryArtWorkSessionController({
  artifactAdapter,
  clock = () => new Date(),
  closeAdapter,
  contextAdapter,
  lifecycleController,
  resourceRetirementCapability = null,
  sourceAdapter,
  store,
} = {}) {
  assertAdapter(contextAdapter, ["continuation"], "contextAdapter");
  assertAdapter(sourceAdapter, [
    "inspectPullRequest",
    "readArtifact",
    "resolveBase",
    "resolveWorktree",
  ], "sourceAdapter");
  assertAdapter(artifactAdapter, [
    "draftWorkStart",
    "evaluateWorkStart",
    "persistArchitecture",
    "statuses",
  ], "artifactAdapter");
  assertAdapter(lifecycleController, ["inspect", "reconcile"], "lifecycleController");
  assertAdapter(store, [
    "artifactPath",
    "readArtifact",
    "readByAlias",
    "readDecision",
    "removeSession",
    "withLock",
    "writeArtifact",
    "writeDecisionDraft",
    "writeSession",
  ], "store");
  const retirementController =
    createDeliveryArtWorkSessionResourceRetirementController({
      clock,
      sourceAdapter,
      store,
    });

  async function continuation(workItemId) {
    const value = await contextAdapter.continuation(workItemId);
    assertContinuation(value, workItemId);
    return value;
  }

  async function contextsFor(decision) {
    const contexts = [];
    for (const workItemId of decision.covered_work_item_ids) {
      const value = await continuation(workItemId);
      assertOpenTarget(targetItem(value), workItemId);
      contexts.push(value);
    }
    const deliveryIds = new Set(contexts.map((entry) => entry.delivery_id));
    const owners = new Set(contexts.map((entry) => targetItem(entry).owner_repo));
    if (deliveryIds.size !== 1 || owners.size !== 1) {
      throw new DeliveryArtWorkSessionError(
        "delivery_art_work_session_landing_unit_inconsistent",
        "One Landing Unit must resolve to one Delivery initiative and one owner repo.",
      );
    }
    return contexts;
  }

  function paths(session) {
    return {
      architecture: session.architecture.artifact_file
        ? store.artifactPath(session, session.architecture.artifact_file)
        : null,
      evidence: store.artifactPath(session, session.artifacts.evidence_file),
      readiness_receipt: store.artifactPath(
        session,
        session.artifacts.readiness_receipt_file,
      ),
      review_packet: store.artifactPath(
        session,
        session.artifacts.review_packet_file,
      ),
      work_start: store.artifactPath(session, session.artifacts.work_start_file),
    };
  }

  async function resourceRetirementActive() {
    const activationWorkItemId =
      resourceRetirementCapability?.activation_work_item_id;
    if (
      !activationWorkItemId ||
      resourceRetirementCapability.normal_path !== true ||
      !["human-gated", "implemented"].includes(
        resourceRetirementCapability.state,
      )
    ) {
      return false;
    }
    const [status] = await artifactAdapter.statuses([activationWorkItemId]);
    return CLOSED_ART_STATES.has(String(status).toLowerCase());
  }

  function cleanupNextAction(workItemId, state) {
    return {
      code: state === "cleanup-blocked"
        ? "cleanup-retry-required"
        : "cleanup-required",
      command: `npm run art -- work close ${workItemId}`,
      reason: state === "cleanup-blocked"
        ? "Terminal cleanup is blocked; retry revalidates only pending or blocked resources."
        : "ART closeout is durable; explicit work close must finish owned resource retirement.",
      authority: "operator-orchestration-service",
    };
  }

  function cleanupResult({ manifest, session, state, workItemId }) {
    return resultEnvelope({
      nextAction: cleanupNextAction(workItemId, state),
      resourceManifest: manifest,
      session,
      state,
      workItemId,
    });
  }

  function terminalCleanupResult(retirement, workItemId) {
    if (retirement.state === "cleanup-blocked") {
      return cleanupResult({
        manifest: retirement.manifest,
        session: retirement.session,
        state: retirement.state,
        workItemId,
      });
    }
    return resultEnvelope({
      cleanupReceipt: retirement.receipt,
      nextAction: {
        code: "work-complete",
        command: `npm run art -- work status ${workItemId}`,
        reason: "Durable ART closeout and terminal resource retirement are complete.",
        authority: "workspace-delivery-art",
      },
      session: retirement.session,
      state: retirement.state,
      workItemId,
    });
  }

  function assertDurableSessionArtifacts(session) {
    const required = [
      [session.artifacts.work_start_file, "work-start"],
      [session.artifacts.evidence_file, "evidence"],
      ...(session.architecture.required
        ? [[session.architecture.artifact_file, "architecture"]]
        : []),
    ];
    for (const [relativeFile, artifactName] of required) {
      if (!store.readArtifact(session, relativeFile)) {
        throw new DeliveryArtWorkSessionError(
          "delivery_art_work_session_artifact_missing",
          `The durable ${artifactName} artifact is missing from this work session.`,
          { artifact: artifactName, relative_file: relativeFile },
        );
      }
    }
  }

  async function statusForSession(session, workItemId) {
    const cleanupReceipt = retirementController.readReceiptBySessionId(
      session.session_id,
    );
    if (cleanupReceipt) {
      return resultEnvelope({
        cleanupReceipt,
        nextAction: {
          code: "work-complete",
          command: `npm run art -- work status ${workItemId}`,
          reason: "Durable ART closeout and terminal resource retirement are complete.",
          authority: "workspace-delivery-art",
        },
        session: { ...session, state: "closed" },
        state: "closed",
        workItemId,
      });
    }
    const current = await continuation(workItemId);
    const target = targetItem(current);
    if (CLOSED_ART_STATES.has(String(target.status).toLowerCase())) {
      if (await resourceRetirementActive()) {
        const manifest = retirementController.readManifest(session);
        const state = session.state === "cleanup-blocked"
          ? "cleanup-blocked"
          : "cleanup-required";
        return cleanupResult({ manifest, session, state, workItemId });
      }
      return resultEnvelope({
        context: current,
        nextAction: {
          code: "work-complete",
          command: `npm run art -- work status ${workItemId}`,
          reason: "Workspace Delivery ART reports this work item as closed.",
          authority: "workspace-delivery-art",
        },
        session,
        state: "closed",
        workItemId,
      });
    }

    assertDurableSessionArtifacts(session);

    const repoRoot = await sourceAdapter.resolveWorktree(session);
    if (!repoRoot) {
      return resultEnvelope({
        context: current,
        nextAction: {
          code: "source-worktree-required",
          command: `npm run art -- work continue ${workItemId}`,
          reason:
            "Durable work-start is ready; reconstruct the planned source worktree before implementation.",
          authority: session.owner_repo,
        },
        session,
        state: "implementation-ready",
        workItemId,
      });
    }

    const plan = buildDeliveryArtLifecycleCompatibilityPlan({
      artifactPath: (relativeFile) => store.artifactPath(session, relativeFile),
      repoRoot,
      session,
    });
    const inspected = await lifecycleController.inspect(plan);
    const securityIds = session.human_gate_work_item_ids.security_acceptance;
    const securityStatuses = securityIds.length > 0
      ? await artifactAdapter.statuses(securityIds)
      : [];
    const context = { ...inspected, repo_root: repoRoot, session };
    return resultEnvelope({
      context,
      nextAction: deliveryArtWorkNextAction({
        artifactPaths: paths(session),
        context,
        securityStatuses,
        workItemId,
      }),
      session,
      state: deliveryArtWorkSessionState(inspected.projection),
      workItemId,
    });
  }

  async function start(workItemIdInput, { decisionPath = null } = {}) {
    const workItemId = normalizeWorkItemId(workItemIdInput);
    return store.withLock(workItemId, async () => {
      const existing = store.readByAlias(workItemId);
      if (existing) {
        return statusForSession(existing, workItemId);
      }
      const current = await continuation(workItemId);
      assertOpenTarget(targetItem(current), workItemId);
      if (!decisionPath) {
        const decision = createDeliveryArtWorkSessionDecisionDraft({
          continuation: current,
        });
        const draftPath = store.writeDecisionDraft(workItemId, decision);
        return resultEnvelope({
          context: current,
          nextAction: deliveryArtWorkDecisionNextAction({
            decisionPath: draftPath,
            workItemId,
          }),
          state: "decision-required",
          workItemId,
        });
      }

      const decision = store.readDecision(decisionPath);
      if (decision.work_item_id !== workItemId) {
        throw new DeliveryArtWorkSessionError(
          "delivery_art_work_session_decision_target_mismatch",
          "The decision target does not match the requested work item.",
        );
      }
      const startAcceptedDecision = async () => {
        const existingSessions = [
          decision.landing_unit.id,
          ...decision.covered_work_item_ids,
        ]
          .map((alias) => store.readByAlias(alias))
          .filter(Boolean);
        const uniqueSessions = new Map(
          existingSessions.map((session) => [session.session_id, session]),
        );
        if (uniqueSessions.size > 1) {
          throw new DeliveryArtWorkSessionError(
            "delivery_art_work_session_alias_ambiguous",
            "The accepted Landing Unit overlaps more than one active work session.",
            { session_ids: [...uniqueSessions.keys()].sort() },
          );
        }
        if (uniqueSessions.size === 1) {
          return statusForSession(uniqueSessions.values().next().value, workItemId);
        }
        const contexts = await contextsFor(decision);
        const first = contexts[0];
        const ownerRepo = targetItem(first).owner_repo;
        const base = await sourceAdapter.resolveBase({
          baseRef: decision.landing_unit.base_ref,
          ownerRepo,
        });
        let architecture = null;
        if (decision.architecture.required) {
          architecture = await sourceAdapter.readArtifact(
            decision.architecture.artifact_location,
          );
          assertArchitecture(architecture, {
            coveredWorkItemIds: decision.covered_work_item_ids,
            deliveryId: first.delivery_id,
          });
          if (architecture.custody?.state !== "durable") {
            architecture = await artifactAdapter.persistArchitecture({
              artifact: architecture,
              callerId: decision.operator.id,
            });
          }
        }

        const session = createDeliveryArtWorkSession({
          architectureFile: decision.architecture.required
            ? "artifacts/architecture.json"
            : null,
          baseCommit: base.commit,
          clock,
          continuation: first,
          decision,
        });
        if (architecture) {
          store.writeArtifact(session, session.architecture.artifact_file, architecture);
        }
        store.writeArtifact(session, session.artifacts.evidence_file, evidenceTemplate(session));

        const architectureReference = architecture
          ? artifactReference(architecture)
          : null;
        const draft = await artifactAdapter.draftWorkStart({
          callerId: session.operator.id,
          input: {
            architecture: {
              reference: architectureReference,
              required: session.architecture.required,
            },
            covered_work_item_ids: session.covered_work_item_ids,
            delivery_id: session.delivery_id,
            landing_unit: {
              branch_plan: [{
                base_commit: session.landing_unit.base_commit,
                base_ref: session.landing_unit.base_ref,
                branch: session.landing_unit.branch,
                repo: session.owner_repo,
              }],
              decision: session.landing_unit.decision,
              owner_repos: [session.owner_repo],
              planned_review_packet_ref: session.artifacts.review_packet_file,
              split_reason: session.landing_unit.split_reason,
            },
            operator: {
              decision_source: session.operator.decision_source,
            },
          },
        });
        store.writeArtifact(session, session.artifacts.work_start_file, draft);
        const evaluated = await artifactAdapter.evaluateWorkStart({
          artifact: draft,
          callerId: session.operator.id,
        });
        if (evaluated.readiness?.level !== "implementation-ready") {
          throw new DeliveryArtWorkSessionError(
            "delivery_art_work_session_work_start_blocked",
            "Durable work-start did not reach implementation readiness.",
            evaluated.readiness,
          );
        }
        store.writeArtifact(session, session.artifacts.work_start_file, evaluated);
        store.writeSession(session);
        return statusForSession(session, workItemId);
      };
      return store.withLock(
        "delivery-art-work-session-start",
        startAcceptedDecision,
      );
    });
  }

  async function status(workItemIdInput) {
    const workItemId = normalizeWorkItemId(workItemIdInput);
    const session = store.readByAlias(workItemId);
    if (session) {
      return statusForSession(session, workItemId);
    }
    const current = await continuation(workItemId);
    const target = targetItem(current);
    const closed = CLOSED_ART_STATES.has(String(target.status).toLowerCase());
    return resultEnvelope({
      context: current,
      nextAction: closed
        ? {
            code: "work-complete",
            command: `npm run art -- work status ${workItemId}`,
            reason: "Workspace Delivery ART reports this work item as closed.",
            authority: "workspace-delivery-art",
          }
        : {
            code: "work-session-start-required",
            command: `npm run art -- work start ${workItemId}`,
            reason: "No active reconstructable work session exists for this item.",
            authority: "operator",
          },
      state: closed ? "closed" : "decision-required",
      workItemId,
    });
  }

  async function continueWork(workItemIdInput) {
    const workItemId = normalizeWorkItemId(workItemIdInput);
    return store.withLock(workItemId, async () => {
      const session = store.readByAlias(workItemId);
      if (!session) {
        return status(workItemId);
      }
      return store.withLock(session.session_id, async () => {
        const repoRoot = await retirementController.ensureTrackedWorktree(session);
        const plan = buildDeliveryArtLifecycleCompatibilityPlan({
          artifactPath: (relativeFile) => store.artifactPath(session, relativeFile),
          repoRoot,
          session,
        });
        const reconciled = await lifecycleController.reconcile(plan);
        const updated = {
          ...session,
          state: deliveryArtWorkSessionState(reconciled.projection),
          updated_at: clock().toISOString(),
        };
        store.writeSession(updated);
        return statusForSession(updated, workItemId);
      });
    });
  }

  async function close(workItemIdInput) {
    const workItemId = normalizeWorkItemId(workItemIdInput);
    return store.withLock(workItemId, async () => {
      const session = store.readByAlias(workItemId);
      if (!session) {
        const receipt = retirementController.readReceiptByAlias(workItemId);
        if (receipt) {
          return resultEnvelope({
            cleanupReceipt: receipt,
            nextAction: {
              code: "work-complete",
              command: `npm run art -- work status ${workItemId}`,
              reason: "Durable ART closeout and terminal resource retirement are complete.",
              authority: "workspace-delivery-art",
            },
            state: "closed",
            workItemId,
          });
        }
        return status(workItemId);
      }
      return store.withLock(session.session_id, async () => {
        const receipt = retirementController.readReceiptBySessionId(
          session.session_id,
        );
        if (receipt) {
          return terminalCleanupResult(
            await retirementController.retire({ pullRequest: null, session }),
            workItemId,
          );
        }
        const authoritative = await continuation(workItemId);
        const artAlreadyClosed = CLOSED_ART_STATES.has(
          String(targetItem(authoritative).status).toLowerCase(),
        );
        const current = await statusForSession(session, workItemId);
        if (artAlreadyClosed && !(await resourceRetirementActive())) {
          store.removeSession(session);
          return current;
        }
        if (
          !artAlreadyClosed &&
          current.next_action.code !== "art-closeout-required"
        ) {
          throw new DeliveryArtWorkSessionError(
            "delivery_art_work_session_closeout_not_ready",
            "Work closeout requires one finalized Review Packet and explicit ART closeout readiness.",
            {
              current_state: current.state,
              required_gate: "art-closeout",
            },
          );
        }
        if (!artAlreadyClosed && typeof closeAdapter?.close !== "function") {
          throw new DeliveryArtWorkSessionError(
            "delivery_art_work_session_close_adapter_missing",
            "Delivery ART closeout adapter is unavailable.",
          );
        }
        if (!artAlreadyClosed) {
          const closed = await closeAdapter.close({
            packetPath: store.artifactPath(
              session,
              session.artifacts.review_packet_file,
            ),
            session,
            workItemId,
          });
          if (!closed?.complete) {
            return resultEnvelope({
              context: current,
              nextAction: closed.next_action,
              session,
              state: "closeout-required",
              workItemId,
            });
          }
        }
        if (!(await resourceRetirementActive())) {
          store.removeSession(session);
          return resultEnvelope({
            nextAction: {
              code: "work-complete",
              command: `npm run art -- work status ${workItemId}`,
              reason: "Durable evidence, ART closeout, and projection reconciliation are complete.",
              authority: "workspace-delivery-art",
            },
            session: { ...session, state: "closed" },
            state: "closed",
            workItemId,
          });
        }
        const retirement = await retirementController.retire({
          pullRequest: await sourceAdapter.inspectPullRequest(session),
          session,
        });
        return terminalCleanupResult(retirement, workItemId);
      });
    });
  }

  return { close, continue: continueWork, start, status };
}
