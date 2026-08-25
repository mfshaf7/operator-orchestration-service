# Delivery Catalog Contract V1

## Status

The Catalog protocol was admitted by ART `#1005`; its OOS runtime source is
complete under ART `#1010`. Workspace composition, Security review, Platform
activation, and Console wiring remain downstream Landing Units. The runtime
therefore fails closed until the privileged Catalog control route is configured
and approved. No live capability is claimed by this source change.

The machine-readable source is
[`contracts/catalog/manifest.json`](../../contracts/catalog/manifest.json) and
its adjacent JSON Schemas.

## Purpose

Delivery Catalog is the operator surface for backend-owned Delivery vocabulary.
It projects Catalog groups, items, and values and applies bounded add, edit, or
retire mutations through OOS. The contract preserves the approved Console
concepts while removing prototype-local authority.

Catalog is not repository admission. It can link and synchronize an admitted
repository value, but it cannot create, rename, suspend, retire, or delete a
repository.

## Authority Boundary

| Concern | Authority |
| --- | --- |
| Catalog projection, mutation validation, OpenProject adapter call, readback, idempotency, receipt, and history | `operator-orchestration-service` |
| Repository admission and lifecycle | Governance Operations Console Repository operation and its future OOS adapter |
| Repository readiness evaluation and receipt | `workspace-governance-control-fabric` |
| Trust review and activation decision | `security-architecture` |
| Operator interaction and semantic-to-visual mapping | `governance-operations-console` |
| Canonical Delivery Catalog values | OpenProject through the OOS adapter |

The Console calls OOS only. OOS verifies the WGCF receipt; the browser does not
call WGCF or OpenProject directly.

## Contract-Admitted Operations

- `GET /v1/delivery-catalog/projection`
- `POST /v1/delivery-catalog/{catalog_item_id}/mutations`

These paths are source-complete and inactive until the later composition,
Security, and Platform activation Landing Units authorize their dependencies.

OpenProject API v3 exposes Custom Options as a read surface, not an
administrative value-mutation API. OOS therefore delegates canonical Catalog
mutation to a bounded privileged control adapter instead of pretending the
ordinary OpenProject API can perform that operation. The adapter must return
canonical readback and durable backend evidence before OOS reports success.

## Projection

The projection carries semantic status, source authority, routes, capabilities,
usage, evidence, and next action for each group, item, and value. It deliberately
excludes visual tones and layout metadata. The Console derives visual treatment
from lifecycle, gap, route, and projection status.

The source revision is mandatory. Every mutation binds that revision so stale
operator forms cannot overwrite newer canonical Catalog state.

## Console Compatibility

The projection preserves the Console's semantic group, item, value, usage,
capability, route, evidence, parent-value, and lifecycle fields. OOS adds the
canonical `source_revision`, uses `projected_at` as the projection timestamp,
and may include a repository-readiness binding on Owner Repo values. The later
Console adapter maps that semantic contract into presentation state, derives
visual tone locally, and must not reintroduce fixture authority or mutate
Catalog identifiers.

## Mutation

1. The operator chooses add, edit, or retire in the existing Catalog surface.
2. The Console submits one typed draft, exact source revision, deterministic
   idempotency key, and matching operator acceptance to OOS.
3. OOS validates Catalog capability, lifecycle, parent relationship, usage and
   retirement rules, and any repository readiness reference.
4. OOS invokes only the canonical backend route owned by that Catalog item.
5. Success requires readback of the resulting value and a digest-bound receipt.
6. Retry with the same identity returns the same mutation result and does not
   create a duplicate value.

## Repository Binding

A repository-bound Catalog value requires:

- an exact `repo://<repo-name>` identity, not free text
- the same normalized Catalog value key
- a current `repo:<repo-name>` WGCF readiness scope
- a ready receipt with issuer, URI, digest, generation, and evaluation time

OOS rejects mismatched identities, blocked or stale readiness, and missing
receipts. A Catalog retirement request cannot carry repository-binding data;
retiring a Catalog value is not authority to mutate repository lifecycle.

The WGCF child owns the canonical readiness receipt schema and evaluator. This
consumer contract stores only the minimum digest-bound reference needed to
verify and use that external decision without creating a second readiness
authority in OOS.

## Failure And Rollback

Configured runtime failure never falls back to prototype-local values or false
success. Backend conflict, read-only Catalog state, value usage, stale source,
repository admission/readiness, mutation, and readback failures have bounded
codes.

Rollback removes only the OOS Catalog runtime and Console adapter integration.
It preserves canonical Catalog values, mutation receipts, and Repository
admission/lifecycle state.
