# Product Publication Operator Surface

## Purpose

Use this workflow to record an operator-approved, readiness-backed decision to
list, update, unlist, or archive a product in a governed portfolio projection.
OOS owns the journal and terminal receipt. Workspace Governance owns the
contract, the product repo owns its lifecycle evidence, WGCF owns readiness,
Security owns acceptance, and the Console only submits intent and renders the
result.

Security `#1257` approved the exact source boundary and the OOS and WGCF source
gates are active. The surface remains unavailable until Platform `#1258`
composes and proves the exact activated revisions.

## API

| Action | Route | Result |
| --- | --- | --- |
| Submit or replay | `POST /v1/product-publications` | Exact WGCF readback, publication packet, and immutable terminal OOS receipt. |
| Read | `GET /v1/product-publications/{request_id}` | Caller-owned receipt projection and exact next action. |

Submit requires caller-specific `x-oos-caller-id` and
`x-oos-caller-secret` credentials plus `x-oos-operator-id`. The operator must
match the commissioned caller/operator binding.

## Procedure

1. Commit the product source snapshot named by `owner_revision`.
2. Commit the owner manifest at a later `manifest_revision`; that commit must
   descend from the product source snapshot.
3. Submit one command containing both revisions, the exact committed manifest
   digest, current publication state, target tuple, operator decision, and
   exact Security decision reference.
4. OOS obtains and rereads WGCF readiness. It returns `applied` only when the
   evidence is current and ready. `stale` or `blocked` readiness returns a
   terminal `rejected` receipt and does not advance the version.
5. Read the OOS receipt. After Console `#1256` lands, refresh the Console's
   authoritative projection from this same API.

For an update, unpublish, or archive command, use the latest OOS receipt ID,
digest, version, and posture. Do not reconstruct those values from Console
display state.

## Recovery

- Exact replay is safe and returns the original receipt.
- `idempotency_conflict` means an identity was reused for changed content;
  create a new request identity after correcting the command.
- `publication_version_conflict` means the prior receipt or posture is stale;
  read the current request chain and submit a new command against it.
- `readiness_expired` or `readiness_mismatch` requires fresh WGCF evidence;
  never bypass the readback or replace it with a copied payload.
- Storage integrity or lock failure is a hard stop. Restore the journal; do
  not manufacture a replacement receipt.

## Runtime Configuration

After Security approval and both owner-source activations, Platform runtime
construction needs:

- `OOS_RUNTIME_PROFILE=dev-integration`
- `OOS_PRODUCT_PUBLICATION_ENABLED=true`
- `OOS_PRODUCT_PUBLICATION_STATE_ROOT`
- `OOS_PRODUCT_PUBLICATION_CALLER_OPERATOR_BINDINGS_JSON`
- `OOS_PRODUCT_PUBLICATION_SECURITY_DECISION_URI`
- `OOS_PRODUCT_PUBLICATION_SECURITY_DECISION_DIGEST`
- `OOS_PRODUCT_PUBLICATION_SECURITY_DECISION_REVISION`
- `WGCF_PRODUCT_PUBLICATION_BASE_URL`
- `WGCF_PRODUCT_PUBLICATION_CALLER_ID`
- `WGCF_PRODUCT_PUBLICATION_CALLER_SECRET`
- `WGCF_PRODUCT_PUBLICATION_IMPLEMENTATION_REF`
- `WGCF_PRODUCT_PUBLICATION_SERVICE_IDENTITY_REF`

Configuration alone does not override the reviewed profile, source scope, or
Security decision binding. Missing or partial configuration still fails closed.
The three Security values are one exact reviewed decision binding; OOS rejects
a command when its URI, SHA-256 digest, or full Git revision differs before it
contacts WGCF or writes journal state.

The initial source-owned activation scope admits only the `internal` target
posture. OOS rejects `client`, `public`, `unlisted`, or `archived` targets
before WGCF access or journal mutation. Expanding that set requires another
reviewed source revision and Security decision; Platform configuration cannot
broaden it.
