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

readonly OPENPROJECT_RELEASE="${DEVINT_OPENPROJECT_RELEASE:-devint-accepted-idea-delivery-openproject}"
readonly OPENPROJECT_SERVICE="${OPENPROJECT_RELEASE}"
readonly OPENPROJECT_LOCAL_PORT="${DEVINT_OPENPROJECT_LOCAL_PORT:-18183}"
readonly OPENPROJECT_NODE_PORT="${DEVINT_OPENPROJECT_NODE_PORT:-32183}"
readonly BROKER_LOCAL_PORT="${DEVINT_BROKER_LOCAL_PORT:-18180}"
readonly OPENPROJECT_DATA_VOLUME_SIZE="${DEVINT_OPENPROJECT_DATA_VOLUME_SIZE:-8Gi}"
readonly OPENPROJECT_POSTGRES_VOLUME_SIZE="${DEVINT_OPENPROJECT_POSTGRES_VOLUME_SIZE:-8Gi}"
readonly BROKER_DEPLOYMENT="operator-orchestration-service"
readonly BROKER_SERVICE="operator-orchestration-service"
readonly BROKER_ENV_SECRET="operator-orchestration-service-env"
readonly WORK_DESIGN_COMPOSITION_ID="work-design-advice"
readonly WORK_DESIGN_CALLER_SECRET_NAME="operator-orchestration-service-work-design-cgg-caller"
readonly WORK_DESIGN_CALLER_SECRET_KEY="CGG_WORK_DESIGN_CALLER_SECRET"
readonly REFINEMENT_CATALOG_COMPOSITION_ID="refinement-catalog"
readonly REFINEMENT_BINDING_SECRET_NAME="operator-orchestration-service-refinement-bindings"
readonly REFINEMENT_CGG_SECRET_KEY="CGG_REFINEMENT_CALLER_SECRET"
readonly CATALOG_WGCF_SECRET_KEY="WGCF_REPOSITORY_READINESS_CALLER_SECRET"
readonly CATALOG_CONTROL_SECRET_NAME="delivery-catalog-control-caller"
readonly CATALOG_CONTROL_TOKEN_KEY="OPENPROJECT_CATALOG_CONTROL_TOKEN"
readonly CATALOG_CONTROL_SHARED_SECRET_KEY="OPENPROJECT_CATALOG_CONTROL_SHARED_SECRET"
readonly CATALOG_CONTROL_CONFIG_MAP="delivery-catalog-control"
readonly CATALOG_CONTROL_MOUNT_PATH="/app/config/catalog-control"
readonly OPENPROJECT_COMPOSITION_SERVICE="openproject"
readonly REFINEMENT_WORKER_DEPLOYMENT="operator-orchestration-service-refinement-worker"
readonly ORCHESTRATION_WORKER_DEPLOYMENT="operator-orchestration-service-worker"
readonly ORCHESTRATION_WORKER_SERVICE_ACCOUNT="temporal-oos-worker"
readonly TEMPORAL_KUBERNETES_NAMESPACE="${DEVINT_TEMPORAL_KUBERNETES_NAMESPACE:-devint-temporal-${OPERATOR}}"
readonly TEMPORAL_ADDRESS="${DEVINT_TEMPORAL_ADDRESS:-temporal-frontend.${TEMPORAL_KUBERNETES_NAMESPACE}.svc:7233}"
readonly TEMPORAL_WORKFLOW_NAMESPACE="${DEVINT_TEMPORAL_WORKFLOW_NAMESPACE:-governance-${OPERATOR}}"
readonly BROKER_CALLER_ID="${DEVINT_BROKER_CALLER_ID:-${PROFILE_ID}-smoke}"
readonly OPENPROJECT_ADMIN_SECRET="${OPENPROJECT_RELEASE}-admin-secret"
readonly LOGS_DIR="${STATE_ROOT}/logs"
readonly RENDERED_DIR="${STATE_ROOT}/rendered"
readonly HELM_STATE_DIR="${STATE_ROOT}/helm"
readonly DELIVERY_ART_VIEW_SYNC_INTERVAL_SECONDS="${DEVINT_DELIVERY_ART_VIEW_SYNC_INTERVAL_SECONDS:-60}"
readonly DELIVERY_ART_VIEW_SYNC_READY_FILE="${STATE_ROOT}/delivery-art-view-sync.ready"
readonly OPENPROJECT_BACKLOG_RAW="${STATE_ROOT}/openproject-backlog-raw.txt"
readonly OPENPROJECT_BACKLOG_JSON="${STATE_ROOT}/openproject-backlog.json"
readonly OPENPROJECT_DELIVERY_ART_RAW="${STATE_ROOT}/openproject-delivery-art-raw.txt"
readonly OPENPROJECT_DELIVERY_ART_JSON="${STATE_ROOT}/openproject-delivery-art.json"
readonly OPENPROJECT_DELIVERY_ART_VIEWS_RAW="${STATE_ROOT}/openproject-delivery-art-views-raw.txt"
readonly OPENPROJECT_DELIVERY_ART_VIEWS_JSON="${STATE_ROOT}/openproject-delivery-art-views.json"
readonly OPENPROJECT_IDENTITY_RAW="${STATE_ROOT}/openproject-identity-raw.txt"
readonly OPENPROJECT_IDENTITY_JSON="${STATE_ROOT}/openproject-identity.json"
readonly OPENPROJECT_API_TOKEN_FILE="${STATE_ROOT}/openproject-api-token.txt"
readonly LOCAL_SECRETS_ENV="${STATE_ROOT}/local-secrets.env"
readonly BROKER_ENV_FILE="${STATE_ROOT}/broker.env"
readonly SMOKE_SUMMARY="${STATE_ROOT}/smoke-summary.txt"
readonly PROFILE_PROMOTION_NOTES="${STATE_ROOT}/profile-promotion-notes.md"
readonly OPENPROJECT_RUNNER_TIMEOUT_SECONDS="${DEVINT_OPENPROJECT_RUNNER_TIMEOUT_SECONDS:-180}"

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

