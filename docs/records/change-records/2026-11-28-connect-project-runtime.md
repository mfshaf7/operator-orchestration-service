---
security_evidence:
  review_areas:
    - identity
    - delivery
    - runtime
  workstreams:
    - WS-003
---

# Connect Prototype saved source to the shared runtime

## Summary

The existing saved-project command, source executor and Platform transport
are available to the Prototype source workspace when the installation
admits the exact project and setup.

## Classification

Owner maintenance prerequisite for the approved Prototype work group in
Epic #1384. Landing unit `1384-connect-project-runtime`.

## Ownership

The Broker owns draft identity, authorization, the original command, and
filtered run history. Platform owns the current setup and observations.
Prototype custody, private drafts, and the editor's existing Studio preview
retain their current workflows.

## Root Cause

The Stage 2 saved-source command service was exercised as an isolated library,
with no attachment to the authenticated Prototype Source API. The existing
Platform provider is the owner path for the missing connection.

## Source Changes

Add the current setup and history read, exact saved-source Run, and original
command read or reconciliation under the caller-bound source request. The
owner composition supplies admitted project bindings. The browser cannot
submit a project scope, owner path, runtime policy, or credential. Command
history preserves the source and setup identity and never dispatches a run.

## Artifact And Deployment Evidence

The owner tests use an actual Git tree and captured saved revision. They check
setup mismatch, unsaved source, settled versus lost responses, and separation
between the original source request and a different project.

## Live Verification

In an isolated K3s rehearsal the candidate Console server route, Broker and
protected Platform provider refused an unsaved revision, dispatched the
confirmed saved revision once, and read back the expected result from both
the frontend and its same-project API. Normal Console activation remains an
approved later checkpoint.

## Follow-Up

Reverting the Broker attachment hides the shared-runtime actions and leaves
the original command ledger and Studio workflow available for recovery.
