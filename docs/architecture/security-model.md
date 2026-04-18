# Security Model

## Purpose

Define the initial security posture for `operator-orchestration-service`.

This service crosses:

- operator identity
- bounded AI suggestion
- canonical backend write paths

It must not become the trust anchor for governance decisions.

## Identity Model

Phase 1 should separate these identities:

- operator identity
  - the human actor represented in Telegram and recorded in workflow events
- caller runtime identity
  - the service caller such as `openclaw-telegram-enhanced`
- backend service identity
  - the broker's identity when talking to OpenProject or an AI provider

These identities must not collapse into one generic actor string.

## Caller Authentication

Phase 1 recommendation:

- cluster-internal HTTP
- explicit shared service credential delivered from Vault
- caller identity declared in a dedicated header and checked against an allowlist

That means:

- Telegram plugin authenticates to the broker
- the broker does not trust source metadata alone
- backend credentials remain inside the broker, not in the Telegram repo

This is an acceptable first step for a local controlled cluster, but it should
be treated as a bounded phase-1 control rather than the final identity model.

Target direction later:

- workload identity or stronger platform-native service auth

## Secrets Boundary

The broker should own these credentials, not the channel adapter:

- OpenProject API credential
- AI provider credential if a remote provider is used
- internal caller-auth secret or equivalent trust material

Credential custody expectations:

- stored in Vault
- delivered only to the broker and approved callers
- rotation model documented before active runtime admission

OpenProject broker credential target:

- Vault path:
  - `kv/components/operator-orchestration-service/prod/openproject`
- required key:
  - `apiToken`

This credential must not be stored under the OpenProject runtime namespace
secret tree because it is not consumed by the `openproject` runtime.

OpenProject minimum project roles for the automation identity:

- `Reader`
- `Work package creator`
- `Work package editor`

Scope:

- project: `workspace-proposals`

## AI Boundary

The broker may request AI-assisted triage only when:

- the purpose is bounded to workflow assistance
- output stays within a fixed schema
- operator approval remains mandatory before durable state change

Local-model assistance may exist before a governed AI path is active, but it
must not be labeled as governed AI.

## Backend Mutation Boundary

The broker may mutate:

- OpenProject work packages or related canonical backlog artifacts

The broker must not mutate directly:

- workspace governance contracts
- release or promotion contracts
- security registers

Promotion into those systems remains a separate operator-governed action.

## Audit Minimum

Every workflow event should capture at least:

- correlation id
- operator id
- caller identity
- source surface and source ref
- backend target
- action result

AI-assisted steps must also capture:

- provider lane or governed profile id
- suggestion decision id
- acceptance or override outcome

## Phase 1 Risk Controls

- no public ingress
- no free-form chat endpoint
- no provider secrets in Telegram
- no autonomous governance mutation
- no model authority over approval
