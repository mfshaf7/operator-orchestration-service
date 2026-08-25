# Delivery Ingress Contract V1

## Purpose

Define one OOS-owned application boundary for source records entering Workspace
Delivery ART. Proposal and Prototype preserve their own source truth and packet
formats; neither source writes Delivery directly.

## Contract Artifacts

- `contracts/delivery-ingress/application-envelope.schema.json` binds one
  source kind, record version, packet, resolved custody posture, operator, and
  deterministic ingress identity to the fixed Delivery target.
- `contracts/delivery-ingress/target-application-result.schema.json` records
  the one created or reused Delivery Epic, reciprocal source backlink, and
  OOS-owned receipt.
- `contracts/delivery-ingress/manifest.json` records source-class activation
  state and invariants.
- `contracts/delivery-ingress/prototype-delivery-packet.schema.json` and
  `prototype-ingress-readiness-receipt.schema.json` are the digest-pinned
  Prototype Studio and WGCF contracts consumed by OOS.
- `contracts/delivery-ingress/prototype-application-request.schema.json`,
  `prototype-application-event.schema.json`, and
  `prototype-application-result.schema.json` define authenticated application,
  immutable target evidence, and the backend-derived read projection.

## Source Classes

`proposal` is live through the existing authenticated Proposal handoff route.
Its external request, response, receipt reference, replay behavior, and
OpenProject mutation order remain unchanged. The Proposal workflow now adapts
its accepted packet into the neutral envelope before invoking the canonical
target adapter.

`prototype` is live through the authenticated Prototype Delivery application
routes. Its envelope requires a baseline-approved source version, packet
digest, objective, included and excluded scope, remaining work, baseline
identity, evidence references, and resolved source custody. OOS validates the
exact packet identity, obtains a durable WGCF allow receipt, and creates or
reuses one Delivery Epic. The Console remains a separate projection client.

## Identity And Idempotency

The ingress identity is derived from source kind, source record reference,
packet reference, and the fixed Delivery target. It does not depend on a
client-selected target lane. A stale or substituted identity is rejected before
an adapter runs.

The source workflow retains its stable application identifier and source
version precondition. Prototype application identity is derived from source
record, packet reference, packet digest, and the fixed Delivery target. A
structured target marker binds the Delivery Epic to that identity, packet,
baseline, operator decision, and WGCF receipt. Target adapters create or reuse
exactly one Delivery Epic and confirm its reciprocal source backlink before OOS
returns target application evidence.

## Custody And Authority

Only resolved `existing-repo` or `new-repo-required` custody, or explicitly
`not-required` `platform-internal` or `non-source-work` custody, can enter the
application boundary. Pending repository custody is not an application input.

OOS owns target mutation and the target receipt. Source systems own their
records and packets. WGCF owns Prototype ingress readiness and has no target
mutation authority. The Console remains an invoking and projection client; it
does not gain canonical write authority.

OOS does not introduce a separate application database. Durable execution
state remains platform-owned, readiness remains in the WGCF ledger, and target
application evidence remains an immutable OOS-authored OpenProject activity.
Process-local serialization protects the admitted single-writer dev-integration
topology; durable replay always derives from backend evidence.

## Fail-Closed Boundary

The neutral service rejects malformed envelopes, mismatched deterministic
identity, unsupported source adapters, source/runtime-context mismatch, and a
target result without a confirmed source backlink. Prototype application also
rejects packet identity drift, caller/operator mismatch, WGCF denial, malformed
or mismatched readiness evidence, duplicate targets, conflicting target
markers, duplicate trusted events, and invalid receipt custody.

## Operator Surface

Proposal operators continue to use
`POST /v1/proposals/{proposal_id}/handoff/apply`. Prototype operators use:

- `POST /v1/delivery-ingress/prototype/applications`
- `GET /v1/delivery-ingress/prototype/applications/{application_id}`

The POST body carries the exact Prototype packet and an explicit operator apply
decision. The authenticated caller must match the decision operator. The GET
route reconstructs its projection from trusted OpenProject evidence and does
not mutate state. See the
[Prototype Delivery operator surface](../operations/prototype-delivery-application.md).

## Rollback

Disable the Prototype routes and adapter together while retaining source-owned
packets and WGCF readiness evidence. Existing Delivery Epics and immutable
application activities remain auditable. The Proposal-specific public contract
remains the compatibility boundary and needs no client migration.
