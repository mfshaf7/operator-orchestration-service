# WGCF ART Handoff v1

## Purpose

Define the broker-owned handoff from `workspace-governance-control-fabric`
readiness and evidence receipts into Workspace Delivery ART action drafts.

WGCF may classify, recommend, and produce receipt references. OOS remains the
only broker that creates, validates, and submits ART mutation drafts.

## Authority Model

- WGCF authority: recommendation only.
- OOS authority: ART mutation draft creation, validation, and submission.
- Operator authority: final decision to submit, discard, or edit a managed
  draft.
- Raw OpenProject, Rails, or direct ART mutation paths are not part of this
  handoff.

WGCF-class callers may use:

- `POST /v1/delivery-art/wgcf/mutation-drafts`

WGCF-class callers must not use:

- `POST /v1/delivery-work-items/{work_item_id}/complete`
- `POST /v1/delivery-work-items/{work_item_id}/blocker`
- `POST /v1/delivery-work-items/{work_item_id}/update`
- `POST /v1/delivery-work-items`
- any other direct ART mutation endpoint

## Input Contract

The request body is reference-only:

```json
{
  "input": {
    "schema_version": 1,
    "source_system": "workspace-governance-control-fabric",
    "receipt": {
      "kind": "art_readiness_receipt",
      "ref": "wgcf://receipts/art-readiness/522",
      "digest": "sha256:receipt"
    },
    "recommendation": {
      "action": "record_blocker",
      "reason": "WGCF detected a blocker recommendation that requires OOS handling."
    },
    "draft": {
      "operation": "work-item.blocker",
      "target_id": "work-item-522",
      "payload_input": {
        "action": "record",
        "blocker_decision_path": "remove",
        "blocker_statement": "WGCF recommends blocker recording before closeout."
      }
    },
    "review_packet_refs": [
      {
        "kind": "art_evidence_packet",
        "ref": "wgcf://packets/art-evidence/522",
        "digest": "sha256:packet"
      }
    ]
  }
}
```

Required fields:

- `input.schema_version = 1`
- `input.source_system`
- `input.receipt.kind`
- `input.receipt.ref`
- `input.receipt.digest`
- `input.draft.operation`

Allowed draft operations:

- `work-item.blocker`
- `work-item.complete`
- `work-item.create`
- `work-item.stale-open-close`
- `work-item.update`

Denied fields anywhere in the handoff:

- `raw`
- `raw_context`
- `raw_output`
- `raw_artifact`
- `full_output`
- `full_artifact`
- `artifact_body`
- `artifact_content`
- `context`

## Output Contract

The broker returns a managed mutation draft plus authority metadata:

```json
{
  "workflow_id": "delivery-art-wgcf-mutation-draft-create",
  "authority": {
    "source_system": "workspace-governance-control-fabric",
    "source_authority": "recommendation_only",
    "mutation_authority": "operator-orchestration-service",
    "broker_submit_required": true,
    "direct_mutation_allowed": false
  },
  "mutation_draft": {
    "artifact_type": "art_mutation_draft",
    "status": "draft"
  },
  "receipt_refs": []
}
```

The output is not completion evidence by itself. Completion still requires the
normal Review Packet, source evidence, validation evidence, and ART closeout
preflight.

## CLI Surface

The normal ART CLI invokes WGCF readiness directly for the operator path:

```bash
npm run art -- item continuation <work-item-id>
npm run art -- item complete <work-item-id> <payload.json>
npm run art -- item stale-open-close <work-item-id> <payload.json>
```

Continuation reads include a compact `wgcf_art_readiness` projection. Completion
and stale-open closeout fail closed before broker mutation dispatch when WGCF
readiness does not allow the mutation.

When the broker runtime is configured with `WGCF_ART_READINESS_MODE=required`,
the HTTP mutation routes also enforce the same readiness contract before the
OpenProject write:

- `POST /v1/delivery-work-items/{work_item_id}/complete`
- `POST /v1/delivery-work-items/{work_item_id}/stale-open-close`

The broker obtains its own continuation context and calls the WGCF API
`/v1/art/readiness`; callers do not provide readiness receipts as proof for
these required gates.

Local operators can import a WGCF handoff into a managed draft:

```bash
npm run art -- wgcf draft .art/wgcf/522-handshake.json .art/drafts/522-wgcf.json
```

Submit remains the existing OOS draft path:

```bash
npm run art -- draft validate .art/drafts/522-wgcf.json
npm run art -- draft submit .art/drafts/522-wgcf.json
```

## Review Packet References

`review_packet_refs` are custody references only. They can point to WGCF
evidence packets, readiness receipts, or operator receipts, but they must not
embed raw terminal, CI, repository, or ART context.

OOS stores those refs under the draft `source.review_packet_refs` field so the
operator can cite durable WGCF evidence without giving WGCF mutation authority.
