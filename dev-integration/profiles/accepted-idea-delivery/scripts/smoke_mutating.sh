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

python3 - "http://127.0.0.1:${BROKER_LOCAL_PORT}/readyz" <<'PY'
import json
import sys
from urllib.request import urlopen

with urlopen(sys.argv[1], timeout=10) as response:
    payload = json.loads(response.read().decode("utf-8"))
    if not payload.get("ready"):
        raise SystemExit(f"broker not ready: {payload}")
PY

python3 - \
  "http://127.0.0.1:${BROKER_LOCAL_PORT}" \
  "$(openproject_operator_url)" \
  "$(openproject_operator_host)" \
  "${OPENPROJECT_IDENTITY_JSON}" \
  "${OPENPROJECT_BACKLOG_JSON}" \
  "${OPENPROJECT_DELIVERY_ART_JSON}" \
  "${SMOKE_SUMMARY}" \
  "${BROKER_CALLER_SECRET}" \
  "${BROKER_CALLER_ID}" \
  "${PROFILE_ID}" <<'PY'
import json
import pathlib
import re
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


def read_custom_field(payload, field_id):
    key = f"customField{field_id}"
    if key in payload:
        return payload[key]

    linked = payload.get("_links", {}).get(key)
    if isinstance(linked, list):
        titles = [
            entry.get("title", "").strip()
            for entry in linked
            if isinstance(entry, dict) and entry.get("title", "").strip()
        ]
        return titles
    if isinstance(linked, dict):
        title = linked.get("title")
        if isinstance(title, str) and title.strip():
            return title.strip()
    return None


broker_base = sys.argv[1].rstrip("/")
openproject_base = sys.argv[2].rstrip("/")
openproject_host_header = sys.argv[3]
identity = json.loads(pathlib.Path(sys.argv[4]).read_text())
backlog = json.loads(pathlib.Path(sys.argv[5]).read_text())
delivery = json.loads(pathlib.Path(sys.argv[6]).read_text())
summary_path = pathlib.Path(sys.argv[7])
caller_secret = sys.argv[8]
caller_id = sys.argv[9]
profile_id = sys.argv[10]

token = identity["api_token"].get("plaintext_value")
if not token:
    raise SystemExit("OpenProject identity payload did not include a plaintext API token.")

backlog_fields = {
    entry["name"]: entry["id"] for entry in backlog["project"]["work_package_custom_fields"]
}
delivery_fields = {
    entry["name"]: entry["id"] for entry in delivery["project"]["work_package_custom_fields"]
}

capture_payload = {
    "title": "Accepted idea delivery devint smoke",
    "body": "Verify accepted idea consumption into the local Workspace Delivery ART project.",
    "operator": {
        "id": f"devint-{profile_id}",
        "handle": "mfshaf7",
    },
    "source": {
        "surface": "dev-integration",
        "integration_id": profile_id,
        "native_ref": {
            "command": f"{profile_id}-smoke",
            "message_id": "9201",
        },
        "context_ref": {
            "conversation_id": profile_id,
            "thread_id": "local",
        },
    },
}
capture_status, capture = request_json(
    f"{broker_base}/v1/ideas/capture",
    method="POST",
    body=capture_payload,
    headers=broker_headers(caller_secret, caller_id),
)
if capture_status != 200:
    raise SystemExit(f"Unexpected capture status: {capture_status}")
idea_id = capture["idea_id"]

triage_status, triage = request_json(
    f"{broker_base}/v1/ideas/{idea_id}/triage",
    method="POST",
    body={
        "operator": {
            "id": f"devint-{profile_id}",
            "handle": "mfshaf7",
        },
        "input": {
            "summary": "Promote the accepted proposal into a local delivery epic with durable backlinks.",
        },
    },
    headers=broker_headers(caller_secret, caller_id),
)
if triage_status != 200 or triage.get("status") != "triaged":
    raise SystemExit(f"Triage did not succeed: {triage}")

decision_status, decision = request_json(
    f"{broker_base}/v1/ideas/{idea_id}/decision",
    method="POST",
    body={
        "operator": {
            "id": f"devint-{profile_id}",
            "handle": "mfshaf7",
        },
        "input": {
            "notes": "Approved for local delivery-art consumption smoke rehearsal.",
            "status": "accepted",
        },
    },
    headers=broker_headers(caller_secret, caller_id),
)
if decision_status != 200 or decision.get("status") != "accepted":
    raise SystemExit(f"Decision did not succeed: {decision}")

