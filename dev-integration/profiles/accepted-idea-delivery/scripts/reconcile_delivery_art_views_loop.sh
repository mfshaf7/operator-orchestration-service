#!/usr/bin/env bash
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"

need_cmd k3s
need_cmd timeout
ensure_state_dirs

reconcile_once() {
  local timestamp
  timestamp="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "[${timestamp}] Reconciling delivery-art roadmap projection"

  if bash "${PROFILE_ROOT}/scripts/reconcile_delivery_art_views.sh"; then
    echo "[${timestamp}] Reconcile succeeded"
  else
    local status=$?
    echo "[${timestamp}] Reconcile failed with exit status ${status}" >&2
  fi
}

trap 'exit 0' INT TERM

while true; do
  reconcile_once
  sleep "${DELIVERY_ART_VIEW_SYNC_INTERVAL_SECONDS}" &
  wait $!
done
