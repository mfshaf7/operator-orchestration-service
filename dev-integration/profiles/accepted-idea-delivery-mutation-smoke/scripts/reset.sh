#!/usr/bin/env bash
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"

bash "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/down.sh"
rm -rf "${STATE_ROOT}"
