# Repository Lifecycle Workflow V1

## Purpose

OOS owns the guarded workflow for changing an already-custodied repository's
workspace owner, provider archive state, or workspace-record state. It consumes
the exact durable WGCF decision, checkpoints before mutation, reads back the
result, and emits a terminal receipt plus immutable history.

## Supported Actions

- `transfer-workspace-custody`
- `archive-provider`
- `unarchive-provider`
- `retire-workspace-record`
- `restore-workspace-record`

Provider ownership transfer and hard deletion are not supported. Impact
assessment never rewrites downstream consumers; every receipt records
`downstream_mutation: none`.

## API

- `POST /v1/repository-lifecycle/requests`
- `GET /v1/repository-lifecycle/requests/{request_id}`
- `GET /v1/repository-lifecycle/repositories/{provider}/{provider_repository_id}`

All routes require caller-specific OOS authentication. The Console calls OOS;
the browser does not call WGCF or GitHub directly.

## State And Recovery

The store serializes lifecycle work by immutable provider repository identity.
One request ID is permanently bound to one canonical digest. Provider commands
persist a pre-mutation checkpoint. On retry, OOS reads fresh provider truth: a
completed target is reconciled without repeating the mutation, unchanged truth
permits one retry, and conflicting truth fails closed.

Workspace transitions update only the OOS-owned lifecycle aggregate. Every
terminal attempt adds an immutable history entry and receipt. Reversals are new
requests linked to the earlier receipt; history is never rewritten.

## Activation

Source and sandbox conformance are complete under ART `#1051`. Normal runtime
remains disabled until Console integration `#1053` and the composed operating
evidence satisfy the activation contract.
