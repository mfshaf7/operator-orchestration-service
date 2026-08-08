---
security_evidence:
  review_areas:
    - delivery
    - runtime
  findings: []
  risks: []
  workstreams:
    - WS-007
---

# 2026-08-08 Delivery ART Durable Artifact Chain

## Summary

Implemented the OOS-owned runtime boundary for scoped Delivery ART work-start,
append-only architecture and Review Packet custody, exact dependency resolution,
and durable-packet closeout authority under ART child `#802`.

## Classification

- area: Workspace Delivery ART operator workflow
- type: broker workflow, artifact custody, and closeout authority
- runtime impact: adds authenticated OOS HTTP and CLI paths, but does not
  activate the path in a shared environment

## Ownership

- owner repo: `operator-orchestration-service`
- related ART slice: child `#802` under Feature `#800` and delivery `#698`
- upstream contract: Workspace Governance child `#801`
- downstream activation: WGCF `#803`, Platform `#804`, Security `#805`, and
  dogfood `#806`

## Root Cause

- the legacy Review Packet path did not persist a canonical work-start record
  before source work or resolve the full durable artifact chain before closeout
- the canonical policy and schemas landed first in `#801`; OOS runtime support
  was deliberately sequenced into this owner-repo child
- local packet files therefore remained useful working copies but could not yet
  provide durable custody or authoritative closeout scope

## Source Changes

- pinned the four Workspace Governance Delivery ART schemas with a source
  commit and per-file digest manifest
- added strict canonical JSON parsing, schema and semantic validation, complete
  reference and supersession resolution, and immutable Review Packet
  finalization checks
- added bounded OpenProject scope snapshots plus append-only, content-addressed
  attachment custody with idempotent replay and interrupted-write recovery
- extended the OpenProject mutation gate to recognize dedicated attachment
  adapter tests and their append-only and same-origin evidence
- included the pinned Delivery ART contract bundle in both runtime image targets
  so API and worker startup validate against the same schemas as local execution
- added authenticated artifact validation, resolution, architecture persistence,
  work-start evaluation, Review Packet readiness, finalization preparation, and
  finalization routes
- fail-closed runtime admission now prevents every v2 artifact write from
  reaching OpenProject until the downstream activation work admits the path;
  validation and resolution reads remain available
- all v2 write routes enforce the existing OOS mutation-authority boundary and
  emit one correlated success, blocked, or failure audit outcome
- finalization preparation computes the cycle-safe readiness subject without
  terminal timestamps; OOS copies the durable WGCF receipt evaluation time,
  records finalization afterward, and persists packet custody last
- updated the ART CLI so broker-returned durable artifacts replace local working
  copies and landing-unit closeout resolves the exact durable packet before using
  its scope
- documented the API and primary operator sequence

## OpenProject Contract Evidence

- writable surface: initiative attachment creation through the existing
  authenticated OpenProject adapter
- read surface: bounded initiative, covered-item, ancestor, relation, and
  attachment reads
- no OpenProject form field, allowed value, status transition, roadmap
  projection, or read-only field behavior changed
- artifact writes are append-only; an existing filename with different content
  fails closed

## Security And Trust

- authenticated caller identity must match artifact operator and decision
  authority where applicable
- OOS refreshes the declared ART scope immediately before persistence
- WGCF readiness remains recommendation and receipt authority only; it cannot
  persist source artifacts, finalize Review Packets, or mutate ART
- recommendation-only callers are denied at the HTTP authority boundary before
  the artifact service can execute a write
- production runtime construction injects a denied v2 mutation-admission state;
  OpenProject credentials alone cannot activate the source-only path
- local files cannot redefine finalized scope because closeout resolves and
  validates the durable content-addressed packet
- no credential, secret-delivery, AI invocation, or platform promotion boundary
  changed in this landing unit

## Validation

- contract tests cover canonical JSON, exact source-head binding, direct-land
  expiry, chronology, conformance coverage, immutable merge-ready evidence, and
  supersession cycles
- service tests cover fresh-snapshot rejection, caller binding, idempotent
  replay, append-only custody, interruption recovery, recursive dependency
  resolution, and fail-closed WGCF receipt resolution
- OpenProject adapter tests cover same-origin attachment reads and reject
  credential-bearing reads to foreign origins
- HTTP and CLI tests cover all v2 routes, duplicate-key rejection, durable
  write-back, and broker-resolved landing-unit scope
- focused tests also prove recommendation-only denial, fail-closed runtime
  admission, correlated mutation outcomes, and honest receipt-before-packet
  chronology
- API documentation validation proves every implemented route is documented

## Artifact And Deployment Evidence

- source evidence: this Landing Unit branch and its Review Packet for `#802`
- runtime revision: none
- deployment impact: none; source activation is sequenced after downstream
  readiness, platform, security, and dogfood work

## Live Verification

- local validation: focused contract, service, OpenProject adapter, HTTP, CLI,
  API documentation, governance documentation, and repository gates
- live or dev-integration verification: not claimed by this source-only child
- residual risk: WGCF cannot yet issue or expose the operating-readiness
  receipt required by v2 finalization, so the external receipt resolver remains
  fail-closed until `#803` lands

## Rollout And Rollback

- rollout: merge this OOS Landing Unit, then complete the sequenced WGCF,
  Platform, Security, and dogfood children before enabling the runtime path
- rollback: revert this OOS pull request; existing schema-v1 Review Packet and
  mutation-draft routes remain compatible
- durable artifacts are append-only and are not deleted during rollback

## Residual Risk

- WGCF cannot yet issue or expose the operating-readiness receipt required by
  v2 finalization; standalone receipt resolution is therefore not claimed by
  this source-only landing
- no shared dev-integration activation or live OpenProject dogfood is claimed by
  this source-only child

## Follow-Up

- complete `#803` through `#806` in dependency order
- activate and dogfood the complete chain only after the WGCF receipt and
  security controls are proven
- close `#802` only from its finalized Review Packet after this source lands
