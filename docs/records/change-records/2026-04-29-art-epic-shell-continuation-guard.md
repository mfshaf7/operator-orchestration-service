---
security_evidence:
  review_areas:
    - runtime
    - delivery
  findings: []
  risks: []
  workstreams:
    - WS-007
---

# 2026-04-29 ART Epic Shell Continuation Guard

## Summary

Added a fail-closed guard to the broker continuation route so a top-level
delivery `Epic` shell cannot be treated as an executable work item. Operators
must use initiative planning, governance, or review-pack surfaces to decompose
the shell before selecting a child execution front.

## Classification

- area: delivery workflow
- type: workflow guard
- runtime impact: `GET /v1/delivery-work-items/{work_item_id}/continuation-context`

## Ownership

- owner repo: `operator-orchestration-service`
- related ART slice:
  - `#362` `Introduce universal governed work-tracking home controls for meaningful changes`
  - `#366` `Enabler: Enforce shell-to-execution and work-home declaration gates`
  - `#367` `Enabler: Fail closed when an ART Epic shell is treated as executable`

## Root Cause

The continuation route returned a compact resume packet for any work-item id
inside the delivery project. That was useful for child execution items, but it
left a top-level `Epic` shell ambiguous: an operator or automation path could
request `work-item-<epic>` and receive a normal continuation response instead
of an explicit signal that the item is an initiative shell.

## Source Changes

- updated [src/delivery-service.js](../../../src/delivery-service.js) to reject
  top-level `Epic` targets with `initiative_epic_not_executable`
- extended [test/delivery-service.test.js](../../../test/delivery-service.test.js)
  with coverage for the fail-closed shell guard
- updated the delivery API contract and operator surface to route Epic shells
  through initiative planning/governance/review-pack paths before execution

## Artifact And Deployment Evidence

- artifact:
  - continuation context can no longer make an Epic shell look like a normal
    executable work item
  - failure is explicit and machine-readable through
    `initiative_epic_not_executable`
- deployment:
  - devint broker rollout is required after merge before live verification

## Live Verification

- pending after merge: restart accepted-idea devint broker from merged `main`
- pending after merge: `GET /v1/delivery-work-items/work-item-362/continuation-context`
  returns `initiative_epic_not_executable`
- pending after merge: `GET /v1/delivery-work-items/work-item-367/continuation-context`
  still returns the child execution context

## Follow-Up

- complete `#367` only after local tests pass, PR is merged, devint is
  restarted, and both live positive and negative continuation probes pass
