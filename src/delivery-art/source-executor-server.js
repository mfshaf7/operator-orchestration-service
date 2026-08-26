import { chmodSync, existsSync, lstatSync, rmSync } from "node:fs";
import path from "node:path";

import { createDeliveryArtLifecycleSourceAdapter } from "./lifecycle-cli-adapters.js";
import { createDeliveryArtSourceExecutorServer } from "./source-executor.js";
import { createDeliveryArtWorkSessionSourceAdapter } from "./work-session-cli-adapters.js";

const socketPath = process.env.OOS_DELIVERY_SOURCE_EXECUTOR_SOCKET_PATH;
const executorId = process.env.OOS_DELIVERY_SOURCE_EXECUTOR_ID;
const secret = process.env.OOS_DELIVERY_SOURCE_EXECUTOR_SECRET;
const workspaceRoot = process.env.OOS_DELIVERY_SOURCE_EXECUTOR_WORKSPACE_ROOT;

if (!socketPath || !executorId || !secret || !workspaceRoot) {
  throw new Error(
    "OOS_DELIVERY_SOURCE_EXECUTOR_SOCKET_PATH, OOS_DELIVERY_SOURCE_EXECUTOR_ID, " +
      "OOS_DELIVERY_SOURCE_EXECUTOR_SECRET, and OOS_DELIVERY_SOURCE_EXECUTOR_WORKSPACE_ROOT are required",
  );
}
if (!path.isAbsolute(socketPath) || !path.isAbsolute(workspaceRoot)) {
  throw new Error("source executor socket and workspace root must be absolute paths");
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
    lifecycleSource: createDeliveryArtLifecycleSourceAdapter(),
    workSource: createDeliveryArtWorkSessionSourceAdapter({ workspaceRoot }),
  },
  audit: (event) => process.stdout.write(`${JSON.stringify({
    ...event,
    event: "delivery_art_source_action",
    observed_at: new Date().toISOString(),
  })}\n`),
  executorId,
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
