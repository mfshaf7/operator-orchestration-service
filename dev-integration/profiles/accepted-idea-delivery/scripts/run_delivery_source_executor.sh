#!/usr/bin/env bash
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"

ensure_state_dirs
ensure_local_secrets
load_local_secrets
rm -f "${DELIVERY_SOURCE_EXECUTOR_SOCKET}"

operator_repo="$(repo_path operator-orchestration-service)"
exec env \
  OOS_DELIVERY_SOURCE_EXECUTOR_ID="${DELIVERY_SOURCE_EXECUTOR_ID}" \
  OOS_DELIVERY_SOURCE_EXECUTOR_SECRET="${DELIVERY_SOURCE_EXECUTOR_SECRET}" \
  OOS_DELIVERY_SOURCE_EXECUTOR_SOCKET_PATH="${DELIVERY_SOURCE_EXECUTOR_SOCKET}" \
  OOS_DELIVERY_SOURCE_EXECUTOR_WORKSPACE_ROOT="${WORKSPACE_ROOT}" \
  node "${operator_repo}/src/delivery-art/source-executor-server.js"
