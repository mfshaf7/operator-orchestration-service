# Model Operations

This is the primary operator procedure for admitted backend registration,
verified model registration, native effort, system defaults, per-task overrides,
explicit fallback and account sign-in. OOS records authenticated operator intent;
Platform owns connection permissions, model verification, configuration receipts,
provider invocation and provider-account custody. Console is the normal client.

Source implementation does not activate this capability. It is disabled by
default, limited to separately commissioned `dev-integration`, and requires the
accepted Platform model-management owner endpoint. It conveys no stage or
production authority. Epic 1313 Security acceptance and commissioning must occur
before operating proof. Existing Model Profile Requests remain the procedure for
new or changed purpose, caller, data or output permissions; they are not a
per-model registration queue.

## Normal procedure

1. Read `GET /v1/model-operations/registry` for admitted backends, existing
   profile/task identities, current configuration revision and revision history.
   Catalogue metadata and `availability: not-probed` are not provider health or
   entitlement evidence.
2. Submit one authenticated intent to `POST /v1/model-operations/requests`.
   Include a stable request ID and idempotency key, the observed configuration
   revision, an action and its exact input. Keep that identity across lost
   responses. The API returns HTTP 202 for accepted/replayed intent; inspect its
   business state rather than treating HTTP success as completion.
3. Poll `GET /v1/model-operations/requests/{request_id}` until the displayed next
   action changes. The bounded list endpoint supplies caller-owned history and
   pagination. Requests are visible only to their authenticated caller and bound
   operator. `x-oos-operator-id` is required on every model-operations route;
   operator identity is never accepted from request JSON.
4. Discover models with `GET /v1/model-operations/catalogue?backend_id=...`.
   Request `&model=...` for native effort details. Registering a model performs
   Platform's bounded synthetic verification; discovery alone is insufficient.
5. Save the system default and task overrides using verified model IDs and their
   exact advertised effort values. Each route specifies a primary, zero to four
   ordered fallbacks and `on_exhausted: fail-closed`. There is no automatic model
   intelligence ranking or fixed provider preference. An absent task override
   inherits the system default. A null route explicitly uses the existing source
   binding. Boolean native effort values remain booleans, not strings.
6. Confirm `completed`, the owner receipt and the accepted configuration
   readback. The readback is of that receipt's revision; another operator may have
   advanced the current tip afterward. Refresh the registry before another edit.
   `routing.rollback` restores a retained configuration as a new revision; it
   does not erase history or silently undo an in-flight inference.

Actions and exact inputs:

| Action | Input |
| --- | --- |
| `backend.register`, `backend.remove` | `{backend_id}` |
| `model.register` | `{backend_id, model}` |
| `model.remove` | `{model_id}` |
| `routing.save` | `{default, overrides}` |
| `routing.rollback` | `{revision}` |
| `account.login.start` | `{backend_id}` |
| `account.login.cancel` | `{login_command_id}` from this caller's sign-in |

Backend addresses, allowed tasks, caller permissions, provider credentials,
policy documents and executable paths cannot be submitted through these inputs.

## Progress and recovery

Controls use `POST /v1/model-operations/requests/{request_id}/controls` with
`{control_id, expected_revision, action}`. Use the current **request** revision,
not the configuration revision. Reuse the same control identity for the same
payload after a lost response. Different content under that identity is rejected.

| State | Operator action and effect |
| --- | --- |
| `queued`, `running` | Await live progress. After a process restart, the next action becomes reconciliation of the retained command; reads do not silently dispatch it. |
| `awaiting-account` | Complete the bounded native device sign-in challenge, or cancel it. Reloading reads Platform's original login journal. |
| `retryable` | Explicit `retry` starts a numbered attempt only after a known effect-free failure; the original intent and expected configuration revision remain unchanged. `cancel` may stop an undispatched retry. |
| `unknown` | Use `reconcile`, which replays the same owner command. Do not create a replacement or assume cancellation. A retained mutation receipt is never resubmitted; only its historical readback is retried. |
| `blocked` | Review the invalid owner evidence. Reconciliation retains the original identity; tampered evidence cannot become completion or fallback. |
| `rejected` | Refresh and review the owner failure. A stale configuration edit requires a corrected new request with the newly reviewed revision. |
| `completed`, `cancelled` | Terminal actual result. Cancellation of an already dispatched configuration mutation is not claimed or treated as rollback. |

Native login cancellation may remain pending until Platform confirms its actual
terminal state. A finished or interrupted login never imports Codex Desktop/CLI
credentials. Device challenges are private operator metadata; access tokens and
Vault credentials remain inside Platform and are never included in OOS records,
Console responses or audit events. Routine configuration uses a separate
purpose-bound management token, not a provider-account token.

If Platform itself retains `command-completion-unknown`, keep the original
operation blocked for owner recovery. Repeated polling is not proof of success,
and an unknown submitted turn is never a reason to invoke another model.

## Runtime configuration and engineering validation

Platform commissioning supplies `OOS_MODEL_OPERATIONS_ENABLED`, the
`OOS_MODEL_OPERATIONS_STATE_ROOT`, `OOS_MODEL_OPERATIONS_PLATFORM_BASE_URL`,
`OOS_MODEL_OPERATIONS_MANAGEMENT_TOKEN_FILE` and explicit
`OOS_MODEL_OPERATIONS_CALLER_OPERATOR_BINDINGS_JSON`. The state root must be
private and distinct from Model Profile Requests. `OOS_RUNTIME_PROFILE` must be
`dev-integration`. OOS reads the purpose-bound management token from its private
file for each call; changing provider custody does not require copying secrets
through Console. Incomplete configuration fails closed. Existing source and
runtime commissioning controls remain authoritative.

The [API contract](../api/openapi.json) defines exact wire fields. Run
`node --test --test-concurrency=1 test/model-operations.test.js` and
`npm run validate:model-operations-openapi` for the owner contract checks.

## Provider checks after core startup

Console core startup does not require a configured, signed-in or reachable AI
provider. After core readiness, Platform's existing observation timer checks only
registered backends. Registry reads with `include_health=true` return cached, revision/digest-bound `health`
metadata with a 120-second expiry; absent, stale, mismatched or invalid evidence
means unknown health. Configuration and recovery controls remain usable.

Local metadata can report availability or a changed registration. Dedicated
account presence is reported separately from unprobed remote connectivity and
entitlement. Routine checks never start Codex, perform inference, send project
context, register a backend, adopt a changed model or change routes.

For `verification-needed`, inspect advertised metadata and explicitly submit the
existing `model.register` command. Successful verification updates the same model
identity and creates a new configuration revision; routes and prior receipts are
retained. Failed or uncertain verification does not adopt metadata. Request
`reconcile` still means recover that original command, not accept provider drift.