lookup_status, lookup = request_json(
    f"{broker_base}/v1/ideas/{idea_id}",
    headers=broker_headers(caller_secret, caller_id),
)
if lookup_status != 200 or lookup.get("status") != "accepted":
    raise SystemExit(f"Accepted idea lookup failed: {lookup}")

project_status, delivery_project = request_json(
    f"{openproject_base}/api/v3/projects/workspace-delivery-art",
    headers=bearer_headers(token, openproject_host_header),
)
if project_status != 200 or delivery_project.get("identifier") != "workspace-delivery-art":
    raise SystemExit(f"Delivery project verification failed: {delivery_project}")

consume_status, consume = request_json(
    f"{broker_base}/v1/ideas/{idea_id}/consume",
    method="POST",
    body={
        "operator": {
            "id": f"devint-{profile_id}",
            "handle": "mfshaf7",
        },
        "input": {
            "target_pi": "PI-2026-02",
        },
    },
    headers=broker_headers(caller_secret, caller_id),
)
if consume_status != 200:
    raise SystemExit(f"Consume failed: {consume}")

delivery_ref = consume.get("delivery_ref")
if not isinstance(delivery_ref, str) or not delivery_ref.startswith("openproject://work_packages/"):
    raise SystemExit(f"Consume response did not include a delivery ref: {consume}")

delivery_record_id_match = re.search(r"/work_packages/(\d+)$", delivery_ref)
if not delivery_record_id_match:
    raise SystemExit(f"Could not parse delivery record id from {delivery_ref!r}")
delivery_record_id = delivery_record_id_match.group(1)

source_status, source_after = request_json(
    f"{openproject_base}/api/v3/work_packages/{idea_id.split('-')[-1]}",
    headers=bearer_headers(token, openproject_host_header),
)
if source_status != 200:
    raise SystemExit(f"Source work package lookup failed: {source_after}")
source_delivery_ref = read_custom_field(source_after, backlog_fields["Delivery Ref"])
if source_delivery_ref != delivery_ref:
    raise SystemExit(
        f"Source backlink mismatch: expected {delivery_ref!r}, got {source_delivery_ref!r}"
    )

delivery_status, delivery_record = request_json(
    f"{openproject_base}/api/v3/work_packages/{delivery_record_id}",
    headers=bearer_headers(token, openproject_host_header),
)
if delivery_status != 200:
    raise SystemExit(f"Delivery work package lookup failed: {delivery_record}")

origin_idea_ref = read_custom_field(
    delivery_record,
    delivery_fields["Origin Idea Ref"],
)
target_pi = read_custom_field(
    delivery_record,
    delivery_fields["Target PI"],
)
pm2_phase = read_custom_field(
    delivery_record,
    delivery_fields["PM² Phase"],
)
if origin_idea_ref != idea_id:
    raise SystemExit(
        f"Delivery backlink mismatch: expected {idea_id!r}, got {origin_idea_ref!r}"
    )
if target_pi != "PI-2026-02":
    raise SystemExit(f"Delivery target PI mismatch: {target_pi!r}")
if pm2_phase != "Initiating":
    raise SystemExit(f"Delivery PM² phase mismatch: {pm2_phase!r}")

lookup_after_status, lookup_after = request_json(
    f"{broker_base}/v1/ideas/{idea_id}",
    headers=broker_headers(caller_secret, caller_id),
)
if lookup_after_status != 200:
    raise SystemExit(f"Final broker lookup failed: {lookup_after}")
if lookup_after.get("delivery_ref") != delivery_ref:
    raise SystemExit(
        f"Broker projection backlink mismatch: expected {delivery_ref!r}, got {lookup_after.get('delivery_ref')!r}"
    )

summary_path.write_text(
    "\n".join(
        [
            "accepted-idea-delivery dev-integration smoke (mutating)",
            f"idea_id: {idea_id}",
            f"delivery_ref: {delivery_ref}",
            "",
            "## accepted idea lookup",
            json.dumps(lookup, indent=2),
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
            "## consume accepted idea",
            json.dumps(consume, indent=2),
            "",
            "## backlink verification",
            json.dumps(
                {
                    "broker_delivery_ref": lookup_after.get("delivery_ref"),
                    "source_delivery_ref": source_delivery_ref,
                    "delivery_origin_idea_ref": origin_idea_ref,
                    "delivery_pm2_phase": pm2_phase,
                    "delivery_target_pi": target_pi,
                },
                indent=2,
            ),
            "",
        ]
    )
)
print(summary_path.read_text(), end="")
PY
