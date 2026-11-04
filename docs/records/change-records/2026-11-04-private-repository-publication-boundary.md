---
security_evidence:
  review_areas: [identity, secrets, delivery, runtime]
  reviewed_artifacts:
    - src/workspace-intake/provider-client.js
    - src/workspace-intake/source-client.js
    - src/workspace-inventory/provider-client.js
    - src/workspace-inventory/source-client.js
    - src/source-publication-privacy.js
    - src/instance-records/client.js
    - contracts/instance-records/receipt.schema.json
    - contracts/instance-records/intake-request.schema.json
    - src/instance-records/contracts.js
    - src/instance-records/intake-journal.js
    - src/instance-records/intake-service.js
    - src/instance-records/intake-facade.js
    - src/instance-records/source-authority.js
    - src/instance-records/source-proof.js
    - src/instance-records/host-source-reader.js
    - src/instance-records/host-source-git.js
    - src/instance-records/host-source-binding.js
    - src/instance-records/source-location.js
    - src/delivery-art/source-executor-server.js
    - dev-integration/profiles/accepted-idea-delivery/scripts/run_delivery_source_executor.sh
    - scripts/read_instance_source_authority.mjs
    - src/repository-owner-bootstrap/authority-reader.js
    - src/repository-owner-bootstrap/source-adapter.js
    - src/delivery-art/source-repository-admission.js
    - src/delivery-art/agent-source-identity.js
    - src/delivery-art/work-session-cli-adapters.js
    - src/instance-records/inventory-service.js
    - src/instance-records/inventory-facade.js
    - src/instance-records/inventory-projection.js
    - contracts/instance-records/inventory-request.schema.json
    - src/repository-owner-bootstrap/runtime.js
    - src/repository-owner-bootstrap/private-source-reader.js
    - src/repository-owner-bootstrap/preparation.js
    - src/repository-owner-bootstrap/service.js
    - src/platform-operation/provider-client.js
    - src/platform-operation/service.js
    - scripts/sync_repository_owner_bootstrap_openapi.mjs
    - src/workspace-intake/runtime.js
    - src/workspace-inventory/runtime.js
    - src/catalog/wgcf-readiness-client.js
    - src/app.js
    - src/config.js
    - scripts/instance_intake_openapi_tools.mjs
    - scripts/sync_workspace_intake_openapi.mjs
    - scripts/instance_inventory_openapi_tools.mjs
    - scripts/sync_workspace_inventory_openapi.mjs
    - docs/api/openapi.json
  findings: []
  risks: []
  workstreams: [WS-003, WS-005]
---

# Private repository metadata publication boundary

## Summary

Protect custody-backed repository registration from publishing private or
unverified provider metadata to a public Workspace Governance source authority.
This is a protective source candidate, not completed private-source support.

## Classification

Operator-authorized maintenance under the approved private-access goal. Landing
Unit decision `feature_single_landing_unit`, `maintenance-private-repository-access`.
No new ART item, improvement candidate, service or live permission grant.

## Ownership

Workspace Governance owns canonical registration semantics. OOS owns the existing
source-publication adapter and its guard. Platform owns credentials; Security
retains review and exact-composition acceptance. Console owns the private listing
and the operator-facing explanation.

## Root Cause

The current source-backed Intake workflow writes repository coordinates into
Workspace Governance Git records. Workspace Governance is public. Its private
runtime snapshot is a copy of that public source, not a private canonical record
store. Successful private custody alone cannot authorize public metadata egress.

## Source Changes

The normal Intake, Inventory promotion and Inventory update source adapters
pass the canonical project provider binding into their existing GitHub review
writers. Both consume one shared privacy guard. Before the first publication effect, verify
the exact authority identity and visibility. For a public destination, require
current matching public project metadata. This bounded metadata GET carries no
authority credential and cannot select arbitrary hosts or paths. Private,
unavailable, ambiguous or mismatched metadata blocks publication. A temporary
provider failure remains retryable and preserves the original operation. A verified
private authority requires no anonymous project probe. Existing non-provider
entrant classification remains unchanged.

## Artifact And Deployment Evidence

The unpublished OOS adapter validates installation-bound WGCF record reads,
preparation, original-outcome lookup and acceptance. The existing OOS service
identity can read and accept; a history reader can only read. Request input and
operator acceptance are retained before canonical effects in private per-request
records under exact target directories, with a durable request locator written
first. Accepted target discovery cannot depend on a later index write. Missing
derived locators can be rebuilt from complete records; missing or corrupt
accepted data is never reconstructed as a fresh request. Retries resolve the original canonical result before
refreshing dependencies; cancellation stops at the first write attempt.

