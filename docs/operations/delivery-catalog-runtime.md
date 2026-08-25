# Delivery Catalog Runtime

## Purpose

Use the Delivery Catalog runtime to read canonical Delivery vocabulary and to
apply one explicitly accepted add, edit, or retire decision. The Governance
Operations Console calls OOS only. It does not call OpenProject or WGCF from
the browser.

Repository admission and lifecycle remain outside Catalog. Catalog can link an
already admitted repository only after OOS proves its referenced WGCF readiness
decision is still current.

## Operator Sequence

1. Read `GET /v1/delivery-catalog/projection` and retain its `source_revision`.
2. Choose one value action allowed by the projected Catalog item capability.
3. For Owner Repo, provide the exact admitted repository identity and its
   content-addressed WGCF readiness reference.
4. Submit the typed draft, source revision, idempotency key, and explicit
   operator acceptance to
   `POST /v1/delivery-catalog/{catalog_item_id}/mutations`.
5. Treat only an `applied` result with canonical value readback,
   `readback_complete: true`, and a durable receipt as success.
6. Re-read the projection after success or a stale-source response.

Reuse the same idempotency key when recovering the same accepted decision.
Create a new key only for a genuinely different decision.

## Activation

Source ships inactive. Later composition, Security review, and Platform
activation work must deliberately supply:

- `OPENPROJECT_CATALOG_CONTROL_BASE_URL`
- `OPENPROJECT_CATALOG_CONTROL_TOKEN`
- `WGCF_REPOSITORY_READINESS_BASE_URL`
- `WGCF_REPOSITORY_READINESS_CALLER_ID`
- `WGCF_REPOSITORY_READINESS_CALLER_SECRET`
- the existing OOS caller authentication accepted for the Console service

The OpenProject Custom Options API is read-only. The configured Catalog control
route is therefore a separately governed privileged adapter. It must return
canonical readback and durable backend evidence; OOS does not manufacture
success or retain a second Catalog database.

## Failure And Recovery

An unconfigured control route, stale source revision, stale repository
readiness decision, in-use retirement, backend failure, or incomplete readback
fails closed. There is no fixture fallback.

Rollback disables the OOS route composition and Console adapter while
preserving canonical values and backend receipts. Repository lifecycle state is
never rolled back through Catalog.
