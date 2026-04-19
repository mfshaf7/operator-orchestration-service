---
security_evidence:
  review_areas:
    - runtime
    - delivery
  workstreams:
    - WS-007
---

# 2026-04-20 Doc Surface And Link Hardening

## Summary

The repo’s primary guide no longer treats the old proposed security review as a
current primary entrypoint, and change-record governance now rejects local
filesystem markdown links so git-tracked broker records stay web-safe and
reviewable.

## Classification

- owner repo: `operator-orchestration-service`
- related control planes:
  - `workspace-governance`
  - `security-architecture`
- trust-boundary areas:
  - runtime
  - delivery

## Ownership

- repo-local workflow and contract surface: `operator-orchestration-service`
- workspace doc-link doctrine and cross-repo governance expectations:
  `workspace-governance`
- security review authority and current admitted security posture:
  `security-architecture`

## Root Cause

The broker repo had two documentation-shape inconsistencies: the main README
still surfaced a proposed security review in the primary reading path even
after runtime admission, and one git-tracked change record still used
`/home/mfshaf7/projects/...` markdown links that do not survive outside the
local filesystem.

## Source Changes

- removed the stale proposed-review entry from the primary README guide
- replaced local filesystem links in the `idea-workflow` dev-integration change
  record with repo-relative links
- tightened `scripts/validate_governance_docs.py` so future broker change
  records fail on `/home/mfshaf7/projects/...` markdown links and the README
  fails if the stale proposed-review marker returns
- documented the repo-relative link rule in the change-record lane README

## Artifact And Deployment Evidence

- no image or Argo artifact change
- repo-level governance evidence only

## Live Verification

- `python3 scripts/validate_governance_docs.py --repo-root .`
- `python3 scripts/validate_change_record_requirement.py --repo-root . --changed-file scripts/validate_governance_docs.py --changed-file README.md --changed-file docs/records/change-records/README.md --changed-file docs/records/change-records/2026-04-18-dev-integration-idea-workflow-profile.md --changed-file docs/records/change-records/2026-04-20-doc-surface-and-link-hardening.md`
- `rg -n "\\]\\(/home/mfshaf7/projects/" . --glob '*.md'`

## Follow-Up

- keep historical review artifacts available in `security-architecture`, but do
  not route operators through superseded proposed-state docs as if they were
  current posture
- carry the same repo-link discipline through the remaining owner repos if any
  other change-record lanes still permit local filesystem markdown links
