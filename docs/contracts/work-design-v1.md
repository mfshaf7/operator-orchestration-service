# Delivery Work Design Contract V1

## Status

The OOS source runtime is implemented for ART `#993`. Both routes remain
fail-closed behind the inactive `delivery-work-design-advisor-v1` profile; this
Landing Unit does not activate the model profile or add the Console adapter.

The machine-readable source is
[`contracts/work-design/manifest.json`](../../contracts/work-design/manifest.json)
and its adjacent JSON Schemas.

## Purpose

Provide one provider-neutral protocol for two Work Design assist tasks:

- `context_advice`
- `tree_advice`

The same contract separately defines operator-approved application of an
accepted Work Design draft to canonical Delivery through OOS.

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

- `POST /v1/delivery-work-design/{package_id}/assist`
- `POST /v1/delivery-work-design/{package_id}/apply`

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
3. OOS maps the accepted tree into its canonical Delivery `plan/apply` adapter.
4. OOS reads back the backend result and returns created, updated, and reused
   record references plus a durable receipt.

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

This contract adds no database. OOS later persists only workflow coordination,
accepted draft identity, audit references, and apply receipts using its admitted
runtime boundary. Canonical work remains in OpenProject, context artifacts and
redaction receipts remain in CGG, provider audit remains behind the governed AI
gateway, and the Console remains a projection.

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

OOS keeps an in-process replay cache for immediate duplicate suppression and
also sends every accepted tree through the canonical Delivery reconciler. A
retry after process restart therefore reconciles by backend identity instead of
creating duplicate Delivery records. The application and receipt identities are
derived from the accepted request rather than provider output.

## Activation And Rollback

`delivery-work-design-advisor-v1` is registered by Platform as non-active. A
fresh Security review must bind the exact CGG, gateway, and OOS implementation
heads before Platform activates the profile in dev-integration.

Rollback suspends only the Work Design profile and disables its OOS/Console
integration. It must not disable `intake-classifier-v1`, remove historical audit
or receipts, or broaden direct provider access.
