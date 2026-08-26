#!/usr/bin/env bash
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"

need_cmd helm
need_cmd k3s
need_cmd python3
need_cmd sha256sum
need_cmd timeout
validate_work_design_composition_context
validate_refinement_catalog_composition_context

ensure_state_dirs
ensure_local_secrets
load_local_secrets
platform_repo="$(repo_path platform-engineering)"
helm_cmd repo add openproject https://charts.openproject.org >/dev/null 2>&1 || true
helm_cmd repo update openproject >/dev/null

kubectl_cmd get namespace "${NAMESPACE}" >/dev/null 2>&1 || kubectl_cmd create namespace "${NAMESPACE}"
trap 'remove_work_design_binding; remove_refinement_catalog_bindings' ERR
reconcile_work_design_binding
reconcile_refinement_catalog_bindings "${platform_repo}"
kubectl_cmd -n "${NAMESPACE}" create secret generic "${OPENPROJECT_ADMIN_SECRET}" \
  --from-literal=password="${OPENPROJECT_ADMIN_PASSWORD}" \
  --dry-run=client -o yaml | kubectl_cmd apply -f -

cat >"${RENDERED_DIR}/openproject-values.yaml" <<EOF
develop: true
ingress:
  enabled: false
service:
  type: NodePort
  ports:
    http:
      containerPort: 8080
      port: 8080
      nodePort: ${OPENPROJECT_NODE_PORT}
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

if is_refinement_catalog_composition; then
  catalog_source_digest="$(
    cat \
      "${platform_repo}/products/openproject/catalog-control/additional_environment.rb" \
      "${platform_repo}/products/openproject/catalog-control/openproject_delivery_catalog_control.rb" \
      "${platform_repo}/products/openproject/catalog-control/catalog-control-contract.json" |
      sha256sum | cut -d' ' -f1
  )"
  cat >>"${RENDERED_DIR}/openproject-values.yaml" <<EOF
podAnnotations:
  governance.workspace/catalog-control-source-digest: "${catalog_source_digest}"
extraEnvVars:
  - name: OPENPROJECT_CATALOG_CONTROL_EXTENSION_PATH
    value: "${CATALOG_CONTROL_MOUNT_PATH}/openproject_delivery_catalog_control.rb"
  - name: OPENPROJECT_CATALOG_CONTROL_CONTRACT_PATH
    value: "${CATALOG_CONTROL_MOUNT_PATH}/catalog-control-contract.json"
  - name: ${CATALOG_CONTROL_SHARED_SECRET_KEY}
    valueFrom:
      secretKeyRef:
        name: ${CATALOG_CONTROL_SECRET_NAME}
        key: ${CATALOG_CONTROL_SHARED_SECRET_KEY}
extraVolumes:
  - name: catalog-control
    configMap:
      name: ${CATALOG_CONTROL_CONFIG_MAP}
extraVolumeMounts:
  - name: catalog-control
    mountPath: /app/config/additional_environment.rb
    subPath: additional_environment.rb
    readOnly: true
  - name: catalog-control
    mountPath: ${CATALOG_CONTROL_MOUNT_PATH}
    readOnly: true
EOF
fi

helm_cmd upgrade --install "${OPENPROJECT_RELEASE}" openproject/openproject \
  --version 13.4.4 \
  --namespace "${NAMESPACE}" \
  --create-namespace \
  --wait \
  --timeout 15m \
  --values "${RENDERED_DIR}/openproject-values.yaml"

wait_for_openproject_ready

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

