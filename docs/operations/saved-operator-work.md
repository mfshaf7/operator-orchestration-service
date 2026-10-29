# Saved operator work

This is the primary OOS procedure for retaining Work Design, Refinement and
Orchestration authoring content across browser profiles and service restarts.
Source implementation and exact-source runtime commissioning are separate.

## Ownership and meaning

OOS owns private saved input; Console owns editing, save status and recovery.
The existing private work-state volume and transaction primitive hold it.
OpenProject remains canonical for ART. WGCF remains the formal governance
artifact/readiness authority; its Delivery ART registry is not a generic draft
store. No new service, database, model invocation or canonical write is involved.

A save acknowledges inert content. It does not approve a brief, apply a tree,
execute an orchestration definition, authenticate historical authorship or
replace an existing workflow receipt. Imported browser records retain their
import origin; original version labels/times are not new server attestations.

## Normal Console procedure

1. Open the original Work Design, Refinement or definition-design workflow.
   The Console reads the bound operator's server draft before mounting its
   existing autosave controller. Configured owner failure blocks initialization
   rather than substituting an empty draft or disconnected preview.
2. Edit normally. The existing screen reports pending edits, saving, server
   acknowledgement or failure. Save requests coalesce; only one runs per subject
   in the tab. Leaving a pending draft retains its local working copy.
3. Reopen with the same authenticated operator in another browser profile.
   The server copy restores the original workflow. Canonical apply still uses
   its existing source/packet revision and human acceptance guards.
4. If browser and server contain unacknowledged differences, inspect the conflict.
   Choose **Use server copy** or **Keep browser edits** explicitly. Neither option
   can silently replace an intervening revision or rewrite finalized history.
5. **Preserved browser records** lists exact raw originals by key and preservation
   time. Download an original for inspection or restore a supported record as a
   draft. Malformed/unsupported content stays preserved; no accepted evidence is
   reconstructed. Read-only history disables restoration and performs owner reads.

## Legacy data

Before local normalization or autosave, original current/older subject keys are
copied locally when storage permits and retained separately by OOS in live
editable mode. Repeated identical imports reuse their recovery identity. A failed
preservation blocks initialization without replacing the local record. Unknown
old formats remain downloadable. Different-operator acknowledged browser caches
are not imported into a new operator's server records.

The original desktop profile must still contain the bytes, or a retained backup
must exist. Another browser cannot discover those bytes remotely. A normal PC
restart does not itself clear localStorage. Missing raw files cannot be recreated
from an apply receipt; do not fabricate their content, authors or approval.

## Bounded API

`GET /v1/operator-saved-work/{kind}/{subject_id}` reads one caller/operator-bound
subject; `recovery_id` selects an original. Kinds are `work-design`, `refinement`
and `orchestration`. The normal Console source-projection media type is required
by the BFF. No global draft/history scan is used.

`POST` takes `command_id`, `expected_revision`, `payload_json` and `origin`.
`action=preserve` instead takes `storage_key` and `raw_value`. Inputs are closed,
caller-specific credentials and existing operator bindings are required, and
saves require existing mutation authority. Transport is bounded to4MiB, payload
UTF-8 bytes to2MiB, recovery metadata to100 originals per operator/subject.
Limit failures are explicit; originals are not deleted automatically.

Payloads are exact JSON text, preserving fractional canvas geometry without
changing the integer-only formal governance artifact contract. Each save returns
a revision, content digest and acknowledgement only after fsync/atomic commit.
Same latest-command retries reuse acknowledgement; stale/conflicting input returns
409. Finalized brief versions are append-only under draft saves. A prior complete
record remains beside the atomic current record; integrity failures preserve
bytes and return unavailable instead of success.

## Recovery and rollout

The runtime composes this store only with the existing explicit private work-state
root. No temporary directory or browser-only fallback qualifies a live save.
Use normal Platform complete-runtime activation after reviewed OOS/Console source
and paired Security acceptance. Retain original browser archives during rollout.
Rollback selects prior reviewed source through the same lifecycle, preserving the
new private saved-work directory and browser originals. Do not purge it to make
an older version start. Whole-product off-machine disaster recovery remains its
own qualification scope.

Completion requires actual original-content migration plus a fresh-browser read,
service restart recovery, readonly finalized-history inspection and bounded
failure/conflict proof. Unit fixtures alone do not prove operating recovery.
