import { randomUUID } from "node:crypto";

import { createDeliveryArtLifecycleController } from "./lifecycle-controller.js";
import { createDeliveryArtLifecycleContextClient } from "./lifecycle-context-client.js";
import { createDeliveryArtLifecycleContextService } from "./lifecycle-context.js";
import { createDeliveryArtLifecycleFileAdapter } from "./lifecycle-cli-adapters.js";
import { deliveryArtWorkSessionResourceRetirementCapability } from "./lifecycle.js";
import {
  analyzeLandingUnitCompletion,
  evaluateLandingUnitAncestorDispositions,
  submitLandingUnitCompletion,
} from "./landing-unit-completion.js";
import { createDeliveryArtSourceExecutorClient } from "./source-executor.js";
import { createDeliveryArtWorkSessionController } from "./work-session-controller.js";
import { createDeliveryArtWorkSessionService } from "./work-session-service.js";
import {
  validateDeliveryArtWorkSessionArchitectureSupersessionReceipt,
  validateDeliveryArtWorkSession,
  validateDeliveryArtWorkSessionDecision,
  validateDeliveryArtWorkSessionRecoveryReceipt,
} from "./work-session.js";
import {
  validateDeliveryArtWorkSessionCleanupReceipt,
  validateDeliveryArtWorkSessionResourceManifest,
} from "./work-session-resource-retirement.js";
import {
  createDeliveryArtWorkSessionStore,
  deliveryArtWorkStateRoot,
} from "./work-session-store.js";

const PATHS = Object.freeze({
  "/v1/delivery-art/architecture-packets/current": "currentArchitecturePacket",
  "/v1/delivery-art/architecture-packets/persist": "persistArchitecturePacket",
  "/v1/delivery-art/artifacts/resolve": "resolveArtifact",
  "/v1/delivery-art/review-evidence/project": "projectReviewEvidence",
  "/v1/delivery-art/review-packets": "draftReviewPacket",
  "/v1/delivery-art/review-packets/finalization-drafts":
    "draftReviewPacketFinalization",
  "/v1/delivery-art/review-packets/finalize": "finalizeReviewPacket",
  "/v1/delivery-art/review-packets/operating-readiness":
    "issueReviewPacketOperatingReadiness",
  "/v1/delivery-art/review-packets/readiness": "markReviewPacketMergeReady",
  "/v1/delivery-art/work-start/draft": "draftWorkStart",
  "/v1/delivery-art/work-start/evaluate": "evaluateWorkStart",
});

function artifactArguments(path, body, callerId) {
  switch (path) {
    case "/v1/delivery-art/architecture-packets/current":
      return { deliveryId: body.delivery_id };
    case "/v1/delivery-art/architecture-packets/persist":
      return { artifact: body.artifact, callerId };
    case "/v1/delivery-art/artifacts/resolve":
      return { reference: body.reference };
    case "/v1/delivery-art/review-evidence/project":
    case "/v1/delivery-art/review-packets":
    case "/v1/delivery-art/review-packets/finalization-drafts":
    case "/v1/delivery-art/work-start/draft":
      return { callerId, input: body.input };
    case "/v1/delivery-art/review-packets/finalize":
      return {
        artifact: body.review_packet,
        callerId,
        readinessReceiptRef: body.readiness_receipt_ref,
      };
    case "/v1/delivery-art/review-packets/operating-readiness":
    case "/v1/delivery-art/review-packets/readiness":
      return { artifact: body.review_packet, callerId };
    case "/v1/delivery-art/work-start/evaluate":
      return { artifact: body.artifact, callerId };
    default:
      throw new Error(`unsupported Delivery ART lifecycle route: ${path}`);
  }
}

export function deliveryWorkItemStatus(response) {
  return response?.status ?? null;
}

