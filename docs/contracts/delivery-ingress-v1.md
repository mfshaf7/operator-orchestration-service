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

## Source Classes

`proposal` is live through the existing authenticated Proposal handoff route.
Its external request, response, receipt reference, replay behavior, and
OpenProject mutation order remain unchanged. The Proposal workflow now adapts
its accepted packet into the neutral envelope before invoking the canonical
target adapter.

`prototype` is contract-admitted but not runtime-active. Its envelope requires
a baseline-approved source version, packet digest, objective, included and
excluded scope, remaining work, baseline identity, evidence references, and
resolved source custody. Prototype packet production, WGCF readiness, target
application, and Console projection remain separate Landing Units.

## Identity And Idempotency

The ingress identity is derived from source kind, source record reference,
packet reference, and the fixed Delivery target. It does not depend on a
client-selected target lane. A stale or substituted identity is rejected before
an adapter runs.

The source workflow retains its stable application identifier and source
version precondition. Target adapters create or reuse exactly one Delivery Epic
and must confirm the reciprocal source backlink before OOS can return target
application evidence.

## Custody And Authority

Only resolved `existing-repo` or `new-repo-required` custody, or explicitly
`not-required` `platform-internal` or `non-source-work` custody, can enter the
application boundary. Pending repository custody is not an application input.

OOS owns target mutation and the target receipt. Source systems own their
records and packets. WGCF will own Prototype ingress readiness after its
separate contract lands. The Console remains an invoking and projection client;
it does not gain canonical write authority.

## Fail-Closed Boundary

The neutral service rejects malformed envelopes, mismatched deterministic
identity, unsupported source adapters, source/runtime-context mismatch, and a
target result without a confirmed source backlink. Prototype application
returns `delivery_ingress_source_not_implemented` until its governed adapter is
activated.

## Operator Surface

No new generic HTTP endpoint is introduced in this Landing Unit. Proposal
operators continue to use
`POST /v1/proposals/{proposal_id}/handoff/apply`. Future Prototype application
must use this neutral service boundary after source packet and readiness
evidence are available; it must not call the OpenProject adapter directly.

## Rollback

Revert the neutral contract, adapter, and Proposal routing changes together.
The Proposal-specific public contract remains the compatibility boundary, so a
rollback does not require a client request or response migration.
