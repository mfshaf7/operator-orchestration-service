#!/usr/bin/env bash
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"

need_cmd k3s
need_cmd python3

ensure_state_dirs
ensure_local_secrets
load_local_secrets
wait_for_broker_ready

broker_pf_pid="$(start_port_forward "${BROKER_SERVICE}" "${BROKER_LOCAL_PORT}" 8080 broker-port-forward.log)"
openproject_pf_pid="$(start_port_forward "${OPENPROJECT_SERVICE}" "${OPENPROJECT_LOCAL_PORT}" 8080 openproject-port-forward.log)"
trap 'stop_port_forward "${broker_pf_pid}"; stop_port_forward "${openproject_pf_pid}"' EXIT

python3 - \
  "http://127.0.0.1:${BROKER_LOCAL_PORT}" \
  "$(openproject_operator_url)" \
  "$(openproject_operator_host)" \
  "${OPENPROJECT_API_TOKEN_FILE}" \
  "${SMOKE_SUMMARY}" \
  "${BROKER_CALLER_SECRET}" \
  "${BROKER_CALLER_ID}" <<'PY'
import json
import pathlib
import sys
import urllib.error
import urllib.request


def request_json(url, *, method="GET", body=None, headers=None):
    payload = None if body is None else json.dumps(body).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=payload,
        headers=headers or {},
        method=method,
    )
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            text = response.read().decode("utf-8")
            return response.status, json.loads(text) if text else None
    except urllib.error.HTTPError as error:
        text = error.read().decode("utf-8")
        raise RuntimeError(
            f"{method} {url} failed with {error.code}: {text or error.reason}"
        ) from error


def bearer_headers(token, host_header):
    headers = {
        "Accept": "application/json",
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    }
    if host_header:
        headers["Host"] = host_header
    return headers


def broker_headers(secret, caller_id):
    return {
        "Content-Type": "application/json",
        "x-oos-caller-id": caller_id,
        "x-oos-caller-secret": secret,
    }


broker_base = sys.argv[1].rstrip("/")
openproject_base = sys.argv[2].rstrip("/")
openproject_host_header = sys.argv[3]
token = pathlib.Path(sys.argv[4]).read_text().strip()
summary_path = pathlib.Path(sys.argv[5])
caller_secret = sys.argv[6]
caller_id = sys.argv[7]

ready_status, ready = request_json(
    f"{broker_base}/readyz",
    headers={"Accept": "application/json"},
)
if ready_status != 200 or not ready.get("ready"):
    raise SystemExit(f"Broker readiness failed: {ready}")

list_status, proposal_list = request_json(
    f"{broker_base}/v1/ideas?limit=1",
    headers=broker_headers(caller_secret, caller_id),
)
if list_status != 200:
    raise SystemExit(f"Proposal backlog list read failed: {proposal_list}")

proposal_project_status, proposal_project = request_json(
    f"{openproject_base}/api/v3/projects/workspace-proposals",
    headers=bearer_headers(token, openproject_host_header),
)
if proposal_project_status != 200 or proposal_project.get("identifier") != "workspace-proposals":
    raise SystemExit(f"Proposal project verification failed: {proposal_project}")

delivery_project_status, delivery_project = request_json(
    f"{openproject_base}/api/v3/projects/workspace-delivery-art",
    headers=bearer_headers(token, openproject_host_header),
)
if delivery_project_status != 200 or delivery_project.get("identifier") != "workspace-delivery-art":
    raise SystemExit(f"Delivery project verification failed: {delivery_project}")

summary_path.write_text(
    "\n".join(
        [
            "accepted-idea-delivery dev-integration smoke (read-only)",
            "",
            "## broker readiness",
            json.dumps(ready, indent=2),
            "",
            "## proposal backlog list read",
            json.dumps(
                {
                    "count": proposal_list.get("count"),
                    "has_more": proposal_list.get("has_more"),
                    "returned_items": len(proposal_list.get("items") or []),
                },
                indent=2,
            ),
            "",
            "## proposal project verification",
            json.dumps(
                {
                    "identifier": proposal_project.get("identifier"),
                    "name": proposal_project.get("name"),
                },
                indent=2,
            ),
            "",
            "## delivery-art project verification",
            json.dumps(
                {
                    "identifier": delivery_project.get("identifier"),
                    "name": delivery_project.get("name"),
                },
                indent=2,
            ),
            "",
        ]
    )
)
print(summary_path.read_text(), end="")
PY
