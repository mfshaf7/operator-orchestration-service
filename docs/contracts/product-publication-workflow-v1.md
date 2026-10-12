# Product Publication Workflow v1/v2

## Purpose

OOS owns the bounded request journal, idempotency boundary, and terminal owner
receipt for Product Publication. It consumes Workspace Governance vocabulary
and WGCF readiness; it does not become product, lifecycle, source, release,
runtime, or Security authority.

The local bundle in `contracts/product-publication/manifest.json` pins the
merged Workspace Governance contract at `06b954b31466f9779dce8ec54f722f348b885505`
and the WGCF evaluator at `9d3e5ef1b8fafac1bf0970a7d997021c37052535`.
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

Schema v2 additionally preserves the exact Workspace Inventory lifecycle
receipt and append-only history event supplied by WGCF. `archive` requires the
owner lifecycle transition to `retired`; `restore` requires the owner lifecycle
`restore` event and may only move publication from `archived` to `unlisted`.

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

The versioned `maintenance_projection` keeps lifecycle state, publication
posture, owner routing, evidence findings, and bounded publication history as
independent fields. Operational product health is deliberately reported as
`not-projected`; Platform owns that separate source. History retains at most 50
ordered immutable events and each schema-v2 event carries the exact Workspace
Inventory receipt and history-event references.

## Activation

The internal-only baseline is source-active and commissioned in the loopback
`dev-integration` profile. OOS carries inactive validation support for every
Workspace Governance posture tuple and legal action transition, but
`contracts/product-publication/manifest.json` remains the source activation
gate and currently admits only `internal` as a target.

The manifest binds
`security-architecture://product-publication/decisions/audience-internal-only-v1`
at exact digest and merge revision. Security `#1262` approved no widening, so
`unlisted`, `client`, `public`, and `archived` remain inactive targets.
Capability support is not publication approval. Any future expansion requires
a fresh exact-revision Security decision, a separate reviewed OOS manifest
change, and Platform commissioning before it becomes live. The owner-manifest
binding is publication evidence; neither it nor a publication receipt grants
product access.

Schema-v2 `archive` and `restore` validation and projection support are present
but separately source-inactive. The manifest keeps
`lifecycle_maintenance.runtime_activation` false and `allowed_actions` empty
until Security `#1271`, OOS activation `#1272`, and Platform commissioning
`#1273` complete. Restoration means only `archived` to `unlisted`; it never
restores runtime, release, access, or Security acceptance.
