# Model Profile Request Operator Surface

## Purpose

Use this workflow to request a new governed model profile or a reviewed change
to an existing profile. OOS records and reviews the request. Platform
Engineering implements an approved request in its canonical registry. Security
Architecture accepts or rejects the resulting trust boundary through its own
review.

The workflow is source-complete but inactive. Do not set the enable flag until
the downstream Platform and Security items admit the exact runtime composition.

## Normal API

| Action | Route | Authority and result |
| --- | --- | --- |
| Create | `POST /v1/model-profile-requests` | Operator-bound OOS draft; no lifecycle mutation. |
| List | `GET /v1/model-profile-requests` | Caller-owned request projections only. |
| Read | `GET /v1/model-profile-requests/{request_id}` | Current revision, next action, history, and receipt. |
| Review | `POST /v1/model-profile-requests/{request_id}/commands` | Revision-bound review transition by the bound operator. |
| Fulfill | `POST /v1/model-profile-requests/{request_id}/fulfillment` | Platform-owned implementation evidence after approval. |

Create and review calls require `x-oos-caller-id`, that caller's dedicated
secret, and `x-oos-operator-id`. The operator header must equal the configured
binding for the authenticated caller. Fulfillment uses a separately admitted
Platform caller identity and does not accept operator impersonation.

## Procedure

1. Create one request with a unique `request_id` and `idempotency_key`.
2. For an existing profile, bind the request to its exact profile ID, registry
   artifact digest, and source version. For a new profile, keep both fields
   null.
3. Revise the draft if needed, then submit it at the exact current revision.
4. Start review. Record either requested changes, approval, or rejection.
   Approval and rejection require a durable decision artifact reference.
5. After approval, Platform records `implementing`, then `applied` or `failed`.
   `applied` requires exact base/result versions, reviewed source evidence, and
   a Platform receipt.
6. Read the final OOS projection and the separate authoritative Platform
   profile projection. OOS fulfillment is coordination evidence, not the
   canonical profile lifecycle.

The Governance Operations Console is the intended normal client after its
downstream integration is landed. Direct HTTP use is an engineering and
recovery path.

## Recovery

- On `revision_conflict`, read the request and decide against the new current
  revision; do not blindly retry stale input.
- An exact command or fulfillment replay is safe and does not append history.
  The same identity with changed input is rejected.
- After `failed`, correct the Platform-side cause and record a new
  `implementing` update against the current revision before recording another
  result.
- Corrupt state, a lost transaction lock, missing caller/operator bindings, or
  a missing Platform fulfiller fails closed. Restore the durable state or
  commissioned configuration; do not replace it with an untracked file.
- Rejected and withdrawn requests are terminal. Create a new explicitly linked
  request for materially changed intent.

## Runtime Configuration

Runtime construction requires all of:

- `OOS_MODEL_PROFILE_REQUEST_ENABLED=true`
- `OOS_MODEL_PROFILE_REQUEST_STATE_ROOT`
- `OOS_MODEL_PROFILE_REQUEST_CALLER_OPERATOR_BINDINGS_JSON`
- `OOS_MODEL_PROFILE_FULFILLMENT_CALLER_IDS`

The feature remains disabled by default and its manifest records
`source-complete-inactive`. Platform activation and Security acceptance are
downstream work, not implied by these settings existing.

## Evidence

Each mutation appends an ordered event and a digest-bound receipt containing
the caller, operator where applicable, request revision, review and fulfillment
state, delivery reference, source reference, and prior receipt. The projection
always states `profile_lifecycle_changed: false`.

## Non-Ownership

This surface cannot select providers or models, write the Platform registry,
grant Security acceptance, activate a profile, or enable Temporal definitions.
Those remain with their existing owners.
