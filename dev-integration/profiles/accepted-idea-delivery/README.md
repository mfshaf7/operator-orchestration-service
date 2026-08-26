# Accepted Idea Delivery Dev-Integration Profile

This profile is the persistent accepted-idea delivery workbench on the shared
local-k3s lane.

Current lifecycle in the shared workspace contract:

- `active`
- self-serve launchable through the shared runner

It exists so accepted-idea delivery work can continue against one durable local
ART and broker runtime without using governed `stage` to discover basic
project-model, identity-scope, or operator-surface mistakes.

Runtime state model:

- `persistent`

## What It Runs

- local OpenProject through the upstream Helm chart
- local OpenProject runtime bounded to:
  - `OPENPROJECT_WEB__WORKERS=1`
  - `workers.default.maxThreads=10`
- PVC-backed OpenProject application and PostgreSQL data so project history can
  survive normal `devint-down` / `devint-up` cycles
- bundled local PostgreSQL and Memcached inside that chart
- `operator-orchestration-service` from local source mounted into a generic
  Node runtime pod with exact lockfile dependencies installed into an isolated
  runtime volume
- the source-admitted OOS workflow worker with its dedicated service account
  and identity, fixed at zero replicas until runtime activation
- broker-side WGCF ART readiness enforcement for completion-style work-item
  mutations, using the `governance-control-fabric` dev-integration WGCF API
- local proposal backlog seeding plus local delivery ART seeding through the
  canonical `platform-engineering` OpenProject platform-admin surface
- a local broker automation identity with access only to
  `workspace-proposals` and `workspace-delivery-art`
- a runner-owned host-side delivery-art view reconciler that keeps the OpenProject
  roadmap projection aligned to ART `Target PI`, the derived backlog bucket
  `Not yet committed to a PI`, and the derived retired bucket `Retired scope`

## Work Design Composition

The profile remains independently launchable for ART operations. Governed Work
Design advice is enabled only when Platform runs the registered composition:

- `make devint-up COMPOSITION=work-design-advice`
- `make devint-status COMPOSITION=work-design-advice`
- `make devint-down COMPOSITION=work-design-advice`

That composition supplies the CGG and governed AI gateway cluster endpoints and
one runtime-generated CGG caller credential. OOS accepts the three projections
only as one complete set under the exact composition id. The credential is
mounted from a dedicated namespace Secret, is never written to `broker.env` or
rendered YAML, is omitted from status output, and is removed on failure or
teardown. Standalone profile launch removes stale composition credentials and
leaves Work Design fail closed while preserving the existing ART workbench.

The Governance Operations Console contract does not change: the browser calls
the same-origin Console server, the Console server calls OOS, and only OOS calls
CGG and the governed AI gateway.

## Refinement And Catalog Composition

Refinement execution and Delivery Catalog control remain disabled during a
standalone profile launch. Platform enables them only through the registered
`refinement-catalog` composition. That composition projects the CGG, governed
AI gateway, WGCF repository-readiness, Temporal, and OpenProject Catalog
service endpoints together with their exact caller identities and activation
flags.

Runtime credentials are held in namespace Secrets and mounted only into the
broker, the dedicated Refinement worker, or OpenProject process that consumes
them. They are never written to `broker.env`, rendered manifests, status
output, or Git. The OpenProject Catalog extension and contract are mounted
directly from the canonical `platform-engineering` source through a ConfigMap;
OOS does not keep a copied implementation.

The composition runs a dedicated `src/refinement-worker.js` process. Failure,
suspension, standalone launch, and destructive reset remove the worker and all
composition-owned Secrets, ConfigMap data, and service aliases. This remains a
local `dev-integration` shape; it grants no stage or production authority and
does not change the Console's same-origin browser route through OOS.

## Delivery ART Custody Posture

This persistent profile carries the OOS work-session and source-executor
composition, but Delivery artifact mutation remains disabled by default. The
profile generates a caller-specific Console credential, binds it to the exact
local operator, and supervises an authenticated host source executor. Its
transient socket uses a short operator-private runtime directory while durable
session state stays under the profile state root. The OOS pod receives only the
private executor socket and work-session state paths; it does not receive a
workspace source mount.

The registered `refinement-catalog` composition already supplies the exact
method-scoped OOS caller credential accepted by the WGCF artifact registry.
Work sessions reuse that identity for Delivery artifact registration and
readiness; they do not grant WGCF ART mutation authority or introduce a second
ambient credential.