export function createDeliveryArtWorkSessionCloseAdapter({
  deliveryService,
  store,
} = {}) {
  async function followUp({ deliveryId }) {
    if (typeof deliveryService?.getDeliveryCloseoutReadiness !== "function") {
      throw new Error("Delivery ART getDeliveryCloseoutReadiness service is unavailable.");
    }
    const response = await deliveryService.getDeliveryCloseoutReadiness({
      callerId: "operator-orchestration-service",
      correlationId: randomUUID(),
      deliveryId,
    });
    const readiness = response?.closeoutReadiness ?? {};
    const epicStatus = String(readiness.epic?.status ?? "").toLowerCase();
    const openDescendantCount = readiness.summary?.open_descendant_count ?? null;
    const initiativeDisposition = {
      blocked_count: readiness.summary?.blocked_count ?? null,
      delivery_id: deliveryId,
      epic_status: readiness.epic?.status ?? null,
      open_descendant_count: openDescendantCount,
      ready_for_closeout: readiness.ready_for_closeout === true,
      reasons: [...(readiness.reasons ?? [])],
    };
    if (["closed", "done", "retired"].includes(epicStatus)) {
      return {
        initiative_disposition: { ...initiativeDisposition, disposition: "closed" },
        next_action: {
          code: "work-complete",
          command: `npm run art -- initiative closeout-readiness ${deliveryId} --json`,
          reason: "The Landing Unit and its Delivery initiative are closed.",
          authority: "workspace-delivery-art",
        },
      };
    }
    if (readiness.ready_for_closeout === true) {
      return {
        initiative_disposition: {
          ...initiativeDisposition,
          disposition: "ready-for-closeout",
        },
        next_action: {
          code: "initiative-closeout-required",
          command:
            `npm run art -- scaffold initiative-close ${deliveryId} ` +
            `.art/outputs/${deliveryId}-closeout.json .`,
          reason:
            "The Landing Unit is complete and the initiative is ready for its separate guided closeout.",
          authority: "workspace-delivery-art",
        },
      };
    }
    return {
      initiative_disposition: {
        ...initiativeDisposition,
        disposition: openDescendantCount > 0
          ? "retained-open-work"
          : "retained-closeout-gates",
      },
      next_action: {
        code: openDescendantCount > 0
          ? "initiative-work-remains"
          : "initiative-closeout-gates-required",
        command: `npm run art -- initiative closeout-readiness ${deliveryId} --json`,
        reason: openDescendantCount > 0
          ? `The Landing Unit is complete; ${openDescendantCount} initiative descendants remain open.`
          : "The Landing Unit is complete; initiative closeout gates remain unsatisfied.",
        authority: "workspace-delivery-art",
      },
    };
  }

  return {
    followUp,
    async close({ session, workItemId }) {
      const requiredMethods = [
        "closeStaleOpenDeliveryWorkItem",
        "completeDeliveryWorkItem",
        "getDeliveryWorkItemEvidencePacket",
      ];
      for (const method of requiredMethods) {
        if (typeof deliveryService?.[method] !== "function") {
          throw new Error(`Delivery ART ${method} service is unavailable.`);
        }
      }
      const reviewPacket = store.readArtifact(
        session,
        session.artifacts.review_packet_file,
      );
      const readEvidence = async (targetWorkItemId) => ({
        ok: true,
        response: await deliveryService.getDeliveryWorkItemEvidencePacket({
          callerId: "operator-orchestration-service",
          correlationId: randomUUID(),
          workItemId: targetWorkItemId,
        }),
      });
      const plan = await analyzeLandingUnitCompletion({
        packet: reviewPacket,
        readEvidence,
      });
      if (!plan.ready_to_submit) {
        const error = new Error(
          "The finalized Review Packet is not ready for whole-Landing-Unit closeout.",
        );
        error.code = "delivery_art_landing_unit_closeout_plan_invalid";
        error.details = { errors: plan.errors };
        throw error;
      }
      const completion = await submitLandingUnitCompletion({
        closeParent: ({ input, workItemId: targetWorkItemId }) =>
          deliveryService.closeStaleOpenDeliveryWorkItem({
            ...deliveryCompletionServiceInput(input),
            callerId: "operator-orchestration-service",
            correlationId: randomUUID(),
            staleOpenJustification: input.stale_open_justification,
            workItemId: targetWorkItemId,
          }),
        completeWorkItem: ({ input, workItemId: targetWorkItemId }) =>
          deliveryService.completeDeliveryWorkItem({
            ...deliveryCompletionServiceInput(input),
            callerId: "operator-orchestration-service",
            correlationId: randomUUID(),
            workItemId: targetWorkItemId,
          }),
        packet: reviewPacket,
        plan,
        readEvidence,
      });
      const complete = completion.failed.length === 0;
      const ancestorDispositions = complete
        ? await evaluateLandingUnitAncestorDispositions({ plan, readEvidence })
        : [];
      const followUpProjection = complete
        ? await followUp({ deliveryId: reviewPacket.delivery_id })
        : null;
      const closeout = {
        ancestor_dispositions: ancestorDispositions,
        completed: completion.completed,
        covered_work_item_ids: [...reviewPacket.covered_work_item_ids],
        failed: completion.failed,
        packet_digest: completion.packet_digest,
        packet_id: completion.packet_id,
        parent_closeouts: completion.parent_closeouts,
        initiative_disposition:
          followUpProjection?.initiative_disposition ?? null,
        skipped_work_items: completion.skipped_work_items,
        state: complete ? "complete" : "partial_failure",
      };
      return {
        closeout,
        complete,
        next_action: complete
          ? followUpProjection.next_action
          : {
              code: "landing-unit-closeout-retry-required",
              reason:
                "Landing Unit closeout stopped before every covered work item completed. Retry from authoritative ART readback.",
              authority: "operator-orchestration-service",
            },
      };
    },
  };
}

