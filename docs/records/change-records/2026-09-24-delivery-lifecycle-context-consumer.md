---
security_evidence:
  review_areas:
    - ai
    - delivery
    - identity
    - runtime
  reviewed_artifacts:
    - contracts/delivery-art-work-session/lifecycle-context-request.schema.json
    - contracts/delivery-art-work-session/lifecycle-context-ledger.schema.json
    - src/delivery-art/lifecycle-context-client.js
    - src/delivery-art/lifecycle-context.js
    - src/delivery-art/work-session-service.js
    - src/delivery-art/work-session-store.js
    - test/delivery-art-lifecycle-context.test.js
  findings: []
  risks: []
  workstreams:
    - WS-007
  notes: "CGG projects bounded context only; OOS retains lifecycle authority and records every denied packet request or explicit raw fallback."
---

# Delivery Lifecycle Context Consumer

## Summary

Delivery work sessions now expose one bounded lifecycle-context API. OOS derives
authoritative session sources, uses CGG packet projection by default, rejects
silent raw downgrade, and retains measured references without storing context
content.

## Classification

- area: Delivery ART work-session context admission
- type: workflow contract and source implementation
- runtime impact: source-complete and uncommissioned pending Security and Platform activation

## Ownership

- owner repo: `operator-orchestration-service`
- related ART slice: Epic #1154, Feature #1159, Enabler #1165
- related products or components: OOS work sessions and Context Governance Gateway

## Root Cause

- immediate failure: lifecycle automation had no API-owned path for bounded CGG
  packets or measurable raw fallback
- actual root cause: existing CGG support covered oversized CLI output rather
  than authoritative work-session lifecycle context
- why it escaped earlier controls: context projection was sequenced behind the
  CGG lifecycle contract and was not part of the original work-session API

## Source Changes

- changed workflow, adapter, or contract: added the authenticated context route,
  CGG client, source derivation, fail-closed response binding, external context
  ledger, public status projection, and runtime configuration boundary
- tests or validator added: packet, fallback, denial, replay, restart,
  credential-reference persistence, service, config, HTTP, and OpenAPI coverage
- related change records: None

## Artifact And Deployment Evidence

- source-only change: Delivery ART work item #1165
- image tag or digest: None
- runtime revision: not commissioned; #1166 and #1167 own review and activation

## Live Verification

- local validation: repository test and contract validation evidence is bound
  through the #1165 Review Packet
- live or dev-integration verification: deferred until the dedicated CGG
  endpoint and identity are commissioned
- residual risk: no packet projection is available before commissioning; OOS
  reports that posture and fails closed instead of using raw context

## Follow-Up

- required follow-up: Security review in #1166 and Platform commissioning in
  #1167
- owner: Security Architecture and Platform Engineering respectively
- closure condition: the dedicated endpoint and caller binding are reviewed,
  configured, and proven without expanding CGG authority

## Rollback

Revert the context endpoint, lifecycle-context service and client, schemas,
configuration, and status projection together. Existing reference-only ledgers
remain non-authoritative audit records.
