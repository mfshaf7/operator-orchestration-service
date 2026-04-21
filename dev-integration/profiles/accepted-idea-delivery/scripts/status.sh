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
echo "runtime state model: persistent"
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
echo "  make devint-access PROFILE=${PROFILE_ID}"
echo "Suspend while preserving project history:"
echo "  make devint-down PROFILE=${PROFILE_ID}"
echo "Resume or reconcile the preserved runtime:"
echo "  make devint-up PROFILE=${PROFILE_ID}"
echo "Destructive rebuild:"
echo "  make devint-reset PROFILE=${PROFILE_ID}"
echo
echo "Broker inspection:"
echo "  k3s kubectl -n ${NAMESPACE} port-forward svc/${BROKER_SERVICE} ${BROKER_LOCAL_PORT}:8080"
echo "OpenProject inspection:"
echo "  k3s kubectl -n ${NAMESPACE} port-forward svc/${OPENPROJECT_SERVICE} ${OPENPROJECT_LOCAL_PORT}:8080"
