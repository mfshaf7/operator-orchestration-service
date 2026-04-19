#!/usr/bin/env bash
set -euo pipefail

readonly PROFILE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly PROFILE_ID="${DEVINT_PROFILE_ID:?DEVINT_PROFILE_ID is required}"
readonly NAMESPACE="${DEVINT_NAMESPACE:?DEVINT_NAMESPACE is required}"
readonly OPERATOR="${DEVINT_OPERATOR:?DEVINT_OPERATOR is required}"
readonly STATE_ROOT="${DEVINT_STATE_ROOT:?DEVINT_STATE_ROOT is required}"
readonly SESSION_FILE="${DEVINT_SESSION_FILE:?DEVINT_SESSION_FILE is required}"
readonly WORKSPACE_ROOT="${DEVINT_WORKSPACE_ROOT:?DEVINT_WORKSPACE_ROOT is required}"
readonly REPO_PATHS_JSON="${DEVINT_REPO_PATHS_JSON:?DEVINT_REPO_PATHS_JSON is required}"
readonly REPO_STATES_JSON="${DEVINT_REPO_STATES_JSON:?DEVINT_REPO_STATES_JSON is required}"
readonly PROMOTION_REPORT="${DEVINT_PROMOTION_REPORT:?DEVINT_PROMOTION_REPORT is required}"
readonly PROFILE_FILE="${DEVINT_PROFILE_FILE:?DEVINT_PROFILE_FILE is required}"
readonly PROFILE_JSON="${DEVINT_PROFILE_JSON:?DEVINT_PROFILE_JSON is required}"
readonly DEVINT_KUBECONFIG_PATH="${DEVINT_KUBECONFIG:-/etc/rancher/k3s/k3s.yaml}"

export KUBECONFIG="${DEVINT_KUBECONFIG_PATH}"

read -r -a KUBECTL_CMD <<<"${DEVINT_KUBECTL:-k3s kubectl}"
read -r -a HELM_CMD <<<"${DEVINT_HELM:-helm}"

readonly OPENPROJECT_RELEASE="${DEVINT_OPENPROJECT_RELEASE:-devint-idea-workflow-openproject}"
readonly OPENPROJECT_SERVICE="${OPENPROJECT_RELEASE}-web"
readonly OPENPROJECT_LOCAL_PORT="${DEVINT_OPENPROJECT_LOCAL_PORT:-18083}"
readonly BROKER_LOCAL_PORT="${DEVINT_BROKER_LOCAL_PORT:-18080}"
readonly BROKER_DEPLOYMENT="operator-orchestration-service"
readonly BROKER_SERVICE="operator-orchestration-service"
readonly BROKER_ENV_SECRET="operator-orchestration-service-env"
readonly OPENPROJECT_ADMIN_SECRET="${OPENPROJECT_RELEASE}-admin-secret"
readonly LOGS_DIR="${STATE_ROOT}/logs"
readonly RENDERED_DIR="${STATE_ROOT}/rendered"
readonly HELM_STATE_DIR="${STATE_ROOT}/helm"
readonly OPENPROJECT_BACKLOG_RAW="${STATE_ROOT}/openproject-backlog-raw.txt"
readonly OPENPROJECT_BACKLOG_JSON="${STATE_ROOT}/openproject-backlog.json"
readonly OPENPROJECT_IDENTITY_RAW="${STATE_ROOT}/openproject-identity-raw.txt"
readonly OPENPROJECT_IDENTITY_JSON="${STATE_ROOT}/openproject-identity.json"
readonly LOCAL_SECRETS_ENV="${STATE_ROOT}/local-secrets.env"
readonly BROKER_ENV_FILE="${STATE_ROOT}/broker.env"
readonly SMOKE_SUMMARY="${STATE_ROOT}/smoke-summary.txt"
readonly PROFILE_PROMOTION_NOTES="${STATE_ROOT}/profile-promotion-notes.md"

kubectl_cmd() {
  "${KUBECTL_CMD[@]}" "$@"
}

helm_cmd() {
  "${HELM_CMD[@]}" "$@"
}

need_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

ensure_state_dirs() {
  mkdir -p "${STATE_ROOT}" "${LOGS_DIR}" "${RENDERED_DIR}" "${HELM_STATE_DIR}/cache"
}

