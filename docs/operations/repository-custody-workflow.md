# Repository Custody Workflow

## Connected GitHub accounts

The account-routing extension uses Platform's server-only
`OOS_REPOSITORY_CONNECTIONS_JSON` projection. It contains verified account IDs,
personal/organization type, a default connection and separate short-lived grants.
`GET /v1/repository-custody/connections` exposes bounded non-secret metadata only
to the authenticated Console caller. Expired or missing permissions are not ready;
an invalid optional projection fails its own operations without a fallback token.

Creation selects the exact target account, type and provisioning binding. Personal
creation uses `/user/repos` and explicit Private/Public; organization creation uses
`/orgs/{account}/repos`. Independent readback verifies immutable repository ID,
provider account ID/type and exact settings. Linking and URL lookup use only that
account's metadata reader. Default selection is a form convenience and never
changes an existing request, credential binding or retry target.

Same names in different accounts retain different immutable provider IDs. New
Console aliases include the account; existing Registry aliases are preserved.
Native Registry rows expose their recorded provider coordinates without another
database or an account-specific Registry. Operational metadata remains private.

Source and lifecycle grants remain independent. Lifecycle credentials retain the
existing explicit single-repository bound; an account connection does not activate
that workflow or authorize account-wide archive operations. No personal token,
browser credential, ambient `gh` login or more privileged fallback is accepted.