profile_runtime_state_model() {
  python3 - "$PROFILE_JSON" <<'PY'
import json
import sys

profile = json.loads(sys.argv[1])
print(profile["runtime"]["state_model"])
PY
}

profile_summary() {
  python3 - "$PROFILE_JSON" <<'PY'
import json
import sys

profile = json.loads(sys.argv[1])
print(profile["summary"])
PY
}

profile_smoke_companion_id() {
  python3 - "$PROFILE_JSON" <<'PY'
import json
import sys

profile = json.loads(sys.argv[1])
companion = (((profile.get("testing") or {}).get("smoke") or {}).get("companion_profile_id"))
if companion:
    print(companion)
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

is_work_design_composition() {
  [[ "${DEVINT_COMPOSITION_ID:-}" == "${WORK_DESIGN_COMPOSITION_ID}" ]]
}

validate_cluster_service_url() {
  python3 - "$1" "$2" "$3" <<'PY'
import sys
from urllib.parse import urlsplit

value, service_name, service_port = sys.argv[1:]
parsed = urlsplit(value)
if (
    parsed.scheme != "http"
    or parsed.hostname is None
    or not parsed.hostname.startswith(f"{service_name}.")
    or not parsed.hostname.endswith(".svc.cluster.local")
    or parsed.port != int(service_port)
    or parsed.path not in {"", "/"}
    or parsed.query
    or parsed.fragment
    or parsed.username is not None
    or parsed.password is not None
):
    raise SystemExit(
        f"refused: {service_name} must use its declared cluster-local HTTP service endpoint"
    )
PY
}

validate_work_design_composition_context() {
  local context_base_url="${CGG_WORK_DESIGN_BASE_URL:-}"
  local gateway_base_url="${GOVERNED_AI_GATEWAY_BASE_URL:-}"
  local caller_id="${CGG_WORK_DESIGN_CALLER_ID:-}"
  local caller_secret="${CGG_WORK_DESIGN_CALLER_SECRET:-}"

  if ! is_work_design_composition &&
    [[ -n "${context_base_url}" || -n "${caller_id}" || -n "${caller_secret}" ]]; then
    echo "refused: Work Design runtime projections require the registered ${WORK_DESIGN_COMPOSITION_ID} composition." >&2
    return 2
  fi
  if ! is_work_design_composition; then
    return
  fi
  if [[ -z "${context_base_url}" || -z "${gateway_base_url}" || -z "${caller_id}" || -z "${caller_secret}" ]]; then
    echo "refused: the ${WORK_DESIGN_COMPOSITION_ID} composition did not supply every required OOS projection." >&2
    return 2
  fi
  if [[ "${caller_secret}" == *$'\n'* ]]; then
    echo "refused: the Work Design caller binding contains an invalid newline." >&2
    return 2
  fi
  if [[ "${caller_id}" != "operator-orchestration-service" ]]; then
    echo "refused: the Work Design caller identity does not match the registered composition." >&2
    return 2
  fi
  validate_cluster_service_url "${context_base_url}" "context-governance-gateway-api" 8080
  validate_cluster_service_url "${gateway_base_url}" "governed-ai-gateway" 8080
}

remove_work_design_binding() {
  kubectl_cmd -n "${NAMESPACE}" delete secret "${WORK_DESIGN_CALLER_SECRET_NAME}" \
    --ignore-not-found=true >/dev/null 2>&1 || true
}

reconcile_work_design_binding() {
  validate_work_design_composition_context
  if ! is_work_design_composition; then
    remove_work_design_binding
    return
  fi

  python3 - "${NAMESPACE}" "${WORK_DESIGN_CALLER_SECRET_NAME}" "${WORK_DESIGN_CALLER_SECRET_KEY}" <<'PY' |
import json
import os
import sys

namespace, secret_name, secret_key = sys.argv[1:]
print(json.dumps({
    "apiVersion": "v1",
    "kind": "Secret",
    "metadata": {"name": secret_name, "namespace": namespace},
    "type": "Opaque",
    "stringData": {secret_key: os.environ[secret_key]},
}))
PY
    kubectl_cmd apply -f - >/dev/null
}

work_design_runtime_state() {
  if ! command -v k3s >/dev/null 2>&1; then
    printf 'not-observed'
    return
  fi

  local context_encoded=""
  local gateway_encoded=""
  local caller_id_encoded=""
  local caller_encoded=""
  context_encoded="$(
    kubectl_cmd -n "${NAMESPACE}" get secret "${BROKER_ENV_SECRET}" \
      -o 'jsonpath={.data.CGG_WORK_DESIGN_BASE_URL}' 2>/dev/null || true
  )"
  gateway_encoded="$(
    kubectl_cmd -n "${NAMESPACE}" get secret "${BROKER_ENV_SECRET}" \
      -o 'jsonpath={.data.GOVERNED_AI_GATEWAY_BASE_URL}' 2>/dev/null || true
  )"
  caller_id_encoded="$(
    kubectl_cmd -n "${NAMESPACE}" get secret "${BROKER_ENV_SECRET}" \
      -o 'jsonpath={.data.CGG_WORK_DESIGN_CALLER_ID}' 2>/dev/null || true
  )"
  caller_encoded="$(
    kubectl_cmd -n "${NAMESPACE}" get secret "${WORK_DESIGN_CALLER_SECRET_NAME}" \
      -o "jsonpath={.data.${WORK_DESIGN_CALLER_SECRET_KEY}}" 2>/dev/null || true
  )"

  if ! is_work_design_composition; then
    if [[ -z "${context_encoded}" && -z "${caller_id_encoded}" &&
      -z "${caller_encoded}" ]]; then
      printf 'absent'
    else
      printf 'stale'
    fi
    return
  fi
  if [[ -z "${context_encoded}" || -z "${gateway_encoded}" ||
    -z "${caller_id_encoded}" || -z "${caller_encoded}" ]]; then
    printf 'missing'
    return
  fi

  local expected_context=""
  local expected_gateway=""
  local expected_caller_id=""
  local expected_caller=""
  expected_context="$(printf '%s' "${CGG_WORK_DESIGN_BASE_URL}" | base64 | tr -d '\n')"
  expected_gateway="$(printf '%s' "${GOVERNED_AI_GATEWAY_BASE_URL}" | base64 | tr -d '\n')"
  expected_caller_id="$(printf '%s' "${CGG_WORK_DESIGN_CALLER_ID}" | base64 | tr -d '\n')"
  expected_caller="$(printf '%s' "${CGG_WORK_DESIGN_CALLER_SECRET}" | base64 | tr -d '\n')"
  if [[ "${context_encoded}" == "${expected_context}" &&
    "${gateway_encoded}" == "${expected_gateway}" &&
    "${caller_id_encoded}" == "${expected_caller_id}" &&
    "${caller_encoded}" == "${expected_caller}" ]]; then
    printf 'ready'
  else
    printf 'mismatch'
  fi
}

