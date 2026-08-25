# Delivery Work Design Contract V1

## Status

The OOS assist and apply runtime from ART `#993` and the dev-integration profile
activation from ART `#995` are complete. ART `#997` adds the authenticated
current-state projection and restart-safe apply receipt custody required before
the Console adapter can replace fixture authority. Stage and production remain
out of scope.

The machine-readable source is
[`contracts/work-design/manifest.json`](../../contracts/work-design/manifest.json)
and its adjacent JSON Schemas.

## Purpose

Provide one provider-neutral protocol for two Work Design assist tasks:

- `context_advice`
- `tree_advice`

The same contract separately defines operator-approved application of an
accepted Work Design draft to canonical Delivery through OOS. A read-only
projection returns the current source revision and durable application history
without allowing the Console to read OpenProject directly.

## Authority Boundary

| Concern | Authority |
| --- | --- |
| Work Design workflow, task instructions, response validation, acceptance, and apply | `operator-orchestration-service` |
| Context admission, redaction, budgeting, and model-safe projection | `context-governance-gateway` |
| Logical profile, provider route, credentials, egress, and activation | `platform-engineering` |
| Trust review and activation decision | `security-architecture` |
| Operator interaction and backend-derived projection | `governance-operations-console` |
| Canonical ART records | OpenProject through the OOS adapter |

No Console, model, CGG, or gateway output can mutate canonical Delivery.

## Runtime Operations

The OOS API and OpenAPI contract now expose:

- `GET /v1/delivery-work-design/{package_id}/projection?source_ref=...`
- `POST /v1/delivery-work-design/{package_id}/assist`
- `POST /v1/delivery-work-design/{package_id}/apply`

The projection requires normal caller authentication but no mutation authority.
Apply additionally requires the existing Delivery mutation authority.

## Assist Sequence

1. The Console sends a typed task, operator prompt, source revision, and current
   context or tree draft to OOS.
2. OOS verifies source and operator identity, then admits the complete task
   context through CGG.
3. CGG returns only a receipt-bound model-safe packet projection.
4. OOS invokes `delivery-work-design-advisor-v1` through the governed AI
   gateway using the versioned task contract and required output schema.
5. OOS validates the complete response before returning typed advice and
   evidence references to the Console.
6. The operator may accept, ignore, or edit the advice. Advice never starts
   apply.

The assist result preserves the existing Console concepts: confidence,
required operator action, prose guidance, affected node, and bounded patch
summary. `mocked` is not a valid live response status.

## Apply Sequence

1. The Console sends the exact accepted draft id, digest, tree, source revision,
   idempotency key, and operator acceptance record to OOS.
2. OOS rejects stale source, mismatched acceptance identity, conflicting replay,
   or invalid tree structure.
3. OOS reconstructs prior application state from authenticated OpenProject
   activities and rejects conflicting replay.
4. OOS records a deterministic `apply-intent` activity before calling the
   canonical Delivery `plan/apply` adapter.
5. OOS reads back the backend result, records an `apply-completed` activity,
   and returns created, updated, and reused record references plus that durable
   activity receipt.
6. A retry after restart returns the completed receipt without another
   mutation. If only an intent exists, OOS reruns the canonical reconciler and
   completes receipt custody from backend truth.

Advisor evidence is optional on apply. An operator can complete Work Design
without model assistance, and model evidence never substitutes for acceptance.

## Failure Contract

Failures use the bounded codes in
[`error.schema.json`](../../contracts/work-design/error.schema.json). The
response records correlation plus available audit or receipt references and
does not expose provider secrets, raw context, or unvalidated provider output.

Configured live mode fails closed. It must not silently return fixture advice
when CGG, profile, gateway, provider, schema, operator, or backend checks fail.

## Storage And Audit

This contract adds no database. Canonical work and versioned Work Design apply
events remain in OpenProject. Context artifacts and redaction receipts remain in
CGG, provider audit remains behind the governed AI gateway, and the Console
remains a projection.

Only activity comments authored by the authenticated OOS OpenProject identity
and matching the strict versioned event marker become receipt truth. Ordinary
comments and foreign-user comments are ignored. Malformed or conflicting
trusted events fail closed. The bounded projection returns at most the newest
100 completed applications while the adapter keeps a bounded history scan.

Every assist binds:

- caller and operator identity
- Delivery and package identity
- source revision
- request and correlation identity
- task contract and logical profile
- CGG packet and redaction receipt
- output schema and gateway audit reference

Every apply additionally binds the accepted draft digest, idempotency key,
backend readback, and final receipt.

OOS uses in-process serialization only as an optimization for simultaneous
requests. Durable event history and canonical backend reconciliation remain the
authority after restart. Application and event identities derive from the
accepted request rather than provider output.

## Activation And Rollback

`delivery-work-design-advisor-v1` is active only in the admitted
`work-design-advice` dev-integration composition. Platform supplies the CGG and
governed AI gateway endpoints plus one composition-lifetime CGG caller binding;
OOS rejects partial or foreign projection and keeps standalone Work Design fail
closed. The Console continues to use the same-origin OOS routes and receives no
CGG, gateway, provider, or cluster credential.

Rollback removes the OOS composition projections and caller binding, then
suspends only the Work Design profile. It must not disable
`intake-classifier-v1`, remove historical audit or receipts, alter unrelated ART
workflows, or broaden direct provider access.
