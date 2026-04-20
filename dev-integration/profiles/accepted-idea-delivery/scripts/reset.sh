#!/usr/bin/env bash
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"

bash "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/down.sh"
kubectl_cmd delete namespace "${NAMESPACE}" --ignore-not-found >/dev/null 2>&1 || true
rm -rf "${STATE_ROOT}"
