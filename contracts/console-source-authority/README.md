# Console source authority

This contract is the OOS producer side of the Governance Operations Console
source-authority envelope. It projects an existing bounded workflow read into a
uniform authority, identity, revision, ordering, and freshness shape without
changing the workflow's domain payload.

Clients opt in with:

```http
Accept: application/vnd.mfshaf7.console-source-projection+json; version=1
```

The existing `application/json` response remains the default until the Console
cutover is complete. Negotiated responses include `Vary: Accept`.

## Semantics

- `binding.authority` is `operator-orchestration-service`.
- `binding.source_owner` names the actual domain owner, not the Console.
- `binding.record_ref` identifies the canonical record or durable OOS workflow
  record.
- `binding.source_ref` identifies the exact OOS read surface.
- `revision.source_revision` binds the domain revision or a deterministic
  digest of the durable workflow projection.
- `revision.event_sequence` is sourced from a domain version, workflow
  revision, or source timestamp. OOS rejects a projection when no orderable
  coordinate exists.
- freshness is a bounded observation claim. A successful direct owner read may
  be `current`; domain `stale`, `unavailable`, and partial states retain their
  weaker posture.
- receipt bindings copy the exact binding and revision from the accepted
  projection. They cannot be authored for an earlier timestamp.

The envelope does not grant mutation authority, replace domain schemas, or
activate fixture fallback removal. Error responses and mutation responses keep
their existing media type and contract.
