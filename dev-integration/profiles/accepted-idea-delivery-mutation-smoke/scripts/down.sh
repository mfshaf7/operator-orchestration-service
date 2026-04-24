#!/usr/bin/env bash
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"

need_cmd k3s

echo "Tearing down disposable dev-integration runtime for ${PROFILE_ID} in namespace ${NAMESPACE}"
kubectl_cmd delete namespace "${NAMESPACE}" --ignore-not-found >/dev/null 2>&1 || true
echo "Disposable runtime removed. Local state root remains at ${STATE_ROOT} until reset."
