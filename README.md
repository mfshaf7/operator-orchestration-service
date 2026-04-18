# operator-orchestration-service

`operator-orchestration-service` is a shared operator-facing workflow service that brokers bounded operator requests from fast interaction surfaces into governed, auditable workflow actions against canonical backend systems.

Current maturity:

- lifecycle: active
- workspace status: active repo and active shared component
- primary initial use case: idea capture and idea triage from Telegram into
  OpenProject
- current implementation scope: workflow-catalog and capture-first service
  skeleton with broker-owned help metadata, bounded idea read and list
  projections, and `POST /v1/ideas/capture`
- local fast-iteration lane: `dev-integration` `idea-workflow` profile on local
  `k3s`

## Intended Role

This service exists to keep workflow orchestration out of fast-changing channel
adapters such as `openclaw-telegram-enhanced/`.

The service should provide:

- stable internal workflow APIs
- workflow correlation and audit
- bounded AI-assist orchestration for operator workflows
- adapters to canonical systems such as OpenProject
- explicit operator approval before durable workflow outcomes are committed

## System Position

The intended path is:

`Telegram or another operator surface -> operator-orchestration-service -> AI assist backend and canonical backend system`

Initial target flow:

`/idea` or `/idea triage` in Telegram -> `operator-orchestration-service` ->
structured suggestion and/or OpenProject write

## What This Repo Owns

- workflow-oriented service APIs such as idea capture, triage, and decision
  recording
- correlation ids, idempotency handling, and workflow audit events
- provider-agnostic AI assist invocation for bounded operator workflows
- OpenProject-facing workflow adapters
- operator approval handling at the workflow layer

## What This Repo Does Not Own

- Telegram delivery, message formatting, or chat UX
- workspace admission contracts or intake policy
- platform rollout authority
- provider-specific governed AI policy
- canonical product or component records outside the workflows it brokers

## First Capability Boundary

The first supported workflow is expected to be:

- capture an idea from Telegram
- optionally request bounded AI triage for that idea
- present the suggestion back to the operator
- write the accepted result into OpenProject

## Security And Governance Posture

This service crosses multiple trust boundaries and must not become the trust
anchor for governance decisions.

Non-negotiable rules:

- operator approval remains required for durable intake decisions
- model output must stay bounded to a reviewed structured schema
- the service must not mutate active workspace contracts directly
- Telegram or other channel adapters must not carry backend or model-provider
  credentials

The service is active as a bounded shared workflow component now, but its live
scope is still intentionally narrow.

## Initial Repo Guide

- repo-local guidance: [AGENTS.md](AGENTS.md)
- architecture: [docs/architecture/overview.md](docs/architecture/overview.md)
- runtime shape: [docs/architecture/runtime-shape.md](docs/architecture/runtime-shape.md)
- security model: [docs/architecture/security-model.md](docs/architecture/security-model.md)
- interface contract: [contracts/interface-manifest.json](contracts/interface-manifest.json)
- initial API shape: [docs/contracts/intake-api-v1.md](docs/contracts/intake-api-v1.md)
- OpenProject adapter contract:
  [docs/contracts/openproject-adapter-v1.md](docs/contracts/openproject-adapter-v1.md)
- audit event contract: [docs/contracts/audit-events-v1.md](docs/contracts/audit-events-v1.md)
- change-record lane: [docs/records/change-records/README.md](docs/records/change-records/README.md)
- dev-integration profile:
  [dev-integration/profiles/idea-workflow/README.md](dev-integration/profiles/idea-workflow/README.md)
- proposed security review:
  [`security-architecture/docs/reviews/components/2026-04-18-operator-orchestration-service-proposed-component-review.md`](https://github.com/mfshaf7/security-architecture/blob/main/docs/reviews/components/2026-04-18-operator-orchestration-service-proposed-component-review.md)
- runtime-admission security review:
  [`security-architecture/docs/reviews/components/2026-04-18-operator-orchestration-service-runtime-admission.md`](https://github.com/mfshaf7/security-architecture/blob/main/docs/reviews/components/2026-04-18-operator-orchestration-service-runtime-admission.md)
- component security view:
  [`security-architecture/docs/architecture/components/operator-orchestration-service/README.md`](https://github.com/mfshaf7/security-architecture/blob/main/docs/architecture/components/operator-orchestration-service/README.md)
- security review checklist:
  [`security-architecture/docs/reviews/security-review-checklist.md`](https://github.com/mfshaf7/security-architecture/blob/main/docs/reviews/security-review-checklist.md)
- AI governance standard:
  [`security-architecture/docs/standards/ai-security-and-governance.md`](https://github.com/mfshaf7/security-architecture/blob/main/docs/standards/ai-security-and-governance.md)

## Runtime Skeleton

The repo now carries a minimal no-dependency Node runtime that keeps the
service boundary real without prematurely admitting it to cluster runtime.

Implemented in the current phase:

- `GET /healthz`
- `GET /readyz`
- `GET /version`
- `GET /v1/workflows`
- `GET /v1/workflows/idea-command`
- `GET /v1/workflows/idea-capture`
- `GET /v1/ideas`
- `GET /v1/ideas/{idea_id}`
- `POST /v1/ideas/lookup`
- `POST /v1/ideas/capture`

Deferred to the next phase:

- `POST /v1/ideas/{idea_id}/triage`
- `POST /v1/ideas/{idea_id}/decision`
- runtime admission and Vault-delivered secret wiring

## Local Bring-Up

1. Copy `.env.example` into local environment management.
2. Supply the OpenProject token and backlog field ids.
3. If the target OpenProject runtime enforces a canonical external host, also
   set `OPENPROJECT_HOST_HEADER`.
4. Start the service:

```bash
npm start
```

5. Run tests:

```bash
npm test
```

`/readyz` currently checks both config completeness and live reachability of the
configured OpenProject project. That gives the repo a concrete operator surface
before runtime admission.

## Governance Validation

```bash
python3 scripts/validate_governance_docs.py --repo-root .
python3 scripts/validate_change_record_requirement.py --repo-root . --against-ref origin/main
```

## Dev-Integration

This repo owns the first concrete `dev-integration` profile:
`idea-workflow`.

That profile exists to let the broker idea workflow iterate quickly on local
`k3s` before the winning shape moves through the governed `stage` path.

It reuses:

- this repo's real broker runtime
- `openclaw-telegram-enhanced`'s real `/idea` command handler through a local
  simulator
- `platform-engineering`'s canonical OpenProject backlog and automation runners

Shared operator entrypoints are exposed from `platform-engineering`:

```bash
make devint-up PROFILE=idea-workflow
make devint-status PROFILE=idea-workflow
make devint-smoke PROFILE=idea-workflow
make devint-reset PROFILE=idea-workflow
make devint-down PROFILE=idea-workflow
make devint-promote-check PROFILE=idea-workflow
```

`dev-integration` does not require push or PR for ordinary iteration. It is
local-only, uses local branches or worktrees, and records the exact repo state
in a session manifest under `.dev-integration/`.

Once the winning shape leaves `dev-integration` and enters the PR path, follow
the workspace-level Codex review and PR procedure in
[`workspace-governance/docs/codex-github-review-and-automation.md`](https://github.com/mfshaf7/workspace-governance/blob/main/docs/codex-github-review-and-automation.md).
