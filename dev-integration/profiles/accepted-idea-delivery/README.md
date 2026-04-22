# Accepted Idea Delivery Dev-Integration Profile

This profile is the second concrete `dev-integration` implementation for the
shared local-k3s lane.

Current lifecycle in the shared workspace contract:

- `active`
- self-serve launchable through the shared runner

It exists so accepted-idea delivery changes can be rehearsed locally without
using governed `stage` to discover project-model, identity-scope, or backlink
mistakes.

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
- local proposal backlog seeding plus local delivery ART seeding through the
  canonical `platform-engineering` runners
- a local broker automation identity with access only to
  `workspace-proposals` and `workspace-delivery-art`

## What It Reuses

- canonical OpenProject proposal backlog provisioning runner from
  `platform-engineering`
- canonical OpenProject delivery ART provisioning runner from
  `platform-engineering`
- canonical delivery-art view sync runner from `platform-engineering`
- canonical OpenProject broker-identity runner from `platform-engineering`
- real broker API and real internal accepted-idea consume path

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

The smoke script exercises:

- broker readiness
- accepted idea lookup through the broker projection
- delivery-art project verification through the local OpenProject API
- accepted-idea consumption into `workspace-delivery-art`
- durable backlink verification on both the source proposal and the delivery
  record

## Stage Handoff Checks

The governed `stage` rehearsal for this active profile is not complete until it
proves these profile-owned checks:

- `accepted idea lookup`
- `delivery-art project verification`
- `consume accepted idea`
- `backlink verification`

## Handoff

`dev-integration` does not promote its runtime directly.

Use `make devint-promote-check PROFILE=accepted-idea-delivery` to generate the
local promotion report. That report must stay aligned with the active profile
`stage_handoff.required_checks`; if the workflow surface changes, update the
profile contract and this README in the same work before treating the handoff
as ready.

Then move the winning source changes into the governed repo and stage path.

When that handoff reaches the PR path, use the workspace-level Codex review and
PR procedure in:

- [workspace-governance/docs/codex-github-review-and-automation.md](https://github.com/mfshaf7/workspace-governance/blob/main/docs/codex-github-review-and-automation.md)

## Design References

- [docs/contracts/accepted-idea-delivery-consumption-v1.md](../../../docs/contracts/accepted-idea-delivery-consumption-v1.md)
- [`platform-engineering/products/openproject/delivery-art-contract.md`](https://github.com/mfshaf7/platform-engineering/blob/main/products/openproject/delivery-art-contract.md)
- [`platform-engineering/docs/decisions/adr/ADR-013-openproject-proposal-to-delivery-split-and-one-art-model.md`](https://github.com/mfshaf7/platform-engineering/blob/main/docs/decisions/adr/ADR-013-openproject-proposal-to-delivery-split-and-one-art-model.md)
