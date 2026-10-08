# Agent Console Dev-Integration Runtime Hook

## Summary

Adds the default-off OOS side of the existing `refinement-catalog` Agent
Console composition so Platform #1246 can activate and verify the already
merged #1245 source without creating another runtime or workflow.

## Classification

- area: accepted-idea delivery dev-integration profile
- type: owner-repo runtime integration
- runtime impact: disabled by default; activation remains blocked on the Platform and Security work assigned by Epic #1203

## Ownership

- owner repo: `operator-orchestration-service`
- related ART slice: #1246 under Feature #1215 and Epic #1203
- related products or components: Context Governance Gateway, governed AI gateway, Workspace Governance Control Fabric, Governance Operations Console

## Root Cause

- immediate failure: the source-complete Agent Console had no OOS profile hook for the Platform-owned live composition.
- actual root cause: #1245 intentionally deferred caller credentials, runtime state, and activation to Platform #1246.
- why it escaped earlier controls: it did not escape; the architecture packet assigned this runtime boundary to the later Platform child.

## Source Changes

- changed workflow, adapter, or contract: extended the existing `refinement-catalog` profile with an exact, default-off OOS-to-CGG binding, operator binding, persistent local session state, readiness reporting, and teardown.
- tests or validator added: positive exact-binding readiness plus negative partial, disabled, foreign-composition, identity, credential, and stale-state checks.
- related change records: `docs/records/change-records/2026-10-09-agent-console-orchestration.md`

## Artifact And Deployment Evidence

- source-only change, or build/deployment evidence: owner-repo maintenance Landing Unit `delivery-1203-agent-console-oos-runtime-hook`
- image tag or digest: None
- runtime revision: None until Platform #1246 performs the composed live proof

## Live Verification

- local validation: profile-focused tests, full repository tests, governance validation, and base-aware source validation
- live or dev-integration verification: assigned to Platform #1246 after the matching Platform contract is reviewed and Security #1248 permits operating-ready activation
- residual risk: the hook cannot operate without the exact registered composition, CGG endpoint, caller id, and ephemeral credential; disabled and teardown paths remove the credential

## Follow-Up

- required follow-up: land the Platform contract and governed model profile, complete Console #1247 and Security #1248, then run #1246 positive, negative, rollback, and cleanup proof
- owner: the existing Epic #1203 child owners
- due date or closure condition: before Feature #1215 and Epic #1203 close
