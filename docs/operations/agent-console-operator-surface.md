# Agent Console Orchestration

This is the primary OOS operator surface for the governed Agent Console
session path introduced by ART #1245.

## Current State

The source contract is complete but disabled by default. Platform #1246 must
commission the `dev-integration` runtime binding, Console #1247 must replace
its local provider path with these routes, and Security #1248 must accept the
exact composed boundary before the Feature is operating-ready.

Do not set `OOS_AGENT_CONSOLE_ENABLED=true` outside the reviewed
`dev-integration` composition. Route availability is not approval to activate
a model profile or an owner mutation path.

## Authority And Sequence

OOS owns session identity, one-active-invocation ordering, deterministic
replay, terminal state, and invocation receipts. Every invocation follows one
fixed sequence:

1. authenticate the caller with a caller-specific credential and bind
   `x-oos-operator-id` to that caller;
2. reserve the invocation durably before any upstream call;
3. send the exact candidate to the pinned CGG Agent Console projection
   contract;
4. verify the complete CGG schema, session binding, candidate digest, safety
   flags, authority flags, receipts, and timeline;
5. send only the model-safe projection to the governed AI gateway;
6. verify the active profile, caller, task, response schema, audit reference,
   and timeline;
7. record a terminal completed, failed, or cancelled invocation and its
   digest-bound receipt before responding.

There is no raw-context fallback and no direct provider path. An upstream
transport error becomes a bounded retryable failure; it cannot leave the
session permanently busy.

## Routes

All routes require `x-oos-caller-id`, `x-oos-caller-secret`, and
`x-oos-operator-id`.

- `POST /v1/agent-console/sessions` creates or replays a session.
- `GET /v1/agent-console/sessions/{session_id}` reads the caller-owned session.
- `POST /v1/agent-console/sessions/{session_id}/invocations` runs one governed
  invocation.
- `POST /v1/agent-console/sessions/{session_id}/actions` admits one canonical,
  session-bound Agent Action through the existing OOS/WGCF enforcement path.
- `POST /v1/agent-console/sessions/{session_id}/close` closes the exact
  expected revision.

The action route is not an arbitrary dispatcher. It fails closed unless the
runtime has an admitted owner adapter, the action binds the current operator,
session, and agent instance, WGCF allows the exact current request, and any
mutation returns the owner receipt required by the canonical Agent Action
contract. With no admitted adapter, it returns `503` without evaluation or
dispatch.

## Configuration

- `OOS_AGENT_CONSOLE_ENABLED` — defaults to `false`.
- `OOS_RUNTIME_PROFILE` — must equal `dev-integration` when enabled.
- `OOS_AGENT_CONSOLE_STATE_ROOT` — private atomic session and receipt store.
- `OOS_AGENT_CONSOLE_CALLER_OPERATOR_BINDINGS_JSON` — exact caller-to-operator
  map.
- `CGG_AGENT_CONSOLE_BASE_URL`
- `CGG_AGENT_CONSOLE_CALLER_ID`
- `CGG_AGENT_CONSOLE_CALLER_SHARED_SECRET`
- `GOVERNED_AI_GATEWAY_BASE_URL`
- `WGCF_DELIVERY_ART_BASE_URL`, `WGCF_DELIVERY_ART_CALLER_ID`, and
  `WGCF_DELIVERY_ART_CALLER_SECRET` for Agent Action evaluation.

Provider credentials are never projected into OOS. CGG and WGCF secrets must
come from the Platform-owned runtime composition, not source or Console input.

## Recovery

An identical session, invocation, or close retry returns the retained result.
A conflicting identity or payload is rejected. After a process restart, read
the session before issuing a new invocation. A terminal failed or cancelled
invocation clears the active reservation; rerun only with a new invocation and
idempotency identity when the operator intentionally wants a new model call.

Do not edit the state file by hand. Preserve it for diagnosis if integrity
validation fails, disable the runtime, and repair the owning source or
composition before retrying.

## Evidence

The pinned CGG schemas and source commit are recorded in
`contracts/agent-console/manifest.json`. API examples and request/response
contracts are generated into `docs/api/openapi.json`. Source completion for
#1245 proves merge-ready protocol behavior; live positive and negative cases
belong to Platform #1246 and activation acceptance belongs to Security #1248.
