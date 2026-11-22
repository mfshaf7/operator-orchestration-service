# Delivery Catalog Runtime

## Purpose

The paired maintenance preview adds [Project membership management](delivery-project-members.md).
This is a separate native access workflow reached from Catalog, not arbitrary
editing of the assignee projection. It remains unpublished until coordinated
source acceptance and activation.

Use the Delivery Catalog runtime to read canonical Delivery vocabulary and to
apply one explicitly accepted add, edit, or retire decision. The Governance
Operations Console calls OOS only. It does not call OpenProject or WGCF from
the browser.

Repository admission and lifecycle remain outside Catalog. Catalog can link an
already admitted repository only after OOS proves its referenced WGCF readiness
decision is still current.

The unpublished internal-registration extension accepts the same operator
request. OOS resolves current active source-only Inventory and sends WGCF its
actual installation, record version/digest and policy reference. WGCF checks
current native eligibility; OOS reevaluates before linking. Stale, suspended,
foreign or unavailable native authority blocks linking without a public-Git
fallback. No invented repository rule, Git revision or new application test is
required. This extends repository admission consumption; it does not migrate
Catalog storage or activate private Studio import. Existing Git-backed records
retain their original authority. Normal live operation still requires the
coordinated batch's accepted source and composition.

## Operator Sequence

1. Read `GET /v1/delivery-catalog/projection` and retain its `source_revision`.
2. Choose one value action allowed by the projected Catalog item capability.
3. For a new Owner Repo value, call
   `POST /v1/delivery-catalog/repository-readiness` with
   `{ "schema_version": 1, "repo_name": "<canonical-repo-name>" }`.
   Treat only the returned exact, content-addressed
   `repository_readiness_reference` as preparation evidence. The request does
   not create or mutate a repository or Catalog value.
4. For Owner Repo, provide the exact admitted repository identity and that
   content-addressed WGCF readiness reference.
5. Submit the typed draft, source revision, idempotency key, and explicit
   operator acceptance to
   `POST /v1/delivery-catalog/{catalog_item_id}/mutations`.
6. Treat only an `applied` result with canonical value readback,
   `readback_complete: true`, and a durable receipt as success.
7. Re-read the projection after success or a stale-source response.

Reuse the same idempotency key when recovering the same accepted decision.
Create a new key only for a genuinely different decision.

For a PI calendar, add or edit Target PI with `planning_window_start_date`,
`iteration_length_days` and `iteration_count`. A connected Catalog with
`supports_iteration_generation` calculates the inclusive end date and saves
the PI and all full-length consecutive iterations in one transaction. Send a
null end date or the exact calculated date. Verify the PI window and each
dated iteration in `related_values`. An original receipt can be recovered
with the same accepted request. Only exact numbered keys acquire dates.
Existing assignments and out-of-calendar labels retain their original values.
Use this calendar operation to create a PI or change its dates. The Catalog
rejects standalone Iteration writes. Target PI details can be edited while
preserving the saved calendar.

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

An unconfigured Workspace Inventory or WGCF authority, inactive repository,
authority race, stale source revision, stale repository readiness decision,
in-use retirement, backend failure, or incomplete readback fails closed. There
is no fixture fallback. Retry readiness preparation after restoring its named
dependency; never supply a fabricated reference or call WGCF from the browser.

Rollback disables the OOS route composition and Console adapter while
preserving canonical values and backend receipts. Repository lifecycle state is
never rolled back through Catalog.

## Exact reviewed revision and recovery

The Console sends the revision the operator reviewed, never a newly substituted
server revision. It prepares repository readiness once before dispatch and pins
that reference with the complete accepted request. Retry the same acceptance
and body to recover its receipt; a new revision is a new reviewed decision.

The canonical Catalog control adapter checks an exact request digest and
idempotency receipt before rejecting a stale revision. OOS forwards a stale
request only through that existing receipt path and accepts only a replayed
canonical result for the same operator, request, correlation and Catalog item.
The backend must reject an unseen stale request without applying it. Historical
receipt recovery does not reauthorize current repository readiness or grant a
new write. Its original readback may predate later legitimate edits; consumers
must separately read current values before another decision.

An applied receipt is an applied outcome even if the consumer's next list read
fails. Keep that receipt visible, mark the list unavailable, and retry the read.
Never silently allocate a replacement acceptance for an uncertain mutation.
Catalog has no separate in-use retirement request workflow: values with active
references must be reassigned before retirement. Repository linking is a
sequenced Catalog/Delivery command with explicit partial-failure reconciliation,
not a multi-service transaction or a manual Sync workflow.
