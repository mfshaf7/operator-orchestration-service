# Repository Custody Workflow V1

## Status

Source-complete under Workspace Delivery ART `#1042`. Normal runtime remains
disabled by the upstream custody authority until Security acceptance `#1043`,
provider application identity `#1044`, and Console composition `#1045` are
complete.

## Purpose

OOS owns the request lifecycle for linking an existing provider repository to
workspace custody. It evaluates the exact canonical request through WGCF,
reads immutable repository identity from provider truth, persists a replayable
result, and emits one canonical terminal custody receipt.

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
4. For an allowed GitHub decision, read the provider through
   `GET /repositories/{repository_id}` using the positive decimal REST
   repository `id` and application identity, never a GraphQL `node_id` or
   ambient operator credentials.
5. Reject mismatched, archived, unavailable, or stale provider truth.
6. Persist the terminal result and digest-bound receipt atomically.
7. Replay the same request ID and digest without repeating completed work;
   reject a changed digest and permit explicit retry only after a retryable
   provider failure.

## Terminal Truth

- `succeeded`: readback proves the exact active provider identity and custody
  transitions from `unrecorded` to `linked`.
- `denied`: readiness denies the request before provider access; the receipt
  carries null provider readback and unchanged custody.
- `failed`: provider access or identity verification fails; the receipt carries
  only provider readback that actually occurred and custody remains unchanged.

Every outcome returns the canonical custody receipt. OOS never fabricates
provider readback to satisfy success-oriented evidence requirements.

## Persistence And Recovery

The dev-integration source proof uses a private, atomic, file-backed state root
owned by OOS. It binds `request_id` to `request_digest`, rejects corrupt state,
uses a process-safe write lock, and allows replacement only when the prior
result explicitly marked a provider failure retryable. This does not introduce
a new system-of-record database; later runtime composition may replace the
storage adapter without changing the API contract.
