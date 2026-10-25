# Operator source editing and import

This is the shared OOS procedure for manual source drafts in Prototype and
Delivery. The Console owns its editor, file picker and before/after presentation;
OOS owns retained state, revision checks, source scope and acceptance. This
source extension requires coordinated Console source, exact Security acceptance
and Platform commissioning under Delivery1323 before operating qualification.
The existing generated-source and delivery paths remain available in their
accepted composition. No new service or source-authority flag is introduced.

## Prepare the actual source session

For a Prototype, follow [Prototype source authoring](prototype-source-authoring-operator-surface.md)
through canonical request preparation, exact source authorization and session
start. For Delivery, follow [the work-session procedure](delivery-workflow-operator-surface.md#resumable-source-delivery-lifecycle)
for the real work item and accepted Landing Unit decision. Use the Console's
[canonical source authorization](platform-operation-adapter.md#source-authorization-through-the-console),
including its bounded renewal and terminal revocation. An engineering token
alone does not authorize this session.

The caller/operator, owner, source root, branch and fetched base come from that
owner session. Browser input cannot replace them. Trusted Preview/Delivery
owner-preparation requests remain inspect-only; this editor cannot alter their
automation or control metadata. Prototype app/design and ordinary Delivery
retain their different source scopes; there is no universal extension allowlist.

## Inspect, edit or import, and retain a draft

1. Read the current realization revision. Read `GET <base>/files` for the
   bounded source tree without content. Repeat `path=<relative-path>` to read
   up to48 distinct source text files within the existing256KiB capture budget.
   The Prototype adapter filters both names and bytes to its canonical app/design
   scope. Ignored, unsafe, absent, linked, binary or malformed UTF-8 files cannot
   be adopted as readable baseline text. A truncated tree is explicitly marked;
   it does not establish that an unseen file is absent.
2. Edit source or select local files/folders in the Console. Import is text
   input into the same draft, not a filesystem mount, archive extraction,
   command execution or Git upload. Review relative-path mapping, exclusions
   and each create/replace/delete. Omitted import files never imply deletion.
   Dependency/build/Git material and secret-bearing paths must be reported and
   skipped/rejected rather than silently transformed or sent to a model.
3. Save with `POST <base>/draft`. Prototype accepts the exact
   `OperatorSourceDraftCommand`; Delivery wraps it as `{realization: command}`.
   The command includes schema version1, stable `command_id` and `execution_id`,
   `expected_revision`, `expected_change_set_digest` (null when there is no
   editable draft), `requested_at`, bounded `objective`, `input_origin`
   (`manual` or `import`), `retry_of`, commit message and source operations.
   Each replacement/deletion binds the actual baseline file digest. Creates
   require an absent target. The isolated owner performs the same read-only
   base/path/digest preflight as apply before any draft is retained.
4. Reload with `GET <base>/draft` and the ordinary realization projection.
   Saved UTF-8 text, BOM and line endings remain unchanged in private draft
   custody. Native Git attributes and owner validation still govern eventual
   delivery. Saving neither calls a model nor commits, publishes, approves,
   merges or activates source. Private source is not browser persistent state
   or automatic AI context. Normal metadata projections contain paths/digests
   and provenance; raw source is available only through the caller-bound draft
   and selected-file reads.

| Domain | `<base>` |
| --- | --- |
| Prototype | `/v1/prototype-source-requests/{request_id}` |
| Delivery | `/v1/delivery-work-items/{work_item_id}/work-session/realization` |

The exact schemas and examples are in the [OpenAPI contract](../api/openapi.json).
Each file is at most64KiB of valid UTF-8, with at most64 operations and512KiB
changed text. JSON escaping, session metadata and the future apply command must
also fit the executor's existing1MiB serialized envelope. These bounds are not
permission to truncate source. Split a genuinely larger source change through
its existing owner workflow; do not raise a browser-only limit or claim support
for arbitrary binary/archive/private-client projects.

## Amend a model proposal or recover a save

An existing `draft-ready` proposal may be edited within its original objective
and execution. Saving changes its exact digest. OOS preserves the previous
proposal in private owner artifacts and labels the current revision as operator
input; the original model evidence remains lineage and does not attest edited
bytes. The previously accepted digest cannot apply the amended content. Model
inference is optional and uses current task/model/effort configuration; a
provider outage does not prevent inert manual draft saves in an otherwise
commissioned source composition.

For a lost save response, retry the identical retained command. Its original
acknowledgement is returned even after a later save or expired source approval;
that historical acknowledgement does not claim the newest revision. Refresh
current owner state afterward. Changing input under an existing command id is
rejected. A stale expected revision or digest requires explicit reconciliation;
never overwrite the other revision or discard unsaved buffers silently.

`applying`, `apply-unknown` and `source-created` are immutable. Recover the
original uncertain source action; do not edit beneath it or launch replacement
inference. Failed/cancelled attempts require an explicit `retry_of` pointing to
the actual predecessor before a new draft. Current Prototype canonical objective
bounds and Delivery's existing20–12000-character objective bounds are retained.

## Accept and deliver

Review the exact saved diff and digest, then use the existing separate
Prototype `/accept` or Delivery realization `/continue` action. Only that
accepted digest can create Gary's source commit. Continue the ordinary owner
validation, Gary PR publication, exact-head human review/merge, final evidence
and scoped credential/worktree/branch cleanup. Saving/importing is not evidence
that any of those delivery actions occurred. Source preparation checks, browser
fixtures and CI are distinct from actual Console operating proof.
