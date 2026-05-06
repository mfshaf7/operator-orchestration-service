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
  Node runtime pod
- broker-side WGCF ART readiness enforcement for completion-style work-item
  mutations, using the `governance-control-fabric` dev-integration WGCF API
- local proposal backlog seeding plus local delivery ART seeding through the
  canonical `platform-engineering` OpenProject platform-admin surface
- a local broker automation identity with access only to
  `workspace-proposals` and `workspace-delivery-art`
- a host-side delivery-art view reconciler loop that keeps the OpenProject
  roadmap projection aligned to ART `Target PI`, the derived backlog bucket
  `Not yet committed to a PI`, and the derived retired bucket `Retired scope`

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

## Operator Actions

Run through the shared `platform-engineering` entrypoints:

- `make devint-up PROFILE=accepted-idea-delivery`
- `make devint-status PROFILE=accepted-idea-delivery`
- `make devint-access PROFILE=accepted-idea-delivery`
- `make devint-smoke PROFILE=accepted-idea-delivery`
- `make devint-down PROFILE=accepted-idea-delivery`
- `make devint-reset PROFILE=accepted-idea-delivery`
- `make devint-promote-check PROFILE=accepted-idea-delivery`

`make devint-access PROFILE=accepted-idea-delivery` is the primary UI path for
this local lane. It prints the disposable OpenProject admin credential for the
current session and then holds open the port-forward at
`http://localhost:18183/login` until you stop it.
`make devint-up PROFILE=accepted-idea-delivery` now also synchronizes that
same admin password into the running OpenProject app after Helm rollout so the
printed credential stays valid.
It also converges the managed delivery-art views:

- `PM² Initiative Register`
- `ART Execution Kanban`
- `Program Increment Planning` when PI versions exist
- the roadmap-compatible backlog bucket for work that is not yet committed to a
  PI

While the persistent lane is up, a minute-level host-side reconciler loop
keeps that roadmap projection healed automatically by calling the canonical
platform-admin sync surface from `platform-engineering`. `make devint-down
PROFILE=accepted-idea-delivery` stops that loop along with the rest of the
lane so the paused profile does not keep mutating OpenProject in the
background.

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

If your current access session is already holding `localhost:18183`, run the
read-only smoke on alternate local ports while keeping the canonical host
header:

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

When that handoff reaches the PR path, use the workspace-level Codex review and
PR procedure in:

- [workspace-governance/docs/codex-github-review-and-automation.md](https://github.com/mfshaf7/workspace-governance/blob/main/docs/codex-github-review-and-automation.md)

## Design References

- [docs/contracts/accepted-idea-delivery-consumption-v1.md](../../../docs/contracts/accepted-idea-delivery-consumption-v1.md)
- [`platform-engineering/products/openproject/delivery-art-contract.md`](https://github.com/mfshaf7/platform-engineering/blob/main/products/openproject/delivery-art-contract.md)
- [`platform-engineering/docs/decisions/adr/ADR-013-openproject-proposal-to-delivery-split-and-one-art-model.md`](https://github.com/mfshaf7/platform-engineering/blob/main/docs/decisions/adr/ADR-013-openproject-proposal-to-delivery-split-and-one-art-model.md)
