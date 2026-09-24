import {
  architectureExecutionPrerequisitesForLandingUnit,
  architectureHumanGatesForLandingUnit,
  architectureLandingUnitId,
  architectureSecurityAcceptanceWorkItemIds,
  buildDeliveryArtLifecycleCompatibilityPlan,
  createDeliveryArtWorkSession,
  createDeliveryArtWorkSessionDecisionDraft,
  deliveryArtWorkDecisionNextAction,
  deliveryArtWorkNextAction,
  deliveryArtWorkSessionState,
  normalizeWorkItemId,
  pendingArchitectureExecutionPrerequisite,
  pendingArchitectureHumanGate,
  validateDeliveryArtWorkSessionDecision,
} from "./work-session.js";
import { createDeliveryArtWorkSessionResourceRetirementController } from "./work-session-resource-retirement-controller.js";
import { canonicalDigest, canonicalStringify } from "./canonical-json.js";
import { applicableDeliveryArtConformanceCases } from "./review-evidence.js";

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

function sameArtifactReference(left, right) {
  return Boolean(
    /^sha256:[0-9a-f]{64}$/.test(left?.digest ?? "") &&
    /^sha256:[0-9a-f]{64}$/.test(right?.digest ?? "") &&
    left.digest === right.digest &&
    left.uri === right.uri,
  );
}

function sourceObservation(source) {
  return {
    ...source,
    upstream_commit: source.upstream_commit ?? null,
  };
}

function resultEnvelope({
  agentSource = null,
  architectureSupersession = null,
  cleanupReceipt = null,
  configuredPath = null,
  context = null,
  decisionDraft = null,
  nextAction,
  recoveryReceipt = null,
  resourceManifest = null,
  session = null,
  state,
  workContract = null,
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
    session_revision: session?.updated_at ?? null,
    state,
    next_action: nextAction,
    ...(agentSource ? { agent_source: agentSource } : {}),
    ...(architectureSupersession
      ? { architecture_supersession: architectureSupersession }
      : {}),
    ...(decisionDraft ? { decision_draft: decisionDraft } : {}),
    ...(cleanupReceipt ? { cleanup_receipt: cleanupReceipt } : {}),
    ...(configuredPath ? { configured_path: configuredPath } : {}),
    ...(recoveryReceipt ? { recovery_receipt: recoveryReceipt } : {}),
    ...(resourceManifest ? {
      cleanup: {
        attempt: resourceManifest.cleanup.attempt,
        state: resourceManifest.cleanup.state,
        resources: resourceManifest.resources.map((resource) => ({
          last_error: resource.last_error,
          outcome: resource.outcome,
          resource_id: resource.resource_id,
          resource_type: resource.resource_type,
        })),
      },
    } : {}),
    ...(workContract ? { work_contract: workContract } : {}),
    ...(context?.facts ? { facts: context.facts } : {}),
    ...(projection ? { projection } : {}),
    ...(context?.pull_request ? { pull_request: context.pull_request } : {}),
    ...(context?.source ? { source: sourceObservation(context.source) } : {}),
  };
}

function targetItem(continuation) {
  return continuation?.continuation_context?.target_item ?? null;
}

function artItemProjection(item) {
  return item
    ? {
        blocked: item.blocked === true,
        dependency_blocked: item.dependency_blocked === true,
        id: `work-item-${item.id}`,
        owner_repo: item.owner_repo ?? null,
        parent_id: item.parent_id ? `work-item-${item.parent_id}` : null,
        pm2_phase: item.pm2_phase ?? null,
        record_ref: item.record_ref ?? null,
        status: item.status ?? null,
        subject: item.subject ?? null,
        target_pi: item.target_pi ?? null,
        type: item.type ?? null,
      }
    : null;
}

function workContractProjection({ architecture, contexts, coveredWorkItemIds }) {
  const contextByWorkItemId = new Map(
    contexts.map((context) => [context.work_item_id, context]),
  );
  const narrativeItems = coveredWorkItemIds.map((workItemId) => {
    const target = targetItem(contextByWorkItemId.get(workItemId));
    const evaluated = typeof target?.completion_narrative_contract_satisfied ===
      "boolean";
    return {
      evaluated,
      issues: Array.isArray(target?.completion_narrative_contract_issues)
        ? structuredClone(target.completion_narrative_contract_issues)
        : [],
      record_ref: target?.record_ref ?? null,
      satisfied: evaluated
        ? target.completion_narrative_contract_satisfied
        : null,
      work_item_id: workItemId,
    };
  });
  const conformanceCases = applicableDeliveryArtConformanceCases(
    architecture,
    coveredWorkItemIds,
  );
  return {
    schema_version: 1,
    completion_narrative: {
      blockers: narrativeItems
        .filter((entry) => entry.satisfied === false)
        .map((entry) => ({
          issues: structuredClone(entry.issues),
          work_item_id: entry.work_item_id,
        })),
      items: narrativeItems,
      ready: narrativeItems.every((entry) => entry.evaluated)
        ? narrativeItems.every((entry) => entry.satisfied)
        : null,
    },
    conformance: {
      cases: conformanceCases.map((entry) => ({
        applies_to_work_item_ids: structuredClone(
          entry.applies_to_work_item_ids,
        ),
        expected_outcome: entry.expected_outcome,
        fidelity: entry.fidelity,
        id: entry.id,
        target_readiness: entry.target_readiness,
      })),
      target_readiness: "merge-ready",
    },
  };
}

function configuredPathAction({ authority, code, inputs = {}, reason }) {
  return {
    authority,
    code,
    inputs,
    reason,
  };
}

function configuredPathBlocker({ authority, code, inputs = {}, reason }) {
  return {
    authority,
    code,
    reason,
    next_action: configuredPathAction({ authority, code, inputs, reason }),
  };
}

function publicConfiguredPathAction(action) {
  if (!action) return null;
  return {
    authority: action.authority,
    code: action.code,
    inputs: structuredClone(action.inputs ?? {}),
    reason: action.reason,
  };
}

