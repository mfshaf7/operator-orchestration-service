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

# 2026-04-25 Initiative Owner Repo Parity

## Summary

Extended the broker so top-level delivery initiatives can carry `Owner Repo`
through the same supported consume and governance routes that already backed
child work-item ownership.

## Classification

- area: delivery workflow
- type: control hardening
- runtime impact: bounded broker write-path parity for top-level epics

## Ownership

- owner repo: `operator-orchestration-service`
- related ART slice:
  - `#310` `Brokerize guided closeout, stale-open, planning-repair, and initiative-write parity workflows`
  - `#319` `Add top-level initiative Owner Repo parity to broker governance and accepted-idea consume flows`

## Root Cause

`Owner Repo` was already machine-enforced for delivery work items, but top-level
epics still lacked parity on the broker initiative paths. That left initiative
ownership as a hidden special case and forced manual repair through later ART
cleanup instead of preserving owner metadata from the first supported write.

## Source Changes

- extended top-level initiative consume and governance writes to accept
  `owner_repo`:
  - `src/app.js`
  - `src/idea-service.js`
  - `src/delivery-service.js`
  - `src/openproject-client.js`
- exposed the same field in the broker contract surfaces:
  - `docs/contracts/accepted-idea-delivery-consumption-v1.md`
  - `docs/contracts/delivery-workflow-api-v1.md`
  - `docs/operations/delivery-workflow-operator-surface.md`
  - `docs/api/openapi.json`
- added regression coverage for HTTP, service, and OpenProject-client parity:
  - `test/http.test.js`
  - `test/idea-service.test.js`
  - `test/delivery-service.test.js`
  - `test/openproject-client.test.js`

## Artifact And Deployment Evidence

- local broker code and contract update only
- no image build or governed runtime promotion in this slice yet

## Live Verification

- local regression coverage now proves:
  - accepted-idea consume forwards `owner_repo`
  - initiative governance forwards `owner_repo`
  - OpenProject client writes `Owner Repo` on top-level epics
  - initiative governance responses now surface `owner_repo`

## Follow-Up

- restart the devint broker from merged code before repairing live epics
- update live ART epics `#304` and `#306` through the supported initiative
  governance path so their stored `Owner Repo` matches the planned execution
  ownership
