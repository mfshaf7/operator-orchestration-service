#!/usr/bin/env bash
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"

need_cmd k3s
need_cmd timeout
ensure_state_dirs

platform_repo="$(repo_path platform-engineering)"
delivery_art_views_runner="${platform_repo}/products/openproject/scripts/openproject_sync_delivery_art_views_runner.rb"
delivery_art_home_support="${platform_repo}/products/openproject/scripts/openproject_delivery_art_home_support.rb"
delivery_art_custom_field_support="${platform_repo}/products/openproject/scripts/openproject_delivery_art_custom_field_support.rb"
delivery_art_taxonomy_support="${platform_repo}/products/openproject/scripts/openproject_delivery_art_taxonomy_support.rb"
delivery_art_taxonomy_json="${platform_repo}/products/openproject/delivery-art-taxonomy.json"
openproject_pod="$(openproject_web_pod)"

kubectl_cmd -n "${NAMESPACE}" cp "${delivery_art_views_runner}" "${openproject_pod}:/tmp/openproject_sync_delivery_art_views_runner.rb"
kubectl_cmd -n "${NAMESPACE}" cp "${delivery_art_home_support}" "${openproject_pod}:/tmp/openproject_delivery_art_home_support.rb"
kubectl_cmd -n "${NAMESPACE}" cp "${delivery_art_custom_field_support}" "${openproject_pod}:/tmp/openproject_delivery_art_custom_field_support.rb"
kubectl_cmd -n "${NAMESPACE}" cp "${delivery_art_taxonomy_support}" "${openproject_pod}:/tmp/openproject_delivery_art_taxonomy_support.rb"
kubectl_cmd -n "${NAMESPACE}" cp "${delivery_art_taxonomy_json}" "${openproject_pod}:/tmp/delivery-art-taxonomy.json"

kubectl_exec_capture \
  "${OPENPROJECT_DELIVERY_ART_VIEWS_RAW}" \
  "__OPENPROJECT_DELIVERY_ART_VIEWS_END__" \
  exec "${openproject_pod}" -- env \
  OPENPROJECT_DELIVERY_PI_NAMES="${OPENPROJECT_DELIVERY_PI_NAMES:-}" \
  bundle exec rails runner /tmp/openproject_sync_delivery_art_views_runner.rb

extract_marked_json \
  "${OPENPROJECT_DELIVERY_ART_VIEWS_RAW}" \
  "__OPENPROJECT_DELIVERY_ART_VIEWS_BEGIN__" \
  "__OPENPROJECT_DELIVERY_ART_VIEWS_END__" \
  "${OPENPROJECT_DELIVERY_ART_VIEWS_JSON}"
