#!/usr/bin/env bash
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"

need_cmd helm
need_cmd k3s
need_cmd python3
need_cmd timeout

ensure_state_dirs
ensure_local_secrets
load_local_secrets
helm_cmd repo add openproject https://charts.openproject.org >/dev/null 2>&1 || true
helm_cmd repo update openproject >/dev/null

kubectl_cmd get namespace "${NAMESPACE}" >/dev/null 2>&1 || kubectl_cmd create namespace "${NAMESPACE}"
kubectl_cmd -n "${NAMESPACE}" create secret generic "${OPENPROJECT_ADMIN_SECRET}" \
  --from-literal=password="${OPENPROJECT_ADMIN_PASSWORD}" \
  --dry-run=client -o yaml | kubectl_cmd apply -f -

cat >"${RENDERED_DIR}/openproject-values.yaml" <<EOF
develop: true
ingress:
  enabled: false
service:
  type: ClusterIP
  ports:
    http:
      containerPort: 8080
      port: 8080
      protocol: TCP
openproject:
  https: false
  hsts: false
  host: $(openproject_operator_host)
  admin_user:
    name: Dev Integration Admin
    mail: devint-openproject-admin@local.invalid
    password_reset: "false"
    secret: ${OPENPROJECT_ADMIN_SECRET}
    secretKeys:
      password: password
  realtime_collaboration:
    enabled: false
environment:
  OPENPROJECT_WEB__WORKERS: "1"
workers:
  default:
    maxThreads: 10
persistence:
  enabled: true
  accessModes:
    - ReadWriteOnce
  size: ${OPENPROJECT_DATA_VOLUME_SIZE}
postgresql:
  bundled: true
  primary:
    persistence:
      enabled: true
      size: ${OPENPROJECT_POSTGRES_VOLUME_SIZE}
memcached:
  bundled: true
EOF

helm_cmd upgrade --install "${OPENPROJECT_RELEASE}" openproject/openproject \
  --version 13.4.4 \
  --namespace "${NAMESPACE}" \
  --create-namespace \
  --wait \
  --timeout 15m \
  --values "${RENDERED_DIR}/openproject-values.yaml"

wait_for_openproject_ready

platform_repo="$(repo_path platform-engineering)"
env \
  KUBECTL="${DEVINT_KUBECTL:-k3s kubectl}" \
  OPENPROJECT_NAMESPACE="${NAMESPACE}" \
  OPENPROJECT_DEPLOYMENT="$(openproject_web_deployment)" \
  OPENPROJECT_ADMIN_SECRET_NAME="${OPENPROJECT_ADMIN_SECRET}" \
  OPENPROJECT_ADMIN_FORCE_PASSWORD_CHANGE=false \
  "${platform_repo}/products/openproject/scripts/openproject_sync_admin_password.sh"

backlog_script="${platform_repo}/products/openproject/scripts/openproject_configure_idea_backlog.sh"
delivery_art_script="${platform_repo}/products/openproject/scripts/openproject_configure_delivery_art.sh"
delivery_art_views_script="${platform_repo}/products/openproject/scripts/openproject_sync_delivery_art_views.sh"
identity_helper="${platform_repo}/products/openproject/scripts/openproject_provision_identity.sh"
rm -f "${OPENPROJECT_API_TOKEN_FILE}"

run_platform_admin_capture \
  "${OPENPROJECT_BACKLOG_RAW}" \
  "__OPENPROJECT_IDEA_BACKLOG_END__" \
  env \
  KUBECTL="${DEVINT_KUBECTL:-k3s kubectl}" \
  OPENPROJECT_NAMESPACE="${NAMESPACE}" \
  OPENPROJECT_DEPLOYMENT="$(openproject_web_deployment)" \
  "${backlog_script}"
extract_marked_json \
  "${OPENPROJECT_BACKLOG_RAW}" \
  "__OPENPROJECT_IDEA_BACKLOG_BEGIN__" \
  "__OPENPROJECT_IDEA_BACKLOG_END__" \
  "${OPENPROJECT_BACKLOG_JSON}"

