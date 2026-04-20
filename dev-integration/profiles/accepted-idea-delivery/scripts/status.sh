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
echo
kubectl_cmd -n "${NAMESPACE}" get deploy,pods,svc || true
echo
echo "Artifacts:"
echo "  backlog: ${OPENPROJECT_BACKLOG_JSON}"
echo "  delivery art: ${OPENPROJECT_DELIVERY_ART_JSON}"
echo "  identity: ${OPENPROJECT_IDENTITY_JSON}"
echo "  broker env: ${BROKER_ENV_FILE}"
echo
echo "Broker inspection:"
echo "  k3s kubectl -n ${NAMESPACE} port-forward svc/${BROKER_SERVICE} ${BROKER_LOCAL_PORT}:8080"
echo "OpenProject inspection:"
echo "  k3s kubectl -n ${NAMESPACE} port-forward svc/${OPENPROJECT_SERVICE} ${OPENPROJECT_LOCAL_PORT}:8080"
