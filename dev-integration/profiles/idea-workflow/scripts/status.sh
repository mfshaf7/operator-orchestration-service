#!/usr/bin/env bash
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"

need_cmd k3s
ensure_state_dirs

echo "profile: ${PROFILE_ID}"
echo "namespace: ${NAMESPACE}"
echo "operator: ${OPERATOR}"
echo "session: ${SESSION_FILE}"
echo "state root: ${STATE_ROOT}"
echo "runtime state model: disposable"
echo
kubectl_cmd -n "${NAMESPACE}" get deploy,pods,svc || true
echo
echo "Primary UI access:"
echo "  make devint-access PROFILE=${PROFILE_ID}"
echo
echo "Broker inspection:"
echo "  k3s kubectl -n ${NAMESPACE} port-forward svc/${BROKER_SERVICE} ${BROKER_LOCAL_PORT}:8080"
echo "OpenProject inspection:"
echo "  k3s kubectl -n ${NAMESPACE} port-forward svc/${OPENPROJECT_SERVICE} ${OPENPROJECT_LOCAL_PORT}:8080"
