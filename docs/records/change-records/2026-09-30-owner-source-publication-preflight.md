---
security_evidence:
  review_areas:
    - delivery
    - runtime
  reviewed_artifacts:
    - src/owner-source-cli.js
    - src/delivery-art/agent-source-identity.js
    - src/delivery-art/work-session-cli-adapters.js
    - scripts/owner_source_cli.mjs
    - test/owner-source-cli.test.js
  workstreams:
    - WS-007
  findings: []
  risks: []
  notes: "The command reuses the accepted Agent Gary adapter and adds no credential, approval, merge, or repository authority."
---

# Owner Source Publication Preflight

## Summary

Owner-repo maintenance now uses one OOS command surface for Agent Gary source
preflight, author preparation, branch publication, and pull-request creation.

## Classification

- area: Agent source identity and owner-repo maintenance
- type: operator workflow correction
- runtime impact: local engineering source publication only

## Ownership

- owner repo: `operator-orchestration-service`
- related ART slice: None; accepted workspace improvement candidate
- related products or components: Agent Gary source identity

## Root Cause

- immediate failure: a maintenance PR was opened with the ambient human identity
- actual root cause: the normal OOS publisher was reachable only through ART work sessions
- why it escaped earlier controls: owner-repo maintenance had guidance but no bounded executable consumer

## Source Changes

- changed workflow, adapter, or contract: adds the `npm run source -- maintenance` command family and hash-aware credential-root resolution
- tests or validator added: focused session-shape, ready-preflight, and fail-closed tests
- related change records: None

## Artifact And Deployment Evidence

- source-only change: pending pull request
- image tag or digest: None
- runtime revision: None

## Live Verification

- local validation: focused tests and governance validation required before review
- live or dev-integration verification: publish this change through the corrected Agent Gary path
- residual risk: Platform still owns credential issuance and human review and merge remain mandatory

## Follow-Up

- required follow-up: update and install Workspace Governance source-implementation guidance
- owner: `workspace-governance`
- closure condition: the improvement candidate links the merged controls and the installed skill is current

## Rollback

Remove the maintenance command and restore explicit `OOS_AGENT_SOURCE_IDENTITY_ROOT`
configuration. Existing source history and non-secret Platform receipts remain
authoritative.
