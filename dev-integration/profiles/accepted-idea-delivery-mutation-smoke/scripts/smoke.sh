#!/usr/bin/env bash
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"

bash "${MUTATION_SMOKE_BASE_PROFILE_ROOT}/scripts/smoke_mutating.sh"
bash "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/proposal-live-e2e.sh"
