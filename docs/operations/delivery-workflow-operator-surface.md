# Delivery Workflow Operator Surface

## Purpose

Define the only supported execution plane for `Workspace Delivery ART`.

The broker is the canonical operator surface for delivery workflow reads and
writes. Product-local OpenProject execution scripts are retired.

## Boundary

Use `operator-orchestration-service` for:

- proposal-to-delivery consumption and closeout
- delivery initiative reads
- delivery planning and PI-objective reads
- delivery work-item reads and writes
- completion, review, and evidence recording

Use `platform-engineering/products/openproject` only for:

- OpenProject runtime deploy, status, and access
- OpenProject bootstrap and schema provisioning
- roadmap-compatible `Target PI` to OpenProject `version` projection
- service identity provisioning
- board/view projection repair, quality wrappers, and one-time normalization
- clean-start, backup, restore, and uninstall controls

Do not add delivery execution scripts back into `platform-engineering`.

## Roadmap Projection

`Target PI` is the canonical ART planning field. The OpenProject roadmap page
is a derived compatibility surface that reads project `version`, not the ART
custom field directly.

That means:

- broker writes set and read `Target PI`
- broker writes that set `Target PI` also set the matching roadmap `version`
  only when the live OpenProject form marks `version` writable
- when OpenProject marks `version` read-only, broker writes keep the canonical
  `Target PI` change and return a roadmap projection report with
  `external_reconciler_required`
- platform-owned OpenProject controls project matching `version` values from
  `Target PI` for provisioning, backfill, and repair
- backlog or active work with blank `Target PI` still projects into the derived
  roadmap bucket `Not yet committed to a PI`
- retired blank-`Target PI` scope projects into the derived roadmap bucket
  `Retired scope`
- roadmap drift is a projection problem, not a second planning source

## Planning Workflow

Broker planning-workflow metadata mirror:

- [delivery-planning-workflow.json](../../src/delivery-planning-workflow.json)

Broker initiative-review workflow mirror:

- [delivery-initiative-review-workflow.json](../../src/delivery-initiative-review-workflow.json)

Broker blocker workflow mirror:

- [delivery-blocker-workflow.json](../../src/delivery-blocker-workflow.json)

Primary blocker checklist:

- `platform-engineering/products/openproject/runbooks/manage-delivery-blockers.md`

That mirror must stay aligned to the canonical OpenProject owner contract in
`platform-engineering/products/openproject/delivery-art-planning-workflow.json`.

Use one planning path for newly accepted work:

Primary start-here decision surface:

