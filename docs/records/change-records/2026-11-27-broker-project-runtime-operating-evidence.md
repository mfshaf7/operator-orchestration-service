---
security_evidence:
  review_areas: [delivery, runtime]
  workstreams: [WS-007]
  findings: []
  risks: []
  reviewed_artifacts:
    - contracts/delivery-art-work-session/evidence-profile.json
    - scripts/project-runtime-rehearsal/recover-in-flight.py
    - scripts/project-runtime-rehearsal/recover-in-flight.mjs
    - scripts/verify_project_runtime_rehearsal.mjs
  notes: The named operating checks read bounded private rehearsal results tied to the exact reviewed Broker and paired Platform revisions. The disposable rehearsal is separate from evidence acquisition.
---

# Verify the Broker project runtime operating cases

## Summary

Stage 2's two Broker operating cases require an observed restart recovery and
source and replay rejection. The general repository test command does not
observe the isolated Platform runtime. Bind the two approved cases to
read-only verification of the retained rehearsal result.

## Classification

- Area is shared project development runtime.
- Type is a verifier repair for the existing source-command foundation.
- Landing Unit Decision is `feature_single_landing_unit`.

## Ownership

Operator Orchestration Service owns source capture, durable command recovery
and the named verification commands. Platform owns sandbox admission and
runtime observations. The Console requests existing operating acquisition.

## Root Cause

The prior profile used a general suite for any sandbox fidelity case. The
approved source foundation adds specific cases that require observed command
and source state across an independent Platform execution.

## Source Changes

- Reuse the paired sandbox rehearsal with one disposable Broker process loss.
  Observe the same operation and materialized source under a fresh process
  and require one original dispatch.
- Exercise rejected source and replay inputs and verify the previously
  qualified source and owner state remain intact.
- Record the results after namespace cleanup. The profile's named commands
  verify receipt integrity, source identity and the required observations.

## Artifact And Deployment Evidence

The operating verifier is selected from the exact reviewed Broker revision.
Prior merge-ready evidence and the paired Platform receipt retain their own
revisions. Use the existing evidence-preserving recovery for the already
merged session and the admitted runtime release procedure for Console use.

## Live Verification

The disposable proof checks the original Run through Broker process exit,
source materialization and result readback. It verifies six rejected inputs
with zero dispatches and verifies cleanup. Run the exact reviewed rehearsal
and confirm both named results through the normal Console closeout action.

## Follow-Up

Record the verification outcome and retire the retained source resources
through the existing Landing Unit closeout.
