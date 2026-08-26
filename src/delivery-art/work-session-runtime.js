import { randomUUID } from "node:crypto";

import { createDeliveryArtLifecycleController } from "./lifecycle-controller.js";
import { createDeliveryArtLifecycleFileAdapter } from "./lifecycle-cli-adapters.js";
import { deliveryArtWorkSessionResourceRetirementCapability } from "./lifecycle.js";
import { createDeliveryArtSourceExecutorClient } from "./source-executor.js";
import { createDeliveryArtWorkSessionController } from "./work-session-controller.js";
import { createDeliveryArtWorkSessionService } from "./work-session-service.js";
import {
  validateDeliveryArtWorkSession,
  validateDeliveryArtWorkSessionDecision,
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

export function deliveryWorkItemStatus(packet) {
  return packet?.evidence_packet?.target_item?.status ??
    packet?.target_item?.status ??
    null;
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
    validateCleanupReceipt: validateDeliveryArtWorkSessionCleanupReceipt,
    validateDecision: validateDeliveryArtWorkSessionDecision,
    validateResourceManifest: validateDeliveryArtWorkSessionResourceManifest,
    validateSession: validateDeliveryArtWorkSession,
  });
  const artAdapter = {
    async statuses(workItemIds) {
      const statuses = [];
      for (const workItemId of workItemIds) {
        const packet = await deliveryService.getDeliveryWorkItemEvidencePacket({
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
    closeAdapter: null,
    contextAdapter,
    lifecycleController,
    resourceRetirementCapability: deliveryArtWorkSessionResourceRetirementCapability(),
    sourceAdapter: sourceExecutor.workSource,
    store,
  });
  return createDeliveryArtWorkSessionService({
    controller,
    executor: sourceExecutor.executor,
    store,
  });
}
