# Runtime Shape

## Phase 1 Decision

Phase 1 should be a small internal HTTP service, not a queue-first system and
not a general agent runtime.

## Intended Deployment Position

The intended runtime shape is:

- cluster-internal service
- no public ingress
- callable only by approved internal operator surfaces
- separate from `openclaw-telegram-enhanced`

Initial caller:

- `openclaw-telegram-enhanced`

Initial backend systems:

- OpenProject
- reserved future local AI assist provider or governed AI path

## Why This Shape

This keeps the workflow seam stable while:

- Telegram UX changes
- OpenProject configuration evolves
- AI provider strategy changes over time

## Phase 1 Topology

```mermaid
flowchart LR
    TG[openclaw-telegram-enhanced]
    OOS[operator-orchestration-service]
    OP[OpenProject API]
    AI[reserved future local AI provider or governed AI path]

    TG --> OOS
    OOS --> OP
    OOS --> AI
```

## Endpoint Style

Phase 1 endpoints stay synchronous HTTP:

- `GET /v1/workflows`
- `GET /v1/workflows/idea-command`
- `GET /v1/workflows/idea-capture`
- `GET /v1/workflows/idea-triage`
- `GET /v1/workflows/idea-decision`
- `GET /v1/ideas`
- `GET /v1/ideas/{idea_id}`
- `POST /v1/ideas/lookup`
- `POST /v1/ideas/capture`
- `POST /v1/ideas/{idea_id}/triage`
- `POST /v1/ideas/{idea_id}/decision`

Reason:

- operator workflows are low-volume
- the first use case is interactive
- the phone-friendly triage path should remain usable without AI availability
- synchronous responses simplify Telegram rendering and operator approval

## Data And State Shape

Phase 1 should not introduce a dedicated internal database unless forced by a
real requirement.

The intended state model is:

- OpenProject remains the canonical idea record
- the broker owns transient workflow logic
- the broker owns workflow descriptors and normalized read projections
- correlation ids and source refs are carried through the workflow
- audit is emitted as structured events

If durable broker-side state later becomes necessary for retries or multi-step
workflow recovery, that should be introduced deliberately and documented as a
new trust-boundary decision.

## Idempotency Direction

Phase 1 should require callers to send a stable source reference and/or
idempotency key.

The broker should:

- treat source refs as first-class workflow correlation keys
- avoid duplicate idea creation when the same source ref is replayed
- preserve returned canonical record refs for reuse by later steps

The exact deduplication mechanism is deferred until the OpenProject field model
is finalized.

## Health And Visibility Expectations

Before admission to active runtime, the service must answer:

- health endpoint
- version or commit attestation
- structured audit output location
- caller auth status and backend reachability diagnostics

Expected minimum operator surfaces:

- `/healthz`
- `/readyz`
- `/version`

## Deferred In Phase 1

- public ingress
- queue workers
- webhook fan-out
- arbitrary background job orchestration
- generic chat completions
