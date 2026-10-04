import { chmodSync, existsSync, lstatSync, rmSync } from "node:fs";
import path from "node:path";

import { createDeliveryArtLifecycleSourceAdapter } from "./lifecycle-cli-adapters.js";
import { createDeliveryArtSourceExecutorServer } from "./source-executor.js";
import {
  createConfiguredAgentSourceIdentityAdapter,
  createDeliveryArtWorkSessionSourceAdapter,
} from "./work-session-cli-adapters.js";

const socketPath = process.env.OOS_DELIVERY_SOURCE_EXECUTOR_SOCKET_PATH;
const executorId = process.env.OOS_DELIVERY_SOURCE_EXECUTOR_ID;
const secret = process.env.OOS_DELIVERY_SOURCE_EXECUTOR_SECRET;
const workspaceRoot = process.env.OOS_DELIVERY_SOURCE_EXECUTOR_WORKSPACE_ROOT;
const resultStoreRoot = process.env.OOS_DELIVERY_SOURCE_EXECUTOR_RESULT_STORE_ROOT;

if (!socketPath || !executorId || !secret || !workspaceRoot || !resultStoreRoot) {
  throw new Error(
    "OOS_DELIVERY_SOURCE_EXECUTOR_SOCKET_PATH, OOS_DELIVERY_SOURCE_EXECUTOR_ID, " +
      "OOS_DELIVERY_SOURCE_EXECUTOR_SECRET, OOS_DELIVERY_SOURCE_EXECUTOR_WORKSPACE_ROOT, " +
      "and OOS_DELIVERY_SOURCE_EXECUTOR_RESULT_STORE_ROOT are required",
  );
}
if (
  !path.isAbsolute(socketPath) ||
  !path.isAbsolute(workspaceRoot) ||
  !path.isAbsolute(resultStoreRoot)
) {
  throw new Error("source executor socket, workspace, and result-store paths must be absolute");
}
if (Buffer.byteLength(socketPath) > 100) {
  throw new Error("source executor socket path must not exceed 100 bytes");
}
if (existsSync(socketPath)) {
  if (!lstatSync(socketPath).isSocket()) {
    throw new Error(`refused to replace non-socket path: ${socketPath}`);
  }
  rmSync(socketPath);
}

const server = createDeliveryArtSourceExecutorServer({
  adapters: {
    lifecycleSource: createDeliveryArtLifecycleSourceAdapter({ providerId: executorId }),
    workSource: createDeliveryArtWorkSessionSourceAdapter({
      agentSourceIdentity: createConfiguredAgentSourceIdentityAdapter(),
      workspaceRoot,
    }),
  },
  audit: (event) => process.stdout.write(`${JSON.stringify({
    ...event,
    event: "delivery_art_source_action",
    observed_at: new Date().toISOString(),
  })}\n`),
  executorId,
  resultStoreRoot,
  secret,
});

server.listen(socketPath, () => {
  chmodSync(socketPath, 0o600);
  process.stdout.write(`${JSON.stringify({
    event: "delivery_art_source_executor_ready",
    executor_id: executorId,
    observed_at: new Date().toISOString(),
    socket_path: socketPath,
  })}\n`);
});

function shutdown() {
  server.close(() => {
    if (existsSync(socketPath) && lstatSync(socketPath).isSocket()) {
      rmSync(socketPath);
    }
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
