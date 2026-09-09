---
security_evidence:
  review_areas:
    - delivery
    - runtime
  reviewed_artifacts:
    - contracts/delivery-art/delivery-art-architecture-packet.schema.json
    - contracts/delivery-art-lifecycle/capabilities.json
    - src/delivery-art/contracts.js
    - src/delivery-art/service.js
    - src/delivery-art/work-session.js
    - src/delivery-art/work-session-controller.js
  findings: []
  risks: []
  workstreams:
    - WS-007
  notes: "The change validates and interprets canonical v3 schedule and human-gate semantics without activating v3 or adding runtime authority."
---

# Delivery ART Architecture V3 Adoption

## Summary

ART #1122 adds source support for canonical Architecture Packet v3 while
preserving historical v1 and transition v2 behavior.

## Classification

- area: Delivery ART architecture and work-session lifecycle
- type: contract adoption and fail-closed schedule enforcement
- runtime impact: source capability only; the active normal packet version is
  unchanged until WGCF adoption and Workspace Governance activation land

## Ownership

- owner repo: `operator-orchestration-service`
- related ART slice: User story #1122 under Feature #920 and Epic #892
- related components: Delivery ART artifact service and work sessions

## Root Cause

- immediate failure: OOS rejected schema-v3 packets and could not interpret
  their explicit start, close, gate-emission, or evidence-prerequisite model
- actual root cause: OOS still pinned and implemented the v2 work graph, while
  its work session treated every Security gate affecting a Landing Unit as one
  pre-merge gate
- why it escaped earlier controls: v2 validated acyclic work dependencies but
  could not represent separate pre-implementation and post-conformance
  authority decisions

## Source Changes

- syncs the canonical Architecture Packet schema through Workspace Governance
  commit `8e90eb319cbf541ab6d34836fde4e9655bb24ac8`
- validates v3 combined start-and-close schedules, exact gate emission,
  evidence-prerequisite binding, and explicit Security-owned gates
- persists and consumes valid v3 packets while retaining v1/v2 compatibility
- derives external start and close prerequisites plus transition-specific human
  gates from the durable packet on every work-session status read
- prevents `work continue`, `work merge`, and `work close` from crossing an
  unresolved v3 architecture boundary

## Artifact And Deployment Evidence

- source-only change: OOS pull request for ART #1122
- image tag or digest: None
- runtime revision: None

## Live Verification

- local validation: focused artifact, service, and work-session tests plus the
  full owner-repo and base-aware validation suites at the final PR head
- live or dev-integration verification: None; v3 is deliberately inactive
- residual risk: WGCF cannot custody v3 until #1123 lands, and v3 must not
  become the normal packet version until #1124 activates the cross-repo path

## Follow-Up

- required follow-up: implement WGCF v3 custody in #1123, then activate v3 and
  publish the first normal #892 packet in #1124
- owner: `workspace-governance-control-fabric`, then `workspace-governance`
- closure condition: #1123 and #1124 land through their own reviewed Landing
  Units and normal work sessions resolve the durable v3 packet

## Rollback

Revert the OOS v3 validator, topology comparison, work-session derivation,
capability declarations, and synchronized schema snapshot together. Canonical
v3 remains in Workspace Governance, while OOS continues to accept the prior
v1/v2 runtime path.
