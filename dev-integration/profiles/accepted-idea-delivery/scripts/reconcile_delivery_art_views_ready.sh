#!/usr/bin/env bash
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"

[[ -s "${DELIVERY_ART_VIEW_SYNC_READY_FILE}" ]]

service_pid="$(sed -n 's/^pid=//p' "${DELIVERY_ART_VIEW_SYNC_READY_FILE}")"
last_success_at="$(sed -n 's/^last_success_at=//p' "${DELIVERY_ART_VIEW_SYNC_READY_FILE}")"

[[ "${service_pid}" =~ ^[1-9][0-9]*$ ]]
[[ -n "${last_success_at}" ]]
kill -0 "${service_pid}" >/dev/null 2>&1