export HELM_REPOSITORY_CONFIG="${HELM_STATE_DIR}/repositories.yaml"
export HELM_REPOSITORY_CACHE="${HELM_STATE_DIR}/cache"

repo_path() {
  python3 - "$REPO_PATHS_JSON" "$1" <<'PY'
import json
import sys

repo_paths = json.loads(sys.argv[1])
print(repo_paths[sys.argv[2]])
PY
}

repo_state_value() {
  python3 - "$REPO_STATES_JSON" "$1" "$2" <<'PY'
import json
import sys

repo_states = json.loads(sys.argv[1])
value = repo_states[sys.argv[2]][sys.argv[3]]
if value is None:
    sys.exit(0)
print(value)
PY
}

stage_handoff_required_checks_markdown() {
  python3 - "$PROFILE_JSON" <<'PY'
import json
import sys

profile = json.loads(sys.argv[1])
for check_name in profile["stage_handoff"]["required_checks"]:
    print(f"   - `{check_name}`")
PY
}

generate_random_hex() {
  python3 - <<'PY'
import secrets
print(secrets.token_hex(24))
PY
}

ensure_local_secrets() {
  if [[ -f "${LOCAL_SECRETS_ENV}" ]]; then
    return
  fi

  cat >"${LOCAL_SECRETS_ENV}" <<EOF
OPENPROJECT_ADMIN_PASSWORD=$(generate_random_hex)
BROKER_CALLER_SECRET=$(generate_random_hex)
EOF
}

load_local_secrets() {
  # shellcheck disable=SC1090
  source "${LOCAL_SECRETS_ENV}"
}

openproject_internal_host() {
  printf '%s.%s.svc.cluster.local:8080' "${OPENPROJECT_RELEASE}" "${NAMESPACE}"
}

openproject_internal_url() {
  printf 'http://%s' "$(openproject_internal_host)"
}

openproject_web_deployment() {
  printf '%s-web' "${OPENPROJECT_RELEASE}"
}

openproject_web_pod() {
  kubectl_cmd -n "${NAMESPACE}" get pod \
    -l "app.kubernetes.io/instance=${OPENPROJECT_RELEASE},app.kubernetes.io/component=web" \
    -o jsonpath='{.items[0].metadata.name}'
}

wait_for_broker_ready() {
  kubectl_cmd -n "${NAMESPACE}" rollout status deployment/${BROKER_DEPLOYMENT} --timeout=600s
}

wait_for_openproject_ready() {
  kubectl_cmd -n "${NAMESPACE}" rollout status deployment/$(openproject_web_deployment) --timeout=900s
}

start_port_forward() {
  local service_name="$1"
  local local_port="$2"
  local target_port="$3"
  local log_name="$4"

  kubectl_cmd -n "${NAMESPACE}" port-forward "svc/${service_name}" "${local_port}:${target_port}" >"${LOGS_DIR}/${log_name}" 2>&1 &
  local pf_pid=$!
  sleep 3
  if ! kill -0 "${pf_pid}" >/dev/null 2>&1; then
    echo "Port-forward for ${service_name} failed; see ${LOGS_DIR}/${log_name}" >&2
    return 1
  fi
  echo "${pf_pid}"
}

stop_port_forward() {
  local pid="$1"
  if [[ -n "${pid}" ]] && kill -0 "${pid}" >/dev/null 2>&1; then
    kill "${pid}" >/dev/null 2>&1 || true
    wait "${pid}" >/dev/null 2>&1 || true
  fi
}

run_simulator() {
  local raw_args="$1"
  local message_id="${2:-9000}"
  local telegram_repo
  local operator_repo

  telegram_repo="$(repo_path openclaw-telegram-enhanced)"
  operator_repo="$(repo_path operator-orchestration-service)"

  OPERATOR_ORCHESTRATION_BASE_URL="http://127.0.0.1:${BROKER_LOCAL_PORT}" \
  OPERATOR_ORCHESTRATION_CALLER_ID="telegram-simulator" \
  OPERATOR_ORCHESTRATION_CALLER_SECRET="${BROKER_CALLER_SECRET}" \
  DEVINT_OPENCLAW_TELEGRAM_ENHANCED_PATH="${telegram_repo}" \
  node --experimental-strip-types "${operator_repo}/dev-integration/profiles/idea-workflow/scripts/telegram_simulator.mjs" \
    --raw-args "${raw_args}" \
    --message-id "${message_id}"
}