is_refinement_catalog_composition() {
  [[ "${DEVINT_COMPOSITION_ID:-}" == "${REFINEMENT_CATALOG_COMPOSITION_ID}" ]]
}

has_refinement_catalog_projection() {
  local variable_name=""
  for variable_name in \
    CGG_REFINEMENT_BASE_URL \
    CGG_REFINEMENT_CALLER_ID \
    CGG_REFINEMENT_CALLER_SECRET \
    WGCF_REPOSITORY_READINESS_BASE_URL \
    WGCF_REPOSITORY_READINESS_CALLER_ID \
    WGCF_REPOSITORY_READINESS_CALLER_SECRET \
    OPENPROJECT_CATALOG_CONTROL_BASE_URL \
    OPENPROJECT_CATALOG_CONTROL_TOKEN \
    OPENPROJECT_CATALOG_CONTROL_SHARED_SECRET \
    OOS_REFINEMENT_RUNTIME_ENABLED \
    OOS_REFINEMENT_WORKER_ENABLED \
    OOS_REFINEMENT_EXECUTION_AUTHORIZED; do
    if [[ -n "${!variable_name:-}" ]]; then
      return 0
    fi
  done
  return 1
}

validate_cluster_service_host_port() {
  python3 - "$1" "$2" "$3" <<'PY'
import sys

value, service_name, service_port = sys.argv[1:]
host, separator, port = value.rpartition(":")
if (
    separator != ":"
    or not host.startswith(f"{service_name}.")
    or not host.endswith(".svc.cluster.local")
    or port != service_port
):
    raise SystemExit(
        f"refused: {service_name} must use its declared cluster-local host-port endpoint"
    )
PY
}

