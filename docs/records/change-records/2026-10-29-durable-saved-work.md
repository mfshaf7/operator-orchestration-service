---
security_evidence:
  review_areas:
    - runtime
    - delivery
    - identity
  findings: []
  risks: []
  workstreams:
    - WS-007
---

# Retain operator design work outside one browser

## Summary

Extend the existing saved-work workflows through operator-approved maintenance.
The operator approved preservation/migration, OOS-owned server storage, existing
Console integration, truthful acknowledgements and fresh-browser/restart proof
for Work Design, Refinement and Orchestration. No new ART repair item, installer
or improvement candidate is introduced.

## Classification

Existing-workflow maintenance by explicit operator direction. Extend private
saved-input custody without widening canonical decision or execution authority.

## Root Cause

Accepted local persistence still kept original diagrams, sessions, briefs and
unapplied drafts in one browser profile. Backend apply receipts retained canonical
results but did not store those original authoring artifacts.

## Ownership

OOS owns private saved input and its bounded API. Console owns the original
editors and browser recovery. Existing Platform state custody and runtime remain
in place; Security reviews exact source before activation. WGCF's formal registry
and OpenProject's canonical ART authority are unchanged.

Landing Unit `maintenance-oos-saved-work-20261029` is isolated by backend contract,
authentication, validation and rollback boundary. Gary authors/publishes; the
delegated accountable human reviews the exact source head. The companion Console
Landing Unit uses the same reviewed semantic contract, not an ART child per repo.

## Source Changes

The bounded saved-work store reuses existing fsync/atomic file transactions and
kernel locks on the current private OOS volume. Subjects are scoped by kind,
caller and operator; no all-history scan or new database is required. Exact
payload text preserves diagram geometry. Saves bind expected revision, input
identity and digest. Finalized brief versions cannot be changed or removed by
draft saves. Raw browser originals have separate immutable recovery identities.

Source projection and the existing caller/operator/mutation boundary protect
GET/POST. Malformed input, stale saves, conflicting replay, corrupt storage and
missing runtime are explicit failures. Acknowledgement follows durable commit.
Preserving/restoring input never grants native workflow acceptance or executes it.

## Validation

Owner tests cover all three types, fractional geometry, restart reads, uncertain
save replay, conflicts, finalized history, original bytes, actor isolation,
corrupt records, bounded input, transport authentication and canonical envelope.
Full committed owner tests, API/docs and fetched-base gates remain required.
Security's generated index must follow the merged owner record.

## Live Verification

After paired exact-source acceptance, use normal Platform activation and the real
Console to migrate actual preserved records. Verify exact diagrams/brief versions
from a fresh profile and after service recovery; distinguish actual desktop data
from Console-only automation profiles. No fixture or apply receipt substitutes
for original saved artifact bytes. Record operating limits honestly.

## Artifact And Deployment Evidence

Retain exact committed owner validation, paired source/Security acceptance,
normal Platform activation receipts and real Console recovery evidence. Source
validation alone is not operating recovery. The current private state mount is
reused; reviewed main source advances only when paired acceptance is ready.

## Rollback

Restore prior accepted source and paired decision through existing Platform
controls, retaining both new private owner state and original browser backups.
No destructive migration, canonical ART mutation or new privileged path occurs.

## Follow-Up

Finish full validation, source review, paired acceptance, normal commissioning,
real browser/restart recovery and exact owner cleanup before final completion.
