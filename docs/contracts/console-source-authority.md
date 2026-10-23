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

Work Design and Refinement packet reads are aggregate observations: they carry
history and a per-read `projected_at`, not only the input ART record. Their
envelope uses the existing full-projection digest and projection-time ordering.
The input record version remains unchanged inside the domain projection for
optimistic mutation checks. An unchanged input version therefore does not stamp
different observations with one event sequence. Consumer integrity and replay
checks remain unchanged; this adds no counter, ledger or protocol version.

Work-session status likewise uses the full observation digest and read time.
The valid `decision-required` response has no session revision; an ordinary
session exposes `session_revision`, not `updated_at`. Neither case requires a
source-authorization binding before read access. The nullable domain session
revision remains the exact command concurrency token. Read envelopes do not
start a session, synthesize a command revision or grant source authority.

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
