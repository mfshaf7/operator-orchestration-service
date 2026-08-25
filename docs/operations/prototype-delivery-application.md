# Prototype Delivery Application

## Purpose

Apply one exact, baseline-approved Prototype packet to one Workspace Delivery
ART Epic after WGCF confirms readiness. OOS is the only target writer. This
workflow does not graduate the Prototype source record by itself; it returns the
durable target receipt that the Prototype owner can consume.

## Preconditions

- Prototype Studio emitted and committed the packet.
- The source lifecycle is `baseline-approved` and custody is resolved.
- The request uses the packet unchanged.
- The authenticated caller matches `operator_decision.operator_id`.
- WGCF and OpenProject configuration are available to OOS.

## Apply

Submit the exact packet and explicit operator decision:

```text
POST /v1/delivery-ingress/prototype/applications
```

OOS performs this order:

1. validate the request, packet digest, and deterministic packet identity
2. detect an existing target event or incomplete target application
3. issue or read the exact WGCF readiness receipt
4. stop without OpenProject mutation when WGCF denies application
5. create or reuse one top-level Delivery Epic
6. record one immutable OOS-authored application event on that Epic
7. return the target ref and durable activity receipt

`201` means a new Delivery Epic was created. `200` means the exact application
was replayed or an incomplete application was safely repaired.

## Read

```text
GET /v1/delivery-ingress/prototype/applications/{application_id}
```

The read route returns the projection reconstructed from trusted OpenProject
evidence. It does not call WGCF, create a target, repair an incomplete write, or
advance the Prototype lifecycle.

## Bounded Failures

- `prototype_delivery_packet_identity_mismatch`: packet content, digest, id,
  and ref do not bind to the same source truth.
- `prototype_delivery_operator_binding_mismatch`: the application operator is
  not the authenticated caller.
- `prototype_delivery_readiness_denied`: WGCF rejected the exact packet.
- `prototype_delivery_application_conflict`: the deterministic identity is
  already bound to different input.
- `prototype_delivery_duplicate_targets` or
  `prototype_delivery_duplicate_events`: target evidence violates the
  one-target, one-event invariant.
- `wgcf_prototype_ingress_readiness_*`: WGCF configuration, availability, or
  returned evidence is invalid.

Do not work around these failures with direct OpenProject writes. Correct the
source packet or canonical backend evidence, then replay the same route.

## Replay And Recovery

An exact completed replay returns the original receipt without another WGCF
decision or OpenProject write. If target creation completed but event recording
did not, OOS reads readiness from the target marker and records only the missing
event. If the event write response was lost, OOS reads the trusted activity
before deciding whether the write failed.

## Custody

- Prototype packet: Workspace Prototype Studio
- readiness receipt: WGCF receipt ledger
- Delivery Epic and immutable target activity: OpenProject
- application logic and projection contract: OOS
- invoking UI and read presentation: Governance Operations Console

OOS owns no separate database for this workflow.
