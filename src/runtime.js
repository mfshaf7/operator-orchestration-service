import { loadConfig } from "./config.js";
import { createAuditLogger } from "./audit.js";
import { createOpenProjectClient } from "./openproject-client.js";
import { createDeliveryService } from "./delivery-service.js";
import { createDeliveryArtArtifactService } from "./delivery-art/service.js";
import { createWgcfArtifactRegistryClient } from "./delivery-art/wgcf-client.js";
import {
  createWgcfDeliveryArtReadinessClient,
} from "./delivery-art/wgcf-readiness-client.js";
import { createIdeaService } from "./idea-service.js";
import { createApp } from "./app.js";
import { createWgcfArtReadinessClient } from "./wgcf-art-readiness-client.js";
import { createOrchestrationService } from "./orchestration/service.js";

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
  const wgcfDeliveryArtReadinessClient = createWgcfDeliveryArtReadinessClient({
    baseUrl: config.wgcf.deliveryArtBaseUrl,
    callerId: config.wgcf.deliveryArtCallerId,
    callerSecret: config.wgcf.deliveryArtCallerSecret,
    fetchImpl,
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
  const orchestrationService = createOrchestrationService({ config });
  const app = createApp({
    audit,
    config,
    deliveryArtArtifactService,
    deliveryService,
    ideaService,
    openProjectClient,
    orchestrationService,
  });

  return {
    app,
    audit,
    config,
    deliveryArtArtifactService,
    deliveryService,
    ideaService,
    openProjectClient,
    orchestrationService,
  };
}
