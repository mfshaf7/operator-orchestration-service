---
security_evidence:
  review_areas: [delivery]
  findings: []
  risks: []
  workstreams: [WS-007]
  reviewed_artifacts:
    - src/platform-operation/source-credentials.js
    - scripts/source_credential_openapi_schemas.mjs
    - test/source-credential-authority.test.js
  notes: The broker and its API schema preserve the same approved work group identifier across source preparation, issue, receipt and session binding.
---

# Source authorization for recorded Delivery groups

## Summary

Match the bounded Delivery group identifier accepted by the Platform source
issuer. Preserve the identifier and approved scope across source preparation,
explicit issuance, receipt readback and binding to the source session.

## Classification

OOS owner maintenance. The Landing Unit Decision is
`feature_single_landing_unit`.

## Ownership

OOS owns source intent binding and readback. Platform owns credential
issuance. The recorded Delivery decision supplies the work group identifier.

## Root Cause

The credential adapter's identifier validation still accepted only the older
unqualified identifiers. It rejected an otherwise valid recorded work group
after source admission and repository verification had already succeeded.

## Source Changes

Use one bounded identifier pattern in the broker and in its generated OpenAPI
schemas. Check a recorded group through preparation, approval, issuance,
receipt and session binding. Exact repository, approval, branch, digest and
session checks continue to protect source operations.

## Live Verification

Use the approved plan through the normal Console work-start flow. Read back
the original group and its source authorization, then verify the source
session is bound to both.

## Artifact And Deployment Evidence

Review the exact broker and Console revisions together before normal Platform
activation.

## Follow-Up

Keep the work-start readback with the existing Delivery evidence.
