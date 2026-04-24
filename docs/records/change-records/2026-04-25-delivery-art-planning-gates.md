# 2026-04-25 Delivery ART Planning Gates

## Summary

The broker now treats consume-to-PI planning as a first-class workflow instead
of a convention. Accepted-idea consume remains the top-level `Epic` shell
entrypoint, while delivery work-item create, update, and move now fail closed
when planning discipline would drift.

## Classification

- area: delivery workflow
- type: control hardening
- runtime impact: bounded broker validation and contract guidance

## Ownership

- owner repo: `operator-orchestration-service`
- related platform contract:
  [`platform-engineering/products/openproject/delivery-art-contract.md`](https://github.com/mfshaf7/platform-engineering/blob/main/products/openproject/delivery-art-contract.md)

## Root Cause

The ART had no single enforced planning model for the path from accepted idea
consume to PI commitment. That allowed story-level work to appear before PI
commitment and left the broker surface too permissive relative to the intended
planning doctrine.

## Source Changes

- added broker-side planning validation in:
  - `src/delivery-taxonomy.js`
  - `src/openproject-client.js`
- updated delivery operator and contract surfaces:
  - `docs/operations/delivery-workflow-operator-surface.md`
  - `docs/contracts/delivery-workflow-api-v1.md`
  - `docs/contracts/accepted-idea-delivery-consumption-v1.md`
  - `docs/api/openapi.json`
- added regression coverage in `test/openproject-client.test.js`

## Artifact And Deployment Evidence

- local broker code and contract update only
- no image build or runtime promotion in this slice

## Live Verification

- route-contract validation and unit coverage prove:
  - consume remains the top-level `Epic` shell entrypoint
  - `PI Objective`, `User story`, `Task`, and `Milestone` work cannot exist
    without `Target PI`
  - `User story` and `Task` planning requires a PI-committed parent
  - PI-committed non-`Epic` work must also carry non-backlog `Iteration`

## Follow-Up

- prove the same workflow against the live ART through the active `#277` slice
- keep the platform-side ART quality checker aligned to the same planning rules
