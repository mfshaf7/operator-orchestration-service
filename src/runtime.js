import { loadConfig } from "./config.js";
import { createAuditLogger } from "./audit.js";
import { createOpenProjectClient } from "./openproject-client.js";
import { createDeliveryService } from "./delivery-service.js";
import { createDeliveryChangeService } from "./delivery-change/service.js";
import { createDeliveryCloseoutService } from "./delivery-closeout/service.js";
import { createDeliveryArtArtifactService } from "./delivery-art/service.js";
import { createDeliveryArtWorkSessionRuntime } from "./delivery-art/work-session-runtime.js";
import { createWgcfArtifactRegistryClient } from "./delivery-art/wgcf-client.js";
import {
  createWgcfDeliveryArtReadinessClient,
} from "./delivery-art/wgcf-readiness-client.js";
import { createIdeaService } from "./idea-service.js";
import { createApp } from "./app.js";
import { createWgcfArtReadinessClient } from "./wgcf-art-readiness-client.js";
import { createOrchestrationService } from "./orchestration/service.js";
import { createProposalWorkflowService } from "./proposal-workflow/service.js";
import { createProposalDeliveryIngressAdapter } from "./delivery-ingress/proposal-adapter.js";
import { createDeliveryIngressService } from "./delivery-ingress/service.js";
import { createPrototypeDeliveryIngressAdapter } from "./delivery-ingress/prototype-adapter.js";
import { createPrototypeDeliveryApplicationService } from "./delivery-ingress/prototype-application-service.js";
import { createWgcfPrototypeIngressReadinessClient } from "./delivery-ingress/wgcf-prototype-readiness-client.js";
import {
  createWorkDesignContextClient,
  createWorkDesignGatewayClient,
} from "./work-design/clients.js";
import { createWorkDesignService } from "./work-design/service.js";
import {
  createRefinementContextClient,
  createRefinementGatewayClient,
} from "./refinement/clients.js";
import { createRefinementService } from "./refinement/service.js";
import { createRefinementSourceAdapter } from "./refinement/source-adapter.js";
import { createRefinementTemporalAdapter } from "./refinement/temporal-adapter.js";
import { createCatalogBackendClient } from "./catalog/http-client.js";
import { createCatalogService } from "./catalog/service.js";
import { createWgcfRepositoryReadinessClient } from "./catalog/wgcf-readiness-client.js";
import { createRepositoryCustodyRuntime } from "./repository-custody/runtime.js";
import { createWorkspaceIntakeRuntime } from "./workspace-intake/runtime.js";
import { createWorkspaceInventoryRuntime } from "./workspace-inventory/runtime.js";
import { createRepositoryLifecycleRuntime } from "./repository-lifecycle/runtime.js";

function deriveOpenProjectRuntimeContext(baseUrl) {
  if (typeof baseUrl !== "string" || !baseUrl.trim()) {
    return {
      clusterDomain: null,
      host: null,
      namespace: null,
      serviceName: null,
    };
  }

  try {
    const url = new URL(baseUrl);
    const host = url.hostname;
    const parts = host.split(".").filter(Boolean);
    const svcIndex = parts.indexOf("svc");

    if (svcIndex === 2) {
      return {
        clusterDomain: parts.slice(3).join(".") || null,
        host,
        namespace: parts[1] || null,
        serviceName: parts[0] || null,
      };
    }

    return {
      clusterDomain: null,
      host,
      namespace: null,
      serviceName: null,
    };
  } catch {
    return {
      clusterDomain: null,
      host: null,
      namespace: null,
      serviceName: null,
    };
  }
}