For the bounded commissioning proof only, launch the composition from the
reviewed OOS worktree with explicit single-writer mutation admission:

```bash
OOS_DELIVERY_ART_MUTATION_ENABLED=true \
OOS_DELIVERY_ART_WRITER_TOPOLOGY=single-writer \
make devint-up COMPOSITION=refinement-catalog \
  EXTRA_ARGS="--repo-path operator-orchestration-service=/absolute/reviewed/oos-worktree"
```

Without that explicit environment, `OOS_DELIVERY_ART_MUTATION_ENABLED=false`
and work-session mutation fails closed. The Console still uses its same-origin
server route; browser code never receives OOS, WGCF, OpenProject, Git, or source
executor credentials.

Profile convergence also removes direct Deployment overrides for
`CALLER_ALLOWED_IDS` and `CALLER_AUTH_SECRETS_JSON` before rollout. Those values
must come from the profile-owned environment Secret so stale commissioning
overlays cannot shadow the current caller bindings.

## What It Reuses

- canonical OpenProject proposal backlog provisioning surface from
  `platform-engineering`
- canonical OpenProject delivery ART provisioning surface from
  `platform-engineering`
- canonical delivery-art view sync surface from `platform-engineering`
- canonical OpenProject broker-identity surface from `platform-engineering`
- real broker API and real ART read/update path

The profile targets local `k3s` and defaults to
`KUBECONFIG=/etc/rancher/k3s/k3s.yaml`. Override that with `DEVINT_KUBECONFIG`
only if your local cluster uses a different kubeconfig path.

## What It Must Never Touch

- governed `stage` or `prod` backends
- the real `Workspace Proposals` runtime
- the real `Workspace Delivery ART` runtime
- shared governed Vault secrets
- governed rollout evidence
- Telegram delivery-management surfaces
- mutating smoke traffic for accepted-idea consumption

Mutating consume/backlink smoke now belongs in the disposable companion profile:

- `accepted-idea-delivery-mutation-smoke`

When the registered `refinement-catalog` composition is active, the profile
accepts only the same operator-scoped Temporal workflow namespace that it
already derives as `governance-${DEVINT_OPERATOR}`. A literal `default`, an
empty value, or another operator's namespace fails closed before the
Refinement worker starts. This keeps one durable history boundary per local
operator and does not create a second generic namespace.

## Operator Actions

Run through the shared `platform-engineering` entrypoints:

- `make devint-up PROFILE=accepted-idea-delivery`
- `make devint-status PROFILE=accepted-idea-delivery`
- `make devint-access PROFILE=accepted-idea-delivery`
- `make devint-smoke PROFILE=accepted-idea-delivery`
- `make devint-down PROFILE=accepted-idea-delivery`
- `make devint-reset PROFILE=accepted-idea-delivery`
- `make devint-promote-check PROFILE=accepted-idea-delivery`

`http://localhost:18183/login` is the primary UI path for this local lane. The
profile exposes its OpenProject Service on stable NodePort `32183`; Platform's
existing `PlatformCoreHostStack` task maps Windows `127.0.0.1:18183` to that
WSL port and refreshes the mapping after restart. `make devint-access
PROFILE=accepted-idea-delivery` reports Kubernetes and Windows access health
and prints the disposable OpenProject admin credential; it does not own a
foreground tunnel. `make devint-status PROFILE=accepted-idea-delivery` reports
Kubernetes runtime health and localhost access health separately.
`make devint-up PROFILE=accepted-idea-delivery` now also synchronizes that
same admin password into the running OpenProject app after Helm rollout so the
printed credential stays valid.
It also converges the managed delivery-art views:

- `PM² Initiative Register`
- `ART Execution Kanban`
- `Program Increment Planning` when PI versions exist
- the roadmap-compatible backlog bucket for work that is not yet committed to a
  PI

While the persistent lane is up, the shared runner supervises a minute-level
host-side reconciler that heals the roadmap projection through the canonical
platform-admin sync surface from `platform-engineering`. The profile declares
the foreground service and a functional readiness probe; the runner owns
detach, process identity, source-bound command digest, logs, status, and
teardown. `make devint-down PROFILE=accepted-idea-delivery` stops the declared
service before suspending the rest of the lane.

Lifecycle semantics for this persistent profile:

