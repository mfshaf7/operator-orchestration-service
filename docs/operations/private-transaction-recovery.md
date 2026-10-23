# Recover private file transactions

The Platform Operation store (including ordinary source leases), Prototype
Source Authoring store, and Repository Owner Bootstrap store use
`src/persistence/private-file-transactions.js`. Their transaction lock is a
kernel `flock`, held by the broker's open descriptor throughout synchronous
or asynchronous work. Process death releases ownership immediately. Empty
`locks/<key-hash>.flock` files persist and must never be deleted while writers
are running: replacing an inode could permit overlapping writers.

The API and worker images already include `flock` through `util-linux`.
Missing tooling fails closed before invoking a protected effect. Concurrent
requests retain the workflow's existing `state_busy` error and retry behavior;
this change does not add a queue, expiry, background job, or permission.

## One-time migration from PID locks

The earlier helper wrote `locks/<key-hash>.lock` with only a PID and token.
PID reuse and container PID namespaces make those records insufficient proof
of a live owner. The current helper refuses a transaction while its legacy
file exists, including when that PID appears dead locally. It never removes a
legacy lock automatically.

1. Record the affected original request, source intent or operation, error,
   lock path, record digest, file timestamp, and owner pod/container identity.
   Inspect only bounded metadata; preserve credentials and payloads privately.
   Read the original provider/owner outcome before considering another effect.
2. Quiesce every old-version writer sharing these state roots. Pause automatic
   rollout/credential-consumption activity for the migration window and prove
   the old pods/processes have terminated. Do not mix the PID-lock and kernel
   protocols in a rolling deployment. A locally visible PID or elapsed time
   alone is insufficient evidence that an old owner is gone.
3. Preserve each legacy file in private recovery custody with its original
   digest and ownership evidence, then move that exact verified legacy file
   out of the active lock directory. Preserve all workflow records, operation
   receipts, source preparations and credentials. Never clear an entire state
   root or remove a lock that lacks ownership proof.
4. Activate the reviewed current source through the existing Platform
   composition path, with its exact Security admission. Prove that all writers
   use the kernel protocol and that no old-version writer remains.
5. Reopen the same original Console session, refresh authoritative state and
   perform its exact next action. Capture the normal continuation and owner
   receipt. Do not republish source, repeat a completed provider action, or
   create a replacement request to hide an uncertain outcome.

Ordinary restarts after migration require no lock-file cleanup. Existing
`.flock` files indicate no active ownership on their own; only the kernel
arbitrates the lock. The test suite proves independent-process exclusion,
graceful and forced process-death recovery, asynchronous lease duration,
exception release, tooling denial, and refusal to guess legacy ownership.

## Rollback

Quiesce all kernel-protocol writers before restoring old source. Never run
old and new protocols concurrently against shared state. Keep the archived
legacy record as evidence; restoring a proven dead PID lease would recreate
the outage. Existing domain journals and provider receipts remain the source
of original-operation truth. Roll back through Platform's existing accepted
composition and retain the recovery record until original-session readback
and the selected source version are proven.
