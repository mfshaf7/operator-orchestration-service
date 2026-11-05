---
security_evidence:
  review_areas: [identity, secrets, delivery, runtime]
  reviewed_artifacts:
    - src/repository-custody/use-readiness.js
    - src/proposal-workflow/service.js
    - src/proposal-target-application/service.js
    - src/workspace-inventory/runtime.js
    - src/runtime.js
    - contracts/catalog/repository-readiness-request.schema.json
    - contracts/catalog/repository-readiness-reference.schema.json
    - src/repository-custody/store.js
    - src/repository-custody/service.js
    - src/repository-custody/connections.js
    - src/repository-custody/provider-client.js
    - src/instance-records/inventory-projection.js
  findings: []
  risks: []
  workstreams: [WS-003, WS-005]
---

# Connected GitHub account routing

## Summary

Route GitHub creation and metadata reads by exact account, purpose and credential binding.

## Classification

Operator-approved repository maintenance outside an active ART initiative. No new
ART items or improvement candidates. Landing Unit decision
`child_isolated_landing_unit`, `maintenance-repository-accounts-oos`: owner,
review, validation and rollback boundaries require separate repository landings.

## Ownership

OOS owns workflow, provider routing and private request receipts. Console owns the operator interface, and Security owns acceptance.

## Root Cause

This is an approved capability extension of the initial organization-only route,
not a newly invented defect. Fixed organization input did not cover operators
who use both personal and organization repositories.

## Source Changes

One installation can connect personal accounts, organizations or both, choose a
default and retain one private Registry. A single eligible destination is automatic;
multiple destinations require an explicit form selection. Verified provider account
ID/type and account-specific grant bind every operation. Existing aliases and
retained requests keep their original identity; same-named repositories stay
separate by provider ID and qualified coordinates.

Metadata, provisioning, source authoring and lifecycle authority remain separate.
Lifecycle tokens retain their explicit one-repository bound. No browser secret,
ambient credential, cross-account fallback, new service or database is introduced.

Security delta:
[Connected GitHub accounts](https://github.com/mfshaf7/security-architecture/blob/main/docs/reviews/components/2026-11-05-repository-account-routing.md).
The main agent retains Security judgment and final landing review; this is not an
independent assessment. Gary authors source and the delegated human reviews/merges.

## Artifact And Deployment Evidence

The isolated source candidate is unpublished and unactivated. Existing live source
remains accepted and unchanged. Exact PR, base-aware validation and activation
receipts must be recorded during landing and operating qualification.

## Live Verification

Candidate validation covers both account types/default selection, denied/expired
or missing grant, exact binding, provider readback, same-name collision, original
request recovery, private selection, credential renewal/consumption and truthful
visibility. Full local CI-equivalent checks and browser review remain required
before publication; no operating completion is claimed by this source record.

## Follow-Up

Land canonical Governance first and refresh governing source pins. Land OOS
before updating WGCF’s readiness consumer pin to the actual merged OOS commit;
then land WGCF, Platform and Console in dependency order. Regenerate the Security
change-record index from landed owner main before claiming closure. Normal exact
composed Security/Platform acceptance must precede live activation. Roll back the
same source/connection boundary while retaining canonical requests and evidence.

Packaged onboarding is recorded in the existing Console release backlog: ask for
personal accounts, organizations or both after installation, guide provider-native
authorization and allow later default/connection changes. Building an installer
or declaring customer setup qualified is outside this maintenance batch.


## Approved repository maintenance follow-up

The operator approved four inspection findings in this same pending batch.
The register now reads latest successful repository custody separately from
request history, with bounded pages, exact repository/Proposal filters and
canonical-file-derived lookup metadata. New reference validation blocks invalid
workspace identifiers before provider effects; historical terminal reads remain
unchanged. Console adds explicit read-failure recovery, continuation controls and
shared readable association fields across creation and linking. No new ART,
provider permission, storage authority, or release acceptance is claimed.

Validation:1879 backend tests pass,2 skipped;41 focused storage/service/HTTP
tests pass, including280 repositories, scoped history, cross-scope cursors,
restart/other-writer/corruption and validation-before-effects. API documentation
checks pass. Source remains part of the unpublished account-routing landing unit.

## Coordinated repository onboarding repair

The operator-approved maintenance also restores a single Registry-owned onboarding
path and enforces existing active-source policy at consumer boundaries. Proposal
creation/link resolution previously verified exact custody but did not itself
verify completed onboarding. It now reuses current Inventory/WGCF Catalog
readiness before new resolution, repository-backed disposition/handoff and
Prototype target preparation/publication. Replay and outcome inspection preserve
original records; cancellation is not dependent on permission for new project work.

The existing internal source-authority reader supplies exact provider binding.
Public Studio publication of an internal project's metadata additionally requires
current public, active provider readback with matching immutable identity. Private,
internal, archived, foreign or unavailable source remains blocked on this route;
Delivery uses its existing private-capable route. This adds no source credential,
model context export, automatic approval or second onboarding state.

Readiness schemas now accept the bounded canonical identifiers already supported
by operational registration, including account-qualified dot/underscore names.
WGCF's matching consumer bundle must land after this owner; rebind its consumer
commit to the actual merged OOS commit before WGCF publication. Local candidate
checks do not prove that future source pin.

Primary procedures: [Repository custody](../../operations/repository-custody-workflow.md),
[Proposal workflow](../../operations/proposal-workflow-operator-surface.md) and
[Proposal target application](../../operations/proposal-target-application-operator-surface.md).

## Onboarding validation

Full owner tests pass:1895 total,1893 passed,2 existing skips,0 failures. Full API
documentation validation passes with245 documented and implemented routes. Focused
negative coverage verifies custody alone cannot bypass readiness, missing or stale
authority blocks new source effects, and public Studio rejects native private,
internal, unknown, archived or identity-mismatched source. These are pre-publication
source/conformance checks, not exact merged-source or live activation evidence.

## Producer binding for publication

Governance PR321 merged as f5e06f3c6c480ffe3d48a79f24dfe84c8d0d0e8f.
The custody bundle now pins that exact producer commit; each bundled byte/hash
was compared with its merged source. The final owner suite passes1893 tests
with2 existing skips, and API245-route plus deterministic bundle checks pass.
Committed base-aware record/mutation checks use fetched origin/main
93e155a4e73a9a4b700e80516dc35b985818f3f2 before publication.