- `make devint-down PROFILE=accepted-idea-delivery`
  - suspends the runtime but preserves OpenProject data and local profile state
- `make devint-up PROFILE=accepted-idea-delivery`
  - resumes or reconciles the preserved runtime
- `make devint-reset PROFILE=accepted-idea-delivery`
  - destructive rebuild that wipes the namespace, PVC-backed data, and local
    profile state

To test a worktree instead of the default repo root, pass repo overrides
through `EXTRA_ARGS`, for example:

```bash
make devint-up PROFILE=accepted-idea-delivery \
  EXTRA_ARGS="--repo-path operator-orchestration-service=/home/mfshaf7/worktrees/oos-delivery --repo-path platform-engineering=/home/mfshaf7/worktrees/platform-delivery"
```

## Smoke Scope

The shared `make devint-smoke PROFILE=accepted-idea-delivery` path is now
read-only. It exercises:

- broker readiness
- composed Refinement worker readiness and read-only Catalog projection when
  the `refinement-catalog` composition is active
- proposal backlog list read through the broker projection
- delivery artifact mutation draft creation and validation through the broker
- optimized ART active-session and initiative evidence packet reads through
  the broker
- landing-unit closeout evidence read for the first #650 optimized ART
  dogfood parent, proving the closeout evidence remains valid after automated
  child and parent closure
- proposal project verification through the local OpenProject API
- delivery-art project verification through the local OpenProject API

If you need the full mutating consume/backlink rehearsal, use:

- `make devint-smoke PROFILE=accepted-idea-delivery-mutation-smoke`

The persistent Windows mapping already owns `localhost:18183`. Run read-only
smoke on alternate local ports while keeping the canonical host header:

```bash
DEVINT_OPENPROJECT_LOCAL_PORT=28183 \
DEVINT_OPENPROJECT_HOST_HEADER=localhost:18183 \
DEVINT_BROKER_LOCAL_PORT=28180 \
make devint-smoke PROFILE=accepted-idea-delivery
```

## Stage Handoff Checks

The governed `stage` rehearsal for this active profile is not complete until it
proves these profile-owned checks:

- `broker readiness`
- `composed Work Design dependency and caller binding readiness`
- `composed Refinement and Catalog dependency, caller, credential, and profile binding readiness`
- `dedicated Refinement worker readiness and composition-owned teardown`
- `bounded Catalog control authorization and readback`
- `durable orchestration definition catalog and zero-replica worker`
- `proposal backlog list read`
- `delivery artifact mutation draft workflow`
- `WGCF ART readiness is required for broker completion-style mutations`
- `optimized ART packet reads`
- `landing-unit closeout evidence read`
- `proposal project verification`
- `delivery-art project verification`

## Handoff

`dev-integration` does not promote its runtime directly.

Use `make devint-promote-check PROFILE=accepted-idea-delivery` to generate the
local promotion report. That report must stay aligned with the active profile
`stage_handoff.required_checks`; if the workflow surface changes, update the
profile contract and this README in the same work before treating the handoff
as ready.

Then move the winning source changes into the governed repo and stage path.

When the work still needs mutating consume/backlink rehearsal before stage, run
that proof through the disposable companion profile instead of the persistent
working lane:

- `make devint-up PROFILE=accepted-idea-delivery-mutation-smoke`
- `make devint-smoke PROFILE=accepted-idea-delivery-mutation-smoke`
- `make devint-down PROFILE=accepted-idea-delivery-mutation-smoke`

When that handoff reaches the PR path, use the workspace-level PR review and
optional advisory-review procedure in:

- [workspace-governance/docs/pull-request-review-and-automation.md](https://github.com/mfshaf7/workspace-governance/blob/main/docs/pull-request-review-and-automation.md)

## Design References

- [docs/contracts/accepted-idea-delivery-consumption-v1.md](../../../docs/contracts/accepted-idea-delivery-consumption-v1.md)
- [`platform-engineering/products/openproject/delivery-art-contract.md`](https://github.com/mfshaf7/platform-engineering/blob/main/products/openproject/delivery-art-contract.md)
- [`platform-engineering/docs/decisions/adr/ADR-013-openproject-proposal-to-delivery-split-and-one-art-model.md`](https://github.com/mfshaf7/platform-engineering/blob/main/docs/decisions/adr/ADR-013-openproject-proposal-to-delivery-split-and-one-art-model.md)
