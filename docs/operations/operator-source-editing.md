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

Prototype preparation refreshes the admitted Studio owner's fixed `origin/main`
ref before proving that the canonical selected commit belongs to it. This is a
bounded Git observation: it does not pull or reset the commissioned owner checkout,
create a source session, obtain a credential or invoke a model. A freshly merged
Landing therefore requires no operator Git refresh. An unmerged object or failed
canonical fetch remains unavailable; no stale or arbitrary source is adopted.

Optional model drafting uses the existing CGG lifecycle projection in both
Prototype and Delivery. Its source-list and response-envelope digests follow
CGG's compact sorted ASCII-escaped JSON format; source text and its UTF-8 content
digests stay unchanged, as do ART and private source-custody formats. A CGG denial
retains the typed owner reason. Resolve that prerequisite and use the explicitly
linked generation retry; never replace the failed attempt or use raw context.

The caller/operator, owner, source root, branch and fetched base come from that
owner session. Browser input cannot replace them. Trusted Preview/Delivery
owner-preparation requests remain inspect-only; this editor cannot alter their
automation or control metadata. Prototype app/design and ordinary Delivery
retain their different source scopes; there is no universal extension allowlist.

## Inspect, edit or import, and retain a draft

A new ordinary Delivery session has no saved draft yet. Its native `GET <base>/draft`
returns HTTP404 with `delivery_art_source_realization_draft_missing`; the editor then
reads existing source files for the first manual edit or import. Typed source
revision/digest conflicts retain HTTP409 and their owner reason. These are error
responses, never canonical source projections or successful saves. Unknown failures
remain a bounded HTTP500; do not manufacture a draft or invoke a model to bypass an
unavailable first-use read.

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
   The caller-bound draft includes the original retained `objective` for cold
   editing. Its digest must match `change_set.objective_digest`; a consumer
   must not infer that text from ART metadata or ask for a guessed replacement.
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

## Staged source-editor assistant

The shared editor extension has **Files**, **Editor/diff** and **AI assistant**
areas. Select a file to edit, add a file or import local text. Selected context
is visible before sending; unsaved buffers are included only when the operator
sends an assistant request. Files, conversation and model output remain inert.
The assistant can propose new files without requiring the operator to create empty files first. OOS proves absence in the complete owner tree and rejects sibling scopes, unsafe/control paths and replacements of unselected existing files. The assistant cannot select credentials, run tools, save drafts or accept,
commit, publish, review, merge or activate source.

Use **Ask / explain** for questions; replies in this mode cannot contain edits.
Use **Propose edits** for requested changes. Inspect proposed files against the
selected current text, then apply the proposal to local buffers or reject it.
A later selected-file edit or owner revision makes the old proposal inapplicable rather
than overwriting newer work. Follow-up revisions include the unaccepted proposal
only while the original local snapshot remains unchanged. Undo preserves later
edits and saves. Normal private draft saves and exact acceptance remain separate.

The owner APIs add `POST <base>/assist` to both domains in the table above.
Prototype accepts `SourceEditorAssistantRequest`; Delivery wraps it in
`{realization: request}`. It carries stable request/snapshot identities, the
expected owner revision/draft digest, ask/edit mode, prompt, up to8 conversation
turns and up to48 selected UTF-8 files within the existing256KiB read budget.
Each file binds its actual baseline digest or an owner-proven absent path.
The browser cannot provide source coordinates, source scope, identity or a
permission profile. Trusted owner preparations remain inspect-only.

OOS validates the real session, current revision, allowed paths and baseline
through its existing source reader, then admits honestly labelled operator
buffers through CGG. Truncated or denied context fails with no raw fallback.
The governed gateway uses `source_editor_assistance` under the existing
Prototype or Delivery source profile. Its route inherits that profile's source-generation override until explicitly configured otherwise; model, native
reasoning effort, fallback and data-permission checks remain enforced.

Private owner storage retains immutable original requests and replies, including
model audit and context evidence. A response never changes the source revision.
Retry uses the same request identity and input. Stopping a browser wait does not
claim that provider execution stopped; a late reply is never auto-applied.
Any explicit replacement request remains inert and cannot apply an older result.

This extension is staged source in operator review. Fresh composed Security
acceptance and Platform activation are required before live model qualification.
An isolated UI sample or passing model-policy tests do not prove a real account,
provider invocation, delivered source or application readiness.
