# Workspace Intake

Workspace Intake classifies a repository, product, or component as out of
scope, proposed, or admitted. It does not activate inventory, provision a
repository, deploy runtime, or promote product maturity.

## Availability

The implementation is source-only pending Security #1066 and Platform #1082.
Setting `OOS_WORKSPACE_INTAKE_ENABLED` cannot bypass the pinned inactive
manifest. Sandbox injection is test evidence, not live activation authority.

The Console is the normal operator client. Every operation below is an OOS
API, not a Console-local state machine or a CLI-only procedure. Requests use a
caller-specific credential; shared-secret fallback and recommendation-only
callers are denied. A decision's operator reference must match that admitted
caller. This is the current authenticated service-caller boundary, not a claim
that end-user identity delegation has already been implemented.

## Procedure

1. Collect a Workspace Governance v2 request from the direct, repository,
   prototype, or delivery source adapter. Preserve its source reference and
   digest. Bind the current canonical register digest and record version.
2. Review its classification, owner routing, and complete proposed record.
   Record explicit acceptance in the digest-bound v2 decision. AI suggestions
   remain suggestions; the decision retains their provenance and disposition.
3. POST `/v1/workspace-intake/requests` with `request`, `decision`, exact
   `authority_revision`, `session_ref`, and `execution_ref`. HTTP 202 confirms
   durable acknowledgement only. Retain `request_id`.
4. POST `{}` to `/v1/workspace-intake/requests/{request_id}/continue`. OOS
   evaluates through WGCF, prepares the canonical owner command in an isolated
   review branch, and opens or recovers the one matching pull request.
5. At `review-required`, inspect the returned review URL. Complete owner
   validation and required exact-head reviews, including Security when the
   change affects trust. Merge through the provider's human review process.
   OOS has no merge endpoint and never writes `main`.
6. Continue again. OOS proves that the exact reviewed change entered canonical
   main history, reads the merged register, and compares the record digest.
   Only `succeeded` with a `merged-authority` receipt proves completion.

GET `/v1/workspace-intake/requests/{request_id}` returns durable progress,
findings, history, the review, and terminal evidence without advancing work.
The API contract and examples are in [OpenAPI](../api/openapi.json).

## Recovery

| Situation | Operator action |
| --- | --- |
| Lost acknowledgement | Resubmit the identical command; the original acknowledgement is returned. |
| Service or host restarted | Read the request, then continue. Persisted preparation and provider identity prevent duplicate mutation. |
| Dependency unavailable | Restore the dependency or credential, then continue. Do not change an acknowledged command. |
| Stale authority or conflicting review head | Inspect the review; cancel the obsolete request and submit a newly reviewed request with new identities. Never force-push or overwrite. |
| WGCF rejects or requires action | Correct the reported finding and submit a new reviewed request. No source change was authorized. |
| PR rejected | The request remains rejected; a new decision requires a new request identity. |
| Operator cancels | POST `{}` to `/v1/workspace-intake/requests/{request_id}/cancel`. OOS closes a matching unmerged review but retains evidence. |
| Merge races cancellation | OOS records the actual merged result instead of claiming cancellation. Reversal is a separate reviewed change. |
| Corrupt or missing coordination state | Stop writes and restore its persisted volume. Do not recreate receipts or infer success from an absent session. |

An admitted classification is still intake. Active inventory and lifecycle
changes use the later #1070/#1076 workflows. A prepared branch, WGCF allowance,
or a successful HTTP response is not active inventory or runtime permission.

## Runtime Boundary

Platform supplies an exact-repository installation token through a mounted
file, not a PAT or ambient `gh` login. The adapter re-reads it for rotation and
checks that it selects only the configured Workspace Governance repository.
Only GitHub or an explicitly injected loopback test provider is supported.
Redirects and unbounded provider responses are denied.

The runtime needs a trusted Workspace Governance checkout refreshed by its
owner, Git, Python with PyYAML/jsonschema, and `flock`. The OOS image includes
these tools. The checkout is read-only authority; preparation uses a private
temporary clone and runs the committed owner command. OOS persists workflow
coordination on its existing local volume, never a second canonical workspace
database. Kernel locking and fsync protect single-host transactions across
process death. This is not a multi-host storage claim.

Configure the `OOS_WORKSPACE_INTAKE_*` and `WGCF_WORKSPACE_INTAKE_*` fields in
`src/config.js` only through the Platform admission/activation work. Secrets
are never stored in requests, history, provider review text, or receipts.

## Verification

```bash
node --test test/workspace-intake-*.test.js
npm run validate:workspace-intake-openapi
npm run validate:api-docs
npm run test:workspace-intake-source -- --authority-root <committed-workspace-governance-checkout>
```

The last command creates only temporary Git repositories and workflow state,
then removes them. It exercises the real pinned owner command and a simulated
provider, including forced process death. It does not write an actual provider
repository or activate production credentials. Live composed proof is #1069.
