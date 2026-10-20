---
security_evidence:
  review_areas: [delivery]
  findings: []
  risks: []
  workstreams: [WS-007]
  reviewed_artifacts:
    - security-architecture/docs/reviews/components/2026-10-15-bounded-source-realization-boundary.md
  notes: "Existing trusted owner bootstrap only; narrower CI event selection, no authority or permission expansion. Exact source acceptance and generated index follow actual owner merge."
---
# 2026-10-21 Owner bootstrap CI event bases

## Summary

Keep the optional trusted owner workflow on pull requests and pushes to the
already-qualified main branch, rather than selecting first review-branch or
tag pushes without a previous commit. Preserve all actual application checks.

## Classification

- area: repository owner bootstrap, optional CI
- type: corrective maintenance under the approved Console exercise
- runtime impact: trusted scaffold template bytes and their digest change;
  current reviewed preparations must be reinspected before acceptance

## Ownership

- owner repo: `operator-orchestration-service`
- related ART slice: Epic1275 qualification story1298; no new repair child
- related products or components: Governance Operations Console, source-only owner

## Root Cause

- immediate failure: exact generated app runner passes PR and existing-main
  commit pairs, but its Git diff fails on the zero previous SHA of a new ref.
- actual root cause: unfiltered push selection used an event field that is not
  a commit when the ref did not previously exist. The canonical
  [Octokit new-branch payload](https://github.com/octokit/webhooks/blob/main/payload-examples/api.github.com/push/with-new-branch.payload.json)
  confirms this input; isolated real Git reproduces the actual runner failure.
- why it escaped earlier controls: tests exercised commit substitution and
  separate bootstrap checks, not generated workflow event selection.

## Source Changes

- changed workflow, adapter, or contract: only the optional template trigger
  and existing primary operator guidance, with generated OpenAPI example
  digests synchronized from the changed trusted template; current bootstrap
  remains main-only. No OpenAPI schema or route change.
  No new-ref fallback, model invocation, CI waiver, permission or runtime API.
- tests or validator added: parse the actual generated workflow and bind event
  selection, exact checkout/base/head and unconditional selected app check;
  execute its actual shell command against native Git and app source, including
  initial control-only main, valid real pairs and invalid-zero fail-closed.
- related change records: None.

## Artifact And Deployment Evidence

- source-only change, or build/deployment evidence: source maintenance; full
  local/provider CI, exact-source Security acceptance and normal activation
  remain required before real Console plan continuation.
- image tag or digest: None.
- runtime revision: None at authoring time; do not substitute an unmerged SHA.

## Live Verification

- local validation: exact old plan materialized in isolated Git, with reviewed
  Little List source: PR/main pass, new-ref zero-before fails Git128. This is
  engineering evidence, not an actual provider workflow run or app acceptance.
  Generated-workflow regression and full repo CI-equivalent are required.
- live or dev-integration verification: current Console preparation is read-only;
  no owner request, credential or checkout was created. Reinspect the changed
  exact plan after accepted activation before its first request.
- residual risk: only public synthetic main-based repositories are qualified;
  private/client source and arbitrary branch policies remain unqualified.

## Follow-Up

- required follow-up: owner merge, actual Security index/source acceptance,
  normal activation, real Console bootstrap and remaining end-to-end exercise.
- owner: operator-orchestration-service; Security retains acceptance authority
- due date or closure condition: accepted source plus actual Console plan and
  owner readback; never close Epic1275 from bootstrap checks alone.
