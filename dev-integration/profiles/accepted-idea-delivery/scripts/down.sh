#!/usr/bin/env bash
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"

need_cmd k3s

echo "Suspending persistent dev-integration runtime for ${PROFILE_ID} in namespace ${NAMESPACE}"
scale_if_present deployment "${BROKER_DEPLOYMENT}" 0
scale_if_present deployment "$(openproject_web_deployment)" 0
scale_if_present deployment "$(openproject_worker_deployment)" 0
scale_if_present deployment "$(openproject_hocuspocus_deployment)" 0
scale_if_present deployment "$(openproject_memcached_deployment)" 0
scale_if_present statefulset "$(openproject_postgresql_statefulset)" 0
echo "Runtime suspended. PVC-backed OpenProject data and local state remain intact."
