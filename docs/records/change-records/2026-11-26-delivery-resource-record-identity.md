---
security_evidence:
  review_areas: [delivery, runtime]
  findings: []
  risks: []
  workstreams: [WS-007]
  reviewed_artifacts:
    - contracts/delivery-art/delivery-art-work-session-resource-manifest.schema.json
    - contracts/delivery-art/delivery-art-work-session-cleanup-receipt.schema.json
    - test/delivery-art-work-session-resource-retirement.test.js
  notes: The approved plan group identifier is preserved through resource manifest and cleanup receipt validation. Close intent, exact session ownership and evidence requirements are unchanged.
---

# 2026-11-26 Delivery resource record identity

## Summary

Keep the approved Technical Plan group ID through work-session resource tracking
and terminal cleanup. The recorded session's worktree and branch identity are
carried through the same fields at each step.

## Classification

- Area: Delivery work session and cleanup.
- Type: contract compatibility repair.
- Runtime impact: resource manifests and cleanup receipts accept the same
  Landing Unit identifiers as approved plans.

## Ownership

- Owner repo: `operator-orchestration-service`.
- Related ART slice: shared project development runtime, Stage 2.
- Contract owner: `workspace-governance`.

## Root Cause

The resource manifest and terminal receipt each used the older item-derived
Landing Unit grammar. The session had already accepted the ID from the approved
Technical Plan. Resource-manifest validation stopped the continuation response
after the compatible plan binding was saved. The previous test path used
item-derived IDs throughout.

## Source Changes

- Synchronize both artifacts from the authoritative Delivery ART contract.
- Exercise the existing Git retirement and recovery path with an approved
  plan group, including manifest and terminal receipt readback.
- Preserve exact session binding, explicit close intent, reachable merged
  evidence, and ownership checks from the existing resource-retirement review.
  [Resource retirement security review](https://github.com/mfshaf7/security-architecture/blob/main/docs/reviews/components/2026-08-23-delivery-art-work-session-resource-retirement.md)

## Artifact And Deployment Evidence

Candidate source only. No runtime revision has been activated.

## Live Verification

- The prior schema rejected the approved plan group in a disposable Git lifecycle
  test. The candidate schema passed the same path through terminal cleanup.
- Console preview sent Prepare Source Workspace through the normal API to a
  disposable broker and Unix source executor. The exact Git worktree and
  resource manifest were created and read back under the same named group.
  The rehearsal used seeded work state and a local source-access substitute.
- Live readback confirmed that the compatible plan binding took effect on the
  original session. The updated live source composition awaits activation.

## Follow-Up

Land the authoritative Workspace Governance change first, then synchronize the
broker from the merged contract revision. Keep the exact resource and cleanup
readback with the activation evidence.
