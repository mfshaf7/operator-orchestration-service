# Platform Operation Adapter v1

## Purpose

This contract defines the bounded seam by which the Governance Operations
Console asks `operator-orchestration-service` (OOS) to coordinate operations
owned by `platform-engineering`. It covers the Console workspaces named
**Dev Integration** and **Governed Releases**. OOS owns command admission,
durable coordination state, idempotency, exact next action, and safe readback;
Platform owns capability truth and every platform effect.

The contract does not make OOS a deployment authority, does not expose a shell
or generic HTTP proxy, and does not make the Console a direct Platform client.

## Versioned surface

The authenticated OOS routes are:

- `GET /v1/platform-operations/catalog`
- `POST /v1/platform-operations/commands`
- `GET /v1/platform-operations`
- `GET /v1/platform-operations/{operation_id}`
- `POST /v1/platform-operations/{operation_id}/controls`

The complete request and response schemas are canonical in
[`../api/openapi.json`](../api/openapi.json). Schema version `1` admits only
these actions:

- `dev-integration.request-profile`
- `dev-integration.start`
- `dev-integration.status`
- `dev-integration.access`
- `dev-integration.smoke`
- `dev-integration.stop`
- `dev-integration.reset`
- `dev-integration.promote-check`
- `governed-release.execute-step`
- `governed-release.change-runtime-lifecycle`

Any additional action requires a reviewed contract change. Arbitrary command
names, destinations, methods, headers, scripts, or credentials are not valid
command input.

## Admission invariants

OOS admits a command only when all of these are true:

1. the runtime is explicitly enabled in the `dev-integration` profile;
2. the authenticated caller has an exact caller-to-operator binding;
3. the command contains a canonical intent digest and an approval by that same
   operator for that exact digest;
4. current Platform capability truth contains the exact subject, source
   version, capability id, and action;
5. the capability is available and requires approval;
6. an exact Security decision URI, digest, and reviewed OOS revision are bound
   into runtime configuration.

Catalog truth marked `stale` or `unavailable` is readable but cannot authorize
execution. OOS persists the immutable command and its idempotency binding before
dispatch. A reused idempotency key with different intent is a conflict.

## Owner protocol

OOS calls only the configured Platform owner base URL and these owner routes:

- `GET /v1/console-operations/catalog`
- `POST /v1/console-operations/commands`
- `GET /v1/console-operations/by-command/{command_id}`
- `POST /v1/console-operations/{operation_id}/controls`

The owner connection requires a server-held caller id and secret. HTTPS is the
default. Plain HTTP is admitted only when explicitly enabled for loopback or a
`.svc.cluster.local` target. Redirects are denied and responses are capped at
512 KiB.

Platform responses use an exact allowlisted projection. OOS rejects unknown
fields, identity mismatches, malformed state events, incomplete blockers or
failures, and terminal states without a matching receipt. Raw logs are never
returned; `safe_log_ref` may reference separately governed context. Provider
error bodies are never copied into retained state or returned to the Console;
OOS maps them to bounded error codes and operator-safe messages.

## State and recovery

OOS retains operation records and idempotency bindings in atomic mode-`0600`
files below the configured state root. Per-command locks prevent concurrent
writers, and stale process locks are recoverable.

If dispatch or readback has an unknown outcome, the operation becomes
`blocked` with `reconcile-owner-readback` as its next action. A process restart
reconciles by immutable `command_id`; it does not create a new command.

Retry and cancel are the only controls. OOS persists a control and its own
idempotency binding before dispatch. A lost response is retained as an unknown
control outcome. Repeating the exact control may safely use the same downstream
idempotency key; changing the request under that key is denied.

Mutation denial, accepted dispatch, replay, owner reconciliation, blocked
reconciliation, retry, and cancellation are emitted on the OOS audit boundary.
Audit events contain identifiers, outcomes, receipt references, and bounded
error codes, not command inputs, secrets, or downstream error bodies.

## Ownership and rollout

- OOS source and contract implementation: Workspace Delivery ART #1288.
- Governance Operations Console controls: #1289.
- Security acceptance of the exact OOS revision: #1302.
- Platform owner implementation and runtime composition: #1291.
- Console readiness and recovery validation: #1292.
- Fixture-free end-to-end proof: #1298.

This contract is source-ready after #1288. It is not evidence that the Platform
owner routes are deployed or that Console operations are live.
