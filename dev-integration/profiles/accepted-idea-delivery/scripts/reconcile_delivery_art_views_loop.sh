#!/usr/bin/env bash
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"

need_cmd k3s
need_cmd timeout
ensure_state_dirs
rm -f "${DELIVERY_ART_VIEW_SYNC_READY_FILE}"

clear_readiness() {
  rm -f "${DELIVERY_ART_VIEW_SYNC_READY_FILE}"
}

record_readiness() {
  local timestamp="$1"
  local temporary_file="${DELIVERY_ART_VIEW_SYNC_READY_FILE}.tmp.$$"

  printf 'pid=%s\nlast_success_at=%s\n' "$$" "${timestamp}" >"${temporary_file}"
  mv "${temporary_file}" "${DELIVERY_ART_VIEW_SYNC_READY_FILE}"
}

reconcile_once() {
  local timestamp
  timestamp="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "[${timestamp}] Reconciling delivery-art roadmap projection"

  if bash "${PROFILE_ROOT}/scripts/reconcile_delivery_art_views.sh"; then
    record_readiness "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    echo "[${timestamp}] Reconcile succeeded"
  else
    local status=$?
    clear_readiness
    echo "[${timestamp}] Reconcile failed with exit status ${status}" >&2
  fi
}

trap clear_readiness EXIT
trap 'exit 0' INT TERM

while true; do
  reconcile_once
  sleep "${DELIVERY_ART_VIEW_SYNC_INTERVAL_SECONDS}" &
  wait $!
done
