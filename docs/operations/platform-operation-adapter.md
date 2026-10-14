# Platform Operation Adapter Operator Surface

## Operator outcome

Use the Governance Operations Console as the normal surface. The Console reads
capabilities and operation state from OOS; OOS coordinates with the Platform
owner and returns an exact next action. Operators must not reconstruct normal
Dev Integration or Governed Release work by calling Platform, editing state
files, or using a shell.

This source revision provides the OOS half of the workflow. Until Security
accepts the exact revision and Platform commissions its owner routes, the
runtime stays disabled and returns `platform_operation_not_configured`.

## What the Console must do

1. Read `GET /v1/platform-operations/catalog` immediately before preparing a
   command.
2. Select only an available capability for the exact subject and retain its
   `source_version`.
3. Construct the finite command, calculate its canonical intent digest, and
   obtain the operator's approval for that exact digest.
4. Submit it once to `POST /v1/platform-operations/commands` with a stable
   command id and idempotency key.
5. Retain the OOS `operation_id`; read that resource until it is terminal or
   exposes an operator control.
6. Show `next_action.code`, `authority`, and `reason` without translating a
   blocked state into success.
7. For retry or cancel, create a new stable control id and idempotency key and
   reuse both unchanged after a lost response.
8. For a terminal operation, show the owner receipt and any retained effect.

The Console may list recent records through `GET /v1/platform-operations`.
Operation responses never grant authority for a second effect; a new intent
requires a new command and approval.

## State interpretation

| State | Meaning | Operator action |
| --- | --- | --- |
| `requested`, `queued`, `running` | The exact command is retained and owner work is pending. | Wait, or cancel only when the projection exposes cancel. |
| `blocked` | Current owner truth is unavailable or a dependency blocks progress. | Follow the returned owner and exact next action; do not resubmit with a new key. |
| `failed` | The owner produced a terminal failure receipt. | Retry only when `retryable` is true; otherwise request correction from the named owner. |
| `cancelled` | The owner produced a cancellation receipt. | Inspect retained effects; do not assume rollback. |
| `succeeded` | The owner produced a terminal success receipt. | Treat only the recorded receipt effect as proven. |

## Runtime activation

Platform commissioning supplies the values; OOS operators do not invent them.
All must be present before activation:

- `OOS_RUNTIME_PROFILE=dev-integration`
- `OOS_PLATFORM_OPERATION_ENABLED=true`
- `OOS_PLATFORM_OPERATION_CALLER_OPERATOR_BINDINGS_JSON`
- `OOS_PLATFORM_OPERATION_PROVIDER_BASE_URL`
- `OOS_PLATFORM_OPERATION_PROVIDER_CALLER_ID`
- `OOS_PLATFORM_OPERATION_PROVIDER_CALLER_SECRET`
- `OOS_PLATFORM_OPERATION_SECURITY_DECISION_URI`
- `OOS_PLATFORM_OPERATION_SECURITY_DECISION_DIGEST`
- `OOS_PLATFORM_OPERATION_SECURITY_DECISION_REVISION`
- optional `OOS_PLATFORM_OPERATION_STATE_ROOT`
- `OOS_PLATFORM_OPERATION_PROVIDER_ALLOW_HTTP=true` only for an admitted
  loopback or cluster-local development target

Activation must bind the Security decision to the exact reviewed OOS revision.
Changing that revision requires a new or refreshed Security decision.

## Recovery

- After an OOS restart, read the existing OOS operation. Non-terminal state is
  reconciled by immutable command identity without resubmitting the command.
- After a lost submit response, repeat the same command with the same
  idempotency key. OOS returns the retained operation or rejects changed intent.
- After a lost control response, repeat the exact same control with the same
  idempotency key. Do not generate a replacement key.
- When the Platform owner is unreachable, preserve the blocked operation and
  restore owner connectivity. Do not edit OOS state files.
- Corrupt retained state is a fail-closed service condition. Preserve it for
  investigation; do not delete it to make the screen green.

## Validation boundary

Unit and API tests prove the OOS contract, persistence, denial, replay,
conflict, retry, cancel, and restart behavior. Platform deployment and live
Console-to-Platform execution are separate acceptance steps in #1291, #1292,
and #1298.
