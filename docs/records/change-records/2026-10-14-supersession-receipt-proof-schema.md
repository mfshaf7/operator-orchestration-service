# 2026-10-14 Supersession receipt proof-schema alignment

## Summary

Align the architecture-supersession receipt schema with the real pristine-source proof and add a cross-layer regression test that validates adapter output through the receipt contract.

## Classification

- area: Delivery ART work-session reconstruction
- type: source-behavior repair
- runtime impact: restores bounded reconstruction for pristine sessions after an Architecture Packet supersession

## Ownership

- owner repo: `operator-orchestration-service`
- related ART slice: Workspace Delivery ART #1284 under Epic #1275
- related products or components: Delivery ART work-session controller and source adapter

## Root Cause

- immediate failure: `work reconstruct 1284` returned `delivery_art_work_session_supersession_receipt_invalid`.
- actual root cause: the source adapter added `base_commit_available` to its pristine proof while the closed receipt schema still rejected that property.
- why it escaped earlier controls: the controller reconstruction fixture did not initially contain the field emitted by the real source adapter, and the adapter test did not validate its output through the receipt schema.

## Source Changes

- changed workflow, adapter, or contract: require the real boolean `base_commit_available` field in the supersession receipt's pristine source proof.
- tests or validator added: make the controller reconstruction fixture match the real adapter and validate actual adapter proof output against the receipt schema.
- related change records: `docs/records/change-records/2026-10-14-work-session-replacement-owner-base.md`

## Artifact And Deployment Evidence

- source-only change, or build/deployment evidence: source-only owner-repo maintenance
- image tag or digest: None
- runtime revision: pending merge

## Live Verification

- local validation: focused work-session and CLI-adapter tests plus full repository validation
- live or dev-integration verification: retry `npm run art -- work reconstruct 1284` after the merged source is active
- residual risk: future proof fields remain fail-closed; the new cross-layer test detects adapter/schema drift before merge

## Follow-Up

- required follow-up: close the linked regression candidate after the source control lands and live reconstruction succeeds
- owner: `operator-orchestration-service`
- due date or closure condition: merged repair and successful live reconstruction for work item 1284
