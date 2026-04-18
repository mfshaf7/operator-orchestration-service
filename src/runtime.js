import { loadConfig } from "./config.js";
import { createAuditLogger } from "./audit.js";
import { createOpenProjectClient } from "./openproject-client.js";
import { createIdeaService } from "./idea-service.js";
import { createApp } from "./app.js";

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
  const ideaService = createIdeaService({ openProjectClient, audit });
  const app = createApp({ config, ideaService, openProjectClient });

  return {
    app,
    audit,
    config,
    ideaService,
    openProjectClient,
  };
}
