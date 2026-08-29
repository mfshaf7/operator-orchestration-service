# 2026-08-30 Repository Provider Identity Isolation

## Summary

Repository custody now selects separate GitHub App installation credentials for
existing-repository readback and new-repository provisioning, pins normal
provider traffic to GitHub, and denies credential-forwarding redirects.

## Classification

- area: repository custody provider boundary
- type: security and runtime hardening
- runtime impact: inactive source path only; normal repository custody remains disabled

## Ownership

- owner repo: `operator-orchestration-service`
- related ART slice: `openproject://work_packages/1056`
- related products or components: Platform repository provisioning identity and Governance Operations Console Repository surface

## Root Cause

- immediate failure: one provider token and permissive redirect behavior could not satisfy the accepted provisioning activation gates
- actual root cause: the inactive provisioning client extended the earlier read-only adapter before runtime identity separation and destination containment were operating-proven
- why it escaped earlier controls: ART `#1046` proved workflow behavior while ART `#1047` intentionally deferred live identity and transport activation proof to the Platform boundary

## Source Changes

- changed workflow, adapter, or contract: action-specific credential selection, admitted provider destinations, and redirect denial
- tests or validator added: provider-client and configuration tests cover credential separation, loopback-only sandbox override, and redirect policy
- related change records: `2026-08-29-repository-provisioning-workflow.md`

## Artifact And Deployment Evidence

- source-only change, or build/deployment evidence: source-only; normal runtime activation remains false
- image tag or digest: None
- runtime revision: None

## Live Verification

- local validation: full `npm test` plus base-aware change-record validation
- live or dev-integration verification: bounded provider behavior is sandbox-proven; Platform commissioning is owned by ART `#1048`
- residual risk: no normal provider mutation is allowed until the real organization GitHub App and Console composition pass their remaining gates

## Follow-Up

- required follow-up: commission the Platform provisioning identity and prove the Console/OOS path
- owner: Platform Engineering for `#1048`, Governance Operations Console for `#1049`
- due date or closure condition: before normal repository-provisioning activation
