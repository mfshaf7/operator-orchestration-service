#!/usr/bin/env bash
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"

need_cmd helm
need_cmd k3s
need_cmd python3

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
persistence:
  enabled: false
postgresql:
  bundled: true
  primary:
    persistence:
      enabled: false
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

backlog_runner="${platform_repo}/products/openproject/scripts/openproject_configure_idea_backlog_runner.rb"
identity_runner="${platform_repo}/products/openproject/scripts/openproject_provision_operator_orchestration_identity_runner.rb"
openproject_pod="$(openproject_web_pod)"

kubectl_cmd -n "${NAMESPACE}" cp "${backlog_runner}" "${openproject_pod}:/tmp/openproject_configure_idea_backlog_runner.rb"
kubectl_cmd -n "${NAMESPACE}" exec "${openproject_pod}" -- \
  bundle exec rails runner /tmp/openproject_configure_idea_backlog_runner.rb >"${OPENPROJECT_BACKLOG_RAW}"

python3 - "${OPENPROJECT_BACKLOG_RAW}" "${OPENPROJECT_BACKLOG_JSON}" <<'PY'
import json
import pathlib
import sys

raw_path = pathlib.Path(sys.argv[1])
target_path = pathlib.Path(sys.argv[2])
text = raw_path.read_text()
begin = "__OPENPROJECT_IDEA_BACKLOG_BEGIN__"
end = "__OPENPROJECT_IDEA_BACKLOG_END__"
start = text.index(begin) + len(begin)
finish = text.index(end, start)
payload = json.loads(text[start:finish].strip())
target_path.write_text(json.dumps(payload, indent=2) + "\n")
PY

kubectl_cmd -n "${NAMESPACE}" cp "${identity_runner}" "${openproject_pod}:/tmp/openproject_provision_operator_orchestration_identity_runner.rb"
kubectl_cmd -n "${NAMESPACE}" exec "${openproject_pod}" -- env \
  TARGET_LOGIN=operator-orchestration-service \
  TARGET_FIRSTNAME=Operator \
  TARGET_LASTNAME=Orchestration-Service \
  TARGET_MAIL=operator-orchestration-service@devint.local.invalid \
  TARGET_PROJECT_IDENTIFIER=workspace-proposals \
  TARGET_TOKEN_NAME=devint-operator-orchestration-service \
  ROTATE_API_TOKEN=true \
  TARGET_ROLE_NAMES_JSON='["Reader","Work package creator","Work package editor"]' \
  bundle exec rails runner /tmp/openproject_provision_operator_orchestration_identity_runner.rb >"${OPENPROJECT_IDENTITY_RAW}"

python3 - "${OPENPROJECT_IDENTITY_RAW}" "${OPENPROJECT_IDENTITY_JSON}" <<'PY'
import json
import pathlib
import sys

raw_path = pathlib.Path(sys.argv[1])
target_path = pathlib.Path(sys.argv[2])
text = raw_path.read_text()
begin = "__OPENPROJECT_OPERATOR_ORCHESTRATION_IDENTITY_BEGIN__"
end = "__OPENPROJECT_OPERATOR_ORCHESTRATION_IDENTITY_END__"
start = text.index(begin) + len(begin)
finish = text.index(end, start)
payload = json.loads(text[start:finish].strip())
target_path.write_text(json.dumps(payload, indent=2) + "\n")
PY

workspace_repo="${WORKSPACE_ROOT}/workspace-governance"

python3 - "${OPENPROJECT_BACKLOG_JSON}" "${OPENPROJECT_IDENTITY_JSON}" "${BROKER_ENV_FILE}" "$(openproject_internal_url)" "$(openproject_operator_host)" "${BROKER_CALLER_SECRET}" "${workspace_repo}" <<'PY'
import json
import pathlib
import sys
import yaml

backlog = json.loads(pathlib.Path(sys.argv[1]).read_text())
identity = json.loads(pathlib.Path(sys.argv[2]).read_text())
target = pathlib.Path(sys.argv[3])
base_url = sys.argv[4]
host_header = sys.argv[5]
caller_secret = sys.argv[6]
workspace_repo = pathlib.Path(sys.argv[7])

types = {entry["name"]: entry["id"] for entry in backlog["types"]}
statuses = {entry["name"]: entry["id"] for entry in backlog["statuses"]}
custom_fields = {
    entry["name"]: entry["id"] for entry in backlog["project"]["work_package_custom_fields"]
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

token = identity["api_token"]["plaintext_value"]
target.write_text(
    "\n".join(
        [
            "HOST=0.0.0.0",
            "PORT=8080",
            "SERVICE_VERSION=0.1.0-devint",
            f"CALLER_ALLOWED_IDS=telegram-simulator",
            f"CALLER_AUTH_SHARED_SECRET={caller_secret}",
            f"OPENPROJECT_BASE_URL={base_url}",
            f"OPENPROJECT_HOST_HEADER={host_header}",
            "OPENPROJECT_PROJECT_IDENTIFIER=workspace-proposals",
            f"OPENPROJECT_API_TOKEN={token}",
            f"OPENPROJECT_IDEA_TYPE_ID={types['Idea']}",
            f"OPENPROJECT_CAPTURED_STATUS_ID={statuses['captured']}",
            f"OPENPROJECT_TRIAGED_STATUS_ID={statuses['triaged']}",
            f"OPENPROJECT_PARKED_STATUS_ID={statuses['parked']}",
            f"OPENPROJECT_ACCEPTED_STATUS_ID={statuses['accepted']}",
            f"OPENPROJECT_REJECTED_STATUS_ID={statuses['rejected']}",
            f"OPENPROJECT_IMPLEMENTED_STATUS_ID={statuses['implemented']}",
            f"OPENPROJECT_CUSTOM_FIELD_SUSPECTED_OWNER_ID={custom_fields['Suspected Owner']}",
            f"OPENPROJECT_CUSTOM_FIELD_AFFECTED_SCOPE_ID={custom_fields['Affected Scope']}",
            f"OPENPROJECT_CUSTOM_FIELD_TRUST_BOUNDARY_AREAS_ID={custom_fields['Trust Boundary Areas']}",
            f"OPENPROJECT_CUSTOM_FIELD_TRIAGE_CONFIDENCE_ID={custom_fields['Triage Confidence']}",
            f"OPENPROJECT_CUSTOM_FIELD_AI_ASSIST_LANE_ID={custom_fields['AI Assist Lane']}",
            f"OPENPROJECT_CUSTOM_FIELD_SOURCE_SURFACE_ID={custom_fields['Source Surface']}",
            f"OPENPROJECT_CUSTOM_FIELD_SOURCE_REFERENCE_ID={custom_fields['Source Reference']}",
            f"WORKSPACE_OWNER_TOKENS_JSON={json.dumps(owner_tokens)}",
            f"WORKSPACE_SCOPE_TOKENS_JSON={json.dumps(scope_tokens)}",
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

printf 'dev-integration profile ready\nnamespace: %s\nbroker: svc/%s\nopenproject: svc/%s\n' \
  "${NAMESPACE}" "${BROKER_SERVICE}" "${OPENPROJECT_SERVICE}"