validate_composition_secret() {
  python3 - "$1" "$2" <<'PY'
import sys

value, label = sys.argv[1:]
if len(value) < 32 or "\n" in value or "\r" in value:
    raise SystemExit(f"refused: {label} is not a valid composition credential")
PY
}

validate_refinement_catalog_composition_context() {
  if ! is_refinement_catalog_composition; then
    if has_refinement_catalog_projection; then
      echo "refused: Refinement and Catalog projections require the registered ${REFINEMENT_CATALOG_COMPOSITION_ID} composition." >&2
      return 2
    fi
    return
  fi

  local required_variables=(
    CGG_REFINEMENT_BASE_URL
    CGG_REFINEMENT_CALLER_ID
    CGG_REFINEMENT_CALLER_SECRET
    GOVERNED_AI_GATEWAY_BASE_URL
    WGCF_REPOSITORY_READINESS_BASE_URL
    WGCF_REPOSITORY_READINESS_CALLER_ID
    WGCF_REPOSITORY_READINESS_CALLER_SECRET
    OPENPROJECT_CATALOG_CONTROL_BASE_URL
    OPENPROJECT_CATALOG_CONTROL_TOKEN
    OPENPROJECT_CATALOG_CONTROL_SHARED_SECRET
    OOS_REFINEMENT_RUNTIME_ENABLED
    OOS_REFINEMENT_WORKER_ENABLED
    OOS_REFINEMENT_EXECUTION_AUTHORIZED
    OOS_TEMPORAL_ADDRESS
    OOS_TEMPORAL_NAMESPACE
  )
  local variable_name=""
  for variable_name in "${required_variables[@]}"; do
    if [[ -z "${!variable_name:-}" ]]; then
      echo "refused: the ${REFINEMENT_CATALOG_COMPOSITION_ID} composition did not supply ${variable_name}." >&2
      return 2
    fi
  done

  if [[ "${CGG_REFINEMENT_CALLER_ID}" != "operator-orchestration-service" ||
    "${WGCF_REPOSITORY_READINESS_CALLER_ID}" != "operator-orchestration-service" ]]; then
    echo "refused: Refinement and Catalog caller identities do not match the registered composition." >&2
    return 2
  fi
  if [[ "${OPENPROJECT_CATALOG_CONTROL_TOKEN}" != "${OPENPROJECT_CATALOG_CONTROL_SHARED_SECRET}" ]]; then
    echo "refused: the Catalog caller token is not bound to the OpenProject shared secret." >&2
    return 2
  fi
  if [[ "${OOS_REFINEMENT_RUNTIME_ENABLED}" != "true" ||
    "${OOS_REFINEMENT_WORKER_ENABLED}" != "true" ||
    "${OOS_REFINEMENT_EXECUTION_AUTHORIZED}" != "true" ||
    "${OOS_TEMPORAL_NAMESPACE}" != "${TEMPORAL_WORKFLOW_NAMESPACE}" ]]; then
    echo "refused: Refinement activation settings do not match the registered profile bindings." >&2
    return 2
  fi

  validate_cluster_service_url "${CGG_REFINEMENT_BASE_URL}" "context-governance-gateway-api" 8080
  validate_cluster_service_url "${GOVERNED_AI_GATEWAY_BASE_URL}" "governed-ai-gateway" 8080
  validate_cluster_service_url "${WGCF_REPOSITORY_READINESS_BASE_URL}" "workspace-governance-control-fabric-api" 8080
  validate_cluster_service_url "${OPENPROJECT_CATALOG_CONTROL_BASE_URL}" "${OPENPROJECT_COMPOSITION_SERVICE}" 8080
  validate_cluster_service_host_port "${OOS_TEMPORAL_ADDRESS}" "temporal-frontend" 7233
  validate_composition_secret "${CGG_REFINEMENT_CALLER_SECRET}" "Refinement CGG caller credential"
  validate_composition_secret "${WGCF_REPOSITORY_READINESS_CALLER_SECRET}" "Catalog WGCF caller credential"
  validate_composition_secret "${OPENPROJECT_CATALOG_CONTROL_TOKEN}" "Catalog control caller credential"
}

