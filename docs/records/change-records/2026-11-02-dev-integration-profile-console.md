---
security_evidence:
  review_areas: [identity, secrets, delivery, runtime, ai]
  reviewed_artifacts:
    - src/platform-operation/contracts.js
    - src/platform-operation/governed-product-contracts.js
    - src/platform-operation/release-workflow-contracts.js
    - src/platform-operation/service.js
  findings: []
  risks: []
  workstreams: [WS-003, WS-005]
---

# Console profile and governed-release integration

## Summary

Extend existing OOS ownership with bounded owner records, recoverable native
profile requests and source-bound governed-release commands. Reuse the canonical
Platform-operation journal and the protected owner workflow; keep source evidence,
execution, approval and observed health separate.

## Classification

- Area: shared operator workflow maintenance, explicitly approved by the operator.
- Landing Unit: `maintenance-dev-integration-profile-oos`.
- Landing Unit decision: `child_isolated_landing_unit`; independent workflow owner,
  validation, review and rollback from Platform and the pending Console UI batch.
- Runtime impact: source staged; no live activation or new ART item.

## Ownership

OOS owns workflow validation, attribution, canonical request mutation and recovery.
Platform supplies safe profile readback and retains runtime controls. Workspace
Governance owns profile admission. Console is a client. Security retains acceptance.

## Root Cause

The finite runtime-operation adapter lacks the accepted profile-centric read and
request integration. A reserved action enum does not implement that integration.
Disconnected preview is not operating evidence.

## Source Changes

See [the operator procedure](../../operations/dev-integration-profiles.md).
Implementation is staged and locally validated. Reuse existing private file
transactions for canonical native requests, stable replay and recording receipts;
preserve the current execution allowlist. The operator rejected the earlier
unpublished Proposal-capture mapping. Its backend dispatch, UI navigation and
documentation are replaced together; no actual Proposal was created.

## Local Validation

Native request/HTTP and existing Platform operation tests pass. Isolated composed
proof used the actual seven-profile committed registry, OOS canonical persistence
and Console adapter/form. The same recording receipt survives reconstructed
service, browser reload and replay. No live business request, Proposal, ART item
or runtime command was created. Full-suite config coverage was updated for the
new default-off profile-integration flag.

## Artifact And Deployment Evidence

None. Pending source is not a deployed or commissioned capability.

## Live Verification

No live request mutation has been performed. The profile workflow performs no
OpenProject mutation and requires no OpenProject form fields. Before activation,
prove native recording/readback, exact receipt replay, invalid caller/stale source
denials, independent admission evidence and retained requests after restart.

## Follow-Up

Complete owner tests, exact-source Security review and Platform composition before
claiming Console-only operation. Retain existing requests on rollback.

## Governed Releases maintenance extension

The operator approved the inspected Governed Releases repairs in the same pending
maintenance batch. Extend this Landing Unit with authenticated, default-off product
readback and workspace-scoped history pagination. Platform supplies committed
registry/release data and validated existing protected-workflow links. Recorded
evidence remains separate from executable workflow progress. Navigation creates
no command, request, approval or release receipt. No new privileged dispatcher is
implemented or activated. See [the operator procedure](../../operations/governed-release-readback.md).

The current file store remains canonical. Immutable creation-key continuation
reaches older scoped records without a global200 cutoff. Lightweight metadata
caching avoids decoding every full record on each warm read. Cold discovery and
file-stat costs still grow with retained history; no database-scale claim is made.

Source review and exact-source Security/Platform commissioning remain pending.
No stage/prod state, real workflow, canonical record or live configuration was
changed during the source proof. This extends the existing owner/review/rollback
unit and remains uncommitted until coherent batch publication.

## Approved native governed-release extension

Operator approval `operator-approved:governed-release-native-20261102` extends this
same pending owner Landing Unit. Reuse existing Console/OOS/Platform operations,
private journals, protected owner workflows and their human approvals. No new ART
child, service, database or executor. The dedicated default-off App/Vault custody
is separate from Gary and other workflow identities. No live connection is
created or commissioned in this source work.

Commands bind exact source, actor, inputs and explicit approval. The owner writes
before dispatch and never automatically repeats an uncertain original. A valid
pre-dispatch rejection retains a no-effect receipt. Existing protected workflows
validate native App/source/input binding, safely pass user text as environment
values, push an original branch without force and open its PR. Source completion
requires actual merge ancestry and exact owner desired-state readback; runtime
health, smoke/UAT and readiness acceptance stay distinct. Terminal receipts are
immutable; failures with retained branches stay recoverable. Cancelling the
original run does not prove rollback.

The Console reuses release Details/Review and original operation history. Product
and executable capability must both be current. Its opaque recovery pointer does
not replace canonical journals; lost replies recover the exact original operation.
Unknown/live-source outages never substitute synthetic fixtures.

Source validation includes Platform native recovery/custody and existing provider
checks, strict OOS/Console DTOs, and isolated authenticated Console → OOS →
Platform browser qualification with synthetic GitHub transport. The exercise
proves one dispatch despite a lost reply, separate approval/review waits, merged
readback and cold OOS recovery. It performs zero live release writes and is not
operating acceptance. Preserve final owner CI-equivalent/source review evidence
before later publication. Security source delta:
[review](https://github.com/mfshaf7/security-architecture/blob/main/docs/reviews/components/2026-11-02-console-native-governed-release.md).

After source landing, the existing exact-composition Platform/Security process
must bind the reviewed source and commissioned App before native availability.
Rollback withdraws native selection/credentials while preserving original owner
operations, source branches and receipts. Merge order for this pending extension:
Security evidence/index, Platform provider/workflows, OOS contract/API, Console.
All source remains uncommitted for the requested coherent batch review.

## Repeat-use source/data coherence

Final repeat-use inspection found that a completed GitHub merge would leave the
pinned local record reader behind owner main and prevent the next operation.
Keep reviewed runtime code pinned. The Platform-owned reader follows only fixed
owner GitOps records after complete non-record tree equivalence and ancestry
proof, using the existing dedicated App's read scope. It does not update a local
checkout, execute fetched code or move canonical data. Non-record source changes
still require the existing source acceptance. Snapshots retain explicit current,
accepted or retained posture; only verified owner main enables a native command.

A bounded private derived cache survives restart; immutable blob reuse and shared
head proof avoid repeated whole-source reads. Unknown source cannot become
current by refreshing the UI. Readiness-input failure does not remove an otherwise
valid runtime capability. The source tests and authenticated isolated browser path
now prove two consecutive merged operations with different owner-data revisions
and the same accepted runtime-code revision. No live release is dispatched.