The existing Intake routes select internal authority for new custody-backed,
source-only repository registrations. Positive legacy proof and existing pending
Git requests retain their original authority and identity. Combined history is
caller/target/custody-bound and paginated. Failure to read internal authority
cannot fall back to public Git. The API schema documents both exact alternatives.
The flag is disabled by default; no live configuration has changed. Native
Inventory promotion and lifecycle now retain accepted input before effects,
use the original-outcome lookup before retry, and validate current project
version, policy and the actual receipt. Positive legacy proof retains the
original Git workflow; disabled writes or unavailable native protocol cannot
redirect private metadata into public Git. Private source consumption and full
operating qualification remain unfinished.

The private Registry metadata endpoint is restricted to the dedicated Console
caller with its own credential. It reads one bounded, searched database page
with matching counts and no per-project history fanout. Caller identities using
a shared secret, other read-only callers, duplicate selectors and unsupported
mutations cannot use that endpoint. The original Git Registry endpoint remains
separate for existing product/component consumers.
Source setup now selects the current native eligibility projection before
choosing a reader. Exact canonical custody must match it. Only positive legacy
proof selects the old Git reader; outages never fall back to public source.
The protected private control-file reader now consumes the existing Platform
connection, binds exact owner/provider/namespace/policy and accepts only its
finite read scope with confirmed token revocation. It never falls back to the
anonymous reader on native failure, and it does not place private file bodies
in a generic Platform operation journal. Legacy source retains the public-only
adapter. Native preparation records the actual revoked inspection credential;
it does not falsely claim that no credential was used. No reusable source write
credential, checkout or admission is created by that preparation.

Host checkout/source authority, installation commissioning and full operating
qualification remain unfinished. The protected read API alone is not proof
that private authoring works end to end.

Uncommitted isolated owner worktree at the fetched base. No PR, deployment,
private repository creation, credential-scope change or canonical record write
has been performed. The operator selected installation-private operational
storage for public and private project records, reusing the existing runtime and
WGCF database under Governance policy. No separate records Git repository or
installer. Internal record integration, content-read implementation and eventual
activation remain unfinished; the storage choice itself is approved.

## Live Verification

Provider metadata reads established that the current Governance, Console and
Studio repositories are public. Isolated tests exercise public/private/internal
source, unknown visibility, unavailable and mismatched provider identity, token
separation and the normal source-adapter binding. No live publication or private
business record is used as test evidence. Full runtime proof is not claimed.

## Follow-Up

Implement the approved source-read and internal-record route without public
metadata publication, preserving legacy source evidence and original requests. Obtain
a fresh Security delta and exact-source acceptance before eventual activation.
Keep the generated Security change-record index dependency after owner source
landing; an unpublished candidate is not current operating acceptance. Preserve
original pending requests and uncertain effects instead of recreating them.


The synchronous host admission bridge now reuses the existing authenticated
Platform provider connection and checks the exact current native record,
installation and Governance policy bytes before selecting source authority.
Subprocess stdin carries the protected connection; arguments, sanitized errors
and generic journals do not carry its credential. Native ordinary-source
admission uses an explicit internal record reference without Git Inventory
fields and rechecks the same version before a remote push. Existing positive
legacy admission retains its original contract. Isolated host/provider tests
cover actual authenticated HTTP, namespace and state substitution, disabled or
unavailable authority, and a registration change during publication.
The source candidate now also uses finite Platform-authenticated clone/fetch/ref
reads and installation-private managed source/worktrees. Existing-controls
checkout uses a revoked read token without inventing a source-write session.
The source host reads the fixed private connection beside its accepted cache;
no runtime shell file is sourced and its provider credential is absent from
argv. Existing standalone source work keeps its original location. Real Git
recovery, Gary commit/publication, exact human review, squash merge and cleanup
pass in isolated native-registration tests. Live commissioning, remaining owner
selectors and complete Console operating proof remain unfinished.


The selected-status read exposes only compact current metadata to the dedicated
Console caller. It binds up to 25 exact ordered names, preserves installation
scope and cannot fall back after an unavailable read. The same private authority
now informs Repo Control, verification availability and primary attention. It is
not an automatic model-context source. The fresh source-only Security delta is
[private project operational records](https://github.com/mfshaf7/security-architecture/blob/main/docs/reviews/components/2026-11-05-private-project-operational-records.md);
the unpublished review and candidate source are not operating activation.
