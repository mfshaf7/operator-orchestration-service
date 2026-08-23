# Agent Action Runtime Bundle

This directory is a digest-pinned runtime snapshot of the canonical schemas
owned by `workspace-governance` at commit
`d6e5a5bf0cac6ddfbf127f5826159556971c3718`.

OOS uses the bundle only to validate requests, WGCF decisions, owner receipts,
and its own terminal action receipts. Policy meaning remains owned by
`workspace-governance`, evaluation remains owned by WGCF, and owner mutation
eligibility remains owned by the admitted domain workflow.

Artifact content digests use RFC8785 canonical JSON after omitting
`integrity.content_digest` from the projection. This is the same projection
used by WGCF and by OOS Delivery ART artifacts; an empty placeholder is not
part of the hashed content.

Runtime activation is not granted by this bundle. Integrated conformance and
Security acceptance remain separate gates under work items #954 and #955.
