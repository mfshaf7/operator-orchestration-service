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
  reference and supersession resolution, exact requested-to-declared custody
  URI binding, and immutable Review Packet finalization checks
- added bounded OpenProject scope snapshots covering selected records, the
  transitive `follows` dependency closure, and loaded parent/root lineage, plus
  append-only, content-addressed attachment custody with idempotent replay and
  interrupted-write recovery
- restricted architecture, work-start, merge-readiness, and finalization
  transitions to local candidates so durable packets cannot be rewritten through
  the same transition
- restricted Review Packet v2 persistence to source-backed Landing Units whose
  finalization candidate supersedes a broker-owned durable predecessor; the
  existing schema-v1 path remains the supported non-source closeout path
- claimed transitions by logical artifact identifier plus durable predecessor,
  rejected competing immutable intent, and required explicit same-identifier
  supersession for legitimate replacements
- derived transition times from stable candidate or durable receipt evidence,
  serialized equal operation intent within the broker, and bound the result to
  durable operation markers so retries and process restarts recover one logical
  artifact under an admitted single-writer topology
- extended the OpenProject mutation gate to recognize dedicated attachment
  adapter tests and their append-only and same-origin evidence
- included the pinned Delivery ART contract bundle in both runtime image targets
  so API and worker startup validate against the same schemas as local execution
- added authenticated artifact validation, resolution, architecture persistence,
  work-start evaluation, Review Packet readiness, finalization preparation, and
  finalization routes
- fail-closed runtime admission now prevents every v2 artifact write from
  reaching OpenProject until downstream activation admits the path and proves
  one non-overlapping writer through the explicit `single-writer` topology;
  validation and resolution reads remain available
- all v2 write routes enforce the existing OOS mutation-authority boundary and
  emit one correlated success, blocked, or failure audit outcome
- finalization preparation computes the cycle-safe readiness subject without
  terminal timestamps; OOS copies the durable WGCF receipt evaluation time,
  derives finalization from the latest receipt custody time, and persists packet
  custody last
- updated the ART CLI so broker-returned durable artifacts replace local working
  copies and landing-unit closeout resolves the exact durable packet before using
  its scope
- refreshed the live bounded ART scope whenever a durable Review Packet resolves,
  so closeout cannot proceed from a snapshot that became stale during custody
  persistence or before submit
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
- retry recovery resolves stable operation markers from attachment metadata;
  this contract covers retries and process-crash recovery under one admitted
  writer, while conflicting duplicate markers or filenames fail closed
- concurrent writer replicas are not admitted by this source-only path and need
  future durable orchestration or another atomic coordination owner
- logical transition claims are stable across different local intent for the
  same artifact identifier and predecessor; changed intent requires an explicit
  supersession reference
- artifact resolution rejects alias attachments whose validated content
  declares a custody URI different from the requested durable reference
- operation-marker recovery and idempotent filename replay enforce the same
  selected-attachment-to-declared-custody binding
- scoped ART digests include dependency identity, lag, and supporting
  description together with loaded parent/root lineage; relation reads continue
  through newly materialized dependency and lineage records until the upstream
  closure is complete, while unrelated relations and downstream dependents stay
  out of scope; the internal projection is versioned as schema v2
- work-start, Review Packet persistence, and closeout refresh the active
  work-start and referenced architecture snapshots, so a newer child snapshot
  cannot revive a stale architecture decision
- trusted resolution rejects unsupported non-source Review Packet v2 artifacts,
  so landing-unit closeout cannot bypass the source-backed transition boundary

## Security And Trust

- authenticated caller identity must match artifact operator and decision
  authority where applicable
- OOS refreshes the declared ART scope immediately before persistence
- WGCF readiness remains recommendation and receipt authority only; it cannot
  persist source artifacts, finalize Review Packets, or mutate ART
- every accepted WGCF source-system alias is recommendation-only and denied at
  the HTTP authority boundary before the artifact service can execute a write
- production runtime construction injects a denied v2 mutation-admission state
  with no writer topology; OpenProject credentials or the admitted flag alone
  cannot activate the source-only path
- local files cannot redefine finalized scope because closeout resolves and
  validates the durable content-addressed packet
- copied content cannot redefine durable custody because resolution binds the
  requested backend URI to the artifact's declared custody URI
- no credential, secret-delivery, AI invocation, or platform promotion boundary
  changed in this landing unit

## Validation

- contract tests cover canonical JSON, exact source-head binding, direct-land
  expiry, chronology, conformance coverage, immutable merge-ready evidence, and
  supersession cycles
- service tests cover fresh-snapshot rejection at persistence and closeout,
  caller binding, local-only state transitions, predecessor-bound competing
  intent, explicit architecture/work-start/Review Packet supersession,
  overlapping-request serialization, idempotent replay, append-only custody,
  interruption recovery, requested custody URI binding, recursive dependency
  resolution, referenced-architecture snapshot freshness, non-source v2
  resolution rejection, and fail-closed WGCF receipt resolution
- the full service-chain test replays work-start evaluation, merge-readiness,
  and finalization after their first durable writes and proves that no new
  timestamp or attachment is created
- OpenProject adapter tests cover canonical resolution of equivalent duplicate
  filenames and operation markers, fail-closed conflicting duplicates,
  same-origin attachment reads, and rejection of credential-bearing reads to
  foreign origins
- HTTP and CLI tests cover all v2 routes, duplicate-key rejection, durable
  write-back, and broker-resolved landing-unit scope
- focused tests also prove recommendation-only denial for every accepted WGCF
  alias, fail-closed runtime admission, explicit single-writer topology
  enforcement, correlated mutation outcomes, and honest receipt-before-packet
  chronology
- negative finalization coverage rejects synthetic non-source v2 candidates,
  and snapshot coverage proves parent Feature, transitive dependency, relation
  lag, and supporting-description changes alter the ART digest
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
- concurrent Delivery ART writers remain unsupported; downstream activation
  must retain one non-overlapping writer or introduce separately admitted
  durable atomic coordination before increasing writer concurrency
- no shared dev-integration activation or live OpenProject dogfood is claimed by
  this source-only child

## Follow-Up

- complete `#803` through `#806` in dependency order
- activate and dogfood the complete chain only after the WGCF receipt and
  security controls are proven
- close `#802` only from its finalized Review Packet after this source lands
