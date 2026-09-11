#!/usr/bin/env bash
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"

ensure_state_dirs
ensure_local_secrets
load_local_secrets
rm -f "${DELIVERY_SOURCE_EXECUTOR_SOCKET}"

operator_repo="$(repo_path operator-orchestration-service)"
agent_source_identity_contract="${operator_repo}/contracts/delivery-art-work-session/agent-source-identity.json"
exec env \
  OOS_DELIVERY_SOURCE_EXECUTOR_ID="${DELIVERY_SOURCE_EXECUTOR_ID}" \
  OOS_DELIVERY_SOURCE_EXECUTOR_SECRET="${DELIVERY_SOURCE_EXECUTOR_SECRET}" \
  OOS_DELIVERY_SOURCE_EXECUTOR_SOCKET_PATH="${DELIVERY_SOURCE_EXECUTOR_SOCKET}" \
  OOS_DELIVERY_SOURCE_EXECUTOR_WORKSPACE_ROOT="${WORKSPACE_ROOT}" \
  OOS_AGENT_SOURCE_IDENTITY_ENABLED=true \
  OOS_AGENT_SOURCE_IDENTITY_ROOT="${AGENT_SOURCE_IDENTITY_ROOT}" \
  OOS_AGENT_SOURCE_IDENTITY_CONTRACT_PATH="${agent_source_identity_contract}" \
  node "${operator_repo}/src/delivery-art/source-executor-server.js"
