#!/usr/bin/env bash
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"

need_cmd git
need_cmd k3s
need_cmd node

readonly CONSOLE_REPO_ROOT="${DEVINT_CONSOLE_REPO_ROOT:-${WORKSPACE_ROOT}/governance-operations-console}"
readonly CONSOLE_LOCAL_PORT="${DEVINT_CONSOLE_LOCAL_PORT:-18317}"
readonly PROPOSAL_BROKER_LOCAL_PORT="${DEVINT_PROPOSAL_BROKER_LOCAL_PORT:-18281}"
readonly PROPOSAL_E2E_SUMMARY="${STATE_ROOT}/proposal-live-e2e-summary.json"
readonly PROPOSAL_E2E_SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/proposal-live-e2e.mjs"

ensure_state_dirs
ensure_local_secrets
load_local_secrets
wait_for_broker_ready

if [[ ! -f "${CONSOLE_REPO_ROOT}/package.json" ]] ||
   [[ ! -x "${CONSOLE_REPO_ROOT}/node_modules/.bin/next" ]]; then
  echo "Governance Operations Console source and installed dependencies are required at ${CONSOLE_REPO_ROOT}." >&2
  exit 1
fi

if [[ -n "$(git -C "${CONSOLE_REPO_ROOT}" status --porcelain)" ]]; then
  echo "Governance Operations Console must be clean before the live Proposal proof runs." >&2
  exit 1
fi

readonly OOS_REVISION="$(git -C "${MUTATION_SMOKE_BASE_PROFILE_ROOT}/../../.." rev-parse HEAD)"
readonly CONSOLE_REVISION="$(git -C "${CONSOLE_REPO_ROOT}" rev-parse HEAD)"

broker_pf_pid=""
console_pid=""
broker_scaled_down="false"
cleanup() {
  if [[ "${broker_scaled_down}" == "true" ]]; then
    scale_if_present deployment "${BROKER_DEPLOYMENT}" 1
    wait_for_broker_ready >/dev/null 2>&1 || true
  fi
  if [[ -n "${console_pid}" ]] && kill -0 "${console_pid}" >/dev/null 2>&1; then
    kill "${console_pid}" >/dev/null 2>&1 || true
    wait "${console_pid}" >/dev/null 2>&1 || true
  fi
  stop_port_forward "${broker_pf_pid}"
}
trap cleanup EXIT

broker_pf_pid="$(start_port_forward "${BROKER_SERVICE}" "${PROPOSAL_BROKER_LOCAL_PORT}" 8080 proposal-broker-port-forward.log)"

(
  cd "${CONSOLE_REPO_ROOT}"
  OOS_BASE_URL="http://127.0.0.1:${PROPOSAL_BROKER_LOCAL_PORT}" \
  OOS_CALLER_ID="${BROKER_CALLER_ID}" \
  OOS_CALLER_SECRET="${BROKER_CALLER_SECRET}" \
  GOVERNANCE_CONSOLE_OPERATOR_ID="${BROKER_CALLER_ID}" \
  GOVERNANCE_CONSOLE_OPERATOR_HANDLE="${OPERATOR}" \
  NEXT_TELEMETRY_DISABLED=1 \
    ./node_modules/.bin/next dev \
      --hostname 127.0.0.1 \
      --port "${CONSOLE_LOCAL_PORT}"
) >"${LOGS_DIR}/proposal-console.log" 2>&1 &
console_pid=$!

node "${PROPOSAL_E2E_SCRIPT}" \
  --base-url "http://127.0.0.1:${CONSOLE_LOCAL_PORT}" \
  --console-revision "${CONSOLE_REVISION}" \
  --oos-revision "${OOS_REVISION}" \
  --output "${PROPOSAL_E2E_SUMMARY}" \
  --wait

scale_if_present deployment "${BROKER_DEPLOYMENT}" 0
broker_scaled_down="true"
kubectl_cmd -n "${NAMESPACE}" rollout status "deployment/${BROKER_DEPLOYMENT}" --timeout=120s

node "${PROPOSAL_E2E_SCRIPT}" \
  --base-url "http://127.0.0.1:${CONSOLE_LOCAL_PORT}" \
  --console-revision "${CONSOLE_REVISION}" \
  --oos-revision "${OOS_REVISION}" \
  --outage-only \
  --output "${PROPOSAL_E2E_SUMMARY}"

scale_if_present deployment "${BROKER_DEPLOYMENT}" 1
wait_for_broker_ready
broker_scaled_down="false"

echo "Proposal live E2E proof passed."
echo "  summary: ${PROPOSAL_E2E_SUMMARY}"
echo "  console revision: ${CONSOLE_REVISION}"
echo "  OOS revision: ${OOS_REVISION}"
