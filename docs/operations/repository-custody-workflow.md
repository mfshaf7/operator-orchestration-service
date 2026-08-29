# Repository Custody Workflow

## Current Posture

The implementation is available for injected sandbox validation only. Do not
set `OOS_REPOSITORY_CUSTODY_ENABLED=true` until the upstream authority enables
runtime activation after ART `#1043`, `#1044`, and `#1045`. OOS fails startup
closed if the environment requests activation before that decision.

## Required Runtime Inputs

When activation is approved, Platform provides:

- `WGCF_REPOSITORY_CUSTODY_BASE_URL`
- `WGCF_REPOSITORY_CUSTODY_CALLER_ID`
- `WGCF_REPOSITORY_CUSTODY_CALLER_SECRET`
- `OOS_REPOSITORY_PROVIDER_API_BASE_URL`
- `OOS_REPOSITORY_PROVIDER_INSTALLATION_TOKEN`
- `OOS_REPOSITORY_CUSTODY_STATE_ROOT`

The provider token is a delivered application installation credential. It must
not be written into requests, receipts, logs, tracked environment files, or
operator-visible projections.

## Operator Path

The Governance Operations Console will create a request only after `#1045`.
The request must carry exact operator approval and credential-binding
references. The Console then projects the returned status and receipt; it does
not call WGCF or the provider directly.

## Recovery

- Same request ID and digest after success or denial: read the existing result.
- Same request ID with different content: stop and create a new request
  identity after correcting the operator draft.
- Retryable provider failure: retry the same request; OOS rereads readiness and
  provider truth before replacing the failed result.
- Nonretryable identity mismatch or archived repository: correct the source
  request or provider state, then submit a new request identity.
- Corrupt local state: stop the workflow and preserve the file for diagnosis;
  do not delete it to force success.

## Validation

Use `node --test test/repository-custody-*.test.js` for focused contract,
client, workflow, HTTP, storage, and activation proof. Use
`npm run validate:repository-custody-openapi-schemas` to prove generated API
documentation matches the canonical schemas and routes.
