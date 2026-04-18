# operator-orchestration-service

`operator-orchestration-service` is a proposed shared operator-facing workflow
service that brokers bounded operator requests from fast interaction surfaces
into governed, auditable workflow actions against canonical backend systems.

Current maturity:

- lifecycle: proposed
- workspace status: intake-registered, not admitted
- primary initial use case: idea capture and idea triage from Telegram into
  OpenProject
- current implementation scope: capture-first service skeleton with
  `/healthz`, `/readyz`, `/version`, and `POST /v1/ideas/capture`

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

Until the service is admitted and deployed, this repo is design and contract
scaffolding only.

## Initial Repo Guide

- repo-local guidance: [AGENTS.md](AGENTS.md)
- architecture: [docs/architecture/overview.md](docs/architecture/overview.md)
- runtime shape: [docs/architecture/runtime-shape.md](docs/architecture/runtime-shape.md)
- security model: [docs/architecture/security-model.md](docs/architecture/security-model.md)
- initial API shape: [docs/contracts/intake-api-v1.md](docs/contracts/intake-api-v1.md)
- OpenProject adapter contract:
  [docs/contracts/openproject-adapter-v1.md](docs/contracts/openproject-adapter-v1.md)
- audit event contract: [docs/contracts/audit-events-v1.md](docs/contracts/audit-events-v1.md)
- change-record lane: [docs/records/change-records/README.md](docs/records/change-records/README.md)
- proposed security review:
  [`security-architecture/docs/reviews/components/2026-04-18-operator-orchestration-service-proposed-component-review.md`](https://github.com/mfshaf7/security-architecture/blob/main/docs/reviews/components/2026-04-18-operator-orchestration-service-proposed-component-review.md)

## Runtime Skeleton

The repo now carries a minimal no-dependency Node runtime that keeps the
service boundary real without prematurely admitting it to cluster runtime.

Implemented in phase 1:

- `GET /healthz`
- `GET /readyz`
- `GET /version`
- `POST /v1/ideas/capture`

Deferred to the next phase:

- `POST /v1/ideas/{idea_id}/triage`
- `POST /v1/ideas/{idea_id}/decision`
- Telegram adapter wiring
- runtime admission and Vault-delivered secret wiring

## Local Bring-Up

1. Copy `.env.example` into local environment management.
2. Supply the OpenProject token and backlog field ids.
3. Start the service:

```bash
npm start
```

4. Run tests:

```bash
npm test
```

`/readyz` currently checks both config completeness and live reachability of the
configured OpenProject project. That gives the repo a concrete operator surface
before runtime admission.
