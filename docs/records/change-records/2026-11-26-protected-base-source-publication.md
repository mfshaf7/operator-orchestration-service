---
security_evidence:
  review_areas: [identity, delivery]
  workstreams: [WS-007]
  findings: []
  risks: []
  reviewed_artifacts:
    - src/delivery-art/agent-source-identity.js
    - test/delivery-art-agent-source-identity.test.js
  notes: The inherited history exclusion uses a provider-verified protected branch in the exact admitted repository. Every branch-specific source commit still requires the existing Gary identity.
---

# Protected base advancement in Agent Gary publication

## Summary

Continue an existing source branch when the owner repository requires it to
contain newer protected main. Keep the source session and its review history.

## Classification

Owner maintenance on the existing publisher. The Landing Unit Decision is
`feature_single_landing_unit`. This unblocks the already-approved Stage 2
Broker source in [PR #433](https://github.com/mfshaf7/operator-orchestration-service/pull/433).

## Ownership

OOS owns source verification and publication. GitHub supplies protected
branch state. Platform supplies the existing repository-scoped source lease.

## Root Cause

GitHub requires the PR branch to contain the current protected main commit.
OOS previously treated all commits after the recorded session base as
new work. This included commits already merged into protected main.

## Source Changes

- Keep the original session base, clean branch and exact repository checks.
- Verify the provider's current protected main when inherited history would
  otherwise fail attribution. Prove that it lies between the approved base
  and proposed head using the actual Git history.
- Verify the Gary author and committer on every commit outside that history.
  Ordinary pushes stay non-force and all review remains bound to the new head.

## Artifact And Deployment Evidence

Verify source in the Broker repository and rehearse the exact publication
boundary. Activate the reviewed source executor through its existing Platform
owner path before repeating the blocked live operation.

## Live Verification

Confirm the original PR stays attached to its work session. Verify the new
head includes current main, required GitHub checks pass, source contains only
the intended change, and the Console shows the exact review and merge result.

## Follow-Up

Keep branch freshness and the confirmed merge result visible in the Console.
Carry the existing presentation findings into the workflow batch.
