# Model Profile Request Contract v1

## Purpose

This contract defines the OOS-owned request and review protocol for governed
model profiles. It records exact operator intent, review state, Platform
fulfillment evidence, next action, and immutable receipts. It does not select a
provider or model and does not mutate the Platform profile registry or profile
lifecycle.

## Ownership

- OOS owns request identity, review transitions, revision ordering,
  idempotency, projections, and receipts.
- Platform Engineering owns the canonical profile registry, implementation,
  activation configuration, and lifecycle state.
- Security Architecture owns security acceptance of the profile and runtime
  boundary.
- Governance Operations Console is the primary operator client; it is not an
  authority for registry or lifecycle mutation.

## Artifacts

The machine-readable bundle is in `contracts/model-profile-request/`:

- `request.schema.json` records intent and exact source bindings.
- `command.schema.json` records revision-bound operator review actions.
- `fulfillment.schema.json` records Platform-owned implementation outcomes.
- `projection.schema.json` defines the current Console-compatible view.
- `receipt.schema.json` binds each durable change to its actor and prior
  receipt.
- `manifest.json` records capability and non-authority boundaries.

Create requests require a null profile identity and source. Every amend,
activate, suspend, retire, or exception request requires the exact existing
profile identity and registry source version. This prevents a request from
silently changing which profile or registry revision it addresses.

## State Model

Review state follows:

`draft -> submitted -> under-review -> approved|rejected|changes-required`

`changes-required` can be revised and resubmitted. A nonterminal request can
be withdrawn. Platform fulfillment can begin only after approval and follows:

`not-started -> implementing -> applied|failed`

A failed fulfillment can retry through `implementing`. Every mutation requires
the exact current revision. Reusing a command or idempotency identity with
different input fails closed.

## Security Properties

- request and review mutations require authenticated caller credentials plus
  an exact configured caller-to-operator binding;
- fulfillment updates require an explicitly configured Platform caller;
- callers can read only requests they created;
- canonical JSON, bounded request size, schema closure, and digest-bound
  receipts prevent ambiguous or unbounded input;
- applied fulfillment records reviewed Platform evidence while
  `profile_lifecycle_changed` remains `false`;
- runtime construction is admitted only for the Security-reviewed
  `dev-integration` boundary; stage and production remain denied, and Platform
  still must prove the concrete composition before claiming operating completion.

## Compatibility

The API publishes normal JSON and the shared Console source-projection media
type on the item read route. Consumers must use monotonic `revision`, current
`next_action`, and receipt coordinates. They must not infer Platform lifecycle
state from OOS fulfillment state.
