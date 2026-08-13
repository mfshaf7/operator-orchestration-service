#!/usr/bin/env bash
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"

need_cmd k3s
ensure_state_dirs
ensure_local_secrets
load_local_secrets
wait_for_openproject_ready

if [[ "$(profile_runtime_state_model)" == "persistent" ]]; then
  need_cmd curl
  node_port="$(openproject_service_node_port)"
  if [[ "${node_port}" != "${OPENPROJECT_NODE_PORT}" ]]; then
    echo "OpenProject NodePort is not configured; run make devint-up PROFILE=${PROFILE_ID}." >&2
    exit 1
  fi
  if ! openproject_node_access_ready; then
    echo "OpenProject is not reachable on WSL NodePort ${OPENPROJECT_NODE_PORT}." >&2
    exit 1
  fi

  echo "profile: ${PROFILE_ID}"
  echo "namespace: ${NAMESPACE}"
  echo "OpenProject URL: $(openproject_operator_url)/login"
  echo "Kubernetes access: ready on NodePort ${OPENPROJECT_NODE_PORT}"
  if openproject_windows_access_ready; then
    echo "Windows localhost access: ready"
  else
    access_result=$?
    if [[ "${access_result}" -eq 2 ]]; then
      echo "Windows localhost access: unverified (powershell.exe unavailable)"
    else
      echo "Windows localhost access: unavailable" >&2
      echo "Refresh it from platform-engineering with make openproject-refresh-devint-access." >&2
      exit 1
    fi
  fi
  echo "access lifecycle: managed by PlatformCoreHostStack"
  echo "username: admin"
  echo "password: ${OPENPROJECT_ADMIN_PASSWORD}"
  exit 0
fi

echo "profile: ${PROFILE_ID}"
echo "namespace: ${NAMESPACE}"
echo "OpenProject URL: $(openproject_operator_url)/login"
echo "username: admin"
echo "password: ${OPENPROJECT_ADMIN_PASSWORD}"
echo
echo "Keep this process running while you inspect the dev-integration UI."
echo "Press Ctrl-C to close the access session."
echo

exec "${KUBECTL_CMD[@]}" -n "${NAMESPACE}" port-forward "svc/${OPENPROJECT_SERVICE}" "${OPENPROJECT_LOCAL_PORT}:8080"
