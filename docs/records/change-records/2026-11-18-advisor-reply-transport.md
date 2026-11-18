---
security_evidence:
  review_areas: [runtime, delivery, ai]
  reviewed_artifacts:
    - contracts/work-design/assist-result.schema.json
    - contracts/agent-console/model-response.schema.json
    - src/advisor-draft-reply.js
  findings: []
  risks: []
  workstreams: [WS-007]
  notes: "Pending maintenance source. Composed Security acceptance and activation remain separate."
---

# Complete structured advisor reply transport

## Summary

A valid native tree reply was rejected after encoding because the Work Design
compatibility text field retained the smaller human-message limit. The shared
Agent Console wrapper and Console decoder had different smaller aggregate limits.
Landing Unit Decision: `feature_single_landing_unit`,
`advisor-reply-transport-20261118`. This is approved maintenance of existing
advisors, separate from project runtime implementation; no ART items are added.

## Classification

Approved maintenance of existing advisor reply delivery. No new architecture
capability, ART work or model authority is introduced.

## Ownership

OOS owns response interpretation/contracts; Console owns validated local drafts;
Platform owns provider schemas and invocation custody; Security retains exact
composed-source acceptance.

## Root Cause

Native typed edits were serialized into legacy human-text wrappers, whose
aggregate limits were smaller than valid structured replies. The browser applied
a third incompatible limit after successful transport.

## Source Changes

Align the existing structured reply transport at 128,000 characters across OOS
Work Design, shared Agent Console and the Console consumer. Validate aggregate
size before returning a decoded native reply. Native human messages, selected
field permissions and lengths, read-only controls, typed patches, atomic draft
application and final operator decisions retain their existing validation.
No provider schema, credentials, model route or execution permission is changed.

## Artifact And Deployment Evidence

Synthetic large typed tree replies traverse native decoding and both OOS result
contracts; oversized replies and human messages still fail. Console validation
and native-form application/undo use synthetic data and do not invoke a provider.
Private completed-reply diagnosis establishes the actual failed size boundary;
it is kept outside this public repository. No completed inference is repeated.

## Activation And Rollback

Publish this repair with the coupled Console batch. Land OOS before its
Console consumer and obtain exact composed Security acceptance before activation.
Until then, source tests do not establish live qualification. Retain original
provider records, drafts and finalized history. Rollback restores the prior
accepted source set and never regenerates a completed model response.


## Live Verification

The actual retained provider reply decodes successfully and passes its tree
transaction. The old OOS contract rejects only the encoded text length. The old
Console decoder independently rejects aggregate reply size. Source repair has
not been activated; native live acceptance remains pending.

## Follow-Up

Complete owner/consumer validation, publish only with the batch checkpoint,
record composed Security acceptance and normal activation evidence, then retire
exact branch/worktree and source credentials. Do not repeat completed inference.
