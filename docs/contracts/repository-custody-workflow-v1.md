# Repository Custody Workflow V1

## Status

Source-complete for existing-repository linkage under ART `#1042` and
organization-repository provisioning under `#1046`. Normal runtime remains
disabled by the upstream custody authority until Security acceptance `#1047`,
provider application identity `#1048`, and Console composition `#1049` are
complete.

## Purpose

OOS owns the request lifecycle for linking an existing provider repository or
provisioning a new organization-owned repository into workspace custody. It
evaluates the exact canonical request through WGCF, performs only the approved
provider command, reads fresh provider truth, persists replayable checkpoints,
and emits one canonical terminal custody receipt.

This workflow does not admit a repository to Workspace Intake, add it to active
inventory, link Delivery Catalog, admit a product, or grant release authority.
Those remain explicit downstream workflows.

## Authority Boundary

| Concern | Authority |
| --- | --- |
| Repository-custody policy and artifact schemas | `workspace-governance` |
| Request readiness decision | `workspace-governance-control-fabric` |
| Workflow lifecycle, idempotency, provider adapter, state, and receipt | `operator-orchestration-service` |
| Physical repository and immutable provider ID | repository provider |
| Provider application identity and secret delivery | `platform-engineering` |
| Trust acceptance and least privilege | `security-architecture` |
| Operator request and result projection | `governance-operations-console` |

## API

- `POST /v1/repository-custody/requests`
- `GET /v1/repository-custody/requests/{request_id}`

Both operations require an authenticated caller with a caller-specific OOS
credential. Shared-secret fallback cannot invoke this boundary.

## Workflow

1. Validate canonical request schema, request digest, exact approval, and the
   current authority reference.
2. Issue and reread the exact durable WGCF decision.
3. Stop with a denied receipt when readiness does not allow the request.
4. For `link-existing`, read `GET /repositories/{repository_id}` using the
   positive decimal REST repository `id`, never a GraphQL `node_id`.
5. For `provision-new`, prove the approved organization/name is absent, persist
   a command checkpoint, create once through the organization endpoint, persist
   the acknowledged REST repository ID, then perform a separate readback.
6. Verify owner, name, visibility, features, merge policy, and README
   initialization against the exact WGCF-approved settings.
7. Reject mismatched, archived, unavailable, or stale provider truth.
8. Persist the terminal result and digest-bound receipt atomically.
9. Replay the same request ID and digest without repeating completed work;
   reject changed content and permit retry only after a retryable provider
   failure.

## Terminal Truth

- `applying`: a durable provider-operation checkpoint exists and no terminal
  receipt is claimed yet.
- `succeeded`: readback proves exact active provider truth and custody moves
  from `unrecorded` to `linked` or `provisioned`, matching the action.
- `denied`: readiness denies the request before provider access; the receipt
  carries null provider readback and unchanged custody.
- `failed`: provider access or identity verification fails; the receipt carries
  only provider readback that actually occurred and custody remains unchanged.

Every outcome returns the canonical custody receipt. OOS never fabricates
provider readback to satisfy success-oriented evidence requirements.

## Persistence And Recovery

The dev-integration source proof uses a private, atomic, file-backed state root
owned by OOS. It binds `request_id` to `request_digest`, rejects corrupt state,
and holds one process-safe request lock across readiness and provider work.
Mutable replacement is limited to applying or explicitly retryable state.

Provisioning persists checkpoints before provider mutation and after provider
acknowledgement. Recovery first reads by acknowledged provider ID, otherwise by
approved organization/name. Only a fresh absent result permits another create;
OOS never compensates with provider deletion. This does not introduce a new
system-of-record database; later composition may replace the storage adapter
without changing the API contract.