run_platform_admin_capture \
  "${OPENPROJECT_DELIVERY_ART_RAW}" \
  "__OPENPROJECT_DELIVERY_ART_END__" \
  env \
  KUBECTL="${DEVINT_KUBECTL:-k3s kubectl}" \
  OPENPROJECT_NAMESPACE="${NAMESPACE}" \
  OPENPROJECT_DEPLOYMENT="$(openproject_web_deployment)" \
  OPENPROJECT_DELIVERY_PI_NAMES="${OPENPROJECT_DELIVERY_PI_NAMES:-}" \
  "${delivery_art_script}"
extract_marked_json \
  "${OPENPROJECT_DELIVERY_ART_RAW}" \
  "__OPENPROJECT_DELIVERY_ART_BEGIN__" \
  "__OPENPROJECT_DELIVERY_ART_END__" \
  "${OPENPROJECT_DELIVERY_ART_JSON}"

run_platform_admin_capture \
  "${OPENPROJECT_DELIVERY_ART_VIEWS_RAW}" \
  "__OPENPROJECT_DELIVERY_ART_VIEWS_END__" \
  env \
  KUBECTL="${DEVINT_KUBECTL:-k3s kubectl}" \
  OPENPROJECT_NAMESPACE="${NAMESPACE}" \
  OPENPROJECT_DEPLOYMENT="$(openproject_web_deployment)" \
  OPENPROJECT_DELIVERY_PI_NAMES="${OPENPROJECT_DELIVERY_PI_NAMES:-}" \
  "${delivery_art_views_script}"
extract_marked_json \
  "${OPENPROJECT_DELIVERY_ART_VIEWS_RAW}" \
  "__OPENPROJECT_DELIVERY_ART_VIEWS_BEGIN__" \
  "__OPENPROJECT_DELIVERY_ART_VIEWS_END__" \
  "${OPENPROJECT_DELIVERY_ART_VIEWS_JSON}"

run_platform_admin_capture \
  "${OPENPROJECT_IDENTITY_RAW}" \
  "__OPENPROJECT_IDENTITY_PROVISION_END__" \
  env \
  KUBECTL="${DEVINT_KUBECTL:-k3s kubectl}" \
  OPENPROJECT_NAMESPACE="${NAMESPACE}" \
  OPENPROJECT_DEPLOYMENT="$(openproject_web_deployment)" \
  TARGET_LOGIN=operator-orchestration-service \
  TARGET_FIRSTNAME=Operator \
  TARGET_LASTNAME=Orchestration-Service \
  TARGET_MAIL=operator-orchestration-service@devint.local.invalid \
  TARGET_PROJECT_IDENTIFIER=workspace-proposals \
  TARGET_PROJECT_IDENTIFIERS_JSON='["workspace-proposals","workspace-delivery-art"]' \
  TARGET_TOKEN_NAME=devint-operator-orchestration-service \
  ROTATE_API_TOKEN=true \
  ISSUE_API_TOKEN=true \
  OPENPROJECT_API_TOKEN_OUTPUT_PATH="${OPENPROJECT_API_TOKEN_FILE}" \
  TARGET_ROLE_NAMES_JSON='["Reader","Work package creator","Work package editor","Work package structure editor"]' \
  "${identity_helper}"
extract_marked_json \
  "${OPENPROJECT_IDENTITY_RAW}" \
  "__OPENPROJECT_IDENTITY_PROVISION_BEGIN__" \
  "__OPENPROJECT_IDENTITY_PROVISION_END__" \
  "${OPENPROJECT_IDENTITY_JSON}"

workspace_repo="${WORKSPACE_ROOT}/workspace-governance"

python3 - "${OPENPROJECT_BACKLOG_JSON}" "${OPENPROJECT_DELIVERY_ART_JSON}" "${OPENPROJECT_IDENTITY_JSON}" "${BROKER_ENV_FILE}" "$(openproject_internal_url)" "$(openproject_operator_host)" "${BROKER_CALLER_SECRET}" "${BROKER_CALLER_ID}" "${workspace_repo}" "${OPENPROJECT_API_TOKEN_FILE}" "${OPERATOR}" <<'PY'
import json
import pathlib
import sys
import yaml

