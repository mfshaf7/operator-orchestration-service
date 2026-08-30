# Repository Lifecycle Workflow

## Current Posture

The API and workflow are source-complete but normal runtime is disabled. Do not
set `OOS_REPOSITORY_LIFECYCLE_ENABLED=true` until the lifecycle manifest is
updated by an approved activation Landing Unit.

## Runtime Inputs

- `WGCF_REPOSITORY_LIFECYCLE_BASE_URL`
- `WGCF_REPOSITORY_LIFECYCLE_CALLER_ID`
- `WGCF_REPOSITORY_LIFECYCLE_CALLER_SECRET`
- `OOS_REPOSITORY_LIFECYCLE_STATE_ROOT`
- `OOS_REPOSITORY_PROVIDER_API_BASE_URL`
- `OOS_REPOSITORY_LIFECYCLE_INSTALLATION_TOKEN`

The provider token is the dedicated, single-repository GitHub App installation
token defined by Platform. Personal tokens, ambient `gh` credentials, redirects,
secret-bearing request references, and provider destinations other than GitHub
are rejected. Loopback HTTP is accepted only by an explicit sandbox client.

## Recovery

- Replay a terminal request with the same ID and digest to read its result.
- Retry a retryable provider failure with the same request; OOS reconciles
  provider truth before deciding whether a command is still required.
- Submit changed content under a new request ID after correction.
- Treat stale state/version, mismatched WGCF decisions, and corrupt evidence as
  stop conditions. Do not delete state to force completion.
- Use the repository audit endpoint for current state, latest impact, receipt,
  and complete immutable history.

## Validation

Run `node --test test/repository-lifecycle-*.test.js` and
`npm run validate:repository-lifecycle-openapi-schemas` for focused proof.
