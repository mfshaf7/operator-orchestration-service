#!/usr/bin/env bash
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"

ensure_state_dirs
ensure_local_secrets
load_local_secrets
rm -f "${DELIVERY_SOURCE_EXECUTOR_SOCKET}"

operator_repo="$(repo_path operator-orchestration-service)"
agent_source_identity_contract="${operator_repo}/contracts/delivery-art-work-session/agent-source-identity.json"
source_repository_environment=()
if [[ "${DEVINT_COMPOSITION_ID:-}" == "${REFINEMENT_CATALOG_COMPOSITION_ID}" ]]; then
  # Reuse the existing Console composition's record cache and acceptance pin.
  # Standalone ART/engineering keeps the original fixed-set source lane.
  platform_repo="$(repo_path platform-engineering)"
  source_repository_authority="$(python3 - "${platform_repo}/products/governance-operations-console/complete-runtime-policy.yaml" <<'PY'
from pathlib import Path
import sys
import yaml
policy = yaml.safe_load(Path(sys.argv[1]).read_text())
root = Path(policy["runtime_state_root"])
if not root.is_absolute() or policy.get("record_authority", {}).get("enabled") is not True:
    raise SystemExit("refused: composed source admission requires its existing Platform canonical record authority")
print(root / "record-authority" / "workspace-governance")
PY
)"
  source_repository_environment=(
    OOS_RECORD_AUTHORITY_FRESHNESS_REQUIRED=true
    "OOS_WORKSPACE_INVENTORY_AUTHORITY_ROOT=${source_repository_authority}"
  )
fi
exec env \
  OOS_DELIVERY_SOURCE_EXECUTOR_ID="${DELIVERY_SOURCE_EXECUTOR_ID}" \
  OOS_DELIVERY_SOURCE_EXECUTOR_SECRET="${DELIVERY_SOURCE_EXECUTOR_SECRET}" \
  OOS_DELIVERY_SOURCE_EXECUTOR_SOCKET_PATH="${DELIVERY_SOURCE_EXECUTOR_SOCKET}" \
  OOS_DELIVERY_SOURCE_EXECUTOR_RESULT_STORE_ROOT="${DELIVERY_SOURCE_EXECUTOR_RESULT_STORE}" \
  OOS_DELIVERY_SOURCE_EXECUTOR_WORKSPACE_ROOT="${WORKSPACE_ROOT}" \
  OOS_AGENT_SOURCE_IDENTITY_ENABLED=true \
  OOS_AGENT_SOURCE_IDENTITY_ROOT="${AGENT_SOURCE_IDENTITY_ROOT}" \
  OOS_AGENT_SOURCE_IDENTITY_CONTRACT_PATH="${agent_source_identity_contract}" \
  "${source_repository_environment[@]}" \
  node "${operator_repo}/src/delivery-art/source-executor-server.js"