remove_refinement_catalog_bindings() {
  kubectl_cmd -n "${NAMESPACE}" delete deployment "${REFINEMENT_WORKER_DEPLOYMENT}" \
    --ignore-not-found=true >/dev/null 2>&1 || true
  kubectl_cmd -n "${NAMESPACE}" delete secret \
    "${REFINEMENT_BINDING_SECRET_NAME}" "${CATALOG_CONTROL_SECRET_NAME}" \
    --ignore-not-found=true >/dev/null 2>&1 || true
  kubectl_cmd -n "${NAMESPACE}" delete configmap "${CATALOG_CONTROL_CONFIG_MAP}" \
    --ignore-not-found=true >/dev/null 2>&1 || true
  kubectl_cmd -n "${NAMESPACE}" delete service "${OPENPROJECT_COMPOSITION_SERVICE}" \
    --ignore-not-found=true >/dev/null 2>&1 || true
}

reconcile_refinement_catalog_bindings() {
  local platform_repo="$1"
  validate_refinement_catalog_composition_context
  if ! is_refinement_catalog_composition; then
    remove_refinement_catalog_bindings
    return
  fi

  local catalog_root="${platform_repo}/products/openproject/catalog-control"
  local required_file=""
  for required_file in \
    additional_environment.rb \
    openproject_delivery_catalog_control.rb \
    catalog-control-contract.json; do
    if [[ ! -f "${catalog_root}/${required_file}" ]]; then
      echo "refused: missing Platform Catalog control source ${catalog_root}/${required_file}." >&2
      return 2
    fi
  done

  kubectl_cmd -n "${NAMESPACE}" create configmap "${CATALOG_CONTROL_CONFIG_MAP}" \
    --from-file="${catalog_root}/additional_environment.rb" \
    --from-file="${catalog_root}/openproject_delivery_catalog_control.rb" \
    --from-file="${catalog_root}/catalog-control-contract.json" \
    --dry-run=client -o yaml | kubectl_cmd apply -f - >/dev/null

  kubectl_cmd -n "${NAMESPACE}" create secret generic "${REFINEMENT_BINDING_SECRET_NAME}" \
    --from-literal="${REFINEMENT_CGG_SECRET_KEY}=${CGG_REFINEMENT_CALLER_SECRET}" \
    --from-literal="${CATALOG_WGCF_SECRET_KEY}=${WGCF_REPOSITORY_READINESS_CALLER_SECRET}" \
    --dry-run=client -o yaml | kubectl_cmd apply -f - >/dev/null
  kubectl_cmd -n "${NAMESPACE}" create secret generic "${CATALOG_CONTROL_SECRET_NAME}" \
    --from-literal="${CATALOG_CONTROL_TOKEN_KEY}=${OPENPROJECT_CATALOG_CONTROL_TOKEN}" \
    --from-literal="${CATALOG_CONTROL_SHARED_SECRET_KEY}=${OPENPROJECT_CATALOG_CONTROL_SHARED_SECRET}" \
    --dry-run=client -o yaml | kubectl_cmd apply -f - >/dev/null

  cat <<EOF | kubectl_cmd apply -f - >/dev/null
apiVersion: v1
kind: Service
metadata:
  name: ${OPENPROJECT_COMPOSITION_SERVICE}
  namespace: ${NAMESPACE}
spec:
  type: ExternalName
  externalName: ${OPENPROJECT_SERVICE}.${NAMESPACE}.svc.cluster.local
  ports:
    - name: http
      port: 8080
      protocol: TCP
EOF
}