function deliveryCompletionServiceInput(input) {
  return {
    changedSurfaces: input.changed_surfaces,
    completionNote: input.completion_note,
    completionSummary: input.completion_summary,
    residualFollowUp: input.residual_follow_up,
    testResultArtifact: input.test_result_artifact,
    testResultEvidence: input.test_result_evidence,
    validationEvidence: input.validation_evidence,
  };
}

export function createDeliveryArtWorkSessionRuntime({
  artifactService,
  config,
  deliveryService,
  env = process.env,
} = {}) {
  const executorConfig = config?.deliveryArt?.workSession;
  if (!executorConfig?.executorSecret || !executorConfig?.executorSocketPath) {
    return null;
  }

  const sourceExecutor = createDeliveryArtSourceExecutorClient({
    executorId: executorConfig.executorId,
    secret: executorConfig.executorSecret,
    socketPath: executorConfig.executorSocketPath,
  });
  const store = createDeliveryArtWorkSessionStore({
    root: deliveryArtWorkStateRoot(env),
    validateArchitectureSupersessionReceipt:
      validateDeliveryArtWorkSessionArchitectureSupersessionReceipt,
    validateCleanupReceipt: validateDeliveryArtWorkSessionCleanupReceipt,
    validateDecision: validateDeliveryArtWorkSessionDecision,
    validateRecoveryReceipt: validateDeliveryArtWorkSessionRecoveryReceipt,
    validateResourceManifest: validateDeliveryArtWorkSessionResourceManifest,
    validateSession: validateDeliveryArtWorkSession,
  });
  const artAdapter = {
    async statuses(workItemIds) {
      const statuses = [];
      for (const workItemId of workItemIds) {
        const packet = await deliveryService.getDeliveryWorkItemStatus({
          callerId: "operator-orchestration-service",
          correlationId: randomUUID(),
          workItemId,
        });
        const status = deliveryWorkItemStatus(packet);
        if (!status) throw new Error(`ART status is unavailable for ${workItemId}.`);
        statuses.push(status);
      }
      return statuses;
    },
  };
  const lifecycleController = createDeliveryArtLifecycleController({
    artAdapter,
    brokerAdapter: {
      async request({ body, callerId, path }) {
        const method = PATHS[path];
        if (!method || typeof artifactService?.[method] !== "function") {
          throw new Error(`Delivery ART lifecycle route is unavailable: ${path}`);
        }
        return {
          body: await artifactService[method](artifactArguments(path, body, callerId)),
          ok: true,
        };
      },
    },
    fileAdapter: createDeliveryArtLifecycleFileAdapter(),
    sourceAdapter: sourceExecutor.lifecycleSource,
  });
  const artifactAdapter = {
    async currentArchitecture(deliveryId) {
      return (await artifactService.currentArchitecturePacket({ deliveryId })).artifact;
    },
    async draftWorkStart(input) {
      return (await artifactService.draftWorkStart(input)).work_start;
    },
    async evaluateWorkStart(input) {
      return (await artifactService.evaluateWorkStart(input)).artifact;
    },
    async persistArchitecture(input) {
      return (await artifactService.persistArchitecturePacket(input)).artifact;
    },
    statuses: artAdapter.statuses,
  };
  const contextAdapter = {
    async continuation(workItemId) {
      return deliveryService.getDeliveryWorkItemContinuationContext({
        callerId: "operator-orchestration-service",
        correlationId: randomUUID(),
        workItemId,
      });
    },
  };
  const controller = createDeliveryArtWorkSessionController({
    artifactAdapter,
    closeAdapter: createDeliveryArtWorkSessionCloseAdapter({
      deliveryService,
      store,
    }),
    contextAdapter,
    lifecycleController,
    resourceRetirementCapability: deliveryArtWorkSessionResourceRetirementCapability(),
    sourceAdapter: sourceExecutor.workSource,
    store,
  });
  const lifecycleContextConfig = executorConfig.lifecycleContext ?? {};
  const lifecycleContext = createDeliveryArtLifecycleContextService({
    contextClient: createDeliveryArtLifecycleContextClient({
      baseUrl: lifecycleContextConfig.baseUrl,
      callerId: lifecycleContextConfig.callerId,
      callerSecret: lifecycleContextConfig.callerSecret,
    }),
    defaultBudgetTokens: lifecycleContextConfig.budgetTokens,
    store,
    workSessionController: controller,
  });
  return createDeliveryArtWorkSessionService({
    controller,
    executor: sourceExecutor.executor,
    lifecycleContext,
    store,
  });
}
