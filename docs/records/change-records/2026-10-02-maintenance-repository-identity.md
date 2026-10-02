---
security_evidence:
  review_areas:
    - delivery
    - runtime
  reviewed_artifacts:
    - src/owner-source-cli.js
    - test/owner-source-cli.test.js
  findings: []
  risks: []
  workstreams:
    - WS-007
  notes: "The correction narrows repository identity to the admitted GitHub origin; it does not change credentials, publication authority, or deployed runtime behavior."
---

# 2026-10-02 Maintenance repository identity

## Summary

Derive owner-repository maintenance identity from the checkout's GitHub
`origin` instead of the physical worktree directory name.

## Classification

- area: Agent source maintenance workflow
- type: corrective maintenance
- runtime impact: source operator CLI only; no broker API or deployed runtime change

## Ownership

- owner repo: `operator-orchestration-service`
- related ART slice: None; operator-approved owner-repo maintenance recovery
- related products or components: Agent Gary source implementation workflow

## Root Cause

- immediate failure: `maintenance prepare` rejected valid linked worktrees whose directory basename did not equal the admitted repository name.
- actual root cause: `src/owner-source-cli.js` populated `session.owner_repo` with `path.basename(repoRoot)` instead of repository identity from Git.
- why it escaped earlier controls: tests used a checkout directory whose basename happened to equal the repository name.

## Source Changes

- changed workflow, adapter, or contract: maintenance preparation now resolves the exact GitHub repository from `origin`; the existing Agent source preflight remains the admitted-inventory authority.
- tests or validator added: regression coverage uses a descriptively named linked worktree and rejects a remote outside the admitted GitHub owner.
- related change records: None

## Artifact And Deployment Evidence

- source-only change, or build/deployment evidence: source-only CLI correction
- image tag or digest: None
- runtime revision: None

## Live Verification

- local validation: `npm test`; `npm run validate:governance`; base-aware change-record validation against `origin/main`
- live or dev-integration verification: run `maintenance status` from a descriptively named linked worktree after landing
- residual risk: non-GitHub maintenance origins remain intentionally unsupported by the GitHub App source workflow

## Follow-Up

- required follow-up: close the linked improvement-candidate signal after the landed command succeeds from a descriptive worktree
- owner: `operator-orchestration-service`
- due date or closure condition: exact merged-head live verification passes
