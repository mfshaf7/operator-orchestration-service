# Idea Workflow Dev-Integration Profile

This profile is the first concrete `dev-integration` implementation for the
shared local-k3s lane.

Current lifecycle in the shared workspace contract:

- `active`
- self-serve launchable through the shared runner

It exists so idea-workflow changes can be discovered locally without pushing
every iteration through governed `stage`.

Runtime state model:

- `disposable`

## What It Runs

- local OpenProject through the upstream Helm chart
- bundled local PostgreSQL and Memcached inside that chart
- `operator-orchestration-service` from local source mounted into a generic
  Node runtime pod
- a local Telegram command simulator that imports the real
  `openclaw-telegram-enhanced/src/idea-capture-command.ts`

## What It Reuses

- canonical OpenProject backlog provisioning surface from `platform-engineering`
- canonical OpenProject automation-identity surface from `platform-engineering`
- real broker API and real `/idea` command handling path

The profile targets local `k3s` and defaults to
`KUBECONFIG=/etc/rancher/k3s/k3s.yaml`. Override that with `DEVINT_KUBECONFIG`
only if your local cluster uses a different kubeconfig path.

## What It Must Never Touch

- governed `stage` or `prod` backends
- the real `Workspace Proposals` runtime
- shared governed Vault secrets
- governed rollout evidence

## Operator Actions

Run through the shared `platform-engineering` entrypoints:

- `make devint-up PROFILE=idea-workflow`
- `make devint-status PROFILE=idea-workflow`
- `make devint-access PROFILE=idea-workflow`
- `make devint-smoke PROFILE=idea-workflow`
- `make devint-down PROFILE=idea-workflow`
- `make devint-reset PROFILE=idea-workflow`
- `make devint-promote-check PROFILE=idea-workflow`

`make devint-access PROFILE=idea-workflow` is the primary UI path for this
local lane. It prints the disposable OpenProject admin credential for the
current session and then holds open the port-forward at
`http://localhost:18083/login` until you stop it.
`make devint-up PROFILE=idea-workflow` now also synchronizes that same admin
password into the running OpenProject app after Helm rollout so the printed
credential stays valid.

Lifecycle semantics for this disposable profile:

- `make devint-down PROFILE=idea-workflow`
  - removes the live runtime
- `make devint-reset PROFILE=idea-workflow`
  - destructive rebuild that also clears the local profile state

To test a worktree instead of the default repo root, pass repo overrides
through `EXTRA_ARGS`, for example:

```bash
make devint-up PROFILE=idea-workflow \
  EXTRA_ARGS="--repo-path operator-orchestration-service=/home/mfshaf7/worktrees/oos-feature"
```

## Smoke Scope

The smoke script exercises:

- broker readiness
- `/idea help`
- `/idea <text>`
- `/idea list`
- `/idea list all`
- `/idea list status <status>`
- `/idea list all status <status>`
- `/idea triage <idea-id> <summary>`
- `/idea decide <idea-id> <parked|accepted|rejected> <notes>`
- `/idea show <idea-id>`

## Stage Handoff Checks

The governed `stage` rehearsal for this active profile is not complete until it
proves these profile-owned checks:

- `/idea help`
- `/idea <text>`
- `/idea list status <status>`
- `/idea triage <idea-id> <summary>`
- `/idea decide <idea-id> <parked|accepted|rejected> <notes>`
- `/idea show <idea-id> including internal evaluation metadata readback`

## Handoff

`dev-integration` does not promote its runtime directly.

Use `make devint-promote-check PROFILE=idea-workflow` to generate the local
promotion report. That report must stay aligned with the active profile
`stage_handoff.required_checks`; if the workflow surface changes, update the
profile contract and this README in the same work before treating the handoff
as ready.

Then move the winning source changes into the governed repo and stage path.

When that handoff reaches the PR path, use the workspace-level PR review and
optional advisory-review procedure in:

- [workspace-governance/docs/pull-request-review-and-automation.md](https://github.com/mfshaf7/workspace-governance/blob/main/docs/pull-request-review-and-automation.md)