function repositoryAdmissionBlocker(admission) {
  return configuredPathBlocker({
    authority: "platform-engineering",
    code: admission?.reason_code ?? "agent_source_repository_projection_unavailable",
    inputs: {
      owner_repo: admission?.owner_repo ?? null,
      platform_definition_revision:
        admission?.authority?.platform_definition_revision ?? null,
      repository_inventory_revision:
        admission?.authority?.inventory_revision ?? null,
    },
    reason: admission?.reason ??
      "Repair the Agent source active-owner projection before source work continues.",
  });
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

function assertOpenTarget(
  target,
  workItemId,
  { allowDependencyBlocked = false } = {},
) {
  if (CLOSED_ART_STATES.has(String(target.status).toLowerCase())) {
    throw new DeliveryArtWorkSessionError(
      "delivery_art_work_session_target_closed",
      `${workItemId} is already closed in Workspace Delivery ART.`,
    );
  }
  if (target.blocked || (target.dependency_blocked && !allowDependencyBlocked)) {
    throw new DeliveryArtWorkSessionError(
      "delivery_art_work_session_target_blocked",
      `${workItemId} is blocked by authoritative ART state.`,
      { target },
    );
  }
}

function assertInternalLandingUnitDependency({
  architecture,
  continuation,
  coveredWorkItemIds,
  workItemId,
}) {
  const target = targetItem(continuation);
  if (!target?.dependency_blocked) return;

  assertOpenTarget(target, workItemId, { allowDependencyBlocked: true });
  const unresolved =
    continuation?.continuation_context?.dependency_context
      ?.unresolved_dependencies;
  let dependencyWorkItemIds = [];
  try {
    if (!Array.isArray(unresolved) || unresolved.length === 0) {
      throw new Error("dependency identity is missing");
    }
    dependencyWorkItemIds = unresolved.map((entry) =>
      normalizeWorkItemId(entry?.id));
  } catch (error) {
    throw new DeliveryArtWorkSessionError(
      "delivery_art_work_session_target_blocked",
      `${workItemId} has dependency-blocked ART state without complete dependency identity.`,
      { reason: error.message, target },
    );
  }

  const covered = new Set(coveredWorkItemIds);
  const externalDependencyIds = dependencyWorkItemIds.filter(
    (dependencyWorkItemId) => !covered.has(dependencyWorkItemId),
  );
  const selfDependencyIds = dependencyWorkItemIds.filter(
    (dependencyWorkItemId) => dependencyWorkItemId === workItemId,
  );
  const landingUnitId = architectureLandingUnitId({
    architecture,
    coveredWorkItemIds,
  });
  const executionPlan = architecture?.architecture?.work_item_execution_plan
    ?.find((entry) => entry.work_item_id === workItemId);
  const declaredStartOrder = new Set(
    executionPlan?.start_after_work_item_ids ?? [],
  );
  const undeclaredDependencyIds = dependencyWorkItemIds.filter(
    (dependencyWorkItemId) => !declaredStartOrder.has(dependencyWorkItemId),
  );

  if (
    architecture?.schema_version !== 3 ||
    !landingUnitId ||
    externalDependencyIds.length > 0 ||
    selfDependencyIds.length > 0 ||
    undeclaredDependencyIds.length > 0
  ) {
    throw new DeliveryArtWorkSessionError(
      "delivery_art_work_session_target_blocked",
      `${workItemId} is blocked by an external, ambiguous, or undeclared ART dependency.`,
      {
        external_dependency_work_item_ids: externalDependencyIds,
        landing_unit_id: landingUnitId,
        self_dependency_work_item_ids: selfDependencyIds,
        target,
        undeclared_dependency_work_item_ids: undeclaredDependencyIds,
      },
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

function decisionWithArchitectureBindings(decision, architecture) {
  if (!architecture) {
    return decision;
  }
  const landingUnitId = architectureLandingUnitId({
    architecture,
    coveredWorkItemIds: decision.covered_work_item_ids,
  });
  if (!landingUnitId) {
    throw new DeliveryArtWorkSessionError(
      "delivery_art_work_session_landing_unit_mismatch",
      "The durable architecture packet does not define one exact Landing Unit for this work-session scope.",
    );
  }
  const derived = architectureSecurityAcceptanceWorkItemIds({
    architecture,
    landingUnitId,
  });
  const declared = [
    ...decision.human_gate_work_item_ids.security_acceptance,
  ].sort();
  if (
    declared.length > 0 &&
    (declared.length !== derived.length ||
      declared.some((workItemId, index) => workItemId !== derived[index]))
  ) {
    throw new DeliveryArtWorkSessionError(
      "delivery_art_work_session_security_gate_mismatch",
      "The accepted Security gates do not match the durable architecture packet.",
      { declared, derived },
    );
  }
  return {
    ...decision,
    landing_unit: {
      ...decision.landing_unit,
      id: landingUnitId,
    },
    human_gate_work_item_ids: {
      ...decision.human_gate_work_item_ids,
      security_acceptance: derived,
    },
  };
}

function evidenceTemplate(session) {
  return {
    acquisition: null,
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
    "inspectConfiguredPath",
    "inspectPristineSession",
    "inspectPullRequest",
    "mergePullRequest",
    "readArtifact",
    "resolveBase",
    "resolveWorktree",
    "retirePristineSession",
  ], "sourceAdapter");
  assertAdapter(artifactAdapter, [
    "currentArchitecture",
    "draftWorkStart",
    "evaluateWorkStart",
    "persistArchitecture",
    "statuses",
  ], "artifactAdapter");
  assertAdapter(lifecycleController, ["inspect", "reconcile"], "lifecycleController");
  assertAdapter(store, [
    "archiveRecoveredSession",
    "artifactPath",
    "readArtifact",
    "readByAlias",
    "readRecoveryReceiptBySessionId",
    "readRecoveredSessionBySessionId",
    "readDecision",
    "removeSession",
    "withLock",
    "writeArtifact",
    "writeArchitectureSupersessionReceipt",
    "writeDecision",
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

  async function authorWorkStart(session, architecture) {
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
    return evaluated;
  }

  async function architectureSupersession(session) {
    if (!session.architecture.required) return null;
    const bound = store.readArtifact(
      session,
      session.architecture.artifact_file,
    );
    const current = await artifactAdapter.currentArchitecture(session.delivery_id);
    if (
      current?.artifact_type !== "delivery_art_architecture_packet" ||
      current.delivery_id !== session.delivery_id ||
      current.decision?.status !== "architecture-ready"
    ) {
      throw new DeliveryArtWorkSessionError(
        "delivery_art_work_session_architecture_current_invalid",
        "The current Delivery architecture is missing, invalid, or not ready.",
      );
    }
    const boundReference = artifactReference(bound);
    const currentReference = artifactReference(current);
    if (sameArtifactReference(boundReference, currentReference)) {
      return null;
    }

    const evidence = store.readArtifact(session, session.artifacts.evidence_file);
    const source = await sourceAdapter.inspectPristineSession(session);
    const currentLandingUnitId = architectureLandingUnitId({
      architecture: current,
      coveredWorkItemIds: session.covered_work_item_ids,
    });
    const proof = {
      current_landing_unit_id: currentLandingUnitId,
      evidence_pristine:
        canonicalStringify(evidence) === canonicalStringify(evidenceTemplate(session)),
      readiness_receipt_absent:
        store.readArtifact(session, session.artifacts.readiness_receipt_file) === null,
      review_packet_absent:
        store.readArtifact(session, session.artifacts.review_packet_file) === null,
      source,
    };
    return {
      bound_architecture: boundReference,
      current_architecture: currentReference,
      current_artifact: current,
      pristine_proof: proof,
      reconstructable:
        proof.evidence_pristine &&
        Boolean(proof.current_landing_unit_id) &&
        proof.readiness_receipt_absent &&
        proof.review_packet_absent &&
        source.pristine === true,
    };
  }

  function supersessionProjection(supersession) {
    return {
      bound_architecture: supersession.bound_architecture,
      current_architecture: supersession.current_architecture,
      pristine_proof: supersession.pristine_proof,
      reconstructable: supersession.reconstructable,
    };
  }

  async function contextsFor(decision, knownContexts = [], architecture = null) {
    const knownByWorkItemId = new Map(
      knownContexts.map((entry) => [entry.work_item_id, entry]),
    );
    const contexts = [];
    for (const workItemId of decision.covered_work_item_ids) {
      const value = knownByWorkItemId.get(workItemId) ??
        await continuation(workItemId);
      assertOpenTarget(targetItem(value), workItemId, {
        allowDependencyBlocked: true,
      });
      assertInternalLandingUnitDependency({
        architecture,
        continuation: value,
        coveredWorkItemIds: decision.covered_work_item_ids,
        workItemId,
      });
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

  async function evaluateConfiguredPath(
    workItemId,
    { callerId = null, decision = null, knownCurrent = null, operatorId = null } = {},
  ) {
    const current = knownCurrent ?? await continuation(workItemId);
    const target = targetItem(current);
    const parentChain = current.continuation_context?.parent_chain ?? [];
    const parentFeature = parentChain.find((item) => item.type === "Feature") ?? null;
    const initiative = current.continuation_context?.delivery_epic ??
      parentChain.find((item) => item.type === "Epic") ?? null;
    const blockers = [];
    let architecture = null;
    let boundDecision = null;
    let contexts = [];
    let source = null;
    const decisionDraft = decision ?? createDeliveryArtWorkSessionDecisionDraft({
      ...(callerId ? { callerId } : {}),
      continuation: current,
      ...(operatorId ? { operatorId } : {}),
    });

    try {
      assertOpenTarget(target, workItemId, {
        allowDependencyBlocked: Boolean(decision),
      });
    } catch (error) {
      blockers.push(configuredPathBlocker({
        authority: "workspace-delivery-art",
        code: error.code ?? "art-posture-blocked",
        inputs: { work_item_id: workItemId },
        reason: error.message,
      }));
    }

    if (!decision) {
      blockers.push(configuredPathBlocker({
        authority: "operator",
        code: "landing-unit-decision-required",
        inputs: { work_item_id: workItemId },
        reason: "Complete and accept the generated Landing Unit decision.",
      }));
    } else {
      const validation = validateDeliveryArtWorkSessionDecision(decision);
      if (!validation.valid || decision.work_item_id !== workItemId) {
        blockers.push(configuredPathBlocker({
          authority: "operator",
          code: "landing-unit-decision-invalid",
          inputs: { work_item_id: workItemId },
          reason: validation.valid
            ? "The Landing Unit decision targets a different work item."
            : `The Landing Unit decision is invalid: ${validation.errors.join("; ")}`,
        }));
      }
    }

    let currentArchitecture = null;
    try {
      currentArchitecture = await artifactAdapter.currentArchitecture(
        current.delivery_id,
      );
    } catch (error) {
      blockers.push(configuredPathBlocker({
        authority: "workspace-governance",
        code: "architecture-packet-required",
        inputs: { delivery_id: current.delivery_id },
        reason: error.message,
      }));
    }

    if (decision && blockers.every((entry) =>
      entry.code !== "landing-unit-decision-invalid")) {
      const currentLandingUnitId = architectureLandingUnitId({
        architecture: currentArchitecture,
        coveredWorkItemIds: decision.covered_work_item_ids,
      });
      if (currentLandingUnitId && decision.architecture.required !== true) {
        blockers.push(configuredPathBlocker({
          authority: "operator",
          code: "architecture-binding-required",
          inputs: {
            architecture_artifact_id: currentArchitecture.artifact_id,
            landing_unit_id: currentLandingUnitId,
          },
          reason: "The current architecture defines this Landing Unit and must be bound to work start.",
        }));
      } else if (decision.architecture.required === true) {
        try {
          architecture = await sourceAdapter.readArtifact(
            decision.architecture.artifact_location,
          );
          assertArchitecture(architecture, {
            coveredWorkItemIds: decision.covered_work_item_ids,
            deliveryId: current.delivery_id,
          });
          if (architecture.custody?.state !== "durable") {
            throw new DeliveryArtWorkSessionError(
              "delivery_art_work_session_architecture_not_durable",
              "Work start requires a durable architecture packet.",
            );
          }
          if (!sameArtifactReference(
            artifactReference(architecture),
            artifactReference(currentArchitecture),
          )) {
            throw new DeliveryArtWorkSessionError(
              "delivery_art_work_session_architecture_superseded",
              "Work start requires the current accepted architecture packet.",
            );
          }
          boundDecision = decisionWithArchitectureBindings(decision, architecture);
        } catch (error) {
          blockers.push(configuredPathBlocker({
            authority: "workspace-governance",
            code: error.code ?? "architecture-packet-invalid",
            inputs: { delivery_id: current.delivery_id },
            reason: error.message,
          }));
        }
      } else {
        boundDecision = structuredClone(decision);
      }
    }

    if (boundDecision) {
      try {
        contexts = await contextsFor(
          boundDecision,
          [current],
          architecture,
        );
      } catch (error) {
        blockers.push(configuredPathBlocker({
          authority: "workspace-delivery-art",
          code: error.code ?? "art-scope-invalid",
          inputs: { work_item_id: workItemId },
          reason: error.message,
        }));
      }
    }

    let architectureGateBindings = [];
    let architecturePrerequisiteBindings = { close: [], start: [] };
    if (architecture && boundDecision) {
      const gates = architectureHumanGatesForLandingUnit({
        architecture,
        landingUnitId: boundDecision.landing_unit.id,
      });
      const prerequisites = architectureExecutionPrerequisitesForLandingUnit({
        architecture,
        landingUnitId: boundDecision.landing_unit.id,
      });
      const statusIds = [...new Set([
        ...gates.map((gate) => gate.authority_work_item_id),
        ...prerequisites.start.map((entry) => entry.work_item_id),
        ...prerequisites.close.map((entry) => entry.work_item_id),
      ])];
      try {
        const statuses = statusIds.length > 0
          ? await artifactAdapter.statuses(statusIds)
          : [];
        const statusById = new Map(
          statusIds.map((id, index) => [id, statuses[index]]),
        );
        architectureGateBindings = gates.map((gate) => ({
          gate,
          status: statusById.get(gate.authority_work_item_id),
        }));
        architecturePrerequisiteBindings = {
          close: prerequisites.close.map((entry) => ({
            ...entry,
            status: statusById.get(entry.work_item_id),
          })),
          start: prerequisites.start.map((entry) => ({
            ...entry,
            status: statusById.get(entry.work_item_id),
          })),
        };
        for (const prerequisite of architecturePrerequisiteBindings.start) {
          if (!CLOSED_ART_STATES.has(String(prerequisite.status).toLowerCase())) {
            blockers.push(configuredPathBlocker({
              authority: prerequisite.owner_repo,
              code: "architecture-prerequisite-required",
              inputs: { work_item_id: prerequisite.work_item_id },
              reason: `${prerequisite.work_item_id} must close before implementation starts.`,
            }));
          }
        }
        for (const binding of architectureGateBindings) {
          if (
            binding.gate.blocked_transition === "before_implementation" &&
            !CLOSED_ART_STATES.has(String(binding.status).toLowerCase())
          ) {
            blockers.push(configuredPathBlocker({
              authority: binding.gate.authority_owner_repo,
              code: "architecture-human-gate-required",
              inputs: {
                gate_id: binding.gate.gate_id,
                work_item_id: binding.gate.authority_work_item_id,
              },
              reason: binding.gate.evidence_requirement,
            }));
          }
        }
      } catch (error) {
        blockers.push(configuredPathBlocker({
          authority: "workspace-delivery-art",
          code: "architecture-status-unavailable",
          inputs: { delivery_id: current.delivery_id },
          reason: error.message,
        }));
      }
    }

    const workContract = workContractProjection({
      architecture: architecture ?? currentArchitecture,
      contexts: contexts.length > 0 ? contexts : [current],
      coveredWorkItemIds: boundDecision?.covered_work_item_ids ?? [workItemId],
    });
    for (const narrativeBlocker of workContract.completion_narrative.blockers) {
      blockers.push(configuredPathBlocker({
        authority: "workspace-delivery-art",
        code: "completion-narrative-repair-required",
        inputs: {
          issues: narrativeBlocker.issues,
          work_item_id: narrativeBlocker.work_item_id,
        },
        reason:
          `${narrativeBlocker.work_item_id} must satisfy its final narrative contract before source work starts: ${narrativeBlocker.issues.join("; ")}`,
      }));
    }

    if (
      boundDecision &&
      contexts.length > 0 &&
      workContract.completion_narrative.blockers.length === 0
    ) {
      const first = contexts[0];
      const prospectiveSession = {
        covered_work_item_ids: boundDecision.covered_work_item_ids,
        delivery_id: first.delivery_id,
        landing_unit_id: boundDecision.landing_unit.id,
        owner_repo: targetItem(first).owner_repo,
        landing_unit: {
          base_commit: "0".repeat(40),
          base_ref: boundDecision.landing_unit.base_ref,
          branch: boundDecision.landing_unit.branch,
        },
      };
      try {
        source = await sourceAdapter.inspectConfiguredPath(prospectiveSession);
        if (source.admission?.state === "blocked") {
          blockers.push(repositoryAdmissionBlocker(source.admission));
        } else if (source.base.state !== "ready") {
          blockers.push(configuredPathBlocker({
            authority: prospectiveSession.owner_repo,
            code: "source-base-refresh-required",
            inputs: {
              base_ref: source.base.ref,
              owner_repo: prospectiveSession.owner_repo,
            },
            reason: "The fetched base does not match current provider source truth.",
          }));
        }
        if (source.admission?.state !== "blocked" && source.branch.state !== "available") {
          blockers.push(configuredPathBlocker({
            authority: prospectiveSession.owner_repo,
            code: "source-branch-unavailable",
            inputs: {
              branch: source.branch.name,
              owner_repo: prospectiveSession.owner_repo,
            },
            reason: "The planned branch or worktree already exists.",
          }));
        }
        if (source.admission?.state !== "blocked" && source.owner_repo.state !== "clean") {
          blockers.push(configuredPathBlocker({
            authority: prospectiveSession.owner_repo,
            code: "owner-repo-cleanup-required",
            inputs: {
              changed_files: source.owner_repo.changed_files,
              owner_repo: prospectiveSession.owner_repo,
            },
            reason: "The owner repository has changes outside the planned Landing Unit.",
          }));
        }
        if (source.admission?.state !== "blocked" && source.identity.state !== "ready") {
          const credentialRequired = source.identity.state === "credential-required";
          blockers.push(configuredPathBlocker({
            authority: "platform-engineering",
            code: credentialRequired
              ? "agent-source-credential-required"
              : "agent-source-identity-unavailable",
            inputs: {
              base_commit: source.base.fetched_commit,
              branch: source.branch.name,
              credential_ref: source.runtime.credential_ref,
              landing_unit_id: prospectiveSession.landing_unit_id,
              owner_repo: prospectiveSession.owner_repo,
              profile_id: source.runtime.profile_id,
            },
            reason: credentialRequired
              ? "Deliver the exact non-secret Agent source credential binding before work start."
              : "Repair or activate the admitted Agent source identity before work start.",
          }));
        } else if (
          source.admission?.state !== "blocked" &&
          source.provider.state !== "ready"
        ) {
          blockers.push(configuredPathBlocker({
            authority: "platform-engineering",
            code: "source-provider-capability-required",
            inputs: {
              landing_unit_id: prospectiveSession.landing_unit_id,
              owner_repo: prospectiveSession.owner_repo,
            },
            reason: "The configured provider cannot prove access to the exact owner repository.",
          }));
        }
      } catch (error) {
        blockers.push(configuredPathBlocker({
          authority: prospectiveSession.owner_repo,
          code: error.code ?? "source-path-unavailable",
          inputs: { owner_repo: prospectiveSession.owner_repo },
          reason: error.message,
        }));
      }
    }

    const applicability = architecture?.conformance_plan
      ?.work_item_dimension_applicability
      ?.filter((entry) => boundDecision?.covered_work_item_ids.includes(
        entry.work_item_id,
      )) ?? [];
    const configuredPath = {
      schema_version: 1,
      status: blockers.length === 0 ? "implementation-ready" : "blocked",
      ready: blockers.length === 0,
      art: {
        initiative: artItemProjection(initiative),
        parent_feature: artItemProjection(parentFeature),
        target: artItemProjection(target),
      },
      landing_unit: boundDecision
        ? {
            base_ref: boundDecision.landing_unit.base_ref,
            branch: boundDecision.landing_unit.branch,
            covered_work_item_ids: boundDecision.covered_work_item_ids,
            decision: boundDecision.landing_unit.decision,
            id: boundDecision.landing_unit.id,
            owner_repo: target?.owner_repo ?? null,
            rollback_boundary: boundDecision.landing_unit.rollback_boundary,
          }
        : {
            base_ref: null,
            branch: null,
            covered_work_item_ids: [workItemId],
            decision: null,
            id: architectureLandingUnitId({
              architecture: currentArchitecture,
              coveredWorkItemIds: [workItemId],
            }),
            owner_repo: target?.owner_repo ?? null,
            rollback_boundary: null,
          },
      architecture: {
        artifact_id: currentArchitecture?.artifact_id ?? null,
        content_digest: currentArchitecture?.integrity?.content_digest ?? null,
        custody_state: currentArchitecture?.custody?.state ?? "missing",
        decision_status: currentArchitecture?.decision?.status ?? "missing",
        required: decision?.architecture?.required ??
          Boolean(architectureLandingUnitId({
            architecture: currentArchitecture,
            coveredWorkItemIds: [workItemId],
          })),
        superseded: Boolean(
          architecture && currentArchitecture && !sameArtifactReference(
            artifactReference(architecture),
            artifactReference(currentArchitecture),
          ),
        ),
      },
      source: source ?? {
        admission: { state: "pending-decision" },
        base: { fetched_commit: null, ref: decision?.landing_unit?.base_ref ?? null, remote_commit: null, state: "pending-decision" },
        branch: { local_commit: null, name: decision?.landing_unit?.branch ?? null, remote_commit: null, state: "pending-decision", worktree_present: false },
        identity: { state: "pending-decision" },
        owner_repo: { changed_files: [], name: target?.owner_repo ?? null, state: "pending-decision" },
        provider: { state: "pending-decision" },
        runtime: { credential_ref: null, profile_id: null, secret_values_embedded: false },
      },
      review: {
        human_reviewer_id: source?.identity?.human_reviewer_id ?? null,
        required: true,
      },
      validation: {
        conformance_dimensions: [...new Set(
          applicability.flatMap((entry) => entry.dimension_ids ?? []),
        )].sort(),
        target_readiness: "merge-ready",
      },
      evidence: {
        classes: [
          "acceptance-mapping",
          "changed-surfaces",
          "runtime-and-live",
          "security-and-trust",
          "tests",
          "validations",
        ],
      },
      work_contract: workContract,
      human_gates: architectureGateBindings.map((binding) => ({
        authority: binding.gate.authority_owner_repo,
        blocked_transition: binding.gate.blocked_transition,
        gate_id: binding.gate.gate_id,
        status: binding.status,
        work_item_id: binding.gate.authority_work_item_id,
      })),
      context: {
        budget_posture: "not-evaluated",
        packet_ref: null,
        required: false,
        state: "not-required",
      },
      blockers,
      next_action: blockers[0]?.next_action ?? configuredPathAction({
        authority: "operator-orchestration-service",
        code: "work-session-start-ready",
        inputs: {
          landing_unit_id: boundDecision?.landing_unit.id ?? null,
          work_item_id: workItemId,
        },
        reason: "All configured-path prerequisites are ready for work start.",
      }),
    };
    return {
      architecture,
      configuredPath,
      contexts,
      decision: boundDecision,
      decisionDraft,
      source,
    };
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

  async function statusForSession(session, workItemId, knownCurrent = null) {
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
    const current = knownCurrent ?? await continuation(workItemId);
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

    const supersession = await architectureSupersession(session);
    const architecture = session.architecture.artifact_file
      ? store.readArtifact(session, session.architecture.artifact_file)
      : null;
    const currentContexts = await Promise.all(
      session.covered_work_item_ids.map((coveredWorkItemId) =>
        coveredWorkItemId === workItemId
          ? current
          : continuation(coveredWorkItemId)),
    );
    const workContract = workContractProjection({
      architecture,
      contexts: currentContexts,
      coveredWorkItemIds: session.covered_work_item_ids,
    });
    if (supersession) {
      return resultEnvelope({
        architectureSupersession: supersessionProjection(supersession),
        context: current,
        nextAction: supersession.reconstructable
          ? {
              code: "architecture-reconstruction-required",
              command: `npm run art -- work reconstruct ${workItemId}`,
              reason:
                "The work session is pristine but bound to a superseded architecture packet.",
              authority: "operator",
            }
          : {
              code: "architecture-recovery-required",
              command: `npm run art -- item continuation ${workItemId}`,
              reason:
                "The work session has activity and cannot be rebound to the current architecture.",
              authority: "operator-orchestration-service",
            },
        session,
        state: "architecture-superseded",
        workContract,
        workItemId,
      });
    }

    const architectureGates = architectureHumanGatesForLandingUnit({
      architecture,
      landingUnitId: session.landing_unit_id,
    });
    const architecturePrerequisites =
      architectureExecutionPrerequisitesForLandingUnit({
        architecture,
        landingUnitId: session.landing_unit_id,
      });
    const securityIds = session.human_gate_work_item_ids.security_acceptance;
    const statusIds = [...new Set([
      ...architectureGates.map((gate) => gate.authority_work_item_id),
      ...architecturePrerequisites.start.map((entry) => entry.work_item_id),
      ...architecturePrerequisites.close.map((entry) => entry.work_item_id),
      ...securityIds,
    ])];
    const statuses = statusIds.length > 0
      ? await artifactAdapter.statuses(statusIds)
      : [];
    const statusById = new Map(
      statusIds.map((workItemId, index) => [workItemId, statuses[index]]),
    );
    const architectureGateBindings = architectureGates.map((gate) => ({
      gate,
      status: statusById.get(gate.authority_work_item_id),
    }));
    const architecturePrerequisiteBindings = {
      close: architecturePrerequisites.close.map((entry) => ({
        ...entry,
        status: statusById.get(entry.work_item_id),
      })),
      start: architecturePrerequisites.start.map((entry) => ({
        ...entry,
        status: statusById.get(entry.work_item_id),
      })),
    };
    const implementationPrerequisite =
      pendingArchitectureExecutionPrerequisite({
        bindings: architecturePrerequisiteBindings,
      });
    if (implementationPrerequisite) {
      return resultEnvelope({
        context: current,
        nextAction: {
          code: "architecture-prerequisite-required",
          command:
            `npm run art -- item continuation ${implementationPrerequisite.work_item_id}`,
          reason:
            `${implementationPrerequisite.work_item_id} must close before this Landing Unit can begin implementation.`,
          authority: implementationPrerequisite.owner_repo,
        },
        session,
        state: "blocked",
        workContract,
        workItemId,
      });
    }
    const implementationGate = pendingArchitectureHumanGate({
      bindings: architectureGateBindings,
    });
    if (implementationGate) {
      return resultEnvelope({
        context: current,
        nextAction: {
          code: "architecture-human-gate-required",
          command:
            `npm run art -- item continuation ${implementationGate.gate.authority_work_item_id}`,
          reason:
            `${implementationGate.gate.evidence_requirement} (${implementationGate.gate.blocked_transition})`,
          authority: implementationGate.gate.authority_owner_repo,
        },
        session,
        state: "blocked",
        workContract,
        workItemId,
      });
    }

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
        workContract,
        workItemId,
      });
    }

    const plan = buildDeliveryArtLifecycleCompatibilityPlan({
      artifactPath: (relativeFile) => store.artifactPath(session, relativeFile),
      repoRoot,
      session,
    });
    const inspected = await lifecycleController.inspect(plan);
    const securityStatuses = securityIds.map((workItemId) =>
      statusById.get(workItemId));
    const agentSource = typeof sourceAdapter.inspectAgentSource === "function"
      ? await sourceAdapter.inspectAgentSource(session)
      : null;
    const context = { ...inspected, agent_source: agentSource, repo_root: repoRoot, session };
    const pendingPrerequisite = pendingArchitectureExecutionPrerequisite({
      bindings: architecturePrerequisiteBindings,
      context,
    });
    const pendingGate = pendingArchitectureHumanGate({
      bindings: architectureGateBindings,
      context,
    });
    return resultEnvelope({
      agentSource,
      context,
      nextAction: deliveryArtWorkNextAction({
        artifactPaths: paths(session),
        context,
        pendingArchitectureGate: pendingGate,
        pendingArchitecturePrerequisite: pendingPrerequisite,
        securityStatuses,
        workItemId,
      }),
      session,
      state: pendingGate || pendingPrerequisite
        ? "blocked"
        : deliveryArtWorkSessionState(inspected.projection),
      workContract,
      workItemId,
    });
  }

  async function start(
    workItemIdInput,
    { callerId = null, decision = null, decisionPath = null, operatorId = null } = {},
  ) {
    const workItemId = normalizeWorkItemId(workItemIdInput);
    return store.withLock(workItemId, async () => {
      const existing = store.readByAlias(workItemId);
      if (existing) {
        return statusForSession(existing, workItemId);
      }
      const current = await continuation(workItemId);
      if (decision && decisionPath) {
        throw new DeliveryArtWorkSessionError(
          "delivery_art_work_session_decision_ambiguous",
          "Supply a decision object or decision path, not both.",
        );
      }
      if (!decision && !decisionPath) {
        const evaluation = await evaluateConfiguredPath(workItemId, {
          callerId,
          knownCurrent: current,
          operatorId,
        });
        const prerequisiteBlocker = evaluation.configuredPath.blockers.find(
          (entry) => entry.code !== "landing-unit-decision-required",
        );
        if (prerequisiteBlocker) {
          return resultEnvelope({
            configuredPath: evaluation.configuredPath,
            context: current,
            decisionDraft: evaluation.decisionDraft,
            nextAction: publicConfiguredPathAction(prerequisiteBlocker.next_action),
            state: "blocked",
            workItemId,
          });
        }
        const draftPath = store.writeDecisionDraft(
          workItemId,
          evaluation.decisionDraft,
        );
        return resultEnvelope({
          configuredPath: evaluation.configuredPath,
          context: current,
          decisionDraft: evaluation.decisionDraft,
          nextAction: deliveryArtWorkDecisionNextAction({
            decisionPath: draftPath,
            workItemId,
          }),
          state: "decision-required",
          workItemId,
        });
      }

      const candidateDecision = decision
        ? structuredClone(decision)
        : store.readDecision(decisionPath);
      const evaluation = await evaluateConfiguredPath(workItemId, {
        callerId,
        decision: candidateDecision,
        knownCurrent: current,
        operatorId,
      });
      if (!evaluation.configuredPath.ready) {
        return resultEnvelope({
          configuredPath: evaluation.configuredPath,
          context: current,
          nextAction: publicConfiguredPathAction(
            evaluation.configuredPath.next_action,
          ),
          state: "blocked",
          workItemId,
        });
      }
      const acceptedDecision = store.writeDecision(
        workItemId,
        evaluation.decision,
      );
      const startAcceptedDecision = async () => {
        const existingSessions = [
          acceptedDecision.landing_unit.id,
          ...acceptedDecision.covered_work_item_ids,
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
        const architecture = evaluation.architecture;
        const boundDecision = acceptedDecision;
        const first = evaluation.contexts[0];
        const baseCommit = evaluation.source.base.fetched_commit;

        const session = createDeliveryArtWorkSession({
          architectureFile: acceptedDecision.architecture.required
            ? "artifacts/architecture.json"
            : null,
          baseCommit,
          clock,
          continuation: first,
          decision: boundDecision,
        });
        const baseSessionId = session.session_id;
        let generation = 0;
        while (true) {
          const priorSession = store.readRecoveredSessionBySessionId(session.session_id);
          if (!priorSession) break;
          if (priorSession.landing_unit.branch === session.landing_unit.branch) {
            throw new DeliveryArtWorkSessionError(
              "delivery_art_work_session_recovery_branch_reuse",
              "A replacement session must use a new branch; the archived branch is retained for audit.",
            );
          }
          generation += 1;
          session.session_id = `${baseSessionId}:r${generation}`;
        }
        if (architecture) {
          store.writeArtifact(session, session.architecture.artifact_file, architecture);
        }
        store.writeArtifact(session, session.artifacts.evidence_file, evidenceTemplate(session));

        const evaluated = await authorWorkStart(session, architecture);
        store.writeArtifact(session, session.artifacts.work_start_file, evaluated);
        store.writeSession(session);
        return statusForSession(session, workItemId, first);
      };
      return store.withLock(
        "delivery-art-work-session-start",
        startAcceptedDecision,
      );
    });
  }

  async function preflight(
    workItemIdInput,
    { callerId = null, decision = null, operatorId = null } = {},
  ) {
    const workItemId = normalizeWorkItemId(workItemIdInput);
    const existing = store.readByAlias(workItemId);
    if (existing) {
      return statusForSession(existing, workItemId);
    }
    const current = await continuation(workItemId);
    const evaluation = await evaluateConfiguredPath(workItemId, {
      callerId,
      decision,
      knownCurrent: current,
      operatorId,
    });
    return resultEnvelope({
      configuredPath: evaluation.configuredPath,
      context: current,
      ...(!decision ? { decisionDraft: evaluation.decisionDraft } : {}),
      nextAction: publicConfiguredPathAction(
        evaluation.configuredPath.next_action,
      ),
      state: evaluation.configuredPath.status,
      workItemId,
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
        if (typeof sourceAdapter.inspectRepositoryAdmission === "function") {
          const admission = await sourceAdapter.inspectRepositoryAdmission(session);
          if (admission.state === "blocked") {
            const blocker = repositoryAdmissionBlocker(admission);
            return resultEnvelope({
              nextAction: publicConfiguredPathAction(blocker.next_action),
              session,
              state: "blocked",
              workItemId,
            });
          }
        }
        const current = await statusForSession(session, workItemId);
        if ([
          "architecture-human-gate-required",
          "architecture-prerequisite-required",
          "architecture-reconstruction-required",
          "architecture-recovery-required",
        ].includes(current.next_action.code)) {
          return current;
        }
        const repoRoot = await retirementController.ensureTrackedWorktree(session);
        if (typeof sourceAdapter.prepareAgentSource === "function") {
          await sourceAdapter.prepareAgentSource(session);
        }
        const plan = buildDeliveryArtLifecycleCompatibilityPlan({
          artifactPath: (relativeFile) => store.artifactPath(session, relativeFile),
          repoRoot,
          session,
        });
        let reconciled = await lifecycleController.reconcile(plan);
        const agentSource = typeof sourceAdapter.inspectAgentSource === "function"
          ? await sourceAdapter.inspectAgentSource(session)
          : null;
        const publishableSource =
          reconciled.projection.gate === "source-work" &&
          reconciled.source?.state === "unpushed" &&
          (reconciled.source?.changed_files?.length ?? 0) > 0;
        const missingPullRequest =
          reconciled.projection.gate === "pull-request" &&
          reconciled.pull_request?.state === "missing";
        if (
          (publishableSource || missingPullRequest) &&
          agentSource?.state === "ready" &&
          typeof sourceAdapter.publishAgentSource === "function"
        ) {
          await sourceAdapter.publishAgentSource(session);
          reconciled = await lifecycleController.reconcile(plan);
        }
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

  async function reconstruct(workItemIdInput) {
    const workItemId = normalizeWorkItemId(workItemIdInput);
    return store.withLock(workItemId, async () => {
      const session = store.readByAlias(workItemId);
      if (!session) {
        throw new DeliveryArtWorkSessionError(
          "delivery_art_work_session_not_started",
          "Start the work session before requesting architecture reconstruction.",
        );
      }
      return store.withLock(session.session_id, async () => {
        const supersession = await architectureSupersession(session);
        if (!supersession) {
          throw new DeliveryArtWorkSessionError(
            "delivery_art_work_session_reconstruction_not_required",
            "The work session is already bound to the current architecture packet.",
          );
        }
        if (!supersession.reconstructable) {
          throw new DeliveryArtWorkSessionError(
            "delivery_art_work_session_reconstruction_not_pristine",
            "Only a pristine work session can be reconstructed against current architecture.",
            supersessionProjection(supersession),
          );
        }

        const current = await continuation(workItemId);
        await contextsFor(
          session,
          [current],
          supersession.current_artifact,
        );
        const landingUnitId = architectureLandingUnitId({
          architecture: supersession.current_artifact,
          coveredWorkItemIds: session.covered_work_item_ids,
        });
        if (!landingUnitId) {
          throw new DeliveryArtWorkSessionError(
            "delivery_art_work_session_landing_unit_mismatch",
            "The current architecture does not define this work-session scope as one Landing Unit.",
          );
        }
        const base = await sourceAdapter.resolveBase({
          baseRef: session.landing_unit.base_ref,
          ownerRepo: session.owner_repo,
        });
        const decision = decisionWithArchitectureBindings({
          schema_version: 1,
          artifact_type: "delivery_art_work_session_decision",
          work_item_id: workItemId,
          covered_work_item_ids: session.covered_work_item_ids,
          caller_id: session.caller_id,
          operator: session.operator,
          landing_unit: {
            id: landingUnitId,
            decision: session.landing_unit.decision,
            split_reason: session.landing_unit.split_reason,
            base_ref: session.landing_unit.base_ref,
            branch: session.landing_unit.branch,
            rollback_boundary: session.landing_unit.rollback_boundary,
          },
          architecture: { required: true, artifact_location: null },
          human_gate_work_item_ids: { security_acceptance: [] },
        }, supersession.current_artifact);
        const replacement = createDeliveryArtWorkSession({
          architectureFile: "artifacts/architecture.json",
          baseCommit: base.commit,
          clock,
          continuation: current,
          decision,
        });
        const workStart = await authorWorkStart(
          replacement,
          supersession.current_artifact,
        );
        const resourceManifest = store.readResourceManifest(session);
        const confirmedCurrent = await artifactAdapter.currentArchitecture(
          session.delivery_id,
        );
        if (!sameArtifactReference(
          artifactReference(supersession.current_artifact),
          artifactReference(confirmedCurrent),
        )) {
          throw new DeliveryArtWorkSessionError(
            "delivery_art_work_session_architecture_changed",
            "The accepted architecture changed during reconstruction; retry against the new current packet.",
          );
        }
        const retired = await sourceAdapter.retirePristineSession({
          resources: resourceManifest?.resources ?? [],
          session,
        });

        const receiptBody = {
          schema_version: 1,
          artifact_type:
            "delivery_art_work_session_architecture_supersession_receipt",
          receipt_id:
            `architecture-supersession:${session.session_id}:${supersession.current_architecture.digest}`,
          delivery_id: session.delivery_id,
          landing_unit_id: landingUnitId,
          covered_work_item_ids: session.covered_work_item_ids,
          operator: session.operator,
          superseded_session: {
            architecture: supersession.bound_architecture,
            session_id: session.session_id,
            session_revision: session.updated_at,
          },
          replacement_session: {
            architecture: supersession.current_architecture,
            session_id: replacement.session_id,
            session_revision: replacement.updated_at,
          },
          pristine_proof: supersession.pristine_proof,
          resource_outcomes: retired.outcomes,
          recorded_at: clock().toISOString(),
          integrity: { content_digest: null },
        };
        const receipt = {
          ...receiptBody,
          integrity: { content_digest: canonicalDigest(receiptBody) },
        };

        store.removeSession(session);
        store.writeArtifact(
          replacement,
          replacement.architecture.artifact_file,
          supersession.current_artifact,
        );
        store.writeArtifact(
          replacement,
          replacement.artifacts.evidence_file,
          evidenceTemplate(replacement),
        );
        store.writeArtifact(
          replacement,
          replacement.artifacts.work_start_file,
          workStart,
        );
        store.writeSession(replacement);
        store.writeArchitectureSupersessionReceipt(receipt);
        return {
          ...await statusForSession(replacement, workItemId, current),
          architecture_supersession_receipt: receipt,
        };
      });
    });
  }

  async function recover(workItemIdInput, { operatorId, recovery } = {}) {
    const workItemId = normalizeWorkItemId(workItemIdInput);
    return store.withLock(workItemId, async () => {
      const session = store.readByAlias(workItemId);
      const prior = store.readRecoveryReceiptBySessionId(recovery.session_id);
      const unmerged = recovery.mode === "archive-unmerged";
      if (!session || session.session_id !== recovery.session_id) {
        if (
          prior?.work_item_id === workItemId &&
          prior.operator_id === operatorId &&
          prior.session_revision === recovery.session_revision &&
          prior.reason === recovery.reason &&
          canonicalStringify(prior.pull_request) ===
            canonicalStringify(recovery.pull_request) &&
          (prior.mode ?? null) === (recovery.mode ?? null) &&
          canonicalStringify(prior.source ?? null) === canonicalStringify(recovery.source ?? null)
        ) {
          const archived = store.readRecoveredSessionBySessionId(recovery.session_id);
          if (!archived) {
            throw new DeliveryArtWorkSessionError(
              "delivery_art_work_session_recovery_archive_missing",
              "The recovery receipt exists but the session archive is incomplete.",
            );
          }
          store.archiveRecoveredSession(archived, prior);
          return resultEnvelope({
            nextAction: {
              code: "art-blocker-review-required",
              reason: "Recovery archived the old session; review its ART blocker before starting a fresh Landing Unit.",
              authority: "workspace-delivery-art",
            },
            recoveryReceipt: prior,
            state: "recovery-recorded",
            workItemId,
          });
        }
        throw new DeliveryArtWorkSessionError(
          "delivery_art_work_session_recovery_session_mismatch",
          "Recovery must bind the exact active or already archived session.",
        );
      }
      return store.withLock(session.session_id, async () => {
        if (recovery.session_revision !== session.updated_at) {
          throw new DeliveryArtWorkSessionError(
            "delivery_art_work_session_recovery_revision_mismatch",
            "Recovery must bind the current session revision.",
          );
        }
        const context = await continuation(workItemId);
        const target = targetItem(context);
        if (
          CLOSED_ART_STATES.has(String(target.status).toLowerCase()) ||
          target.owner_repo !== session.owner_repo ||
          session.operator.id !== operatorId
        ) {
          throw new DeliveryArtWorkSessionError(
            "delivery_art_work_session_recovery_target_invalid",
            "Recovery requires an open ART item with the original owner and operator.",
          );
        }
        const projected = await statusForSession(session, workItemId, context);
        if (
          projected.next_action?.code !== "architecture-recovery-required" &&
          (!unmerged || projected.state !== "architecture-superseded") &&
          projected.projection?.state !== "pre-merge-source-binding-invalid"
        ) {
          throw new DeliveryArtWorkSessionError(
            "delivery_art_work_session_recovery_not_required",
            "Only a superseded active session or invalid pre-merge source binding can use recovery.",
          );
        }
        if (
          store.readArtifact(session, session.artifacts.review_packet_file) !== null ||
          store.readArtifact(session, session.artifacts.readiness_receipt_file) !== null
        ) {
          throw new DeliveryArtWorkSessionError(
            "delivery_art_work_session_recovery_evidence_exists",
            "A session with Review Packet or readiness evidence cannot be archived by this recovery path.",
          );
        }
        const pullRequest = await sourceAdapter.inspectPullRequest(session);
        let sourceProof = null;
        if (unmerged) {
          const supersession = await architectureSupersession(session);
          const source = supersession?.pristine_proof.source;
          if (
            projected.state !== "architecture-superseded" ||
            !supersession?.pristine_proof.evidence_pristine ||
            !supersession?.pristine_proof.readiness_receipt_absent ||
            !supersession?.pristine_proof.review_packet_absent ||
            !supersession?.pristine_proof.current_landing_unit_id ||
            pullRequest?.state !== "missing" ||
            source?.pull_request?.state !== "missing" ||
            source?.remote_branch_head !== null ||
            source?.worktree_present !== true ||
            source?.changed_files?.length !== 0 ||
            !/^[0-9a-f]{40}$/.test(source?.local_branch_head ?? "") ||
            source.local_branch_head !== source.worktree_head ||
            source.local_branch_head !== recovery.source.local_branch_head ||
            source.worktree_head !== recovery.source.worktree_head
          ) {
            throw new DeliveryArtWorkSessionError(
              "delivery_art_work_session_recovery_source_mismatch",
              "Unmerged recovery requires clean local source at the exact stated head, no remote branch or PR, and no completion evidence.",
            );
          }
          sourceProof = {
            changed_files: source.changed_files,
            local_branch_head: source.local_branch_head,
            pull_request_state: pullRequest.state,
            remote_branch_head: source.remote_branch_head,
            worktree_head: source.worktree_head,
            worktree_present: source.worktree_present,
          };
        } else if (
          pullRequest?.state !== "merged" ||
          pullRequest.base_ref !== session.landing_unit.base_ref.replace(/^origin\//, "") ||
          !/^[0-9a-f]{40}$/.test(pullRequest.head_commit ?? "") ||
          !/^[0-9a-f]{40}$/.test(pullRequest.merge_commit ?? "") ||
          canonicalStringify({
            url: pullRequest.url,
            head_commit: pullRequest.head_commit,
            merge_commit: pullRequest.merge_commit,
          }) !== canonicalStringify(recovery.pull_request)
        ) {
          throw new DeliveryArtWorkSessionError(
            "delivery_art_work_session_recovery_pr_mismatch",
            "The live merged PR does not match the operator's exact recovery decision.",
          );
        }
        const receiptBody = {
          schema_version: 1,
          artifact_type: "delivery_art_work_session_recovery_receipt",
          receipt_id: `work-session-recovery:${session.session_id}`,
          delivery_id: session.delivery_id,
          work_item_id: workItemId,
          session_id: session.session_id,
          session_revision: session.updated_at,
          session_digest: canonicalDigest(session),
          landing_unit_id: session.landing_unit_id,
          caller_id: session.caller_id,
          operator_id: operatorId,
          reason: recovery.reason,
          pull_request: recovery.pull_request ?? null,
          ...(unmerged ? {
            mode: recovery.mode,
            source: recovery.source,
            source_proof: sourceProof,
          } : {}),
          missing_premerge_review_packet: true,
          missing_readiness_receipt: true,
          recorded_at: clock().toISOString(),
          integrity: { content_digest: null },
        };
        const proposedReceipt = {
          ...receiptBody,
          integrity: { content_digest: canonicalDigest(receiptBody) },
        };
        if (prior && (
          prior.work_item_id !== workItemId ||
          prior.operator_id !== operatorId ||
          prior.session_revision !== recovery.session_revision ||
          prior.session_digest !== canonicalDigest(session) ||
          prior.reason !== recovery.reason ||
          canonicalStringify(prior.pull_request) !== canonicalStringify(recovery.pull_request) ||
          (prior.mode ?? null) !== (recovery.mode ?? null) ||
          canonicalStringify(prior.source ?? null) !== canonicalStringify(recovery.source ?? null)
        )) {
          throw new DeliveryArtWorkSessionError(
            "delivery_art_work_session_recovery_receipt_conflict",
            "An existing recovery receipt is bound to a different decision.",
          );
        }
        const receipt = prior ?? proposedReceipt;
        store.archiveRecoveredSession(session, receipt);
        return resultEnvelope({
          nextAction: {
            code: "art-blocker-review-required",
            reason: "The old session is archived, not completed. Review the ART blocker before a fresh session starts.",
            authority: "workspace-delivery-art",
          },
          recoveryReceipt: receipt,
          state: "recovery-recorded",
          workItemId,
        });
      });
    });
  }

  async function merge(workItemIdInput) {
    const workItemId = normalizeWorkItemId(workItemIdInput);
    return store.withLock(workItemId, async () => {
      const session = store.readByAlias(workItemId);
      if (!session) {
        throw new DeliveryArtWorkSessionError(
          "delivery_art_work_session_not_started",
          "Start the work session before requesting source merge.",
        );
      }
      return store.withLock(session.session_id, async () => {
        const current = await statusForSession(session, workItemId);
        if (current.next_action.code !== "source-merge-approval-required") {
          throw new DeliveryArtWorkSessionError(
            "delivery_art_work_session_merge_not_ready",
            "Source merge requires the exact open pull request and a durable merge-ready Review Packet.",
            {
              current_state: current.state,
              next_action: current.next_action.code,
              required_gate: "source-merge",
            },
          );
        }
        const merged = await sourceAdapter.mergePullRequest(
          session,
          current.pull_request,
        );
        if (
          merged.state !== "merged" ||
          merged.url !== current.pull_request.url ||
          merged.head_commit !== current.pull_request.head_commit ||
          !merged.merge_commit
        ) {
          throw new DeliveryArtWorkSessionError(
            "delivery_art_work_session_merge_outcome_unknown",
            "Source merge did not produce exact merged pull-request evidence.",
            { merged },
          );
        }
        const updated = {
          ...session,
          state: "implementation-ready",
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
        const current = await statusForSession(session, workItemId, authoritative);
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

  return {
    close,
    continue: continueWork,
    merge,
    preflight,
    reconstruct,
    recover,
    start,
    status,
  };
}
