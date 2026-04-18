#!/usr/bin/env bash
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"

need_cmd k3s
need_cmd python3
need_cmd node

ensure_state_dirs
ensure_local_secrets
load_local_secrets
wait_for_broker_ready

broker_pf_pid="$(start_port_forward "${BROKER_SERVICE}" "${BROKER_LOCAL_PORT}" 8080 broker-port-forward.log)"
trap 'stop_port_forward "${broker_pf_pid}"' EXIT

python3 - "http://127.0.0.1:${BROKER_LOCAL_PORT}/readyz" <<'PY'
import json
import sys
from urllib.request import urlopen

with urlopen(sys.argv[1], timeout=10) as response:
    payload = json.loads(response.read().decode("utf-8"))
    if not payload.get("ready"):
        raise SystemExit(f"broker not ready: {payload}")
PY

help_output="$(run_simulator "help" 9100)"
capture_output="$(run_simulator "Dev integration smoke $(date -u +%Y-%m-%dT%H:%M:%SZ)" 9101)"
idea_id="$(printf '%s\n' "${capture_output}" | sed -n 's/^Captured \(idea-[0-9]\+\).*/\1/p' | head -n1)"
if [[ -z "${idea_id}" ]]; then
  echo "Smoke capture did not return an idea id" >&2
  exit 1
fi

list_output="$(run_simulator "list" 9102)"
list_all_output="$(run_simulator "list all" 9103)"
show_output="$(run_simulator "show ${idea_id}" 9104)"

cat >"${SMOKE_SUMMARY}" <<EOF
idea-workflow dev-integration smoke
namespace: ${NAMESPACE}
idea_id: ${idea_id}

## /idea help
${help_output}

## /idea capture
${capture_output}

## /idea list
${list_output}

## /idea list all
${list_all_output}

## /idea show
${show_output}
EOF

cat "${SMOKE_SUMMARY}"
