# Repository Custody Workflow

## Current Posture

The source is Security-approved for local `dev-integration` activation. It
remains absent unless Platform sets `OOS_REPOSITORY_CUSTODY_ENABLED=true`, and
OOS fails startup closed if that setting is used outside
`OOS_RUNTIME_PROFILE=dev-integration`. Source activation does not mean the
runtime is currently operating: Platform must still deliver fresh dedicated
credentials and complete the live evidence owned by ART `#1291` and `#1298`.

## Required Runtime Inputs

When activation is approved, Platform provides:

- `WGCF_REPOSITORY_CUSTODY_BASE_URL`
- `WGCF_REPOSITORY_CUSTODY_CALLER_ID`
- `WGCF_REPOSITORY_CUSTODY_CALLER_SECRET`
- `OOS_REPOSITORY_PROVIDER_API_BASE_URL`
- `OOS_REPOSITORY_PROVIDER_INSTALLATION_TOKEN`
- `OOS_REPOSITORY_PROVISIONING_INSTALLATION_TOKEN`
- `OOS_REPOSITORY_CUSTODY_STATE_ROOT`

Platform delivers separate application installation credentials for existing
repository readback and new repository provisioning. OOS selects the credential
from the immutable request action; it never broadens the read-only identity.
Neither token may be written into requests, receipts, logs, tracked environment
files, or operator-visible projections. Normal provider traffic is pinned to
`https://api.github.com` and denies redirects. A loopback HTTP provider is
accepted only when `OOS_REPOSITORY_PROVIDER_SANDBOX=true` for bounded tests.

## Operator Path

After Platform commissions the exact activated source and credentials, the
Governance Operations Console creates the request with exact operator approval
and credential-binding references. The Console then projects the returned
status and receipt; it does not call WGCF or the provider directly.

The active source capabilities are `link-existing` and `provision-new` only.
Repository lifecycle actions remain on their separately gated workflow.

## Recovery

- Same request ID and digest after success or denial: read the existing result.
- Same request ID with different content: stop and create a new request
  identity after correcting the operator draft.
- Retryable link failure: retry the same request; OOS rereads readiness and
  provider truth before replacing the failed result.
- Retryable provisioning failure: retry the same request. OOS recovers by the
  acknowledged provider ID when present, otherwise by approved coordinates,
  and does not create again unless fresh provider truth proves absence.
- Nonretryable identity mismatch or archived repository: correct the source
  request or provider state, then submit a new request identity.
- Corrupt or concurrently locked state: stop the workflow and preserve the
  state for diagnosis;
  do not delete it to force success.

## Validation

Use `node --test test/repository-custody-*.test.js` for focused contract,
client, workflow, HTTP, storage, and activation proof. Use
`npm run validate:repository-custody-openapi-schemas` to prove generated API
documentation matches the canonical schemas and routes.
