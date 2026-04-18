# Idea Workflow Dev-Integration Profile

This profile is the first concrete `dev-integration` implementation for the
shared local-k3s lane.

It exists so idea-workflow changes can be discovered locally without pushing
every iteration through governed `stage`.

## What It Runs

- local OpenProject through the upstream Helm chart
- bundled local PostgreSQL and Memcached inside that chart
- `operator-orchestration-service` from local source mounted into a generic
  Node runtime pod
- a local Telegram command simulator that imports the real
  `openclaw-telegram-enhanced/src/idea-capture-command.ts`

## What It Reuses

- canonical OpenProject backlog provisioning runner from `platform-engineering`
- canonical OpenProject automation-identity runner from `platform-engineering`
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
- `make devint-smoke PROFILE=idea-workflow`
- `make devint-down PROFILE=idea-workflow`
- `make devint-reset PROFILE=idea-workflow`
- `make devint-promote-check PROFILE=idea-workflow`

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
- `/idea show <idea-id>`

## Handoff

`dev-integration` does not promote its runtime directly.

Use `make devint-promote-check PROFILE=idea-workflow` to generate the local
promotion report, then move the winning source changes into the governed repo
and stage path.