backlog = json.loads(pathlib.Path(sys.argv[1]).read_text())
delivery = json.loads(pathlib.Path(sys.argv[2]).read_text())
identity = json.loads(pathlib.Path(sys.argv[3]).read_text())
target = pathlib.Path(sys.argv[4])
base_url = sys.argv[5]
host_header = sys.argv[6]
caller_secret = sys.argv[7]
caller_id = sys.argv[8]
workspace_repo = pathlib.Path(sys.argv[9])
token_path = pathlib.Path(sys.argv[10])
operator = sys.argv[11]
wgcf_base_url = (
    "http://workspace-governance-control-fabric-api."
    f"devint-governance-control-fabric-{operator}.svc:8080"
)

backlog_types = {entry["name"]: entry["id"] for entry in backlog["types"]}
backlog_statuses = {entry["name"]: entry["id"] for entry in backlog["statuses"]}
backlog_custom_fields = {
    entry["name"]: entry["id"] for entry in backlog["project"]["work_package_custom_fields"]
}
delivery_types = {entry["name"]: entry["id"] for entry in delivery["types"]}
delivery_statuses = {entry["name"]: entry["id"] for entry in delivery["statuses"]}
delivery_custom_fields = {
    entry["name"]: entry["id"] for entry in delivery["project"]["work_package_custom_fields"]
}

contracts_root = workspace_repo / "contracts"
repos = yaml.safe_load((contracts_root / "repos.yaml").read_text())["repos"]
products = yaml.safe_load((contracts_root / "products.yaml").read_text())["products"]
components = yaml.safe_load((contracts_root / "components.yaml").read_text())["components"]

owner_tokens = sorted(
    {
        *[
            f"repo:{name}"
            for name, spec in repos.items()
            if spec.get("lifecycle") == "active"
        ],
        *[
            f"product:{name}"
            for name, spec in products.items()
            if spec.get("lifecycle") != "retired"
        ],
        *[
            f"component:{name}"
            for name, spec in components.items()
            if spec.get("lifecycle") == "active"
        ],
    }
)
scope_tokens = owner_tokens

token = token_path.read_text().strip()
target.write_text(
    "\n".join(
        [
            "HOST=0.0.0.0",
            "PORT=8080",
            "SERVICE_VERSION=0.1.0-devint",
            f"CALLER_ALLOWED_IDS={caller_id}",
            f"CALLER_AUTH_SHARED_SECRET={caller_secret}",
            f"OPENPROJECT_BASE_URL={base_url}",
            f"OPENPROJECT_HOST_HEADER={host_header}",
            "OPENPROJECT_PROJECT_IDENTIFIER=workspace-proposals",
            "OPENPROJECT_DELIVERY_PROJECT_IDENTIFIER=workspace-delivery-art",
            f"OPENPROJECT_API_TOKEN={token}",
            f"OPENPROJECT_IDEA_TYPE_ID={backlog_types['Idea']}",
            f"OPENPROJECT_CAPTURED_STATUS_ID={backlog_statuses['captured']}",
            f"OPENPROJECT_TRIAGED_STATUS_ID={backlog_statuses['triaged']}",
            f"OPENPROJECT_PARKED_STATUS_ID={backlog_statuses['parked']}",
            f"OPENPROJECT_ACCEPTED_STATUS_ID={backlog_statuses['accepted']}",
            f"OPENPROJECT_REJECTED_STATUS_ID={backlog_statuses['rejected']}",
            f"OPENPROJECT_IMPLEMENTED_STATUS_ID={backlog_statuses['implemented']}",
            f"OPENPROJECT_DELIVERY_TOP_LEVEL_TYPE_ID={delivery_types['Epic']}",
            f"OPENPROJECT_DELIVERY_NEW_STATUS_ID={delivery_statuses['new']}",
            f"OPENPROJECT_CUSTOM_FIELD_SOURCE_SURFACE_ID={backlog_custom_fields['Source Surface']}",
            f"OPENPROJECT_CUSTOM_FIELD_SOURCE_REFERENCE_ID={backlog_custom_fields['Source Reference']}",
            f"OPENPROJECT_CUSTOM_FIELD_DELIVERY_REF_ID={backlog_custom_fields['Delivery Ref']}",
            f"OPENPROJECT_CUSTOM_FIELD_SUSPECTED_OWNER_ID={backlog_custom_fields['Suspected Owner']}",
            f"OPENPROJECT_CUSTOM_FIELD_AFFECTED_SCOPE_ID={backlog_custom_fields['Affected Scope']}",
            f"OPENPROJECT_CUSTOM_FIELD_TRUST_BOUNDARY_AREAS_ID={backlog_custom_fields['Trust Boundary Areas']}",
            f"OPENPROJECT_CUSTOM_FIELD_TRIAGE_CONFIDENCE_ID={backlog_custom_fields['Triage Confidence']}",
            f"OPENPROJECT_CUSTOM_FIELD_AI_ASSIST_LANE_ID={backlog_custom_fields['AI Assist Lane']}",
            f"OPENPROJECT_DELIVERY_CUSTOM_FIELD_ORIGIN_IDEA_REF_ID={delivery_custom_fields['Origin Idea Ref']}",
            f"OPENPROJECT_DELIVERY_CUSTOM_FIELD_PM2_PHASE_ID={delivery_custom_fields['PM² Phase']}",
            f"OPENPROJECT_DELIVERY_CUSTOM_FIELD_TARGET_PI_ID={delivery_custom_fields['Target PI']}",
            f"WORKSPACE_OWNER_TOKENS_JSON={json.dumps(owner_tokens)}",
            f"WORKSPACE_SCOPE_TOKENS_JSON={json.dumps(scope_tokens)}",
            "WGCF_ART_READINESS_MODE=required",
            f"WGCF_ART_READINESS_BASE_URL={wgcf_base_url}",
            "",
        ]
    )
)
PY

