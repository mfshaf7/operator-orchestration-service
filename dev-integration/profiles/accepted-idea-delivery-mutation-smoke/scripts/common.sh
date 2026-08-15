#!/usr/bin/env bash
set -euo pipefail

readonly MUTATION_SMOKE_BASE_PROFILE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../accepted-idea-delivery" && pwd)"

export DEVINT_OPENPROJECT_RELEASE="${DEVINT_OPENPROJECT_RELEASE:-devint-aid-mutation-smoke-openproject}"
export DEVINT_OPENPROJECT_LOCAL_PORT="${DEVINT_OPENPROJECT_LOCAL_PORT:-18283}"
export DEVINT_OPENPROJECT_NODE_PORT="${DEVINT_OPENPROJECT_NODE_PORT:-32283}"
export DEVINT_BROKER_LOCAL_PORT="${DEVINT_BROKER_LOCAL_PORT:-18280}"
export DEVINT_BROKER_CALLER_ID="${DEVINT_BROKER_CALLER_ID:-accepted-idea-delivery-mutation-smoke}"

source "${MUTATION_SMOKE_BASE_PROFILE_ROOT}/scripts/common.sh"
