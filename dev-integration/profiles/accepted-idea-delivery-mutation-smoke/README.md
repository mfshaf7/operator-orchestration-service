# Accepted Idea Delivery Mutation Smoke Dev-Integration Profile

This profile is the disposable mutation-smoke companion for the persistent
`accepted-idea-delivery` workbench.

Current lifecycle in the shared workspace contract:

- `active`
- self-serve launchable through the shared runner

It exists so accepted-idea consume and backlink smoke can run against an
isolated local runtime without polluting the persistent accepted-idea-delivery
ART lane.

It also owns the disposable end-to-end proof for the graduated Governance
Operations Console Proposal path. That proof starts the Console on loopback,
routes every Proposal read and command through the Console API and OOS, and
keeps the persistent profile read-only.

Runtime state model:

- `disposable`

## What It Runs

- local OpenProject through the upstream Helm chart
- local OpenProject runtime bounded to:
  - `OPENPROJECT_WEB__WORKERS=1`
  - `workers.default.maxThreads=10`
- bundled local PostgreSQL and Memcached inside that chart
- `operator-orchestration-service` from local source mounted into a generic
  Node runtime pod
- `governance-operations-console` as a loopback-only local process for the
  Proposal API proof
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
- the exact local `governance-operations-console` source revision as a
  loopback-only test consumer

The profile targets local `k3s` and defaults to
`KUBECONFIG=/etc/rancher/k3s/k3s.yaml`. Override that with `DEVINT_KUBECONFIG`
only if your local cluster uses a different kubeconfig path.

## What It Must Never Touch

- governed `stage` or `prod` backends
- the real `Workspace Proposals` runtime
- the real `Workspace Delivery ART` runtime
- the persistent `accepted-idea-delivery` devint lane
- shared governed Vault secrets
- governed rollout evidence
- Telegram delivery-management surfaces

## Operator Actions

Run through the shared `platform-engineering` entrypoints:

- `make devint-up PROFILE=accepted-idea-delivery-mutation-smoke`
- `make devint-status PROFILE=accepted-idea-delivery-mutation-smoke`
- `make devint-access PROFILE=accepted-idea-delivery-mutation-smoke`
- `make devint-smoke PROFILE=accepted-idea-delivery-mutation-smoke`
- `make devint-down PROFILE=accepted-idea-delivery-mutation-smoke`
- `make devint-reset PROFILE=accepted-idea-delivery-mutation-smoke`
- `make devint-promote-check PROFILE=accepted-idea-delivery-mutation-smoke`

`make devint-access PROFILE=accepted-idea-delivery-mutation-smoke` is the
primary UI path for this disposable lane. It prints the disposable OpenProject
admin credential for the current session and then holds open the port-forward
at `http://localhost:18283/login` until you stop it.

Lifecycle semantics for this disposable profile:

- `make devint-down PROFILE=accepted-idea-delivery-mutation-smoke`
  - removes the live runtime but preserves the local state root
- `make devint-reset PROFILE=accepted-idea-delivery-mutation-smoke`
  - destructive rebuild that also clears the local profile state

## Smoke Scope

The smoke script exercises:

- broker readiness
- accepted idea lookup through the broker projection
- delivery-art project verification through the local OpenProject API
- accepted-idea consumption into `workspace-delivery-art`
- durable backlink verification on both the source proposal and the delivery
  record
- Console Proposal capture and canonical refresh
- version-bound triage and disposition
- prepared handoff without target application
- idempotent command replay
- stale-version and backend-outage rejection
- repository-gate rejection with canonical state retained

The Proposal result is written to
`.dev-integration/accepted-idea-delivery-mutation-smoke/<operator>/proposal-live-e2e-summary.json`.
It contains scenario outcomes and exact source revisions, but never the caller
secret.

## Stage Handoff Checks

The governed `stage` rehearsal for this active profile is not complete until it
proves these profile-owned checks:

- `accepted idea lookup`
- `delivery-art project verification`
- `consume accepted idea`
- `backlink verification`
- `Console Proposal capture and refresh`
- `Proposal triage, disposition, and prepared handoff`
- `Proposal replay, stale-version, and backend-outage rejection`
- `repository gate blocking and target non-application`

## Handoff

`dev-integration` does not promote its runtime directly.

Use `make devint-promote-check PROFILE=accepted-idea-delivery-mutation-smoke`
to generate the local promotion report. That report must stay aligned with the
active profile `stage_handoff.required_checks`; if the workflow surface
changes, update the profile contract and this README in the same work before
treating the handoff as ready.

Then move the winning source changes into the governed repo and stage path.

## Design References

- [../accepted-idea-delivery/README.md](../accepted-idea-delivery/README.md)
- [docs/contracts/accepted-idea-delivery-consumption-v1.md](../../../docs/contracts/accepted-idea-delivery-consumption-v1.md)
- [`platform-engineering/products/openproject/delivery-art-contract.md`](https://github.com/mfshaf7/platform-engineering/blob/main/products/openproject/delivery-art-contract.md)