Engineering delivery/renewal and connection inspection use the existing
[Platform procedure](https://github.com/mfshaf7/platform-engineering/blob/main/products/governance-operations-console/runbooks/operate-complete-runtime.md#connected-github-accounts).
Packaged customer onboarding remains an explicit Console release requirement.

## Current Posture

The source is Security-approved for local `dev-integration` activation. It
remains absent unless Platform sets `OOS_REPOSITORY_CUSTODY_ENABLED=true`, and
OOS fails startup closed if that setting is used outside
`OOS_RUNTIME_PROFILE=dev-integration`. Source activation does not mean the
runtime is currently operating: Platform must still deliver fresh dedicated
credentials and complete the live evidence owned by ART `#1291` and `#1298`.

## Account Metadata Reader

The optional account metadata connection supports one GitHub personal account
or organization with an explicit Metadata-read-only installation grant,
including future repositories. Platform owns selection, short-lived token
issuance, Vault custody, renewal and delivery. OOS receives the installation
token and `OOS_REPOSITORY_PROVIDER_ACCOUNT`, never the App private key.

Coordinate lookup rejects another account before contacting GitHub. Readback by
immutable repository ID also rejects a foreign owner. A new repository under
the connected account uses the same reader without an installation edit or an
OOS repository allowlist update. Provider responses still validate immutable
identity, owner, name, URL, response bounds and archive state. Existing selected
mode remains available when no account-wide connection was chosen.

The reader performs metadata GETs only. Source contents, repository creation
and lifecycle writes use their separate authorities; a reader outage never
falls back to the provisioning token. All existing OOS caller authorization and
custody approval/readiness boundaries remain in place. This source extension
does not prove that a deployed reader is connected. Platform's
[primary identity procedure](https://github.com/mfshaf7/platform-engineering/blob/main/docs/components/operator-orchestration-service/repository-provider-identity.md#account-metadata-reader)
and the
[Security delta](https://github.com/mfshaf7/security-architecture/blob/main/docs/reviews/components/2026-11-03-account-repository-reader.md)
own commissioning and activation evidence.

## Required Runtime Inputs

When activation is approved, Platform provides:

- `WGCF_REPOSITORY_CUSTODY_BASE_URL`
- `WGCF_REPOSITORY_CUSTODY_CALLER_ID`
- `WGCF_REPOSITORY_CUSTODY_CALLER_SECRET`
- `OOS_REPOSITORY_PROVIDER_API_BASE_URL`
- `OOS_REPOSITORY_PROVIDER_INSTALLATION_TOKEN`
- `OOS_REPOSITORY_PROVIDER_ACCOUNT` for the optional account-wide metadata connection
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

The Console reloads retained custody requests through authenticated
`GET /v1/repository-custody/requests`. Pages contain at most 25 validated
workflow results, with an opaque `next_cursor` for the next page. A caller may
set `limit` from 1 to 25. The list uses the same caller-bound read authority as
individual request readback and performs no provider operation. Invalid
cursors, corrupt state, and unavailable runtime remain visible failures.

- Same request ID and digest after success or denial: read the existing result.
- Same request ID with different content: stop and create a new request
  identity after correcting the operator draft.
- Retryable link failure: retry the same request; OOS rereads readiness and
  provider truth before replacing the failed result.
- Retryable provisioning failure: retry the same request. OOS recovers by the
  acknowledged provider ID when present, otherwise by approved coordinates,
  and does not create again unless fresh provider truth proves absence.
- Partial provisioning: OOS may complete the exact approved mutable baseline
  only after creation acknowledged an immutable repository ID and fresh
  readback independently proves that same active organization/name. It does
  not rename, transfer, archive, delete, initialize, or adopt a name collision.
  Settings acknowledgement is not success; a separate read must match every
  approved setting before a successful receipt is issued.
- Retained nonretryable partial creation: select the failed request in the
  Console, review its unchanged target and baseline, and approve a correction.
  A new request identity uses the existing `correlation.causation_id` to bind
  the retained failed creation. OOS verifies unchanged operator, target,
  settings, custody and credential-binding identity, evaluates current WGCF
  readiness, and resumes only by its acknowledged provider ID. It never
  creates again or replaces the original failed result and receipt.
- Browser reload or interrupted applying state: select the retained request
  and use `Resume Approved Request`. The Console server rereads the canonical
  request and resubmits its exact original approval and digest; browser fields
  cannot reconstruct, replace or override that authority. Terminal immutable
  results are inspected rather than silently resumed.
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

## Request-specific creation and attachment

A Proposal request for new work can be fulfilled by provision-new or by explicit
attachment of a repository already created for that request. Both operations use
the exact `repo-request://proposal/<proposal_id>` in immutable
`correlation.correlation_id`. Standalone custody remains valid but its receipt
cannot directly confirm an unrelated requirement. The attachment records a new
reviewed link receipt, preserving the original result and provider creation truth.

The Console separates Create new and Already created. Attachment selects known
custody or accepts a GitHub URL. Authenticated Console-only
`GET /v1/repository-custody/provider-repository?owner=<owner>&name=<name>` resolves
positive decimal identity using the existing read installation token. It accepts
only bounded coordinates, pins GitHub, denies redirects and never creates or
changes provider state. Metadata is not a readiness decision or custody receipt.
The reviewed link-existing command still requires WGCF and independently reads
provider state by immutable ID. The operator attests purpose, reviews ownership
and approves attachment; final Proposal confirmation is separate and explicit.

Corrections/resumes preserve the original association; `causation_id` continues
to name the failed creation. A provisioning correction cannot reassign a provider
creation to another request. Exact historical acknowledgements retain recovery
without rewriting original outcomes. New confirmation requires a successful
create or attach receipt for the same requirement, not an unrelated existing link.

## Paged repository list and scoped history

The same authenticated `GET /v1/repository-custody/requests` supports
`view=register`: one latest successful result per immutable provider repository.
The default `requests` view retains original request history. Both are paged at
no more than25 results per read; there is no250-request workspace-read limit.
`provider_repository_id` and `proposal_id` select exact repository or Proposal
history; cursors for indexed views bind their read selection. No read invokes
GitHub, changes state or grants downstream authority. Source envelopes include
the selected read view.

The existing canonical request files remain the system of record. Their derived
in-process lookup metadata is reconstructed after restart and invalidated by
atomic file changes, including another writer. Warm list reads load only their
selected result bodies. Corrupt source metadata fails closed. No database,
retention deletion or replacement receipt is introduced.

New create/link effects require a valid `repo:` workspace identifier consistent
with registration. Invalid identifiers stop before readiness/provider operations.
Existing terminal historical readbacks remain readable and are not rewritten.

## Repository onboarding and use

Repository creation/linking verifies custody. Workspace Registry coordinates its
existing Intake decision, trusted source-control setup and active Inventory
promotion. A successful provider receipt alone cannot unlock project use.

Proposal repository resolution, repository-backed decisions/handoffs and Prototype
target preparation/publication recheck the existing current Inventory/WGCF
readiness authority. Unavailable, stale or incomplete onboarding blocks new use.
Original requests, historical receipts, cancellation and outcome recovery remain
available without replacement IDs or invented activation evidence.

Internal project sources additionally need exact current public provider readback
before the existing public Studio route can publish metadata. Private/internal,
archived, mismatched or unknown sources cannot use that publication route.
Private-capable Delivery retains its own approved source access and controls.
Repository onboarding does not grant private Studio import or model context export.
