# Dev Integration profiles

Status: source implemented and locally validated; not commissioned.

OOS provides the Console's authenticated profile read and request adapter.
Workspace Governance retains admission; Platform and profile owners retain runtime
observations and effects. A request is recorded directly by OOS for the existing
Dev Integration workflow. It does not create a Proposal or ART item, register,
admit or launch a profile.

## Bounded API

- `GET /v1/dev-integration/profiles`: current owner registry and safe declared
  profile metadata, with bounded pagination and source identity. Reading performs
  no runtime probes, command execution, reset, admission or credential issuance.
- `GET /v1/dev-integration/profiles/{profile_id}`: one safe owner profile.
- `POST /v1/dev-integration/requests`: a closed structured request, stable
  request ID, reviewed registry version and explicit operator approval.
- `GET /v1/dev-integration/requests`: caller-bound retained request history.
- `GET /v1/dev-integration/requests/{request_id}`: original intent, native
  request reference and recording receipt, plus independent admission readback.

Profile responses carry `schema_version`, `source_version`, `observed_at`,
`profiles`, `request_options` and `page`. Unknown owner fields are null, not
fabricated from sample defaults. Runtime observations carry their own time and
source and do not follow admission or a successful Start receipt. The finite
Platform operation catalog independently determines executable controls.

Request input is `{request_id, expected_source_version, request, approval}`.
The request contains profile identity, owner, purpose, lane, participating repos,
runtime platform/state model, dependencies, expected writes, review triggers and
any persistent-data contract. Caller/operator, time, backend target and source
identity are server-owned. The same ID cannot change its intent. Server validation
uses current owner choices before the first recording. A recorded request can be
read after the registry changes without creating another request.

OOS retains the canonical structured request and recording receipt in its existing
private file transaction boundary. The immutable identity binds its caller,
operator, source and exact intent. One atomic, fsynced per-caller record is also
the history row; reads do not depend on an external create or a second business
record. Replaying the same request returns its original receipt, including after
restart. Unknown transport acknowledgement is recovered by original identity.

The receipt outcome is only `request-recorded`. Admission readback follows the
current Workspace Governance profile only when both profile ID and original
`request_record.ref` match. A matching name alone cannot adopt another request's
admission. Registry unavailability does not hide the durable request. History is
paged without probing admission for every row; original-request inspection reads
admission on demand.

## Recovery and rollout

Unavailable owner data disables new submission and retains original history.
Stale source requires a fresh review. Unsupported profile operations remain
unavailable even when the profile appears in the registry. No browser-selected
host paths, shell commands, provider destinations or credentials are accepted.

The adapter is staged behind the existing admitted Platform-operation runtime.
Exact owner-source Security acceptance, composition and native Console operating
proof must precede activation. Rollback disables the adapter and retains its
native requests and recording receipts. Historical Proposal/document references
on already registered profiles remain intact; they do not route new requests.
