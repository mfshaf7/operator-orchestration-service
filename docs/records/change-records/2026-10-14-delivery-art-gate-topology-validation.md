---
security_evidence:
  review_areas:
    - delivery
  reviewed_artifacts:
    - src/delivery-art/contracts.js
    - test/delivery-art-contracts.test.js
  findings: []
  risks: []
  workstreams:
    - WS-007
  notes: The validator adds fail-closed planning rejection for impossible early approval cycles; it does not add authority, weaken a human gate, or change later runtime and operating gate semantics.
---

# Delivery ART Gate Topology Validation

## Summary

OOS Architecture Packet validation now composes cross-Landing-Unit work
prerequisites, source-landing order, and `before_implementation` or
`before_source_merge` human-gate authority order. A cycle across those distinct
topologies is rejected before architecture approval.

## Classification

- area: Delivery ART architecture validation
- type: corrective cross-repo contract parity
- runtime impact: newly authored or submitted packets with an impossible early-gate schedule fail closed

## Ownership

- authority contract: `workspace-governance/contracts/delivery-art-operator-path.yaml`
- implementation owner: `operator-orchestration-service`
- related ART item: #1304 under Epic #1275

## Root Cause

- individual work, source, and gate topology checks each passed
- their combined schedule could still place the gate authority after the source merge it had to unlock
- the first exact source-realization head exposed the cycle after implementation instead of during architecture approval

## Source Changes

- preserve the separate meaning of work, source, and human-gate topology
- project only early pre-source gate edges into the combined schedule
- keep `before_runtime_activation` and `before_operating_ready` outside that schedule
- add a regression vector whose individual graphs are acyclic but whose combined schedule is cyclic

## Artifact And Deployment Evidence

- source-only validator parity for Landing Unit `delivery-1275-gate-topology-validator`
- no runtime activation, image rollout, or environment mutation is part of this change

## Live Verification

- focused Delivery ART contract tests
- full serial repository test suite
- API and change-record validation required by the owner repository

## Follow-Up

- merge after Workspace Governance contract authority and WGCF readiness parity are reviewed
- retain the linked improvement candidate until all three validators reject the old Epic 1275 shape and accept its successor
