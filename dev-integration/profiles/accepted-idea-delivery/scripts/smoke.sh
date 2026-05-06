#!/usr/bin/env bash
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"

need_cmd k3s
need_cmd python3

ensure_state_dirs
ensure_local_secrets
load_local_secrets
wait_for_broker_ready
wgcf_art_readiness_mode="$(
  kubectl_cmd -n "${NAMESPACE}" exec "deployment/${BROKER_DEPLOYMENT}" -- printenv WGCF_ART_READINESS_MODE || true
)"
wgcf_art_readiness_base_url="$(
  kubectl_cmd -n "${NAMESPACE}" exec "deployment/${BROKER_DEPLOYMENT}" -- printenv WGCF_ART_READINESS_BASE_URL || true
)"
if [[ "${wgcf_art_readiness_mode}" != "required" || -z "${wgcf_art_readiness_base_url}" ]]; then
  echo "Broker WGCF ART readiness is not configured as required." >&2
  exit 1
fi
wgcf_art_readiness_probe="$(
  kubectl_cmd -n "${NAMESPACE}" exec "deployment/${BROKER_DEPLOYMENT}" -- node -e '
const baseUrl = process.env.WGCF_ART_READINESS_BASE_URL;
fetch(`${baseUrl}/readyz`)
  .then(async (response) => {
    const body = await response.json();
    if (!response.ok || body.ready !== true) {
      console.error(JSON.stringify({ status: response.status, body }));
      process.exit(1);
    }
    console.log(JSON.stringify({ status: response.status, ready: body.ready }));
  })
  .catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
'
)"

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
  "${BROKER_CALLER_ID}" \
  "${wgcf_art_readiness_mode}" \
  "${wgcf_art_readiness_base_url}" \
  "${wgcf_art_readiness_probe}" <<'PY'
import json
import os
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
wgcf_art_readiness_mode = sys.argv[8]
wgcf_art_readiness_base_url = sys.argv[9]
wgcf_art_readiness_probe = json.loads(sys.argv[10])
art_smoke_delivery_id = os.environ.get("DEVINT_ART_SMOKE_DELIVERY_ID", "delivery-650")
art_smoke_closed_feature_id = os.environ.get(
    "DEVINT_ART_SMOKE_CLOSED_FEATURE_ID",
    "work-item-660",
)

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

draft_status, mutation_draft = request_json(
    f"{broker_base}/v1/delivery-art/mutation-drafts",
    method="POST",
    body={
        "input": {
            "operation": "work-item.complete",
            "target_id": "work-item-381",
        }
    },
    headers=broker_headers(caller_secret, caller_id),
)
if draft_status != 200:
    raise SystemExit(f"Mutation draft create failed: {mutation_draft}")

validate_status, draft_validation = request_json(
    f"{broker_base}/v1/delivery-art/mutation-drafts/validate",
    method="POST",
    body={
        "mutation_draft": mutation_draft["mutation_draft"],
    },
    headers=broker_headers(caller_secret, caller_id),
)
if validate_status != 200 or not draft_validation.get("validation", {}).get("valid"):
    raise SystemExit(f"Mutation draft validation failed: {draft_validation}")

active_session_status, active_session_packet = request_json(
    f"{broker_base}/v1/delivery-initiatives/{art_smoke_delivery_id}/active-session-packet",
    headers=broker_headers(caller_secret, caller_id),
)
if (
    active_session_status != 200
    or active_session_packet.get("workflow_id") != "delivery-initiative-active-session-packet"
):
    raise SystemExit(f"Optimized active-session packet read failed: {active_session_packet}")
active_session_body = active_session_packet.get("active_session_packet") or active_session_packet

initiative_evidence_status, initiative_evidence_packet = request_json(
    f"{broker_base}/v1/delivery-initiatives/{art_smoke_delivery_id}/evidence-packet",
    headers=broker_headers(caller_secret, caller_id),
)
if (
    initiative_evidence_status != 200
    or initiative_evidence_packet.get("workflow_id") != "delivery-initiative-evidence-packet"
):
    raise SystemExit(f"Optimized initiative evidence packet read failed: {initiative_evidence_packet}")
initiative_evidence_body = (
    initiative_evidence_packet.get("initiative_evidence_packet")
    or initiative_evidence_packet.get("evidence_packet")
    or initiative_evidence_packet
)
initiative_quality_drift_counts = (
    initiative_evidence_body.get("quality_drift_counts")
    or (initiative_evidence_body.get("evidence_state") or {}).get("quality_drift_counts")
)

closed_feature_status, closed_feature_packet = request_json(
    f"{broker_base}/v1/delivery-work-items/{art_smoke_closed_feature_id}/evidence-packet",
    headers=broker_headers(caller_secret, caller_id),
)
closed_feature_evidence_packet = closed_feature_packet.get("evidence_packet") or {}
closed_feature_state = (
    closed_feature_packet.get("evidence_state")
    or closed_feature_evidence_packet.get("evidence_state")
    or {}
)
closed_feature_target = (
    closed_feature_packet.get("target_item")
    or closed_feature_evidence_packet.get("target_item")
    or {}
)
if (
    closed_feature_status != 200
    or closed_feature_packet.get("workflow_id") != "delivery-work-item-evidence-packet"
    or closed_feature_target.get("status") != "done"
    or closed_feature_state.get("completion_evidence_formatting_valid") is not True
):
    raise SystemExit(f"Landing-unit closeout evidence read failed: {closed_feature_packet}")

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
            "## delivery artifact mutation draft workflow",
            json.dumps(
                {
                    "draft_workflow_id": mutation_draft.get("workflow_id"),
                    "operation": mutation_draft.get("mutation_draft", {}).get("operation"),
                    "route": mutation_draft.get("mutation_draft", {}).get("route"),
                    "validation_valid": draft_validation.get("validation", {}).get("valid"),
                },
                indent=2,
            ),
            "",
            "## WGCF ART readiness required for broker completion-style mutations",
            json.dumps(
                {
                    "mode": wgcf_art_readiness_mode,
                    "base_url_configured": bool(wgcf_art_readiness_base_url),
                    "ready_probe": wgcf_art_readiness_probe,
                },
                indent=2,
            ),
            "",
            "## optimized ART packet reads",
            json.dumps(
                {
                    "delivery_id": art_smoke_delivery_id,
                    "active_session_workflow_id": active_session_packet.get("workflow_id"),
                    "active_open_descendants": (
                        active_session_body.get("active_fronts", {})
                        .get("summary", {})
                        .get("open_descendant_count")
                    ),
                    "initiative_evidence_workflow_id": initiative_evidence_packet.get("workflow_id"),
                    "initiative_quality_drift_counts": initiative_quality_drift_counts,
                },
                indent=2,
            ),
            "",
            "## landing-unit closeout evidence read",
            json.dumps(
                {
                    "work_item_id": art_smoke_closed_feature_id,
                    "status": closed_feature_target.get("status"),
                    "completion_evidence_formatting_valid": closed_feature_state.get(
                        "completion_evidence_formatting_valid"
                    ),
                    "done_narrative_contract_satisfied": closed_feature_state.get(
                        "done_narrative_contract_satisfied"
                    ),
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
