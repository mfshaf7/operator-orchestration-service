---
security_evidence:
  review_areas: [delivery, runtime]
  findings: []
  risks: []
  workstreams: [WS-007]
  reviewed_artifacts:
    - src/record-authority-freshness.js
    - src/repository-owner-bootstrap/authority-reader.js
    - src/delivery-art/source-repository-admission.js
    - security-architecture/docs/reviews/components/2026-10-15-bounded-source-realization-boundary.md
  notes: "Preserve Platform checkpoint authority and exact fresh clean record source; distinguish bundled minimum contract ancestry from the current accepted implementation baseline. No new authority or runtime permission."
---
# 2026-10-21 Source authority checkpoint baselines

## Summary

Correct both host source readers' shared checkpoint predicate so a legitimate
Platform-reviewed control advance does not invalidate an unchanged compatible
contract bundle. Preserve all current cache and source-admission safeguards.

## Classification

- area: proposed owner bootstrap and ordinary source admission
- type: approved corrective maintenance under the existing Console exercise
- runtime impact: common synchronous source-reader validation; no new API,
  checkpoint format, environment switch, credential purpose or permission

## Ownership

- owner repo: `operator-orchestration-service`
- related ART slice: Epic1275 story1298; no new repair child
- related products or components: Console, Platform record refresh, source executor

## Root Cause

- immediate failure: actual first Console owner create is rejected before a
  request, credential or checkout exists; the source-executor audit reports
  `bootstrap.inspect-source-identity` / `record_authority_unavailable`.
- actual root cause: the bundled contract's required revision was equated with
  the current Platform-approved baseline. Actual unchanged cache is fresh and
  clean at5ef54a7, approved baselinec508, bundled minimum5746; native Git proves
  the valid5746-to-c508-to-5ef ancestry, yet both actual source readers deny it.
- why it escaped earlier controls: composed readiness and source fixtures did
  not exercise both host admission readers against the actual current cache
  after a legitimate accepted baseline advance.

## Source Changes

- changed workflow, adapter, or contract: shared synchronous predicate checks
  required bundle ancestor of current approved checkpoint baseline, then that
  baseline ancestor of exact clean cached record main. Existing owner, ref,
  timestamp/expiry, size, regular-file, HEAD and dirt checks remain. Both callers
  explicitly document the bundled requirement. Async reader semantics unchanged.
- tests or validator added: native real-Git advanced/exact positive cases;
  older/unrelated baseline, future required bundle, dirty/untracked source,
  foreign HEAD/ref, wrong owner, invalid/expired checkpoint and symlink denials.
  Actual before/after diagnostics invoke both native readers against the same
  live cache with zero writes. Paired Console maintenance names only the known
  safe dependency code; unknown backend diagnostics remain opaque.
- related change records: None.

## Artifact And Deployment Evidence

- source-only change, or build/deployment evidence: full committed local and
  provider CI, exact human review, dependent actual-source Security/index and
  normal activation are required before live owner workflow continuation.
- image tag or digest: None at authoring time.
- runtime revision: None at authoring time; no future squash SHA substituted.

## Live Verification

- local validation: old native real-Git regression fails, corrected predicate
  passes. Actual current-cache source reader diagnostics deny both before and
  accept both after the correction without cache or checkpoint mutation.
- live or dev-integration verification: original UI rejection and native empty
  owner journal confirmed; no target credential or checkout. Failed read-only
  preparation/audit preserved. New operating witness follows accepted activation.
- residual risk: the local Platform checkpoint remains the trusted freshness
  authority. This does not admit private/client source or arbitrary new code
  merely because it is a Git descendant; Platform still classifies and approves
  cache refresh under its separate exact-source and reviewed-record boundary.

## Follow-Up

- required follow-up: both owner merges, actual Security pins/index, normal
  activation and actual Console owner bootstrap then ordinary app delivery.
- owner: OOS; Platform owns refresh and Security retains acceptance authority
- due date or closure condition: actual end-to-end owner/app proof under1298;
  neither source tests nor this record closes Epic1275.
