---
security_evidence:
  review_areas: [runtime, delivery]
  workstreams: [WS-007]
  findings: []
  risks: []
  reviewed_artifacts:
    - src/delivery-art/service.js
    - src/delivery-art/work-session-service.js
    - src/delivery-art/work-session-store.js
    - src/delivery-art/source-executor.js
    - src/source-authoring/source-text-patch.js
    - src/openproject-client.js
  notes: Composed review covers the exact owner revisions, private draft custody, source-lease enforcement, and the narrow registry read.
---

# Console Delivery recovery and source editing

## Summary

Recover original Delivery commands and private source drafts across timeout,
plan revision and Work Session replacement. Verify plan impact before writing
the current plan and reconcile storage ahead of projection on a fresh retry.
Expose bounded section editing in the existing private source editor.

## Classification

Operator-approved maintenance in the existing Console batch. The Broker's
changes form one landing unit.

## Ownership

The Workspace Governance contract and the
WGCF registry implement the exact-subject read used during Technical Plan
recording. The Broker owns command and source-draft readback. Platform owns
source credentials and Console session projection. The Console owns
presentation and operator interaction.

## Root Cause

A response timeout obscures an already-retained command. A draft stored
ahead of an interrupted projection also becomes the registry's current
custody predecessor before it appears as the active work-package plan.
Editor reads flattened a known dirty baseline into a generic failure.

## Source Changes

Recover command receipts by original command identity. Stage Work Session
replacement before changing the active alias. Recheck scope and plan impact
before recording a revised plan. Retain editor adjustments with the exact
baseline digest and original text range.

## OpenProject Contract

The existing writable work-package description carries the current Technical
Plan reference. The Broker still submits it through the existing optimistic
work-package write with the observed version. The new predecessor and impact
checks run before that write. A canonical read that already shows the requested
plan returns its acknowledgement. No additional OpenProject field is needed.
The disposable OpenProject composition accepted the initial and successor
plan records and read both back through the Console. A competing approval
preserved the active description and returned an explicit conflict.

## Artifact And Deployment Evidence

The existing caller and operator scope, exact source revision, private
retention, and source lease bind all editing and acknowledgement paths.
The disposable Console and Broker rehearsal retained and replayed the
original save after session renewal, rejected uncommitted source and a
stale section, and read back an exact saved draft against the clean Git base.
Real Git and snapshot tests also verify result bytes and replay. The
production activation uses the paired Security decision and supported
Platform procedure for these reviewed revisions.

## Live Verification

After scoped or composed activation, verify normal Console readback, source
binding, command recovery and current runtime observations. Exercise source
writes and rollback in the disposable installation.

## Rollback

Reconcile pending session replacements and retain their predecessor drafts
before rolling back. Resolve active section drafts with a Broker and source
executor that understand their representation. Use the prior accepted owner
revisions and preserve the original Work Sessions and approval evidence.

## Follow-Up

Record the reviewed source identities and the rollout and rollback results
with the paired composed Security decision.