- [platform-engineering OpenProject start-delivery-initiative](https://github.com/mfshaf7/platform-engineering/blob/main/products/openproject/runbooks/start-delivery-initiative.md)

1. `POST /v1/ideas/{idea_id}/consume`
   - creates the top-level `Epic` shell only
   - does not auto-create PI objectives, stories, or tasks
2. initiative framing on the `Epic`
   - keep backlog work at `Feature`, `Risk`, and explicit backlog `Defect`
     posture
3. PI planning
   - commit the near-term slice with `Target PI` plus non-backlog `Iteration`
   - create `PI Objective` and committed `Feature` work
   - select a new PI only for a new planning horizon, accepted carryover
     target, or closed/current-PI boundary; child item count alone is not a PI
     split trigger
4. rolling-wave elaboration
   - create `User story` work only for committed features
   - create `Task` work only under active `User story` or `Defect` items
5. execution
   - continue from the child story, defect, or task front instead of treating
     the umbrella `Feature` shell as the executable item
6. PI review and carryover
   - re-target true carryover and decommit work explicitly instead of leaving
     stale PI placement behind

Before resuming a new ART work period when the next front is not already known,
start from one broker bootstrap read:

- `GET /v1/delivery-session/bootstrap`
- preferred local entrypoint:
  - `npm run art -- bootstrap`

That route returns:

- caller identity
- derived runtime namespace and broker service context
- live assignable principals
- active fronts across current initiatives
- initiative-review backlog that is ready for `Closing`, final closeout, or
  retirement

Use it as the fast operator resume packet before dropping into initiative
planning or a specific work-item continuation read.

When the next question is whether the ART lane itself is healthy enough to
trust, use:

- `GET /v1/delivery-session/workflow-health`
- preferred local entrypoint:
  - `npm run art -- workflow-health`

That route returns:

- compatible OpenProject view truth for roadmap and PM²
- roadmap projection drift
- PM² projection drift
- portfolio-level readiness counts for `Closing`, final closeout, and
  retirement

Use it before falling back to platform quality debugging or board/view repair.

When the next question is whether one initiative is healthy, review-ready, or
just stale-open, use:

- `GET /v1/delivery-initiatives/{delivery_id}/review-pack`
- preferred local entrypoint:
  - `npm run art -- initiative review-pack <delivery-id>`

That route returns:

- initiative review readiness
- quality drift lists
- stale-open candidates
- one bounded summary for `Closing`, final closeout, and retirement posture

When the next question is "what should this session read first without burning
tokens on the whole tree", use:

- `GET /v1/delivery-initiatives/{delivery_id}/active-session-packet`
- preferred local entrypoint:
  - `npm run art -- initiative active-session <delivery-id>`

That route returns:

- active and next-ready front summaries
- compact front candidate lists
- quality drift counts
- stale-open candidates
- closeout readiness

When the next question is evidence posture rather than planning posture, use:

- `GET /v1/delivery-initiatives/{delivery_id}/evidence-packet`
- `GET /v1/delivery-work-items/{work_item_id}/evidence-packet`
- preferred local entrypoints:
  - `npm run art -- initiative evidence-packet <delivery-id>`
  - `npm run art -- item evidence-packet <work-item-id>`

Those routes return compact evidence state without raw OpenProject descriptions
or raw execution-tree content.

## WGCF ART Readiness Guard

The normal ART operator path uses Workspace Governance Control Fabric readiness
on meaningful ART paths. WGCF stays read-only and recommendation-only; OOS
remains the mutation authority.

Automatic behavior:

- `npm run art -- item continuation <work-item-id>` reads broker continuation
  context and then runs WGCF ART readiness against that context. The CLI output
  includes `wgcf_art_readiness` with the receipt id, outcome, findings, and
  recommendations.
- `npm run art -- item evidence-packet <work-item-id>` reuses the same
  continuation context root in the evidence packet and includes the same compact
  advisory `wgcf_art_readiness` receipt summary.
- `npm run art -- item complete <work-item-id> <payload.json>` first reads the
  broker continuation context, runs WGCF ART readiness with operation
  `complete`, and fails closed before dispatching the completion mutation when
  WGCF reports `mutation_allowed=false`.
- `npm run art -- item stale-open-close <work-item-id> <payload.json>` uses the
  same fail-closed WGCF readiness guard with operation `stale-open-close`.

Broker behavior:

- When `WGCF_ART_READINESS_MODE=required`, the OOS server reads broker
  continuation context, calls WGCF API `/v1/art/readiness`, and fails closed
  before OpenProject writes for `POST /v1/delivery-work-items/{id}/complete`
  and `POST /v1/delivery-work-items/{id}/stale-open-close`.
- The active `accepted-idea-delivery` dev-integration profile sets
  `WGCF_ART_READINESS_MODE=required` and points the broker to the
  `governance-control-fabric` dev-integration WGCF API service.
- A successful completion-style broker response includes `wgcf_art_readiness`
  when the server-side gate was active.

The blocker route is not wrapped by the same fail-closed guard because blocker
recording and clearing are the remediation path for WGCF readiness findings.
Use `npm run art -- item blocker <work-item-id> <payload.json>` to enter or
clear the blocker through OOS.

WGCF readiness must never mutate ART directly. If readiness blocks a mutation,
the operator must repair metadata, sync projection, record a blocker, route a
defect, or use the recommended OOS path shown in the `wgcf_art_readiness`
payload.

Broker guardrails now enforce that:

- `PI Objective`, `Task`, and `Milestone` work cannot exist without
  `Target PI`; `User story` work requires `Target PI` once executable, active,
  or PI-committed
- active `PI Objective` plan-apply items must include `PI Objective Type`,
  `Planned Business Value`, `Actual Business Value`, `Assignee`, and
  `Responsible` before the broker mutates OpenProject
- `Milestone` remains an `Epic`-level checkpoint only; it does not replace a
  `PI Objective` or a `Feature` leaf front
- PI-committed initiative scope must include at least one `PI Objective`
- PI-committed `Feature` work must keep at least one open `User story` or
  `Defect` child
- executable `User story` and `Task` creation or moves require a PI-committed
  parent
- backlog `Feature` work may keep `new` planned `User story` children only
  while they remain non-executable future decomposition
- active non-`Epic` work cannot stay uncommitted
- PI-committed non-`Epic` work must also carry non-backlog `Iteration`
- PI-committed work with `Target PI` must use an `Iteration` aligned to the
  same PI or an allowed `Program-wide / ...` label; stale prior-PI iteration
  labels are rejected before broker mutation
- generic create, update, and planning-repair paths do not set or clear
  `blocked`
- blocked status must be entered and cleared through the bounded blocker
  workflow
- clearing a blocker resumes only to `new`, `ready`, or `in-progress`

Broker PATCH-based ART writes now also use one bounded safe retry when
OpenProject rejects the request with a stale lock version. The broker refreshes
the live lock version once and replays the same PATCH intent once. If the
conflict persists, the broker still fails the request instead of hiding a
continuing race from the operator.

When that bounded replay touches ART closeout state, the broker also suppresses
identical duplicate write artifacts instead of appending them again. The normal
operator path should not create a second copy of the same system-demo entry,
inspect-and-adapt entry, or identical broker-authored work note just because a
safe retry or equivalent replay happened.

## Phase-To-Route And Gate Matrix

Use this as the broker-side view of the planning workflow:

| Phase | Main Broker Surface | Key Gates |
| --- | --- | --- |
| `consume` | `POST /v1/ideas/{idea_id}/consume` | `consume-top-level-shell-only`, `consume-must-use-proposal-handoff` |
| `frame` | `POST /v1/delivery-work-items`, `POST /v1/delivery-work-items/{work_item_id}/update` | `backlog-feature-must-stay-umbrella-shaped`, `active-non-epic-must-not-stay-uncommitted` |
| `pi-plan` | `POST /v1/delivery-initiatives/{delivery_id}/governance`, `POST /v1/delivery-initiatives/{delivery_id}/plan/apply`, `POST /v1/delivery-work-items`, `POST /v1/delivery-work-items/{work_item_id}/update` | `pi-committed-initiative-must-have-pi-objective`, `target-pi-required-on-committed-leaf-types`, `committed-non-epic-must-carry-non-backlog-iteration`, `roadmap-version-must-match-target-pi-projection` |
| `elaborate` | `POST /v1/delivery-initiatives/{delivery_id}/plan/apply`, `POST /v1/delivery-work-items`, `POST /v1/delivery-work-items/{work_item_id}/move`, `POST /v1/delivery-work-items/bulk-update` | `story-and-task-parent-must-be-committed`, `target-pi-required-on-committed-leaf-types`, `committed-non-epic-must-carry-non-backlog-iteration`, `pi-committed-feature-must-have-open-leaf-child`, `backlog-feature-child-scope-must-stay-non-executable` |
| `execute` | `GET /v1/delivery-work-items/{work_item_id}/continuation-context`, `POST /v1/delivery-work-items/{work_item_id}/update` | `active-non-epic-must-not-stay-uncommitted`, `pi-committed-feature-must-have-open-leaf-child`, `execute-from-leaf-front` |
| `review-carryover` | `POST /v1/delivery-initiatives/{delivery_id}/pi-review`, `POST /v1/delivery-initiatives/{delivery_id}/plan/repair`, `POST /v1/delivery-initiatives/{delivery_id}/close`, `POST /v1/delivery-work-items/{work_item_id}/complete` | `pi-review-must-carry-review-outcome-and-actual-value`, `carryover-must-be-retargeted-or-decommitted` |

## Blocker Workflow

Use the bounded blocker workflow when the exact next committed ART step cannot
proceed.

- record the blocker on the affected work item:
  - `POST /v1/delivery-work-items/{work_item_id}/blocker`
  - `npm run art -- item blocker <work-item-id> <payload.json>`
- do not use generic create, update, or planning-repair to enter or clear
  `blocked`
- when the blocker is caused by a live system or workflow control bug, also
  open or update a real `Defect`
- when the exposure is broader than one blocked item, also open or update a
  `Risk`
- clear blockers only back to `new`, `ready`, or `in-progress`

When a new broker or ART-control defect is discovered during active work,
contain immediate drift first, then classify the defect before implementation:

- `immediate_blocker`: safe continuation is impossible because scoped quality
  remains unhealthy, the next mutation would corrupt state, evidence cannot be
  trusted, the broker/runtime path is down, or an open security/trust exposure
  exists.
- `deferred_defect`: containment restored safe continuation; record the defect
  or follow-up and continue the active committed front.
- `absorbed_same_slice_fix`: the defect shares the active slice's cause, owner,
  validation, review, and rollback boundary.
- `risk`: the exposure is broader than one work item or needs ROAM handling.

Do not turn every real broker defect into an immediate context switch after
containment. Fix immediately only for `immediate_blocker` cases or when the
operator explicitly approves absorbing the defect into the current Landing Unit.

Canonical gate ids:

- `blocked-status-must-use-blocker-workflow`
- `blocked-status-requires-bounded-blocker-record`
- `active-blocker-record-must-stay-on-blocked-item`
- `blocker-clear-must-use-active-resume-status`
- `exact-blocker-must-be-recorded-before-adjacent-mutation`

## PM² Initiative Review And Closing

Use one explicit initiative-review path for top-level `Epic` closeout:

1. preferred success path
   - `POST /v1/delivery-initiatives/{delivery_id}/close`
2. underlying primitive steps, when the guided workflow is not the target under test
   - `POST /v1/delivery-initiatives/{delivery_id}/system-demo`
   - `POST /v1/delivery-initiatives/{delivery_id}/governance`
   - `POST /v1/delivery-initiatives/{delivery_id}/inspect-and-adapt`
   - `POST /v1/delivery-initiatives/{delivery_id}/governance`
3. retire the initiative only as a separate terminal path
   - `POST /v1/delivery-initiatives/{delivery_id}/governance`

Broker gates now enforce:

- `Closing` requires recorded system-demo evidence
- `Closing` requires a clean execution tree and clean descendant closeout state,
  including done-state narrative evidence
- unresolved dependency gates apply when the initiative or one of its
  descendants is the dependency target; an open downstream consumer that
  requires the initiative does not block the predecessor initiative from
  closing
- `done` requires `PM² Phase = Closing`
- `done` requires both system-demo and inspect-and-adapt evidence
- `done` requires final closeout readiness to stay clean
- `retired` is not a PM² phase
- `retired` is allowed only when all descendants are already `done` or `retired`
- the retirement transition clears the stored `PM² Phase` value

Use `GET /v1/delivery-initiatives/{delivery_id}/closeout-readiness` before the
final governance update. That read now distinguishes:

- initiative readiness to enter `Closing`
- final readiness to mark the initiative `done`
- terminal readiness to mark the initiative `retired`

## Supported API Families

### Preferred Local CLI

For normal local ART sessions on the active devint lane, prefer the broker CLI
instead of raw `kubectl exec ... node -e ...` commands:

- `npm run art -- bootstrap [--json]`
- `npm run art -- workflow-health [--json]`
- `npm run art -- initiative active-session <delivery-id> [--json]`
- `npm run art -- initiative evidence-packet <delivery-id> [--json]`
- `npm run art -- initiative review-pack <delivery-id> [--json]`
- `npm run art -- initiative execution-summary <delivery-id> [--json]`
- `npm run art -- initiative planning <delivery-id> [--json]`
- `npm run art -- initiative planning-repair <delivery-id> <payload.json>`
- `npm run art -- initiative closeout-readiness <delivery-id> [--json]`
- `npm run art -- initiative close <delivery-id> <payload.json>`
- `npm run art -- item continuation <work-item-id> [--json]`
- `npm run art -- item evidence-packet <work-item-id> [--json]`
- `npm run art -- item blocker <work-item-id> <payload.json>`
- `npm run art -- item complete <work-item-id> <payload.json>`
- `npm run art -- item stale-open-close <work-item-id> <payload.json>`
- `npm run art -- scaffold item-complete <work-item-id> <output.json> [repo-root...]`
- `npm run art -- scaffold initiative-close <delivery-id> <output.json> [repo-root...]`
- `npm run art -- draft operations`
- `npm run art -- draft create <operation> <target-id-or-dash> <output.json>`
- `npm run art -- draft show <draft.json>`
- `npm run art -- draft validate <draft.json>`
- `npm run art -- draft submit <draft.json>`
- `npm run art -- draft discard <draft.json> [reason]`
- `npm run art -- draft export <draft.json> <output.json>`
- `npm run art -- draft import <input.json> <output.json>`
- `npm run art -- wgcf draft <handshake.json> <output.json>`
- `npm run art -- review-packet draft <delivery-id> <output.json> <work-item-id...> [--repo-root <path>...]`
- `npm run art -- review-packet evidence-packet <packet.json>`
- `npm run art -- review-packet validate <packet.json>`
- `npm run art -- review-packet readiness <packet.json>`
- `npm run art -- review-packet finalize <packet.json>`
- `npm run art -- landing-unit status <packet.json>`
- `npm run art -- landing-unit dry-run <packet.json>`
- `npm run art -- landing-unit submit <packet.json>`
- `npm run art -- lifecycle status <plan.json>`
- `npm run art -- lifecycle reconcile <plan.json>`
- `npm run art -- projection status [--json]`
- `npm run art -- projection sync [--pi-names <names>] [--target-epic-id <id>] [--quality] [--force] [--dry-run]`
- `npm run art -- projection clear [reason]`
- `npm run art -- scratch status`
- `npm run art -- scratch cleanup [--archive-legacy] [--dry-run]`

The CLI keeps the operator surface broker-owned while hiding the pod-exec
mechanics that are still required by the active devint profile.

Read-heavy ART commands print compact operator summaries by default. Use
`--json` only when the complete broker response is needed. If a non-JSON
response is still large, the CLI writes the full response under `.art/outputs/`
and prints the path instead of pasting the whole payload.

### Resumable Source Delivery Lifecycle

For new source-backed ART work, use one lifecycle plan and rerun the same
controller instead of manually coordinating work-start and Review Packet
commands.

1. Record the approved Landing Unit in a plan under `.art/lifecycle/` using the
   contract at
   [`contracts/delivery-art-lifecycle/lifecycle-plan.schema.json`](../../contracts/delivery-art-lifecycle/lifecycle-plan.schema.json).
   Store the plan and artifact paths in stable operator state, not inside the
   disposable Landing Unit worktree.
2. Inspect the current durable and source state without mutation:
   - `npm run art -- lifecycle status .art/lifecycle/<name>.json`
3. Advance every currently eligible mechanical transition:
   - `npm run art -- lifecycle reconcile .art/lifecycle/<name>.json`
4. When reconciliation reports a gate, complete that operator-owned action and
   rerun the same command.
5. After a finalized schema-v2 Review Packet exists, use `landing-unit dry-run`
   and `landing-unit submit` for explicit ART closeout, then rerun lifecycle
   status to prove completion.

The lifecycle plan binds:

- one Delivery initiative and its covered work items
- one owner-repo Landing Unit, branch, base ref, and rollback boundary
- the operator decision source
- whether an architecture packet is required
- stable paths for work-start, structured evidence, Review Packet, and
  readiness receipt artifacts
- an automatically recorded finalized Review Packet reference after durable
  finalization, allowing terminal status to resolve exact WGCF custody without
  the source worktree

The structured evidence file follows the schema-v2 Review Packet evidence
shape: `changed_surfaces`, `tests`, `validations`, `acceptance_mapping`,
`runtime_and_live`, and `security_and_trust`. Each acceptance row maps one
covered work item to concrete evidence ids. An optional `exceptions` array must
carry valid authority and expiry data before reconciliation can continue.
After source merge, add any operating-readiness evidence required by the
architecture conformance plan to the same file. Finalization authoring extends
the durable merge-ready packet from that file and fails if earlier evidence or
acceptance mappings were removed or rewritten.

`status` never mutates. `reconcile` is idempotent and may draft or persist an
already authorized artifact, evaluate readiness, or finalize durable evidence.
It stops for architecture decisions, source implementation, evidence repair,
pull-request creation or review, source merge, exception acceptance, and ART
closeout. It does not create or merge a pull request, accept an exception, make
an architecture decision, or close ART work automatically.

Git and GitHub are inspected as source truth. Until merge readiness becomes
durable, the local checkout must remain on the plan branch, clean, committed,
and pushed; an open non-draft PR must bind
the exact local head before merge-readiness can advance. The controller is
then bound to the durable merge-ready packet until its exact merge is proven;
later checkout changes do not rewrite that durable source truth. The controller
is adapter-independent so a future Temporal adapter can drive the same state
machine without changing these gates.

### 90 Percent Optimization Surfaces

The #650 optimized read path is now part of the supported local CLI for compact
session and evidence reads. Operators should use the packet reads immediately
to avoid repeated full-tree and full-packet rereads.

The landing-unit closeout path is:

1. finalize the Review Packet after source evidence is real
2. inspect live coverage:
   - `npm run art -- landing-unit status .art/review-packets/<name>.json`
3. prove the mutation sequence without writing:
   - `npm run art -- landing-unit dry-run .art/review-packets/<name>.json`
4. submit the landing unit:
   - `npm run art -- landing-unit submit .art/review-packets/<name>.json`

`submit` completes still-open covered children using payloads derived from the
finalized Review Packet, refreshes parent evidence after child completion, and
then closes eligible stale-open parent Features when the packet covers all open
child scope. If the packet also names that parent Feature, status and dry-run
show it as `parent_closeout_after_children` instead of planning a direct parent
completion. Nested parent closeouts run deepest-first. It returns child
completion receipts, parent closeout receipts, and the projection checkpoint
state so operators do not need to re-read every child and parent manually.

`status` and `dry-run` return `generated_payload_preflight`. This preflight is
the local contract check for the exact child-completion and parent-closeout
payloads that `submit` would send to the broker. If it is invalid,
`ready_to_submit=false`; fix the Review Packet evidence before retrying submit
instead of relying on the live broker mutation to discover formatting drift.

For oversized ART or validation output, the CLI defaults to CGG packet
projection. Operator-visible output keeps the `.art/outputs` artifact path and
adds `cgg_packet_ref` with packet, receipt, manifest, digest, and
admission-decision metadata. Oversized `--json` output is suppressed into the
artifact plus packet reference instead of raw-printing. Projection sync
subprocess stdout/stderr is captured into `.art/outputs` and packetized instead
of being streamed raw. Use
`ART_CGG_PACKETING=off` only for explicit local debugging, and use
`ART_CGG_PACKETING=required` when the command must fail closed if CGG projection
is unavailable.

The scaffold commands are local helpers on the same entrypoint. They generate
editable closeout payloads from repo state so operators do not have to hand-build
every JSON body for item completion or initiative closeout. When multiple repo
roots are supplied, the scaffold links them together into one closeout packet by
including changed surfaces, branch/head references, and changed change-record
paths across those repos.

Use the blocker workflow when the exact next committed ART step cannot proceed.
Do not use generic update to move work into or out of `blocked`.

### Mutation Drafts And Review Packets

Do not create long-lived ART write payloads by hand under `.tmp/`.

Use the managed draft workflow instead:

1. create the draft:
   - `npm run art -- draft operations`
   - `npm run art -- draft create <operation> <target-id-or-dash> .art/drafts/<name>.json`
2. edit only the generated draft payload
3. validate the draft:
   - `npm run art -- draft validate .art/drafts/<name>.json`
4. submit through the broker route locked into the draft:
   - `npm run art -- draft submit .art/drafts/<name>.json`
5. discard obsolete drafts instead of leaving ambiguous files behind:
   - `npm run art -- draft discard .art/drafts/<name>.json "replaced by newer draft"`

When WGCF provides a readiness receipt, blocker recommendation, closeout draft
hint, or Review Packet ref, import it through the WGCF handoff adapter instead
of copying its recommendation into a raw payload:

1. store the WGCF handoff as a reference-only JSON file
2. import it into a managed draft:
   - `npm run art -- wgcf draft .art/wgcf/<name>.json .art/drafts/<name>.json`
3. validate and submit only through the normal OOS draft commands

WGCF-sourced drafts must keep `source_authority = recommendation_only`,
`mutation_authority = operator-orchestration-service`, and
`direct_mutation_allowed = false`. Direct ART mutation endpoints reject
WGCF-class callers.

The draft validation fails or warns when:

- the operation is unsupported
- the route has been changed away from the expected broker route
- the route points outside `/v1/...`
- the route or payload tries to use raw OpenProject paths
- the draft was discarded
- payload evidence still points at `.tmp/`
- placeholders remain in the payload
- bulk-update description changes that include completion sections fail the
  same completion-evidence formatting checks used by the submit route

The direct Review Packet draft procedure below is schema-v1 compatibility for
existing packets. Do not start new source-backed work with it; use the
resumable lifecycle path above. To finish or migrate an existing schema-v1
packet:

1. create the packet from current repo state:
   - `npm run art -- review-packet draft <delivery-id> .art/review-packets/<name>.json <work-item-id...> --repo-root <source-repo>`
   - use exactly one `--repo-root`; split every additional owner repo into its
     own Review Packet and Landing Unit
   - broker-local `.art/drafts`, `.art/payloads`, `.art/outputs`,
     `.art/review-packets`, `.art/archive`, `.tmp`, and platform-drill scratch
     paths are excluded from source evidence
2. fill the pre-merge landing-unit evidence while the PR is still open:
   - `landing_unit.evidence_kind` = `open_pr`
   - `landing_unit.pr_url`
   - `landing_unit.rollback_boundary`
   - `evidence.changed_surfaces`
   - `evidence.test_results`
   - `evidence.validations`
   - `completion_mapping`
3. validate the packet shape:
   - `npm run art -- review-packet validate .art/review-packets/<name>.json`
4. run the pre-merge landing readiness gate before merging:
   - `npm run art -- review-packet readiness .art/review-packets/<name>.json`
5. merge only after readiness passes, then update durable source evidence:
   - `landing_unit.evidence_kind` = `merged_pr`
   - `landing_unit.merge_commit`
6. finalize only after source evidence or approved non-source evidence is real:
   - `npm run art -- review-packet finalize .art/review-packets/<name>.json`
7. use the finalized packet digest in ART completion evidence.

The readiness gate is the pre-merge item-completeness control. It fails closed
when the packet still has placeholders, missing open PR evidence, no item-level
completion mapping, unexplained changed surfaces, missing test or validation
evidence, empty repo changed-file evidence, more than one owner repo, an
unclear rollback boundary, or stale source binding. The CLI proves the exact
clean local head, pushed remote branch, and live open GitHub PR head before it
reports ready.
Do not merge and plan to "patch the packet later" when readiness fails; fix the
same PR or explicitly split the landing unit before merge.

`validate` and `finalize` also print compact operator summaries by default so
the normal closeout path does not paste the full evidence packet into chat. Use
`--json` only when you need the complete broker response; the full durable
packet remains in `.art/review-packets/<name>.json`.

Final Review Packet validation fails closed when durable evidence is missing,
when placeholders remain, or when the packet references `.tmp/` scratch payloads
as evidence. `.tmp/` payloads are legacy unmanaged scratch. They can be inspected
with:

- `npm run art -- scratch status`

Archive legacy scratch only after durable evidence is confirmed:

- dry-run:
  - `npm run art -- scratch cleanup --dry-run`
- archive:
  - `npm run art -- scratch cleanup --archive-legacy`

#### Governed Work-Start And Review Packet Custody

The lifecycle controller is the normal operator path over schema-v2 custody.
Use the direct commands in this section only for bounded diagnosis, recovery,
or contract verification of artifacts produced against the pinned Delivery ART
bundle. Do not hand-convert a schema-v1 Review Packet or copy a digest from
operator notes.

An operator-approved architecture packet remains a local candidate until the
architecture persistence command succeeds. It is valid input to that command,
but it cannot satisfy a work-start architecture dependency until WGCF returns
durable artifact custody. OOS validates each command's transformed candidate
before registry submission so an invalid readiness or chronology projection
cannot become durable evidence.

The equivalent lower-level command sequence is:

1. validate the local candidate:
   - `npm run art -- artifact validate <artifact.json>`
2. persist an approved architecture decision when architecture is required:
   - `npm run art -- architecture persist <architecture.json>`
3. evaluate work-start from its current scoped ART snapshot:
   - `npm run art -- work-start evaluate <work-start.json>`
4. mark a schema-v2 Review Packet merge-ready before source merge:
   - `npm run art -- review-packet readiness <packet.json>`
5. after merge evidence is real, prepare the finalization subject:
   - `npm run art -- review-packet prepare-finalization <packet.json>`
6. ask WGCF to issue the immutable operating-readiness receipt:
   - `npm run art -- review-packet operating-readiness <packet.json> <receipt.json>`
7. finalize with that exact receipt:
   - `npm run art -- review-packet finalize <packet.json> --readiness-receipt <receipt.json>`

Successful mutation commands replace the supplied local file with the exact
broker-returned artifact. `artifact resolve` reads historical immutable
evidence by the ref and digest already present in that file; it verifies the
artifact and custody chain without requiring the recorded ART snapshot to
remain current, and it does not mutate the file. Any command that consumes that
artifact to advance the lifecycle performs its own fresh scoped ART check
before mutation.

Treat these outcomes distinctly:

- registry rejection: no OpenProject projection occurred; fix authority,
  schema, dependency, or registry availability before retrying
- corrected pre-merge source head: regenerate the local Review Packet through
  lifecycle reconciliation while the same pull request remains open. The
  lifecycle revalidates the clean pushed head and current evidence, then its
  deterministic packet identity includes the exact repo, base, branch, PR, and
  head revision set. The corrected packet receives new immutable custody
  without overwriting the earlier merge-ready record; a different, closed, or
  wrong-base pull request remains blocked
- OpenProject projection failure: WGCF custody already succeeded; retain the
  returned safe refs and retry the same canonical digest
- stale scoped ART snapshot: regenerate the local candidate from current ART
  truth; do not overwrite or delete the earlier durable record
- blocked or review-required readiness: retain the receipt as decision evidence,
  resolve its findings, regenerate the post-merge candidate, and issue a new
  receipt generation; do not attempt finalization
- missing readiness client: issuance and finalization fail closed; preparation
  output remains only a local candidate

Do not attach artifact bodies to OpenProject, use OpenProject attachments as a
fallback registry, or delete WGCF evidence to simulate rollback. Rollback is a
new superseding artifact and an explicit ART decision.

### Proposal To Delivery

- `POST /v1/ideas/{idea_id}/consume`
- `POST /v1/ideas/{idea_id}/closeout`
- `POST /v1/ideas/delivery-closeouts/reconcile`

`POST /v1/ideas/{idea_id}/consume` creates one top-level `Epic` shell in
`Workspace Delivery ART`. It is the initiative entry point, not the place to
pre-expand a full execution tree. When the durable initiative owner is already
known, the same consume route may also set top-level `owner_repo` so the epic
lands with machine-readable ownership from the first write.

Normal top-level initiative closeout attempts the linked Proposal transition
after Delivery is durably `done`. Read `source_closeout_status` in the close
response:

- `implemented`: source Proposal changed to terminal implementation state
- `replayed`: the exact source relationship was already closed
- `not_applicable`: the Delivery initiative did not originate from a Proposal
- `source_closeout_pending`: Delivery remains complete; retry the exact
  `source_closeout_receipt.retry` route after the source issue is resolved

Historical repair is always dry-run first. Call
`POST /v1/ideas/delivery-closeouts/reconcile` with `input.mode = dry-run`,
review every item outcome, and use `input.mode = apply` plus an explicit
`closeout_notes` value and the returned `candidate_digest` as
`expected_candidate_digest` only when the report contains the expected exact
backlinks. Apply fails before mutation when the candidate set changed.
`delivery_retired`, missing backlinks, and inspection failures are never
applied.

### Delivery Session Reads

- `GET /v1/delivery-session/bootstrap`
- `GET /v1/delivery-session/workflow-health`
- `GET /v1/delivery-session/quality-pack`

### Delivery Initiative Reads

- `GET /v1/delivery-initiatives`
- `GET /v1/delivery-initiatives/{delivery_id}/active-session-packet`
- `GET /v1/delivery-initiatives/{delivery_id}/evidence-packet`
- `GET /v1/delivery-initiatives/{delivery_id}/review-pack`
- `GET /v1/delivery-initiatives/{delivery_id}/execution-summary`
- `GET /v1/delivery-initiatives/{delivery_id}/planning`
- `GET /v1/delivery-initiatives/{delivery_id}/pi-objectives`
- `GET /v1/delivery-initiatives/{delivery_id}/closeout-readiness`

### Delivery Initiative Writes

- `POST /v1/delivery-initiatives/{delivery_id}/governance`
- `POST /v1/delivery-initiatives/{delivery_id}/plan/apply`
- `POST /v1/delivery-initiatives/{delivery_id}/plan/repair`
- `POST /v1/delivery-initiatives/{delivery_id}/system-demo`
- `POST /v1/delivery-initiatives/{delivery_id}/inspect-and-adapt`
- `POST /v1/delivery-initiatives/{delivery_id}/pi-review`
- `POST /v1/delivery-initiatives/{delivery_id}/close`

### Delivery Work-Item Reads And Writes

- `GET /v1/delivery-work-items/{work_item_id}/continuation-context`
- `GET /v1/delivery-work-items/{work_item_id}/evidence-packet`
- `POST /v1/delivery-work-items`
- `POST /v1/delivery-work-items/bulk-update`
- `POST /v1/delivery-work-items/{work_item_id}/update`
- `POST /v1/delivery-work-items/{work_item_id}/move`
- `POST /v1/delivery-work-items/{work_item_id}/blocker`
- `POST /v1/delivery-work-items/{work_item_id}/dependency`
- `POST /v1/delivery-work-items/{work_item_id}/parking`
- `POST /v1/delivery-work-items/{work_item_id}/complete`
- `POST /v1/delivery-work-items/{work_item_id}/stale-open-close`

Use `POST /v1/delivery-work-items` and the update surfaces for rolling-wave
elaboration after PI commitment exists, or to record backlog `User story`
children that remain explicitly non-executable. They are not intended to create
pre-PI executable story forests.

Before submitting a work-item create payload, run the local preflight:

- `npm run validate:work-item-create -- <payload.json>`

This is required for active `PI Objective`, `Feature`, `User story`, `Defect`,
`Task`, and `Risk` creation. The guard checks planning posture, required active
execution fields, assignee/responsible fields, and type-specific narrative
headings. Active `Feature` work must be closeout-ready from the start: it needs
`Evidence Expectation` and `Operator work notes` before child execution can
consume the leaf front, not only when the parent is being closed.

For PI Objective creation, the request schema is not generic. The API contract
publishes a dedicated `DeliveryActivePiObjectiveCreateInput` branch and the
API-doc validator checks that branch against the same broker preflight rules,
so missing PI Objective fields are caught at draft/schema review time instead
of only by the live mutation route.

When these broker writes create, update, or complete PI-committed work, they
must keep canonical `Target PI` aligned. They keep the roadmap-compatible
`version` projection aligned in the same write only when the live OpenProject
form marks `version` writable. If the form marks it read-only, platform view
sync is the first-class projection owner for the derived roadmap field, and the
broker response reports that reconciliation requirement instead of failing the
canonical write.

Projection reconciliation is part of the ART workflow, not an exceptional
debugging step. Broker mutations that receive an OpenProject
`external_reconciler_required` roadmap projection report now mark local
projection state dirty in `.art/projection-state.json`. Operators may batch
related dirty events during one coherent work burst, but the checkpoint must be
cleared before using the quality gate as final evidence. This applies to:

- `plan/apply` created or updated child entries whose nested
  `creation_applied` or `changes_applied` section carries the projection report
- assigning, clearing, or retargeting `Target PI`
- moving work between backlog, committed, active, done, parked, or retired
  roadmap buckets
- carryover, decommit, parking, retirement, completion, or platform-admin
  repair work that can change the expected `version` projection

The normal checkpoint sequence is:

1. submit the broker mutation
2. inspect `npm run art -- projection status`
3. continue related child closeouts only while the projection checkpoint remains
   intentionally dirty
4. run `npm run art -- projection sync --pi-names "<known-pi-names>" --target-epic-id <epic-id> --quality`
5. continue only when roadmap projection drift is zero

Use `POST /v1/delivery-work-items/{work_item_id}/stale-open-close` only when a
bounded read already shows a stale-open candidate shape:

- the parent work item is still open
- its children are all terminal
- the operator is explicitly attesting that completed child scope satisfies the
  parent item

That route still requires normal completion evidence. It is a guarded closeout
helper, not a bypass around ART completion discipline.

Completing the last open child under a PI-committed `Feature` is also a parent
closeout-readiness event. WGCF readiness must block that child completion if
the parent Feature is missing the closeout-ready narrative headings. Repair the
parent through a bounded `work-item.update` draft before closing the last child;
do not wait for stale-open closeout to discover the weak parent narrative.

When a stale-open parent predates the stricter Feature execution contract,
repair only the required closeout metadata through the bounded update route
before stale-open closeout. This is allowed only when all leaf children are
already terminal and the update is limited to closeout metadata such as
acceptance criteria, definition of ready/done, narrative description, execution
context fields, execution classification, and an operator work note. It must not
be used to keep active Feature work moving without an open executable leaf.

Use `POST /v1/delivery-initiatives/{delivery_id}/plan/repair` when the operator
intent is explicitly planning repair instead of generic item patching.

Use `POST /v1/delivery-initiatives/{delivery_id}/pi-review` before closing a
PI Objective when the objective needs actual business value and review outcome
recorded. In the managed draft payload, `target_work_package_id` is the raw
positive OpenProject work-package id as an integer or numeric string; do not
use broker-shaped ids such as `work-item-476` in that field.

Supported repair actions are:

- `retarget`
  - carry open work into the next PI with explicit `target_pi` and
    non-backlog `iteration`
- `decommit`
  - return eligible backlog-shaped work to backlog posture
  - the broker forces `status=new`, clears `Target PI`, and applies the
    backlog iteration label
- `execution_posture_correction`
  - fix planning-governance posture such as `delivery_team`, assignee,
    responsible, `target_pi`, `iteration`, `status`, or risk posture fields
    like `roam_state`, `risk_owner`, `risk_review_date`, and
    `risk_disposition`
  - use it to restore closeout-required `target_pi` and `iteration` only when
    all Feature leaf children are terminal and no open child scope remains
  - the broker permits only that closeout metadata plus the audit note in this
    terminal-child case; ordinary Feature commitment still uses `plan/apply`

That route fail-closes when:

- a target work item is outside the requested initiative
- a target work item is already `done` or `retired`
- `decommit` is attempted on work that structurally requires `Target PI`
- `decommit` is attempted while open child scope still exists

### Completion Write Preflight

Before `POST /v1/delivery-work-items/{work_item_id}/complete`, validate the
evidence payload locally:

- `npm run validate:completion-evidence -- <payload.json>`

Then use the normal CLI completion path so WGCF readiness runs before broker
mutation dispatch and the broker's own server-side readiness gate also runs
before the OpenProject write in required profiles:

- `npm run art -- item complete <work-item-id> <payload.json>`

`<payload.json>` may be either the broker route envelope `{ "input": { ... } }`
or the inner completion-evidence object accepted by
`npm run validate:completion-evidence`; the CLI normalizes the latter before
broker submission.

The CLI fails closed when WGCF reports blocking readiness findings, before the
completion request is sent to the broker. After WGCF allows the mutation,
the broker synchronizes `Execution Context` from the stored work-item metadata
and then confirms the done-state description still follows the strong narrative
shape before writing:

- required narrative headings for the item type stay present
- `Changed Surfaces` bullets explain what changed on each surface rather than
  listing bare paths, and source paths are code-formatted or linked
- `Execution Context` stays a flat bullet list
- broker rewrites update `Execution Context` in place instead of moving it
  behind later sections such as `Operator work notes`
- `Execution Context` keeps the stored owner repo, parent item, delivery team,
  and iteration values when those fields apply
- any broker-added completion note still lands inside `Operator work notes`
  rather than as a stray evidence bullet

Required evidence line prefixes:

- `Test Result Evidence`
  - `- PASS: ...`
  - `- FAIL: ...`
  - `- NOT APPLICABLE: ...`
  - `- Attached artifact: ...`
- `Validation Evidence`
  - `- PASS: ...`
  - `- FAIL: ...`
  - `- CHECK: ...`
  - `- NOT APPLICABLE: ...`
  - `- Attached artifact: ...`

If `POST /v1/delivery-work-items/{work_item_id}/update` leaves the work item in
`done`, the broker now revalidates the final stored body before patching
OpenProject:

- completion evidence must still satisfy the ART closeout bullet contract
- the done-state narrative must still satisfy the stronger closeout template
- any broker-added work note must stay inside `Operator work notes`
- if the work item carries `Target PI`, the roadmap `version` projection must
  remain aligned while the done-state update is written when OpenProject marks
  `version` writable; otherwise the broker must report that platform projection
  reconciliation is required

Do not let the live broker write be the first place malformed completion
evidence fails.

### Assignee And Responsible Preflight

Before `POST /v1/delivery-work-items`,
`POST /v1/delivery-work-items/{work_item_id}/update`, or
`POST /v1/delivery-initiatives/{delivery_id}/governance` sets
`assignee_login` or `responsible_login`, read the live assignable-principal
list first.

The same governance route is also the only supported way to set top-level
initiative-lineage fields:

- `initiative_family`
- `lineage_role`
- `architecture_anchor_ref`
- `required_upstream_ref`

Operator rule:

- do not hand-edit lineage in raw OpenProject screens
- a top-level Epic may stay unclassified only while it is the brand-new
  `new` + `Initiating` shell with blank `Target PI`
- once it leaves that shell posture, set family and lineage through the broker
- if the lineage role requires an anchor or upstream gate, set those refs in
  the same governance write

Default local execution path from the active devint broker pod:

- `k3s kubectl -n <active-devint-namespace> exec deploy/operator-orchestration-service -- node scripts/show_delivery_art_assignables.mjs`

Operator rule:

- choose `assignee_login` and `responsible_login` only from that live list
- do not infer the login from repo names, ART board wording, or Rails-admin
  pages
- use the exact principal login the list returns

The broker still enforces assignability from the live OpenProject form schema,
but the operator should not discover that constraint only after a rejected
write.

## Caller Rules

- callers use broker workflow routes, not raw OpenProject REST writes
- callers use broker caller auth, correlation, and bounded payloads
- callers may continue to use raw numeric OpenProject ids during the current
  compatibility period, but the durable contract is broker-shaped delivery and
  work-item ids

## Dev-Integration Execution

Inside the `accepted-idea-delivery` devint profile, validate these routes by
calling the broker deployment in the profile namespace.

Default local execution path:

- use `npm run art -- ...` for normal ART reads, writes, draft handling, Review
  Packet handling, and scratch inspection
- let the CLI hide the required devint `k3s kubectl exec` mechanics
- use direct top-level `k3s kubectl` calls only when the broker runtime or CLI
  path itself is being debugged, or when platform-admin runtime repair is
  required outside the delivery execution plane
- prefer the CLI over local Python wrappers, product-local OpenProject scripts,
  or ad hoc background port-forward bridges
- use localhost port-forwarding only when an operator explicitly needs a browser
  or another host-local interactive client

Use the broker pod environment for:

- `CALLER_ALLOWED_IDS`
- `CALLER_AUTH_SHARED_SECRET`

The broker `exec ... node ... fetch(...)` path reuses that environment
directly, so the local shell does not need to reconstruct the caller secret
path just to read or write ART state.

Header contract:

- `x-oos-caller-id`
- `x-oos-caller-secret`

That keeps the proof path aligned with the real internal workflow seam.

When platform-owned OpenProject admin repair is required, first read the active
runtime context from:

- `npm run art -- bootstrap`

Then bind platform-admin commands to that proven context. Do not allow generic
Makefile defaults such as `openproject/openproject-web` to run in a devint ART
lane after bootstrap has already shown a different namespace or deployment.

For the active accepted-idea-delivery devint lane, use the broker checkpoint as
the normal repair shape:

```bash
OPENPROJECT_NAMESPACE=<bootstrap runtime namespace> \
OPENPROJECT_DEPLOYMENT=<active OpenProject web deployment> \
npm run art -- projection sync --pi-names "PI-2026-02,PI-2026-03" --target-epic-id <epic-id> --quality
```

If the active OpenProject deployment is not in the bootstrap packet, prove it
from the platform runtime owner before running the admin command and state that
proof in the operator update.

## Continuation Default

When resuming active ART work:

1. use `GET /v1/delivery-initiatives/{delivery_id}/planning` to find the
   current in-progress front when the target item is not already known
2. use `GET /v1/delivery-work-items/{work_item_id}/continuation-context` to
   retrieve one compact resumption packet for the chosen item
3. do not pass the top-level delivery `Epic` itself to the continuation route
   as executable work; the broker rejects that with
   `initiative_epic_not_executable` and the operator must use initiative
   planning, governance, or review-pack surfaces first
4. if planning surfaces a `ready` `PI Objective`, `Feature`, or another
   umbrella item such as a `Feature` or `User story` classified as `Enabler`,
   do not treat planning as sufficient proof that it is executable next work
5. inspect that item's continuation packet before recommending it as the next
   front
6. if the continuation packet shows `open_child_count=0` and completed related
   scope already satisfies the item, treat it as a stale-open closeout
   candidate instead of the active execution front

The continuation packet is the default resume read for ART work because it
returns the target item, parent chain, related open siblings, previously
completed related items, target dependency context, target execution
classification, and enclosing initiative lineage context without forcing the
operator to scan the entire execution tree by hand.

It also includes compact narrative metadata (`description_present` and
`description_headings`) for work-item nodes. WGCF readiness uses those headings
for Feature completion and stale-open closeout checks, while raw OpenProject
description bodies stay out of the compact context.

## Strict Exception Rule

Direct OpenProject runners are allowed only for:

- bootstrap before the broker runtime is available
- break-glass recovery
- platform-admin maintenance that is not part of the delivery execution plane

Those exceptions are not a second supported operator surface.
