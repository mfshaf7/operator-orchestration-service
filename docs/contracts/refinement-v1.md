# Delivery Refinement Contract V1

## Status

The provider-neutral protocol is admitted by ART `#1005`. CGG projection and
Platform profile foundations are merged, and ART `#1009` implements the OOS
source runtime. Composition, Security review, activation, and Console wiring
remain separate downstream Landing Units. The implementation is fail-closed:
no Refinement model invocation, Temporal execution, or canonical mutation is
active until those later controls authorize it.

The machine-readable source is
[`contracts/refinement/manifest.json`](../../contracts/refinement/manifest.json)
and its adjacent JSON Schemas.

## Purpose

Refinement turns an applied Work Design handoff into reviewed Delivery metadata
and a bounded apply plan. It provides:

- one typed package projection for the existing metadata, readiness, apply, and
  history views
- optional `metadata_advice` for one selected metadata target
- explicit operator acceptance of an immutable draft
- one durable, recoverable apply run with ordered events and canonical readback
- bounded projection and failure semantics for the Console

Refinement is not another Work Design pass. It does not reshape the work tree,
create arbitrary work, handle blockers, or authorize execution.

## Authority Boundary

| Concern | Authority |
| --- | --- |
| Refinement packet, advice request, operator acceptance, apply plan, durable run, OpenProject mutation, receipt, and history | `operator-orchestration-service` |
| Context admission, redaction, budgeting, and model-safe projection | `context-governance-gateway` |
| Logical advisor profile, provider route, credentials, and Temporal runtime profile | `platform-engineering` |
| Trust review and activation decision | `security-architecture` |
| Operator interaction and semantic-to-visual mapping | `governance-operations-console` |
| Canonical ART records | OpenProject through the OOS adapter |

The Console calls OOS only. It never receives provider, CGG, Temporal, WGCF,
or OpenProject credentials. Model output remains suggestion-only and cannot
start apply.

## Contract-Admitted Operations

- `GET /v1/delivery-refinement/{package_id}/projection`
- `POST /v1/delivery-refinement/{package_id}/assist`
- `POST /v1/delivery-refinement/{package_id}/apply`
- `GET /v1/delivery-refinement/{package_id}/runs/{run_id}`

These paths are implemented in OOS but remain activation-pending. Projection
reads canonical Work Design and Delivery truth; assist and apply fail closed
until their admitted dev-integration dependencies are active.

## Packet And Advice

The packet carries semantic workflow truth already used by the approved
Console: source Work Design evidence, target tree, metadata groups and fields,
readiness gates, and the bounded apply plan. Presentation tone, layout, and
component state are deliberately excluded; the Console derives those from
semantic status.

An assist request binds the package and source revision, packet revision, Work
Design receipt, selected metadata target, admitted options, operator identity,
and prompt. The caller cannot select a provider or inject a model profile.
Generated metadata is not an assist target because it must be repaired at its
source authority.

The result carries one typed `ai_drafted` suggestion and complete CGG, profile,
schema, and gateway-audit evidence. The operator may accept, edit, or ignore it.

## Durable Apply

1. The Console submits the exact packet revision, accepted-draft digest,
   metadata values and one resolution per value, apply plan, idempotency key,
   and authenticated acceptance record to OOS.
2. OOS rejects stale source or packet state, mismatched operator identity,
   missing resolutions, unexpected operations, and conflicting replay.
3. OOS starts or reuses one `delivery.refinement.apply` v1 durable run.
4. The run records ordered operation events and can recover after process or
   worker interruption without duplicating canonical mutations.
5. Completion requires canonical backend readback and a digest-bound receipt.
   A run cannot project `completed` with a null receipt or incomplete readback.
6. Failure remains a non-success state with a bounded code and recovery
   reference where one exists.

## Storage And Recovery

This contract adds no database. OOS owns workflow correlation and canonical
receipt projection. Temporal may own durable execution state only after its
Platform profile and Security gate activate. Canonical Delivery state remains
in OpenProject and must be read back before success.

Operator drafts remain local until accepted. The accepted input becomes
immutable for the run. Retry uses the same idempotency identity and returns the
same run or receipt; it does not synthesize a second application.

## Failure And Rollback

Configured runtime failure never falls back to fixture advice or local success.
Rollback can suspend the Refinement advisor and apply definition independently,
while preserving accepted input, run events, partial-effect evidence, canonical
readback, and historical receipts. Work Design and unrelated Delivery paths
remain available.