python3 - "${OPENPROJECT_BACKLOG_JSON}" "${OPENPROJECT_DELIVERY_ART_JSON}" "${OPENPROJECT_IDENTITY_JSON}" "${BROKER_ENV_FILE}" "$(openproject_internal_url)" "$(openproject_operator_host)" "${BROKER_CALLER_SECRET}" "${BROKER_CALLER_ID}" "${workspace_repo}" "${OPENPROJECT_API_TOKEN_FILE}" "${OPERATOR}" "${TEMPORAL_ADDRESS}" "${TEMPORAL_WORKFLOW_NAMESPACE}" "${CGG_WORK_DESIGN_BASE_URL:-}" "${GOVERNED_AI_GATEWAY_BASE_URL:-}" <<'PY'
import json
import os
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
temporal_address = sys.argv[12]
temporal_namespace = sys.argv[13]
work_design_context_base_url = sys.argv[14]
work_design_gateway_base_url = sys.argv[15]
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
            "CALLER_AUTH_SECRETS_JSON={}",
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
            f"OPENPROJECT_CUSTOM_FIELD_PROPOSAL_WORKFLOW_STATE_ID={backlog_custom_fields['Proposal Workflow State']}",
            f"OPENPROJECT_DELIVERY_CUSTOM_FIELD_ORIGIN_IDEA_REF_ID={delivery_custom_fields['Origin Idea Ref']}",
            f"OPENPROJECT_DELIVERY_CUSTOM_FIELD_PM2_PHASE_ID={delivery_custom_fields['PM² Phase']}",
            f"OPENPROJECT_DELIVERY_CUSTOM_FIELD_TARGET_PI_ID={delivery_custom_fields['Target PI']}",
            f"WORKSPACE_OWNER_TOKENS_JSON={json.dumps(owner_tokens)}",
            f"WORKSPACE_SCOPE_TOKENS_JSON={json.dumps(scope_tokens)}",
            "WGCF_ART_READINESS_MODE=required",
            f"WGCF_ART_READINESS_BASE_URL={wgcf_base_url}",
            "WGCF_DELIVERY_ART_BASE_URL=",
            "WGCF_DELIVERY_ART_CALLER_ID=operator-orchestration-service",
            "WGCF_DELIVERY_ART_CALLER_SECRET=",
            "OOS_DELIVERY_ART_MUTATION_ENABLED=false",
            "OOS_DELIVERY_ART_WRITER_TOPOLOGY=",
            "OOS_ORCHESTRATION_RUNTIME_ENABLED=false",
            "OOS_ORCHESTRATION_WORKER_ENABLED=false",
            "OOS_ORCHESTRATION_EXECUTION_AUTHORIZED=false",
            "OOS_ORCHESTRATION_ACTIVATION_EVIDENCE_PATH=",
            "OOS_ORCHESTRATION_ACTIVATION_EVIDENCE_DIGEST=",
            f"OOS_TEMPORAL_ADDRESS={os.environ.get('OOS_TEMPORAL_ADDRESS', temporal_address)}",
            f"OOS_TEMPORAL_NAMESPACE={os.environ.get('OOS_TEMPORAL_NAMESPACE', temporal_namespace)}",
            "OOS_TEMPORAL_IDENTITY=operator-orchestration-service-api",
            f"CGG_WORK_DESIGN_BASE_URL={work_design_context_base_url}",
            f"CGG_WORK_DESIGN_CALLER_ID={os.environ.get('CGG_WORK_DESIGN_CALLER_ID', '')}",
            f"GOVERNED_AI_GATEWAY_BASE_URL={work_design_gateway_base_url}",
            f"CGG_REFINEMENT_BASE_URL={os.environ.get('CGG_REFINEMENT_BASE_URL', '')}",
            f"CGG_REFINEMENT_CALLER_ID={os.environ.get('CGG_REFINEMENT_CALLER_ID', '')}",
            f"WGCF_REPOSITORY_READINESS_BASE_URL={os.environ.get('WGCF_REPOSITORY_READINESS_BASE_URL', '')}",
            f"WGCF_REPOSITORY_READINESS_CALLER_ID={os.environ.get('WGCF_REPOSITORY_READINESS_CALLER_ID', '')}",
            f"OPENPROJECT_CATALOG_CONTROL_BASE_URL={os.environ.get('OPENPROJECT_CATALOG_CONTROL_BASE_URL', '')}",
            f"OOS_REFINEMENT_RUNTIME_ENABLED={os.environ.get('OOS_REFINEMENT_RUNTIME_ENABLED', 'false')}",
            f"OOS_REFINEMENT_WORKER_ENABLED={os.environ.get('OOS_REFINEMENT_WORKER_ENABLED', 'false')}",
            f"OOS_REFINEMENT_EXECUTION_AUTHORIZED={os.environ.get('OOS_REFINEMENT_EXECUTION_AUTHORIZED', 'false')}",
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
        orchestration.workspace/identity: oos-api
    spec:
      automountServiceAccountToken: false
      initContainers:
        - name: prepare-runtime
          image: node:22-bookworm-slim
          command:
            - /bin/sh
            - -ec
            - |
              cp /source/package.json /source/package-lock.json /runtime/
              cp -R /source/src /source/contracts /runtime/
              cd /runtime
              npm ci --omit=dev
          volumeMounts:
            - name: operator-source
              mountPath: /source
              readOnly: true
            - name: broker-runtime
              mountPath: /runtime
      containers:
        - name: ${BROKER_DEPLOYMENT}
          image: node:22-bookworm-slim
          command: ["node", "src/server.js"]
          envFrom:
            - secretRef:
                name: ${BROKER_ENV_SECRET}
          env:
            - name: ${WORK_DESIGN_CALLER_SECRET_KEY}
              valueFrom:
                secretKeyRef:
                  name: ${WORK_DESIGN_CALLER_SECRET_NAME}
                  key: ${WORK_DESIGN_CALLER_SECRET_KEY}
                  optional: true
            - name: ${REFINEMENT_CGG_SECRET_KEY}
              valueFrom:
                secretKeyRef:
                  name: ${REFINEMENT_BINDING_SECRET_NAME}
                  key: ${REFINEMENT_CGG_SECRET_KEY}
                  optional: true
            - name: ${CATALOG_WGCF_SECRET_KEY}
              valueFrom:
                secretKeyRef:
                  name: ${REFINEMENT_BINDING_SECRET_NAME}
                  key: ${CATALOG_WGCF_SECRET_KEY}
                  optional: true
            - name: ${CATALOG_CONTROL_TOKEN_KEY}
              valueFrom:
                secretKeyRef:
                  name: ${CATALOG_CONTROL_SECRET_NAME}
                  key: ${CATALOG_CONTROL_TOKEN_KEY}
                  optional: true
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
          workingDir: /runtime
          volumeMounts:
            - name: broker-runtime
              mountPath: /runtime
      volumes:
        - name: operator-source
          hostPath:
            path: ${operator_repo}
            type: Directory
        - name: broker-runtime
          emptyDir: {}
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
---
apiVersion: v1
kind: ServiceAccount
metadata:
  name: ${ORCHESTRATION_WORKER_SERVICE_ACCOUNT}
  namespace: ${NAMESPACE}
