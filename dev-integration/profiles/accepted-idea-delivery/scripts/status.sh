#!/usr/bin/env bash
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"

need_cmd k3s
need_cmd python3
validate_work_design_composition_context
validate_refinement_catalog_composition_context
ensure_state_dirs

runtime_state_model="$(profile_runtime_state_model)"
companion_profile_id="$(profile_smoke_companion_id)"
work_design_state="$(work_design_runtime_state)"
refinement_catalog_state="$(refinement_catalog_runtime_state)"

echo "profile: ${PROFILE_ID}"
echo "namespace: ${NAMESPACE}"
echo "operator: ${OPERATOR}"
echo "session: ${SESSION_FILE}"
echo "state root: ${STATE_ROOT}"
echo "runtime state model: ${runtime_state_model}"
echo "work design runtime: ${work_design_state}"
echo "refinement and catalog runtime: ${refinement_catalog_state}"
echo
kubectl_cmd -n "${NAMESPACE}" get deploy,pods,svc || true
echo
kubectl_cmd -n "${NAMESPACE}" get statefulset,pvc 2>/dev/null || true
echo
echo "Artifacts:"
echo "  backlog: ${OPENPROJECT_BACKLOG_JSON}"
echo "  delivery art: ${OPENPROJECT_DELIVERY_ART_JSON}"
echo "  delivery art views: ${OPENPROJECT_DELIVERY_ART_VIEWS_JSON}"
echo "  identity: ${OPENPROJECT_IDENTITY_JSON}"
echo "  broker env: ${BROKER_ENV_FILE}"
echo
echo "Primary UI access:"
echo "  URL: $(openproject_operator_url)/login"
if [[ "${runtime_state_model}" == "persistent" ]]; then
  node_port="$(openproject_service_node_port 2>/dev/null || true)"
  echo "  lifecycle: managed by PlatformCoreHostStack"
  if [[ "${node_port}" == "${OPENPROJECT_NODE_PORT}" ]]; then
    echo "  Kubernetes service: NodePort ${node_port}"
  else
    echo "  Kubernetes service: expected NodePort ${OPENPROJECT_NODE_PORT}, found ${node_port:-none}"
  fi
  if command -v curl >/dev/null 2>&1 && openproject_node_access_ready; then
    echo "  WSL node access: ready"
  else
    echo "  WSL node access: unavailable"
  fi
  if openproject_windows_access_ready; then
    echo "  Windows localhost access: ready"
  elif [[ "$?" -eq 2 ]]; then
    echo "  Windows localhost access: unverified (powershell.exe unavailable)"
  else
    echo "  Windows localhost access: unavailable"
  fi
  echo "  credentials: make devint-access PROFILE=${PROFILE_ID}"
else
  echo "  access state: foreground session required"
  echo "  command: make devint-access PROFILE=${PROFILE_ID}"
fi
if [[ "${runtime_state_model}" == "persistent" ]]; then
  echo "Suspend while preserving project history:"
  echo "  make devint-down PROFILE=${PROFILE_ID}"
  echo "Resume or reconcile the preserved runtime:"
  echo "  make devint-up PROFILE=${PROFILE_ID}"
  echo "Destructive rebuild:"
  echo "  make devint-reset PROFILE=${PROFILE_ID}"
else
  echo "Disposable teardown:"
  echo "  make devint-down PROFILE=${PROFILE_ID}"
  echo "Destructive rebuild:"
  echo "  make devint-reset PROFILE=${PROFILE_ID}"
fi
if [[ -n "${companion_profile_id}" ]]; then
  echo
  echo "Disposable mutation-smoke companion:"
  echo "  make devint-smoke PROFILE=${companion_profile_id}"
fi

if is_work_design_composition && [[ "${work_design_state}" != "ready" ]]; then
  echo "refused: composed Work Design runtime is ${work_design_state}." >&2
  exit 3
fi
if ! is_work_design_composition && [[ "${work_design_state}" == "stale" ]]; then
  echo "refused: stale Work Design projections exist outside their composition lifetime." >&2
  exit 3
fi
if is_refinement_catalog_composition && [[ "${refinement_catalog_state}" != "ready" ]]; then
  echo "refused: composed Refinement and Catalog runtime is ${refinement_catalog_state}." >&2
  exit 3
fi
if ! is_refinement_catalog_composition && [[ "${refinement_catalog_state}" == "stale" ]]; then
  echo "refused: stale Refinement or Catalog projections exist outside their composition lifetime." >&2
  exit 3
fi
echo
echo "Broker inspection:"
echo "  k3s kubectl -n ${NAMESPACE} port-forward svc/${BROKER_SERVICE} ${BROKER_LOCAL_PORT}:8080"
echo "OpenProject inspection:"
if [[ "${runtime_state_model}" == "persistent" ]]; then
  echo "  managed Windows URL: $(openproject_operator_url)/login"
  echo "  WSL NodePort: ${OPENPROJECT_NODE_PORT}"
else
  echo "  k3s kubectl -n ${NAMESPACE} port-forward svc/${OPENPROJECT_SERVICE} ${OPENPROJECT_LOCAL_PORT}:8080"
fi
