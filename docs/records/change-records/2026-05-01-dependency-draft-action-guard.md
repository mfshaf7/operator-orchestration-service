---
security_evidence:
  review_areas:
    - runtime
    - delivery
  workstreams:
    - WS-007
  reviewed_artifacts:
    - src/art-workflow-artifacts.js
    - test/art-workflow-artifacts.test.js
  notes: "Dependency mutation drafts now use broker-supported action semantics before submit."
---

# 2026-05-01 Dependency Draft Action Guard

## Summary

The ART mutation draft template for work-item dependencies now emits the
broker-supported `set` action instead of the invalid `add` action, and draft
validation rejects unsupported dependency actions before submit.

## Classification

- area: delivery workflow control
- type: defect remediation
- runtime impact: source-only broker artifact validation change

## Ownership

- owner repo: `operator-orchestration-service`
- related ART slice: `#536`, `#564`
- related products or components: Workspace Delivery ART, WGCF cutover evidence

## Root Cause

- immediate failure: the generated dependency mutation draft used `action: add`.
- actual root cause: the managed draft template did not match the broker
  dependency route contract, which supports `set` and `clear`.
- why it escaped earlier controls: draft validation checked route shape but did
  not validate dependency action semantics.

## Source Changes

- changed workflow, adapter, or contract: `work-item.dependency` draft creation
  and semantic validation.
- tests or validator added: Node tests cover the `set` default and reject
  unsupported `add`.
- related change records: None.

## Artifact And Deployment Evidence

- source-only change, or build/deployment evidence: source-only change.
- image tag or digest: None.
- runtime revision: pending merge of PR source revision.

## Live Verification

- local validation: `node --test test/art-workflow-artifacts.test.js`,
  `npm test`, `npm run validate:openproject-mutation-contracts`.
- live or dev-integration verification: `npm run art -- draft create
  work-item.dependency work-item-539 /tmp/work-item-539-dependency-draft.json`
  and `npm run art -- draft validate /tmp/work-item-539-dependency-draft.json`
  produced a valid broker-supported draft.
- residual risk: None known for the managed draft path.

## Follow-Up

- required follow-up: None.
- owner: `operator-orchestration-service`
- due date or closure condition: close after PR merge and ART defect `#564`
  completion evidence is recorded.
