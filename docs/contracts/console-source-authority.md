# Canonical Console source readback

OOS exposes a versioned canonical readback envelope for authenticated
Console-facing workflow reads. The envelope is additive: callers that request
`application/json` continue to receive the existing domain projection, while a
caller requesting
`application/vnd.mfshaf7.console-source-projection+json; version=1` receives
the same projection under the machine contract in
`contracts/console-source-authority/`.

A vendor-only request for an unsupported or omitted version fails with a
bounded `406 source_projection_version_not_acceptable` response. A request
that also permits `application/json` falls back to the compatible domain
projection.

The shared HTTP boundary owns negotiation and fail-closed construction. Domain
services continue to own their workflow records, revisions, events, and
receipts. Route handlers only provide the domain owner and canonical record
coordinates that cannot be inferred safely.

The negotiated contract is available on current projection reads for:

- Proposal projection and history
- Delivery Work Design, Refinement, Catalog, change control, closeout, and work
  sessions
- Workspace Intake and Workspace Inventory workflow projections
- Prototype Landing, Maturity, and Closure workflow projections
- Repository Custody and Repository Lifecycle workflow projections
- durable orchestration run projection

OOS returns `source_authority_invalid` with `502` when a requested canonical
projection lacks exact binding, revision, ordering, or timestamp evidence. It
does not downgrade to an unbound response. Default JSON compatibility remains
in place only to sequence the OOS producer change ahead of the Console consumer
cutover.
