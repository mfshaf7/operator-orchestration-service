# Product Publication Workflow v1

## Purpose

OOS owns the bounded request journal, idempotency boundary, and terminal owner
receipt for Product Publication. It consumes Workspace Governance vocabulary
and WGCF readiness; it does not become product, lifecycle, source, release,
runtime, or Security authority.

The local bundle in `contracts/product-publication/manifest.json` pins the
merged Workspace Governance contract at `213b9fed48f8bd0e6e6fd658bfeae38cfd9e3784`
and the WGCF evaluator at `d12545242fed839df3bce65ad4dd5d6482e7854a`.
Copied packet, receipt, evaluation, and readiness schemas retain the exact
owner bytes and digests.

## Command And Evidence

One `product-publication-command` binds:

- one caller-bound operator and affirmative operator decision;
- one request ID and idempotency key;
- one exact Workspace Governance authority revision;
- one product source revision plus the later manifest revision and exact
  manifest digest;
- current and target publication posture;
- the exact prior terminal receipt and expected version after initial
  publication;
- a digest- and revision-bound Security decision reference.

OOS derives the WGCF evaluation and request digests. Callers cannot supply
those digests. OOS submits the evaluation, rereads the caller-scoped durable
WGCF receipt, and verifies the configured issuer, authority revision, request,
manifest, target, digest, URI, and expiry before journaling a result.

## State And Replay

The durable journal serializes each request under a process-safe transaction
lock. Request IDs and caller-scoped idempotency keys bind immutable command
content. An exact replay returns the original packet and receipt. Reusing
either identity for different content fails closed.

Applied publication advances the product's publication version exactly once.
Every later request must bind the current receipt ID, digest, version, and
posture. Stale or contradictory evidence cannot advance the version. A valid
WGCF `stale` or `blocked` outcome produces a terminal `rejected` receipt with
no applied version or posture.

## Output

OOS emits the Workspace Governance publication packet and terminal receipt,
plus the receipt's canonical digest and OOS owner URI. All five cross-boundary
grants remain `false`. The Console may render this projection but cannot use it
to infer source custody, runtime activation, release approval, Security
acceptance, or lifecycle mutation.

## Activation

The source contract is complete but runtime activation is `false`. Security
work item `#1257` must accept the exact revision and Platform work item `#1258`
must commission the configuration and live proof before the runtime may be
enabled.