automountServiceAccountToken: false
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: ${ORCHESTRATION_WORKER_DEPLOYMENT}
  namespace: ${NAMESPACE}
spec:
  replicas: 0
  selector:
    matchLabels:
      app.kubernetes.io/name: ${ORCHESTRATION_WORKER_DEPLOYMENT}
  template:
    metadata:
      labels:
        app.kubernetes.io/name: ${ORCHESTRATION_WORKER_DEPLOYMENT}
        app.kubernetes.io/part-of: operator-orchestration-service
        orchestration.workspace/identity: oos-workflow-worker
    spec:
      automountServiceAccountToken: false
      serviceAccountName: ${ORCHESTRATION_WORKER_SERVICE_ACCOUNT}
      initContainers:
        - name: prepare-runtime
          image: node:22-bookworm-slim
          command:
            - /bin/sh
            - -ec
            - |
              cp /source/package.json /source/package-lock.json /runtime/
              cp -R /source/src /source/contracts /runtime/
              cd /runtime
              npm ci --omit=dev
          volumeMounts:
            - name: operator-source
              mountPath: /source
              readOnly: true
            - name: worker-runtime
              mountPath: /runtime
      containers:
        - name: orchestration-worker
          image: node:22-bookworm-slim
          command:
            - node
            - src/orchestration-worker.js
            - run
          env:
            - name: OOS_ORCHESTRATION_RUNTIME_ENABLED
              value: "false"
            - name: OOS_ORCHESTRATION_WORKER_ENABLED
              value: "false"
            - name: OOS_ORCHESTRATION_EXECUTION_AUTHORIZED
              value: "false"
            - name: OOS_ORCHESTRATION_ACTIVATION_EVIDENCE_PATH
              value: ""
            - name: OOS_ORCHESTRATION_ACTIVATION_EVIDENCE_DIGEST
              value: ""
            - name: OOS_TEMPORAL_ADDRESS
              value: ${TEMPORAL_ADDRESS}
            - name: OOS_TEMPORAL_NAMESPACE
              value: ${TEMPORAL_WORKFLOW_NAMESPACE}
            - name: OOS_TEMPORAL_IDENTITY
              value: oos-workflow-worker
          workingDir: /runtime
          volumeMounts:
            - name: worker-runtime
              mountPath: /runtime
      volumes:
        - name: operator-source
          hostPath:
            path: ${operator_repo}
            type: Directory
        - name: worker-runtime
          emptyDir: {}
