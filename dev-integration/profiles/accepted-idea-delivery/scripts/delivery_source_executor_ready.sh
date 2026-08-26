#!/usr/bin/env bash
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"

ensure_local_secrets
load_local_secrets
operator_repo="$(repo_path operator-orchestration-service)"

env \
  EXECUTOR_ID="${DELIVERY_SOURCE_EXECUTOR_ID}" \
  EXECUTOR_SECRET="${DELIVERY_SOURCE_EXECUTOR_SECRET}" \
  EXECUTOR_SOCKET="${DELIVERY_SOURCE_EXECUTOR_SOCKET}" \
  node --input-type=module - "${operator_repo}" <<'JS'
import { pathToFileURL } from "node:url";

const repoRoot = process.argv[2];
const { createDeliveryArtSourceExecutorClient } = await import(
  pathToFileURL(`${repoRoot}/src/delivery-art/source-executor.js`)
);
const client = createDeliveryArtSourceExecutorClient({
  executorId: process.env.EXECUTOR_ID,
  secret: process.env.EXECUTOR_SECRET,
  socketPath: process.env.EXECUTOR_SOCKET,
});
await client.executor.assertAvailable();
JS
