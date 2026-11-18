---
security_evidence:
  review_areas: [ai, runtime, delivery]
  findings: []
  risks: []
  workstreams: [WS-007]
---

# Refinement field authority and advisor context

## Summary

Operator-approved maintenance, with no new ART child or improvement candidate.
Landing Unit Decision: `child_isolated_landing_unit`,
`refinement-advisor-context-20261119`. OOS has its own review/runtime rollback
boundary; Gary authors and the standing delegated human reviews. Publication is approved alongside Console and CGG; source landing alone does
not activate the repair.

## Root Cause

The native String form adapter was used without the existing Catalog value
authority. Advice also required an entire grouped field scope, while Console
supported an individual item or selected subset. Selected source values, related
unsaved drafts and canonical planning counterparts did not share one complete
validated request. The repair reuses Catalog, validates exact subsets, carries
bounded typed drafts as unaccepted context and retains canonical planning facts.
Invalid selectors, numbers, dates, references and PI/Iteration combinations
cannot become accepted values merely because a model suggested them.

## Artifact And Deployment Evidence

See the [paired source review](https://github.com/mfshaf7/security-architecture/blob/main/docs/reviews/components/2026-11-19-refinement-advisor-context.md).
No identity, secret, provider, final-decision tool or canonical writer is added.
CGG remains the context admission boundary; the operator accepts final Apply.
Focused tests cover subsets, stale/foreign/blocked scope, mixed values, related
drafts, Catalog options/outage, reserved buckets and planning/date/reference
validation. Full owner, API and bundle checks are retained with the local review
evidence. Synthetic replies do not prove native model quality.

Publication sequencing is CGG, OOS, Console, then exact-source composed acceptance
and activation. The generated Security owner-record index must follow merged
owner records; it cannot certify this unpublished work in advance. Source closeout
and branch cleanup remain deferred with publication, not silently completed.

## Classification

Explicitly approved maintenance of the existing Refinement workflow, outside
new ART decomposition. Existing Catalog and admission/runtime paths are extended.

## Ownership

OOS owns field/request semantics and canonical validation. CGG owns admission;
Console owns the form; Platform owns Catalog and model/runtime policy; Security
owns the paired source review. No owner boundary is transferred.

## Source Changes

The source adapter consumes current Catalog options once per projection.
Canonical planning snapshots and related typed drafts support exact-subset
advice; source, choice and draft changes are digest-bound. Validation runs
before durable Apply effects and against model proposals independently.

Follow-up source inspection reproduced three related gaps: old-handoff completion
reused for a new pass, per-record choices lost to a whole-group intersection, and
Integer form constraints lost before a prefix-parsing writer. New run projections
retain source handoff identity. Per-record choice maps survive packet, selected
advice context and accepted-value validation; native integer typing and strict
pre-effect writer parsing prevent truncation. Console consumes the same facts and
retains original receipt evidence without synthesizing accepted payload values.

## Live Verification

Only read-only current Console/Catalog projections were inspected. Existing
String forms coexist with Catalog-backed values. No model invocation or live
Apply was used for source proof. Paired live behavior requires later activation.

## Follow-Up

Publish the operator-reviewed batch. Run committed
base-aware owner checks, sequence dependencies, update the generated Security
record index after owner merges, qualify the native advisor, then clean branches.


## Native Unicode wire binding follow-up

Native publication qualification loaded the real packet but rejected the admitted
response: CGG hashes ASCII-escaped canonical JSON, while Refinement compared UTF-8
ART digests. The actual owner narrative contains PM². ASCII-only synthetic tests
missed the mismatch. The existing lifecycle wire digest is now shared, retaining
its public lifecycle export and using that same encoding at all three Refinement
CGG digest boundaries. ART/run/receipt/idempotency custody remains unchanged.
No integrity check is removed or dual-encoding fallback added. Source text is
preserved, including non-Latin and supplementary characters.

Operator-approved maintenance, Landing Unit Decision
`child_isolated_landing_unit`, `refinement-wire-digest-oos-20261119`. Independent
Python serialization and the actual CGG HTTP response qualify digest parity and
unchanged denial behavior before publication. Full owner validation and exact
composed Security acceptance precede normal activation and native advisor proof.
The original Epic 1384 Work Design and Refinement Apply must not be replayed.