EOF

if is_refinement_catalog_composition; then
  cat >>"${RENDERED_DIR}/broker.yaml" <<EOF
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: ${REFINEMENT_WORKER_DEPLOYMENT}
  namespace: ${NAMESPACE}
spec:
  replicas: 1
  selector:
    matchLabels:
      app.kubernetes.io/name: ${REFINEMENT_WORKER_DEPLOYMENT}
  template:
    metadata:
      labels:
        app.kubernetes.io/name: ${REFINEMENT_WORKER_DEPLOYMENT}
        app.kubernetes.io/part-of: operator-orchestration-service
        orchestration.workspace/identity: oos-refinement-worker
    spec:
      automountServiceAccountToken: false
      serviceAccountName: ${ORCHESTRATION_WORKER_SERVICE_ACCOUNT}
      initContainers:
        - name: prepare-runtime
          image: node:22-bookworm-slim
          command:
            - /bin/sh
            - -ec
            - |
              cp /source/package.json /source/package-lock.json /runtime/
              cp -R /source/src /source/contracts /runtime/
              cd /runtime
              npm ci --omit=dev
          volumeMounts:
            - name: operator-source
              mountPath: /source
              readOnly: true
            - name: worker-runtime
              mountPath: /runtime
      containers:
        - name: refinement-worker
          image: node:22-bookworm-slim
          command: ["node", "src/refinement-worker.js"]
          envFrom:
            - secretRef:
                name: ${BROKER_ENV_SECRET}
          env:
            - name: OOS_TEMPORAL_IDENTITY
              value: operator-orchestration-service-refinement-worker
            - name: ${REFINEMENT_CGG_SECRET_KEY}
              valueFrom:
                secretKeyRef:
                  name: ${REFINEMENT_BINDING_SECRET_NAME}
                  key: ${REFINEMENT_CGG_SECRET_KEY}
            - name: ${CATALOG_WGCF_SECRET_KEY}
              valueFrom:
                secretKeyRef:
                  name: ${REFINEMENT_BINDING_SECRET_NAME}
                  key: ${CATALOG_WGCF_SECRET_KEY}
            - name: ${CATALOG_CONTROL_TOKEN_KEY}
              valueFrom:
                secretKeyRef:
                  name: ${CATALOG_CONTROL_SECRET_NAME}
                  key: ${CATALOG_CONTROL_TOKEN_KEY}
          workingDir: /runtime
          volumeMounts:
            - name: worker-runtime
              mountPath: /runtime
      volumes:
        - name: operator-source
          hostPath:
            path: ${operator_repo}
            type: Directory
        - name: worker-runtime
          emptyDir: {}
EOF
fi

kubectl_cmd apply -f "${RENDERED_DIR}/broker.yaml"
kubectl_cmd -n "${NAMESPACE}" rollout restart deployment/${BROKER_DEPLOYMENT} >/dev/null 2>&1 || true
wait_for_broker_ready
if is_refinement_catalog_composition; then
  kubectl_cmd -n "${NAMESPACE}" rollout status deployment/${REFINEMENT_WORKER_DEPLOYMENT} --timeout=180s
fi
work_design_state="$(work_design_runtime_state)"
if is_work_design_composition && [[ "${work_design_state}" != "ready" ]]; then
  echo "refused: composed Work Design runtime is ${work_design_state}." >&2
  exit 3
fi
refinement_catalog_state="$(refinement_catalog_runtime_state)"
if is_refinement_catalog_composition && [[ "${refinement_catalog_state}" != "ready" ]]; then
  echo "refused: composed Refinement and Catalog runtime is ${refinement_catalog_state}." >&2
  exit 3
fi
trap - ERR

printf 'dev-integration profile ready\nnamespace: %s\nbroker: svc/%s\nopenproject: svc/%s\n' \
  "${NAMESPACE}" "${BROKER_SERVICE}" "${OPENPROJECT_SERVICE}"
printf 'work design runtime: %s\n' "${work_design_state}"
printf 'refinement and catalog runtime: %s\n' "${refinement_catalog_state}"
