#!/usr/bin/env bash
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"

need_cmd k3s
ensure_state_dirs
ensure_local_secrets
load_local_secrets
wait_for_openproject_ready

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