refinement_catalog_runtime_state() {
  if ! command -v k3s >/dev/null 2>&1; then
    printf 'not-observed'
    return
  fi

  local binding_secret=""
  local catalog_secret=""
  local catalog_extension=""
  local catalog_contract=""
  local openproject_extension=""
  local service_target=""
  local worker_available=""
  binding_secret="$(kubectl_cmd -n "${NAMESPACE}" get secret "${REFINEMENT_BINDING_SECRET_NAME}" -o name 2>/dev/null || true)"
  catalog_secret="$(kubectl_cmd -n "${NAMESPACE}" get secret "${CATALOG_CONTROL_SECRET_NAME}" -o name 2>/dev/null || true)"
  openproject_extension="$(kubectl_cmd -n "${NAMESPACE}" get configmap "${CATALOG_CONTROL_CONFIG_MAP}" -o 'jsonpath={.data.additional_environment\.rb}' 2>/dev/null || true)"
  catalog_extension="$(kubectl_cmd -n "${NAMESPACE}" get configmap "${CATALOG_CONTROL_CONFIG_MAP}" -o 'jsonpath={.data.openproject_delivery_catalog_control\.rb}' 2>/dev/null || true)"
  catalog_contract="$(kubectl_cmd -n "${NAMESPACE}" get configmap "${CATALOG_CONTROL_CONFIG_MAP}" -o 'jsonpath={.data.catalog-control-contract\.json}' 2>/dev/null || true)"
  service_target="$(kubectl_cmd -n "${NAMESPACE}" get service "${OPENPROJECT_COMPOSITION_SERVICE}" -o 'jsonpath={.spec.externalName}' 2>/dev/null || true)"
  worker_available="$(kubectl_cmd -n "${NAMESPACE}" get deployment "${REFINEMENT_WORKER_DEPLOYMENT}" -o 'jsonpath={.status.availableReplicas}' 2>/dev/null || true)"

  if ! is_refinement_catalog_composition; then
    if [[ -z "${binding_secret}" && -z "${catalog_secret}" &&
      -z "${openproject_extension}" && -z "${catalog_extension}" &&
      -z "${catalog_contract}" && -z "${service_target}" &&
      -z "${worker_available}" ]]; then
      printf 'absent'
    else
      printf 'stale'
    fi
    return
  fi
  if [[ -z "${binding_secret}" || -z "${catalog_secret}" ||
    -z "${openproject_extension}" || -z "${catalog_extension}" ||
    -z "${catalog_contract}" ||
    "${service_target}" != "${OPENPROJECT_SERVICE}.${NAMESPACE}.svc.cluster.local" ||
    "${worker_available}" != "1" ]]; then
    printf 'missing'
    return
  fi

  local variable_name=""
  local actual_encoded=""
  local expected_encoded=""
  for variable_name in \
    CGG_REFINEMENT_BASE_URL \
    CGG_REFINEMENT_CALLER_ID \
    GOVERNED_AI_GATEWAY_BASE_URL \
    WGCF_REPOSITORY_READINESS_BASE_URL \
    WGCF_REPOSITORY_READINESS_CALLER_ID \
    OPENPROJECT_CATALOG_CONTROL_BASE_URL \
    OOS_REFINEMENT_RUNTIME_ENABLED \
    OOS_REFINEMENT_WORKER_ENABLED \
    OOS_REFINEMENT_EXECUTION_AUTHORIZED \
    OOS_TEMPORAL_ADDRESS \
    OOS_TEMPORAL_NAMESPACE; do
    actual_encoded="$(kubectl_cmd -n "${NAMESPACE}" get secret "${BROKER_ENV_SECRET}" -o "jsonpath={.data.${variable_name}}" 2>/dev/null || true)"
    expected_encoded="$(printf '%s' "${!variable_name}" | base64 | tr -d '\n')"
    if [[ "${actual_encoded}" != "${expected_encoded}" ]]; then
      printf 'mismatch'
      return
    fi
  done

  actual_encoded="$(kubectl_cmd -n "${NAMESPACE}" get secret "${REFINEMENT_BINDING_SECRET_NAME}" -o "jsonpath={.data.${REFINEMENT_CGG_SECRET_KEY}}" 2>/dev/null || true)"
  expected_encoded="$(printf '%s' "${CGG_REFINEMENT_CALLER_SECRET}" | base64 | tr -d '\n')"
  if [[ "${actual_encoded}" != "${expected_encoded}" ]]; then
    printf 'mismatch'
    return
  fi
  actual_encoded="$(kubectl_cmd -n "${NAMESPACE}" get secret "${REFINEMENT_BINDING_SECRET_NAME}" -o "jsonpath={.data.${CATALOG_WGCF_SECRET_KEY}}" 2>/dev/null || true)"
  expected_encoded="$(printf '%s' "${WGCF_REPOSITORY_READINESS_CALLER_SECRET}" | base64 | tr -d '\n')"
  if [[ "${actual_encoded}" != "${expected_encoded}" ]]; then
    printf 'mismatch'
    return
  fi
  actual_encoded="$(kubectl_cmd -n "${NAMESPACE}" get secret "${CATALOG_CONTROL_SECRET_NAME}" -o "jsonpath={.data.${CATALOG_CONTROL_TOKEN_KEY}}" 2>/dev/null || true)"
  expected_encoded="$(printf '%s' "${OPENPROJECT_CATALOG_CONTROL_TOKEN}" | base64 | tr -d '\n')"
  if [[ "${actual_encoded}" != "${expected_encoded}" ]]; then
    printf 'mismatch'
    return
  fi
  actual_encoded="$(kubectl_cmd -n "${NAMESPACE}" get secret "${CATALOG_CONTROL_SECRET_NAME}" -o "jsonpath={.data.${CATALOG_CONTROL_SHARED_SECRET_KEY}}" 2>/dev/null || true)"
  expected_encoded="$(printf '%s' "${OPENPROJECT_CATALOG_CONTROL_SHARED_SECRET}" | base64 | tr -d '\n')"
  if [[ "${actual_encoded}" != "${expected_encoded}" ]]; then
    printf 'mismatch'
    return
  fi
  printf 'ready'
}

