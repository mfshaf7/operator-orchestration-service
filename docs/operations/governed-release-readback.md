# Governed product inspection and owner workflow access

Status: implemented in pending source; not commissioned in the live Console.

Open **Governed Releases**. Read the product register, select a product, and open
its existing Dashboard. Products without a governed release path remain visible;
registration and a local runtime do not grant staging or production support.

Overview shows the owner contract. Release Path shows the owner's recorded
candidate and verification evidence, with exact source links and timestamps.
Those records do not establish live resource health, successful execution or a
new readiness decision. Missing timestamps and evidence remain unrecorded.

## Submit an owner release request

The native adapter currently covers OpenClaw's existing readiness, promotion and
production-runtime workflows. Other registered products keep their real maturity
and inspection routes; this adapter does not grant them an OpenClaw release rail.

1. Open the product Dashboard's **Release Path**. Native request buttons require
   current product source, current OOS capability and the commissioned dedicated
   Platform connection. The adjacent GitHub buttons remain read-only navigation.
2. Enter actual owner inputs in **Action Details**. Verification results start
   blank. Readiness records evidence for the exact candidate; it does not run the
   checks. Runtime quarantine and quarantine-to-live need an incident/follow-up.
3. **Review Request** binds those values, the product, capability and exact source.
   Submit once. OOS retains the approved command and Platform records it before
   dispatching the existing protected workflow.
4. In **Operations**, inspect the original request. **Awaiting approval** means
   open its original GitHub workflow and satisfy the existing stage/prod human
   approval. **Awaiting review** means inspect and merge its original source PR.
5. Refresh the original operation (also refreshed while its details are visible).
   Completion requires the merged commit on owner main and exact desired-state
   readback. A successful workflow alone is not completion. Runtime observations,
   post-promotion smoke/UAT and readiness decisions remain independent.

If the response is interrupted, **Recover original request** reads the same OOS
operation. The browser retains only its opaque recovery pointer; canonical input,
events and receipts live with OOS and Platform. Reopening history and refreshing
an existing operation do not require a current executable catalog. A write-ahead
marker prevents automatic redispatch even when GitHub's acknowledgement is lost.
Do not replace an uncertain original request. A pre-dispatch owner rejection gets
a terminal no-effect receipt; a retained source branch remains inspectable.

Cancellation targets only the original in-flight GitHub run. Source effects stay
retained. Neither cancellation nor a failed workflow claims rollback. Native
release retry/automatic rerun is unavailable; inspect original evidence first.

The dispatch App has selected-repository Actions write, Contents read, Metadata
read and Pull requests read. It cannot approve environments, write source or
merge. The existing workflow's own token prepares the source PR. Commissioning
and revocation use the [Platform procedure](https://github.com/mfshaf7/platform-engineering/blob/main/products/governance-operations-console/runbooks/operate-complete-runtime.md#optional-native-governed-release-connection).

## API and authority

- `GET /v1/governed-products` supplies bounded canonical product records through
  the authenticated existing Platform provider. The separate default-off
  `OOS_GOVERNED_PRODUCTS_ENABLED` flag requires reviewed composition before use.
- Filters: `q`, `maturity`, `endpoint`, `product_id`; pagination uses `limit`
  (1–25) and `offset`. The source version binds registry and Platform commits.
- Workspace Governance owns product capability. Platform owns release records,
  execution, workflow routes and environment approval. OOS owns authenticated
  projection and the existing immutable Platform-operation command journal. A
  product read or link grants no mutation authority; each native command needs
  explicit intent approval and current owner admission.
- Unknown or changing owner source fails closed; a configured live read never
  substitutes preview samples. An outage retains visibly old records and preserves
  read-only workflow navigation. Review current source and inputs in GitHub before
  running its protected workflow; Console source availability is not its approval.

## Operation history

`GET /v1/platform-operations/history` filters `workspace` before pagination:
`all`, `dev-integration`, or `governed-releases`. `limit` is 1–25 and `cursor`
is an opaque continuation bound to the workspace. Page order uses immutable
command creation identity, so later state updates and new commands do not
invalidate an existing continuation. No fixed 200-command cutoff applies.

The existing canonical files remain authoritative. The process retains lightweight
file metadata, not full operation payloads; a warm page rereads selected records.
Cold reads discover existing files. Directory/stat costs still grow with stored
history, so this is scoped pagination within the current file store, not a claim
of database-scale indexed queries. No owner records are migrated or deleted.

Use **Load older operations** for another owner page. Each original operation
retains its exact refresh, events, next action and receipt. Loaded rows are not a
lifetime completion total. A retained receipt proves its own owner outcome, not
current health or release approval.

## Validation and activation

Source qualification covers actual committed registry readback, caller denial,
closed DTOs, source drift, unsupported products, preview isolation, review-value
visibility, retained-source behavior and discovery beyond 200 unrelated commands.
Exact-source Security review and Platform commissioning remain required before
live activation. Roll back the source/configuration together and retain all
canonical operations and requests.

## Owner release records after a merge

Native source admission distinguishes the accepted running code from current
GitHub owner records. Only the fixed OpenClaw release, verification, lifecycle and
associated desired-state YAML paths declared in `console_release_source.py` may
differ. All other Git leaves must match the accepted Platform source; main must
retain its ancestry, and each read blob must match the verified complete tree.
No local checkout is advanced and no fetched code runs in the provider.

After a normal record-only merge, refresh products and review another action at
the new owner-data revision. No code repin or CLI repair is required. Current
owner main, accepted local snapshot and retained remote snapshot are distinct.
Only current owner main can admit a new native command. A failed connection keeps
a labelled derived snapshot readable; it grants no authority. Original operations
retain their independent exact-read/receipt recovery.

One private snapshot is persisted atomically with an integrity digest. In-memory
head proofs/document caches are bounded to four revisions; unchanged blobs are
reused by immutable identity. The complete Git-tree proof is bounded by the
existing provider's2MB response limit and20,000 entries, with a short refresh
budget. Slow/incomplete reads withhold new actions and can continue warming on
the next refresh. This is a bounded adapter, not unlimited indexed storage.

The workflow-created source PR may show GitHub's **Approve workflows to run**
banner. The human reviewer starts those checks and waits for required results
before merge. The native adapter does not add an approval bypass or substitute
workflow success for source review. See [GitHub's workflow-trigger rules](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow).
