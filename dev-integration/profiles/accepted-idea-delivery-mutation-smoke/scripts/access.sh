#!/usr/bin/env bash
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"

exec bash "${MUTATION_SMOKE_BASE_PROFILE_ROOT}/scripts/access.sh"
