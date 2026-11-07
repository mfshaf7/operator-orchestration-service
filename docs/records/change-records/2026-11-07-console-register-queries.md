---
security_evidence:
  review_areas: [runtime, delivery]
  reviewed_artifacts:
    - src/app.js
    - src/delivery-service.js
    - src/openproject-client.js
    - src/orchestration/service.js
    - src/prototype-landing/service.js
    - src/repository-owner-bootstrap/service.js
    - src/instance-records/inventory-projection.js
  findings: []
  risks: []
  workstreams: [WS-007]
---

# Bounded Console register reads

## Summary

## Classification

Operator-approved owner maintenance adds bounded, authenticated register reads
for the Console UI batch. Landing Unit Decision: feature_single_landing_unit,
maintenance-register-query-coverage-20261107. This work is outside active ART
scope and creates no new decisions, mutation permissions or database schemas.

## Ownership

OOS owns the read APIs and workflow stores. Governance owns the projection
contract, WGCF owns product readiness projection, Console owns presentation,
and Security/Platform retain exact-source acceptance and activation.

## Root Cause

Bounded overview reads and recent-only history are insufficient as registers
grow. Register paging must preserve global authority and exact original access
rather than treating a short overview as the complete collection.

## Source Changes

The primary [operator instructions](../../operations/console-register-queries.md)
define native cursors, source revision/selection binding, exact originals,
caller-scoped history and legacy response compatibility. Orchestration pages
Temporal executions; Prototype selects immutable owner evidence for one project
page; Delivery pages root identities independently of its global overview.
Repository setup history preserves the independently returned pending request.
Private Registry accepts native signed pages of 25/50/100 records; its actual
page digest remains authoritative rather than a synthesized browser digest.

Changes to the OpenProject client and Delivery service are read-only. Existing
allowedValues, form schema, writable-field and PropertyIsReadOnly handling are
unchanged. No POST/PATCH/PUT/DELETE path or work-item transition is added.

## Artifact And Deployment Evidence

Focused owner service/store/HTTP tests and generated API schemas cover source
bounds, caller/scope isolation, changed revisions, sparse pages and original
recovery. Full owner tests, API/bundle validators, image smoke tests and fetched
origin/main checks are required before publication; exact commands and outcomes
are retained with the source PR. Tests do not claim live deployment.

The existing [composed Security review](https://github.com/mfshaf7/security-architecture/blob/main/docs/reviews/components/2026-10-24-configurable-ai-routing.md)
receives a bounded register-read delta and exact merged source acceptance before
normal Platform activation. Security's generated index is refreshed after this
owner record lands. Backends precede the Console consumer. Rollback restores the
previous accepted composition; no data migration or reversal is necessary.

## Live Verification

Native owner and Console read verification follows activation of the accepted
merged sources. No persistent test items or workflow mutations are authorized
by this read qualification. Until those checks pass, operating status is pending.

## Follow-Up

Refresh the Security index, accept exact merged revisions, activate the existing
Platform composition, verify native reads, revoke source leases and retire the
four batch worktrees/branches. No separate feature or ART item is required.
