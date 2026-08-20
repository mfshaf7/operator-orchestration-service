---
security_evidence:
  review_areas:
    - runtime
    - delivery
  reviewed_artifacts:
    - src/openproject-client.js
    - test/openproject-client.test.js
    - docs/operations/delivery-workflow-operator-surface.md
  findings: []
  risks: []
  workstreams:
    - WS-007
  notes: "The change narrows an existing closeout gate to the dependency direction already represented by OpenProject relations. It adds no route, mutation, caller privilege, secret, or runtime authority."
---

# 2026-08-20 Delivery Initiative Dependency Direction

## Summary

Corrected Delivery initiative closeout readiness so an unfinished downstream
consumer remains visible without blocking the completed predecessor it requires.
Unfinished dependencies required by the initiative continue to block closeout.

## Classification

- area: Workspace Delivery ART initiative closeout
- type: dependency-direction defect correction
- runtime impact: changes read-only closeout evaluation; no OpenProject mutation
  route or stored record is changed

## Ownership

- owner repo: `operator-orchestration-service`
- related ART slice: Defect `#862` under delivery `#417`
- related products or components: Workspace Delivery ART, Operator
  Orchestration Service, OpenProject delivery adapter

## Root Cause

- immediate failure: Epic `#417` could not close while downstream initiative
  `#411` remained active because `#411` requires `#417`.
- actual root cause: closeout evaluation treated every unresolved dependency
  relation touching the initiative scope as an inbound blocker, without
  checking whether the initiative scope was the relation target.
- why it escaped earlier controls: regression coverage included internal and
  inbound dependencies but did not include an active external consumer whose
  dependency points outward from the closing initiative.

## Source Changes

- changed workflow, adapter, or contract: closeout readiness now blocks only
  unresolved relations whose target belongs to the evaluated initiative tree;
  all dependency directions remain present in dependency visibility.
- tests or validator added: expanded delivery execution-summary regression
  coverage for internal unresolved dependencies, unfinished external
  predecessors, completed external predecessors, and unfinished downstream
  consumers.
- related change records:
  [2026-08-14-delivery-art-terminal-lifecycle-custody.md](2026-08-14-delivery-art-terminal-lifecycle-custody.md)

## Artifact And Deployment Evidence

- source-only change, or build/deployment evidence: source branch was loaded by
  the persistent `accepted-idea-delivery` dev-integration profile for live
  closeout-readiness verification; no image was published.
- image tag or digest: None
- runtime revision: `bc021adc40b855be90d43ca4fb8abd5a33f55083`

## Live Verification

- local validation: `npm test` passed with `571` tests; Delivery ART contract,
  API documentation, governance documentation, and OpenProject mutation
  contract validation passed.
- live or dev-integration verification: closeout readiness for `delivery-417`
  retained system-demo, open-descendant, PM2-closing, and inspect-and-adapt
  requirements while removing the false `unresolved_dependencies_present`
  reason. Evidence digest:
  `sha256:ee4481376e43d4b8b79dbb9ce0ca6b38ba2a1839a08df5100294bc67b41dbbdb`.
- residual risk: dependency direction relies on the established OpenProject
  `follows` mapping; the new regression matrix protects that mapping for this
  closeout evaluator.

## Follow-Up

- required follow-up: merge the Landing Unit, finalize its Review Packet, and
  resume Epic `#417` closeout.
- owner: Operator Orchestration Service
- due date or closure condition: Defect `#862` is covered by a finalized Review
  Packet and Epic `#417` closeout readiness is re-evaluated from merged source.

## Rollback

Revert the Landing Unit. This restores the previous conservative closeout gate
without changing OpenProject data, relation direction, or mutation behavior.
