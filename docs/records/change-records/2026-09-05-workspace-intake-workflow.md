---
security_evidence:
  review_areas:
    - identity
    - secrets
    - delivery
    - runtime
  reviewed_artifacts:
    - contracts/workspace-intake
    - src/workspace-intake
    - src/app.js
    - src/config.js
    - src/runtime.js
    - scripts/workspace_intake_source.py
    - docs/api/openapi.json
  findings: []
  risks: []
  workstreams:
    - WS-007
---

# Workspace Intake Reviewed Workflow

## Summary

ART #1064 under #1061/#890 implements source-bound intake acknowledgement,
readiness, source preparation, review wait, merge readback, cancellation,
replay and recovery behind caller-bound OOS APIs.

## Ownership

Workspace Governance retains policy, deterministic mutation and canonical
merged YAML. WGCF provides non-mutating readiness. OOS coordinates one durable
workflow and source review. Platform supplies exact-repository credentials.
Security #1066 and Platform #1082 retain activation authority. The Console
consumes OOS rather than owning this state machine.

## Classification

Source-only workflow, identity, delivery and runtime change; isolated Landing
Unit `delivery-890-intake-workflow`. No runtime activation or OpenProject
business mutation is included.

## Root Cause

The intake contract and non-mutating evaluator did not yet have an OOS-owned
review-and-readback workflow. Operators otherwise had to coordinate source
preparation and completion themselves.

## Source Changes

- Pinned Workspace Governance v2 and WGCF readiness contracts are byte checked.
- Python-compatible canonical JSON is distinct from ART's RFC 8785 format.
- Accepted caller, request, decision, session and execution stay immutable.
- Source preparation invokes the committed owner command in a temporary clone.
- Git credentials never enter subprocess arguments or workflow records.
- Provider access rejects PATs, broader repository selection and redirects.
- No auto-merge or direct-main write exists.
- A reviewed canonical merge and matching record digest precede success.
- Cancellation and dependency failures preserve evidence and replay identity.
- Durable single-host coordination uses atomic writes, fsync and kernel locks.
- Runtime activation remains false; this record does not claim Security
  acceptance, provider activation, or live composed proof.

## Artifact And Deployment Evidence

Source and validation evidence bind the exact reviewed OOS head in its Review
Packet. The activation manifest remains false. No live deployment is claimed.

## Live Verification

Focused contract, service, API and client regressions cover acknowledgement,
identity binding, stale/conflicting input, corruption, cancellation and bounded
dependencies. The source conformance runner exercises a real Git review and
merge, exact-head denial, process death after remote acknowledgement and
restart without a duplicate change. Full OOS tests, API validation and runtime
image proof are recorded at the exact reviewed head in the Review Packet.

The OpenProject business mutation surface is unchanged. Existing ART commands
are used only to track #1064; this capability changes Workspace Governance
through review, not OpenProject schemas or forms.

## Follow-Up

Disable/revert this OOS Landing Unit while retaining workflow state, receipts
and merged authority history. Do not delete evidence or rewrite Git history.
The approved follow-ups are #1065 identity definition, #1067 source adapter,
#1068 Console adapter, #1066 Security review, #1082 activation and #1069 live
conformance. No stage or production authority is introduced.
