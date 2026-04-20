#!/usr/bin/env bash
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"

need_cmd helm
need_cmd k3s

helm_cmd uninstall "${OPENPROJECT_RELEASE}" --namespace "${NAMESPACE}" >/dev/null 2>&1 || true
kubectl_cmd -n "${NAMESPACE}" delete deployment "${BROKER_DEPLOYMENT}" --ignore-not-found
kubectl_cmd -n "${NAMESPACE}" delete service "${BROKER_SERVICE}" --ignore-not-found
kubectl_cmd -n "${NAMESPACE}" delete secret "${BROKER_ENV_SECRET}" --ignore-not-found