kubectl_cmd -n "${NAMESPACE}" create secret generic "${BROKER_ENV_SECRET}" \
  --from-env-file="${BROKER_ENV_FILE}" \
  --dry-run=client -o yaml | kubectl_cmd apply -f -

operator_repo="$(repo_path operator-orchestration-service)"
cat >"${RENDERED_DIR}/broker.yaml" <<EOF
apiVersion: apps/v1
kind: Deployment
metadata:
  name: ${BROKER_DEPLOYMENT}
  namespace: ${NAMESPACE}
spec:
  replicas: 1
  selector:
    matchLabels:
      app.kubernetes.io/name: ${BROKER_DEPLOYMENT}
  template:
    metadata:
      labels:
        app.kubernetes.io/name: ${BROKER_DEPLOYMENT}
    spec:
      containers:
        - name: ${BROKER_DEPLOYMENT}
          image: node:22-bookworm-slim
          command: ["node", "src/server.js"]
          envFrom:
            - secretRef:
                name: ${BROKER_ENV_SECRET}
          ports:
            - containerPort: 8080
              name: http
          readinessProbe:
            httpGet:
              path: /readyz
              port: http
            initialDelaySeconds: 5
            periodSeconds: 10
          livenessProbe:
            httpGet:
              path: /healthz
              port: http
            initialDelaySeconds: 5
            periodSeconds: 10
          workingDir: /workspace/operator-orchestration-service
          volumeMounts:
            - name: operator-source
              mountPath: /workspace/operator-orchestration-service
              readOnly: true
      volumes:
        - name: operator-source
          hostPath:
            path: ${operator_repo}
            type: Directory
---
apiVersion: v1
kind: Service
metadata:
  name: ${BROKER_SERVICE}
  namespace: ${NAMESPACE}
spec:
  selector:
    app.kubernetes.io/name: ${BROKER_DEPLOYMENT}
  ports:
    - name: http
      port: 8080
      targetPort: http
EOF

kubectl_cmd apply -f "${RENDERED_DIR}/broker.yaml"
kubectl_cmd -n "${NAMESPACE}" rollout restart deployment/${BROKER_DEPLOYMENT} >/dev/null 2>&1 || true
wait_for_broker_ready
start_delivery_art_view_sync_loop

printf 'dev-integration profile ready\nnamespace: %s\nbroker: svc/%s\nopenproject: svc/%s\n' \
  "${NAMESPACE}" "${BROKER_SERVICE}" "${OPENPROJECT_SERVICE}"