openproject_internal_host() {
  printf '%s.%s.svc.cluster.local:8080' "${OPENPROJECT_RELEASE}" "${NAMESPACE}"
}

openproject_internal_url() {
  printf 'http://%s' "$(openproject_internal_host)"
}

openproject_operator_host() {
  printf '%s' "${DEVINT_OPENPROJECT_HOST_HEADER:-localhost:${OPENPROJECT_LOCAL_PORT}}"
}

openproject_operator_url() {
  printf 'http://%s' "$(openproject_operator_host)"
}

openproject_web_deployment() {
  printf '%s-web' "${OPENPROJECT_RELEASE}"
}

openproject_worker_deployment() {
  printf '%s-worker-default' "${OPENPROJECT_RELEASE}"
}

openproject_hocuspocus_deployment() {
  printf '%s-hocuspocus' "${OPENPROJECT_RELEASE}"
}

openproject_memcached_deployment() {
  printf '%s-memcached' "${OPENPROJECT_RELEASE}"
}

openproject_postgresql_statefulset() {
  printf '%s-postgresql' "${OPENPROJECT_RELEASE}"
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

openproject_service_node_port() {
  kubectl_cmd -n "${NAMESPACE}" get service "${OPENPROJECT_SERVICE}" \
    -o jsonpath='{.spec.ports[?(@.name=="http")].nodePort}'
}

openproject_node_access_ready() {
  curl --fail --silent --show-error --max-time 5 \
    --header "Host: $(openproject_operator_host)" \
    "http://127.0.0.1:${OPENPROJECT_NODE_PORT}/login" >/dev/null
}

openproject_windows_access_ready() {
  command -v powershell.exe >/dev/null 2>&1 || return 2
  powershell.exe -NoProfile -Command \
    "\$response = Invoke-WebRequest -UseBasicParsing -Uri '$(openproject_operator_url)/login' -TimeoutSec 5; if (\$response.StatusCode -ge 200 -and \$response.StatusCode -lt 500) { exit 0 }; exit 1" \
    >/dev/null 2>&1
}

scale_if_present() {
  local kind="$1"
  local name="$2"
  local replicas="$3"

  if kubectl_cmd -n "${NAMESPACE}" get "${kind}" "${name}" >/dev/null 2>&1; then
    kubectl_cmd -n "${NAMESPACE}" scale "${kind}/${name}" --replicas="${replicas}" >/dev/null
  fi
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

extract_marked_json() {
  local raw_path="$1"
  local begin_marker="$2"
  local end_marker="$3"
  local target_path="$4"

  python3 - "${raw_path}" "${begin_marker}" "${end_marker}" "${target_path}" <<'PY'
import json
import pathlib
import sys

raw_path = pathlib.Path(sys.argv[1])
begin = sys.argv[2]
end = sys.argv[3]
target_path = pathlib.Path(sys.argv[4])
text = raw_path.read_text()
start = text.index(begin) + len(begin)
finish = text.index(end, start)
payload = json.loads(text[start:finish].strip())
target_path.write_text(json.dumps(payload, indent=2) + "\n")
PY
}

kubectl_exec_capture() {
  local raw_path="$1"
  local end_marker="$2"
  shift 2

  local status=0
  set +e
  timeout "${OPENPROJECT_RUNNER_TIMEOUT_SECONDS}s" \
    "${KUBECTL_CMD[@]}" -n "${NAMESPACE}" "$@" >"${raw_path}" 2>&1
  status=$?
  set -e

  if [[ ${status} -ne 0 ]] && ! grep -q "${end_marker}" "${raw_path}"; then
    cat "${raw_path}" >&2
    return "${status}"
  fi
}

run_platform_admin_capture() {
  local raw_path="$1"
  local end_marker="$2"
  shift 2

  local status=0
  set +e
  timeout "${OPENPROJECT_RUNNER_TIMEOUT_SECONDS}s" "$@" >"${raw_path}" 2>&1
  status=$?
  set -e

  if [[ ${status} -ne 0 ]] && ! grep -q "${end_marker}" "${raw_path}"; then
    cat "${raw_path}" >&2
    return "${status}"
  fi
}
