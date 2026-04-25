#!/usr/bin/env bash
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"

need_cmd k3s
need_cmd timeout
ensure_state_dirs

platform_repo="$(repo_path platform-engineering)"
delivery_art_views_script="${platform_repo}/products/openproject/scripts/openproject_sync_delivery_art_views.sh"

run_platform_admin_capture \
  "${OPENPROJECT_DELIVERY_ART_VIEWS_RAW}" \
  "__OPENPROJECT_DELIVERY_ART_VIEWS_END__" \
  env \
  KUBECTL="${DEVINT_KUBECTL:-k3s kubectl}" \
  OPENPROJECT_NAMESPACE="${NAMESPACE}" \
  OPENPROJECT_DEPLOYMENT="$(openproject_web_deployment)" \
  OPENPROJECT_DELIVERY_PI_NAMES="${OPENPROJECT_DELIVERY_PI_NAMES:-}" \
  "${delivery_art_views_script}"

extract_marked_json \
  "${OPENPROJECT_DELIVERY_ART_VIEWS_RAW}" \
  "__OPENPROJECT_DELIVERY_ART_VIEWS_BEGIN__" \
  "__OPENPROJECT_DELIVERY_ART_VIEWS_END__" \
  "${OPENPROJECT_DELIVERY_ART_VIEWS_JSON}"
