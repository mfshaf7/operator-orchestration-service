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

## Experimental API connections

Epic1363 extends the existing service with named Claude API, DeepSeek API and
GLM/Z.AI Standard API connections. These integrations remain **Experimental —
real-account testing pending**, independently of connection health or a
successful model probe. The operator has no eligible provider accounts for
live qualification. Controlled conformance does not establish account access.
The existing composed Security gate and Platform commissioning remain required.

1. Read `GET /v1/model-operations/connections` for the current connection revision,
   fixed provider presets and named connection states. Credentials, provider
   errors and private reasoning are absent from this projection.
2. Submit `POST /v1/model-operations/connections/commands` with
   `{command_id, expected_revision, action, input}`. `connection.create` accepts
   `{provider, name}`; `connection.disconnect`, `connection.reconnect` and
   `connection.remove` accept only `{connection_id}`. Reuse the original stable
   command identity after a lost response. Endpoints are owner-selected.
3. Explicitly enter or replace a key using the separate protected
   `POST /v1/model-operations/connections/credentials` endpoint with
   `{command_id, expected_revision, connection_id, api_key}`. This is transient
   ingress to Platform/Vault. OOS does not queue, journal, log, autosave or retry
   this body. Never put a key in a generic model operation, draft, advisor chat,
   URL or process argument. Its durable owner identity hashes only safe metadata.
4. Read the original result at
   `GET /v1/model-operations/connections/operations/{command_id}`. After an
   uncertain write, explicitly call `POST /v1/model-operations/connections/reconcile`
   with `{command_id}`. Reconciliation reads the original custody effect; it
   does not submit credentials again. Pending/finished/cancelled are actual
   owner states. Refresh current connection state separately from this historical
   receipt. After restart, the server's `pending_operation` retains the identity.
5. Register its admitted backend and explicitly Verify a model through the
   existing model-operation procedure below. Claude/DeepSeek use their native
   catalogues; GLM requires an exact manually entered model ID. Verification is
   bounded at4096 output tokens/60 seconds and may incur provider charges.
   Unknown provider runtime/version digests remain null. Native effort choices
   are model-specific; unknown capabilities use an explicit provider default.
6. Save routes only after verification. Replacing credentials invalidates prior
   model verification. Disconnect clears stored credentials and fences uncertain
   prior writes; reconnect requires a new explicit key. Remove first requires
   reassigning routes and removing that connection's model registrations. It
   retires the connection identity. Configuration-history restoration never
   restores credentials or admission for a removed connection.

Connection receipts bind the operator, original safe command digest, connection,
actual revision transition and state digest. A previously admitted pending write
can finish after another connection advances the registry; its actual previous
revision may therefore exceed the original expected revision. The original
authorization digest remains exact. Configuration and connection revisions are
separate; a connection receipt is not model verification or routing acceptance.

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

Local metadata reports availability or a changed registration. After core
startup, the dedicated hosted backend uses a bounded isolated native
`account/rateLimits/read` request to check authenticated remote connectivity.
Its model catalogue remains metadata, not model entitlement. A collector result
is reused for 60 seconds; native process/account locks prevent overlap with
operator work. Core readiness and browser registry reads never launch this check.
The check never performs inference, sends project context, registers a backend,
adopts a changed model or changes routes.

`last_success` is optional historical evidence from an actual completed model
verification or schema-valid routed request. It includes its original time,
kind and durable receipt/selection reference. The UI marks results older than
15 minutes stale. Success binds the exact registered model, admitted backend
policy and dedicated account/login generation. A newer failed or uncertain
request, changed metadata, missing account or current connection failure takes
precedence; historical success cannot clear it. Older receipts without an
authoritative timestamp do not acquire one from file modification times.
Without recent model proof, a reachable hosted connection still says
Verification needed. Use the existing explicit verification action.

For `verification-needed`, inspect advertised metadata and explicitly submit the
existing `model.register` command. Successful verification updates the same model
identity and creates a new configuration revision; routes and prior receipts are
retained. Failed or uncertain verification does not adopt metadata. Request
`reconcile` still means recover that original command, not accept provider drift.
