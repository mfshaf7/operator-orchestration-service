# Agent Action Enforcement

This is the primary OOS instruction surface for enforcing canonical agent
actions inside admitted shared workflows.

## Current Boundary

The enforcement code is source-complete but runtime activation remains off.
Integrated conformance under work item #954 and Security acceptance under work
item #955 must complete before an agent-originated action can invoke a live
owner workflow.

OOS does not expose a generic client-controlled dispatch endpoint. A client
must never supply the current authority view used for policy evaluation. The
admitted workflow resolves current operator, caller, agent, workflow, target,
source-version, context, delegation, approval, and idempotency bindings from
its authoritative adapters.

## Owner Split

- `workspace-governance` owns action classes, schemas, obligations, and
  fail-closed meaning.
- WGCF validates the exact request against current bindings and emits the
  policy decision plus policy ledger event.
- OOS validates that decision again, re-resolves current bindings immediately
  before dispatch, invokes only an admitted workflow, and records the terminal
  action receipt.
- The domain owner enforces business eligibility and emits the owner receipt
  after any mutation invocation.
- Security Architecture owns activation acceptance.

## Workflow Integration

An admitted workflow integrates through `createAgentActionEnforcer` and must
provide:

1. A canonical `agent_action_request` whose digest covers the complete request.
2. `resolveCurrent(request)`, sourced from current owner and control-plane
   truth. The enforcer calls it before evaluation and again before dispatch.
3. `execute({ request, decision })`, which invokes only the admitted command.
4. `recordReceipt(receipt)`, which durably retains the terminal OOS action
   receipt before success is returned.

For request, decision, owner-receipt, and terminal-receipt integrity, hash the
RFC8785 canonical artifact with `integrity.content_digest` omitted. Do not hash
an empty digest placeholder; WGCF and OOS must compute the same projection.

For `mutate`, an invoked owner adapter must return a canonical
`agent_action_owner_receipt` and its digest-bound reference for every applied,
not-applied, or unknown owner outcome. If owner invocation has not started, the
adapter may throw `AgentActionOwnerNotInvokedError`; OOS then records a terminal
failure with `mutation_state: not-attempted`.

Do not throw an ordinary error after owner invocation. Reconcile through the
owner adapter and return its receipt so OOS never guesses whether a mutation
happened.

## Fail-Closed Behavior

OOS does not invoke the workflow when:

- WGCF returns `deny` or `review-required`
- the request or decision fails its pinned canonical schema or digest
- decision bindings, obligations, or expiry do not match the request
- current source, target, approval, delegation, context, workflow, or caller
  bindings change after evaluation
- the idempotency key is missing from current truth or has already been
  consumed
- mutation execution does not return the exact owner receipt

Policy denial and pre-invocation drift produce a terminal OOS action receipt.
Malformed or unauthenticated WGCF responses are rejected as upstream contract
failures and never become dispatch authority.

## WGCF Transport

The evaluator client uses the existing authenticated WGCF service identity:

- `WGCF_DELIVERY_ART_BASE_URL`
- `WGCF_DELIVERY_ART_CALLER_ID`
- `WGCF_DELIVERY_ART_CALLER_SECRET`

The WGCF caller grant must include method scope `evaluate-agent-action`.
Secrets, raw context, and raw model output are never written into request,
decision, owner, or terminal receipt metadata.