export function createRuntime({
  env = process.env,
  fetchImpl,
  requestImpl,
  auditSink,
} = {}) {
  const config = loadConfig(env);
  const audit = createAuditLogger({ sink: auditSink });
  const openProjectClient = createOpenProjectClient({
    config: config.openProject,
    fetchImpl,
    requestImpl,
  });
  const wgcfArtReadinessClient = config.wgcf.artReadinessBaseUrl
    ? createWgcfArtReadinessClient({
        baseUrl: config.wgcf.artReadinessBaseUrl,
        fetchImpl,
      })
    : null;
  const ideaService = createIdeaService({ openProjectClient, audit });
  const prototypeDeliveryIngressAdapter = createPrototypeDeliveryIngressAdapter({
    openProjectClient,
  });
  const deliveryIngressService = createDeliveryIngressService({
    adapters: {
      proposal: createProposalDeliveryIngressAdapter({ openProjectClient }),
      prototype: prototypeDeliveryIngressAdapter,
    },
  });
  const proposalWorkflowService = createProposalWorkflowService({
    audit,
    deliveryIngressService,
    openProjectClient,
  });
  const wgcfDeliveryArtReadinessClient = createWgcfDeliveryArtReadinessClient({
    baseUrl: config.wgcf.deliveryArtBaseUrl,
    callerId: config.wgcf.deliveryArtCallerId,
    callerSecret: config.wgcf.deliveryArtCallerSecret,
    fetchImpl,
  });
  const prototypeDeliveryApplicationService =
    createPrototypeDeliveryApplicationService({
      adapter: prototypeDeliveryIngressAdapter,
      audit,
      deliveryIngressService,
      readinessClient: createWgcfPrototypeIngressReadinessClient({
        baseUrl: config.wgcf.deliveryArtBaseUrl,
        callerId: config.wgcf.deliveryArtCallerId,
        callerSecret: config.wgcf.deliveryArtCallerSecret,
        fetchImpl,
      }),
    });
  const deliveryArtArtifactService = createDeliveryArtArtifactService({
    audit,
    mutationAdmission: {
      admitted: config.deliveryArt.mutationEnabled,
      reason: config.deliveryArt.mutationEnabled
        ? "configured"
        : "delivery_art_runtime_activation_pending",
      writerTopology: config.deliveryArt.writerTopology,
    },
    openProjectClient,
    readinessClient: wgcfDeliveryArtReadinessClient,
    registryClient: createWgcfArtifactRegistryClient({
      baseUrl: config.wgcf.deliveryArtBaseUrl,
      callerId: config.wgcf.deliveryArtCallerId,
      callerSecret: config.wgcf.deliveryArtCallerSecret,
      fetchImpl,
    }),
  });
  const deliveryService = createDeliveryService({
    audit,
    openProjectClient,
    wgcfArtReadinessClient,
    wgcfArtReadinessMode: config.wgcf.artReadinessMode,
    runtimeContext: {
      brokerService: {
        gitCommit: config.service.gitCommit,
        name: config.service.name,
        version: config.service.version,
      },
      deliveryProjectIdentifier: config.openProject.deliveryProjectIdentifier || null,
      openProjectRuntime: deriveOpenProjectRuntimeContext(config.openProject.baseUrl),
    },
  });
  const deliveryArtWorkSessionService = createDeliveryArtWorkSessionRuntime({
    artifactService: deliveryArtArtifactService,
    config,
    deliveryService,
    env,
  });
  const workDesignService = createWorkDesignService({
    audit,
    contextClient: createWorkDesignContextClient({
      baseUrl: config.workDesign.contextBaseUrl,
      callerId: config.workDesign.contextCallerId,
      callerSecret: config.workDesign.contextCallerSecret,
      fetchImpl,
    }),
    contextCallerId: config.workDesign.contextCallerId,
    deliveryService,
    gatewayClient: createWorkDesignGatewayClient({
      baseUrl: config.workDesign.gatewayBaseUrl,
      fetchImpl,
    }),
    openProjectClient,
  });
  const refinementService = createRefinementService({
    audit,
    contextClient: createRefinementContextClient({
      baseUrl: config.refinement.contextBaseUrl,
      callerId: config.refinement.contextCallerId,
      callerSecret: config.refinement.contextCallerSecret,
      fetchImpl,
    }),
    contextCallerId: config.refinement.contextCallerId,
    gatewayClient: createRefinementGatewayClient({
      baseUrl: config.refinement.gatewayBaseUrl,
      fetchImpl,
    }),
    runAdapter: createRefinementTemporalAdapter({ config }),
    sourceAdapter: createRefinementSourceAdapter({ openProjectClient }),
  });
  const catalogService = createCatalogService({
    audit,
    backendClient: createCatalogBackendClient({
      baseUrl: config.catalog.backendBaseUrl,
      hostHeader: config.catalog.hostHeader,
      token: config.catalog.backendToken,
    }),
    readinessClient: createWgcfRepositoryReadinessClient({
      baseUrl: config.catalog.readinessBaseUrl,
      callerId: config.catalog.readinessCallerId,
      callerSecret: config.catalog.readinessCallerSecret,
      fetchImpl,
    }),
  });
  const deliveryChangeService = createDeliveryChangeService({
    audit,
    catalogService,
    deliveryService,
    openProjectClient,
  });
  const workspaceIntakeService = createWorkspaceIntakeRuntime({
    audit,
    config: config.workspaceIntake,
    fetchImpl,
  });
  const workspaceInventoryService = createWorkspaceInventoryRuntime({
    audit,
    config: config.workspaceInventory,
    fetchImpl,
  });
  const deliveryCloseoutService = createDeliveryCloseoutService({
    audit,
    deliveryService,
    openProjectClient,
    workspaceIntakeService,
  });
  const orchestrationService = createOrchestrationService({ config });
  const repositoryCustodyService = createRepositoryCustodyRuntime({
    audit,
    config: config.repositoryCustody,
    fetchImpl,
  });
  const repositoryLifecycleService = createRepositoryLifecycleRuntime({
    audit,
    config: config.repositoryLifecycle,
    fetchImpl,
  });
  const app = createApp({
    audit,
    catalogService,
    config,
    deliveryArtArtifactService,
    deliveryArtWorkSessionService,
    deliveryChangeService,
    deliveryCloseoutService,
    deliveryService,
    ideaService,
    openProjectClient,
    orchestrationService,
    proposalWorkflowService,
    prototypeDeliveryApplicationService,
    refinementService,
    repositoryCustodyService,
    repositoryLifecycleService,
    workspaceIntakeService,
    workspaceInventoryService,
    workDesignService,
  });

  return {
    app,
    audit,
    catalogService,
    config,
    deliveryArtArtifactService,
    deliveryArtWorkSessionService,
    deliveryChangeService,
    deliveryCloseoutService,
    deliveryService,
    ideaService,
    openProjectClient,
    orchestrationService,
    prototypeDeliveryApplicationService,
    refinementService,
    repositoryCustodyService,
    repositoryLifecycleService,
    workspaceIntakeService,
    workDesignService,
  };
}
