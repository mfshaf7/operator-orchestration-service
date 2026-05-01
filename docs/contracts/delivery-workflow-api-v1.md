# Delivery Workflow API v1

## Purpose

Define the next broker-owned internal API families for delivery execution after
the proposal-plane handoff is complete.

This contract extends the current bounded broker model from:

- proposal-plane lifecycle under `/v1/ideas/...`

into:

- delivery-session bootstrap reads under `/v1/delivery-session/...`
- delivery artifact lifecycle under `/v1/delivery-art/...`
- delivery-initiative workflow under `/v1/delivery-initiatives/...`
- delivery work-item workflow under `/v1/delivery-work-items/...`

It does not turn the broker into a generic OpenProject proxy.

## Delivery Artifact API Family

### Purpose

Own the pre-write and source-evidence artifact lifecycle for Workspace Delivery
ART so operators do not keep long-lived ad hoc payloads under `.tmp/`.

This family is intentionally not a raw file store. The broker owns the schema,
operation vocabulary, validation rules, and finalization checks. The local CLI
may write managed editable files under `.art/`, but those files are drafts or
review evidence packets, not the canonical ART record.

### Command Endpoints

- `POST /v1/delivery-art/mutation-drafts`
- `POST /v1/delivery-art/mutation-drafts/validate`
- `POST /v1/delivery-art/wgcf/mutation-drafts`
- `POST /v1/delivery-art/review-packets`
- `POST /v1/delivery-art/review-packets/validate`
- `POST /v1/delivery-art/review-packets/readiness`
- `POST /v1/delivery-art/review-packets/finalize`

### Mutation Draft Contract

Mutation drafts bind an intended operator write to one supported broker route.

A draft must carry:

- `schema_version = 1`
- `artifact_type = art_mutation_draft`
- `operation`
- normalized target identity when the operation needs one
- locked broker route
- editable broker payload
- validation and submission state

Validation must fail or warn when:

- the operation is unsupported
- the target id does not match the operation target kind
- the stored route differs from the operation's expected broker route
- the route points outside `/v1/...`
- the route attempts to use raw OpenProject paths
- the draft was discarded
- payload evidence still points at `.tmp/`
- placeholders remain in the payload
- bulk-update description changes that include completion sections fail the
  same completion-evidence formatting checks used by the submit route

The CLI submission path validates the draft and then submits the locked route
through the broker. It does not submit raw OpenProject REST requests.

### WGCF Receipt Handoff Contract

`POST /v1/delivery-art/wgcf/mutation-drafts` imports
`workspace-governance-control-fabric` receipt references into managed mutation
drafts.

The handoff is reference-only:

- WGCF may send readiness receipts, closeout draft hints, blocker
  recommendations, and Review Packet refs.
- WGCF must send refs and digests, not raw operational context or full
  artifacts.
- OOS creates a draft with `source_authority = recommendation_only`.
- OOS keeps `mutation_authority = operator-orchestration-service`.
- The route never submits the draft.
- Direct ART mutation routes reject WGCF-class callers even if the caller is
  otherwise authenticated.

The dedicated payload contract is in
[`wgcf-art-handoff-v1.md`](wgcf-art-handoff-v1.md).

When `WGCF_ART_READINESS_MODE=required`, OOS also performs its own
server-side WGCF readiness check before `complete` and `stale-open-close`
OpenProject writes. This is not caller-supplied proof; the broker reads
continuation context, calls WGCF `/v1/art/readiness`, and fails closed when
WGCF reports `mutation_allowed=false`.

### Review Packet Contract

Review Packets bind one source landing unit to one or more ART work items.

A packet must carry:

- `schema_version = 1`
- `artifact_type = art_review_packet`
- delivery id
- covered work item ids
- landing-unit evidence
- rollback boundary
- validation evidence
- completion mapping from each work item to the landing-unit evidence

Pre-merge landing readiness is a separate gate from finalization. Use
`POST /v1/delivery-art/review-packets/readiness` or
`npm run art -- review-packet readiness <packet.json>` after the source PR is
open and before it is merged. The readiness gate fails closed when the draft
packet still has placeholders, missing open PR evidence, missing item-level
completion mapping, unexplained changed surfaces, missing test or validation
evidence, empty repo change evidence, or an unclear rollback boundary.

For source-backed PR work, readiness expects `landing_unit.evidence_kind:
open_pr`. After merge, change the packet to `merged_pr`, add the merge commit,
and run finalization. Finalization remains the post-merge digest gate for ART
completion evidence.

When creating local CLI drafts, pass explicit source repo roots when the
landing unit is not the current broker repo:

```bash
npm run art -- review-packet draft <delivery-id> .art/review-packets/<name>.json <work-item-id...> --repo-root <source-repo>
```

Use one `--repo-root` per source repo. Broker-local ART scratch paths such as
`.art/drafts`, `.art/payloads`, `.art/outputs`, `.art/review-packets`, and
`.art/archive` are not source landing-unit evidence and must be excluded from
draft repo detection.

Finalization must fail closed when:

- no work item is covered
- source-backed evidence lacks a PR/direct-land kind and commit proof
- validation evidence is missing
- placeholders remain
- any packet evidence uses `.tmp/` scratch payloads as durable evidence

The finalized packet digest is the value operators reference in ART completion
evidence when one source landing unit closes one or more ART children.

## Design Position

The durable split is:

- `Workspace Proposals`
  - canonical proposal-of-record
  - lifecycle brokered through `/v1/ideas/...`
- `Workspace Delivery ART`
  - canonical execution-of-record
  - workflow brokered through the delivery API families in this document

OpenProject remains the canonical backend. The broker owns:

- intent-shaped workflow commands
- bounded validation and read projection
- audit, correlation, and caller auth at the workflow seam
- one bounded safe-write retry for stale OpenProject lock-version conflicts on
  PATCH-based ART writes

`platform-engineering` continues to own:

- OpenProject runtime and bootstrap
- project schema provisioning
- board and view sync
- roadmap-compatible `Target PI` to `version` projection
- identity provisioning
- access and clean-start admin controls

`Target PI` remains the canonical ART planning field. OpenProject `version`
is a derived compatibility projection used by roadmap-style UI surfaces and is
not a second authoritative PI field for broker callers. PI-assigned work
projects to the matching version, backlog or active work with blank `Target PI`
projects to the derived roadmap bucket `Not yet committed to a PI`, and retired
blank-`Target PI` scope projects to `Retired scope`.

Broker writes that create, update, or complete PI-committed work always write
the canonical `Target PI` field. They also write the derived `version`
projection only when the live OpenProject form exposes `version` as writable
and the desired version is present in the allowed values. When OpenProject marks
`version` read-only, the broker must not fail the canonical work-item write; it
returns a roadmap projection report with `external_reconciler_required`, and
the platform sync surface remains the owner for version provisioning, backfill,
and projection repair across existing ART records.

Projection reconciliation is a required workflow checkpoint after any ART
mutation that needs external roadmap `version` reconciliation, not a
Target-PI-only exception. That includes PI assignment or clearing, carryover
retargeting, backlog bucket movement, parking, retirement, completion, and
platform-admin repair. Broker CLI mutation responses that receive
`external_reconciler_required` mark projection state dirty. Operators may batch
related dirty events during a coherent work burst, but must run
`npm run art -- projection sync --pi-names "<known-pi-names>" --target-epic-id
<epic-id> --quality` before treating projection health or scoped quality as
final.

The planning workflow is also explicit:

1. consume accepted work into one `Epic` shell
2. frame the initiative while it stays backlog-shaped
3. commit PI objectives and features during PI planning
4. elaborate user stories only for committed features
5. execute from child stories, defects, or tasks
6. review carryover and decommit work deliberately at PI boundaries

Broker planning-workflow metadata mirror:

- `src/delivery-planning-workflow.json`

That file mirrors the canonical owner contract in
`platform-engineering/products/openproject/delivery-art-planning-workflow.json`
so the broker, quality checker, and operator guidance use the same phase and
gate ids.

## Non-Goals

This contract does not introduce:

- generic OpenProject CRUD passthrough
- public ingress
- Telegram delivery-management commands
- multi-ART routing
- solution-train coordination

## Identity Model

The broker should expose a broker-owned delivery identity rather than forcing
callers to use raw OpenProject ids forever.

Recommended response fields:

- `delivery_id`
- `delivery_ref`
- `delivery_record_ref`
- `delivery_record_system`

Current compatibility rule:

- `delivery_ref` and `delivery_record_ref` continue to carry the durable
  OpenProject-style reference such as `openproject://work_packages/77`
- the broker may accept raw OpenProject numeric ids during migration, but that
  is not the long-term caller contract

## Delivery Initiative API Family

### Purpose

Own top-level execution workflow for one delivery initiative.

### Read Endpoints

- `GET /v1/delivery-initiatives/{delivery_id}/review-pack`
- `GET /v1/delivery-initiatives`
- `GET /v1/delivery-initiatives/{delivery_id}/execution-summary`
- `GET /v1/delivery-initiatives/{delivery_id}/planning`
- `GET /v1/delivery-initiatives/{delivery_id}/pi-objectives`
- `GET /v1/delivery-initiatives/{delivery_id}/closeout-readiness`

### Command Endpoints

- `POST /v1/delivery-initiatives/{delivery_id}/governance`
- `POST /v1/delivery-initiatives/{delivery_id}/plan/apply`
- `POST /v1/delivery-initiatives/{delivery_id}/plan/repair`
- `POST /v1/delivery-initiatives/{delivery_id}/system-demo`
- `POST /v1/delivery-initiatives/{delivery_id}/inspect-and-adapt`
- `POST /v1/delivery-initiatives/{delivery_id}/pi-review`
- `POST /v1/delivery-initiatives/{delivery_id}/close`

### Guided Initiative Closeout Contract

`POST /v1/delivery-initiatives/{delivery_id}/close` runs the successful
initiative closeout path through one broker workflow.

It should:

- record one new system-demo entry
- enter PM² `Closing`
- record one new inspect-and-adapt entry
- append final completion evidence sections to the initiative description
- mark the initiative `done`

The route is not a shortcut around initiative-review gates. It must still fail
closed when:

- open descendants remain
- system-demo, inspect-and-adapt, or PM² closing preconditions are not met
- final completion evidence does not satisfy the ART closeout format

### Safe Write Retry Contract

Broker PATCH-based ART writes may perform one bounded retry when OpenProject
rejects the write because the supplied `lockVersion` is stale.

That retry must:

- refresh the lock version from live state
- replay the same intended PATCH once
- hard-fail if the conflict persists after the bounded retry

It must not silently turn into unbounded replay or duplicate evidence writes.
Identical replayed closeout artifacts must be suppressed rather than appended
again, including:

- initiative `System Demo Evidence` entries
- initiative `Inspect & Adapt Actions` entries
- identical broker-authored operator work notes added during item completion or
  done-state update writes

## Delivery Session API Family

### Purpose

Own the one-shot ART session bootstrap read for broker callers before a new
work period starts.

### Read Endpoints

- `GET /v1/delivery-session/bootstrap`
- `GET /v1/delivery-session/workflow-health`
- `GET /v1/delivery-session/quality-pack`

### Bootstrap Read Contract

`GET /v1/delivery-session/bootstrap` should return one broker-owned startup pack
for the active ART lane. The route exists so operators do not have to
reconstruct session truth from multiple low-level reads before they can resume
execution.

Minimum payload shape:

- caller identity and auth mode
- runtime context
  - broker service name and version
  - derived OpenProject runtime namespace when the broker can infer it from the
    in-cluster service host
  - delivery project identifier
- live assignable principals for the delivery project
- active fronts
  - initiatives with in-progress work
  - next-ready work under those same initiatives
- review backlog
  - initiatives ready for `Closing`
  - initiatives ready for final closeout
  - initiatives ready for retirement
  - initiatives blocked from review

The bootstrap route is a broker-native session read, not a new canonical
planning surface. It should stitch together existing broker truth:

- delivery initiative list and summaries
- live assignable-principal list
- broker runtime context

### Workflow Health Contract

`GET /v1/delivery-session/workflow-health` should return one broker-owned
workflow-health summary for the active ART lane.

Minimum payload shape:

- delivery project identity
- compatible OpenProject view model
  - roadmap view uses canonical `Target PI` projected into `version`
  - PM² board reads the initiative `PM² Phase` field and uses `retired` as the
    separate terminal lane
- roadmap projection drift summary
  - PI-assigned work whose roadmap `version` no longer matches `Target PI`
  - backlog or active blank-`Target PI` work that no longer projects into
    `Not yet committed to a PI`
  - retired blank-`Target PI` work that no longer projects into
    `Retired scope`
- PM² projection drift summary
  - active initiatives missing `PM² Phase`
  - done initiatives no longer in `Closing`
  - retired initiatives that still retain a stale `PM² Phase`
- portfolio summary
  - active initiative count
  - initiatives ready for `Closing`
  - initiatives ready for final closeout
  - initiatives ready for retirement

This route exists so the normal operator path can inspect roadmap and PM² truth
through the broker instead of falling back to direct OpenProject admin reads.

### Project Quality Pack Contract

`GET /v1/delivery-session/quality-pack` should return the minimal broker-native
portfolio payload needed by the platform quality checker.

Minimum payload shape:

- delivery project identity
- compatible OpenProject view model
- projection-health summary
- flattened ART work-package list with at least:
  - id
  - record ref
  - type
  - status
  - parent id
  - subject
  - `Target PI`
  - projected roadmap `version`
  - `PM² Phase`
  - `Execution Classification`
  - owner/assignee/responsible
  - description-heading metadata
  - completion-evidence and done-narrative state flags

This route is still broker-owned even when the caller is the
`platform-engineering` quality wrapper. The normal quality/readiness path
should not need a direct Rails runner once this pack exists.

### Initiative Review Pack Contract

`GET /v1/delivery-initiatives/{delivery_id}/review-pack` should return one
initiative-scoped review packet for normal ART sessions.

Minimum payload shape:

- initiative identity and current review state
- quality drift lists:
  - ready work missing ready-contract fields
  - done work with weak completion evidence
  - done work with weak done-state narrative
  - done work missing owner fields
- stale-open candidates
  - open parent items whose children are already all terminal
- readiness summary:
  - ready for `Closing`
  - ready for final closeout
  - ready for retirement

The route is not a generic tree dump. It exists so an operator can answer:

- is this initiative healthy enough to review?
- where is the evidence or readiness drift?
- which open items are likely stale-open shells instead of true active work?

## Delivery Work-Item API Family

### Purpose

Own bounded work-item workflow reads and writes without forcing callers to
scan the full initiative execution tree for basic resumption context.

Planning rules for this family:

- `PI Objective`, `Task`, and `Milestone` work must carry `Target PI`;
  `User story` work must carry `Target PI` once executable, active, or
  PI-committed
- `Milestone` remains an `Epic`-level checkpoint only; it does not replace a
  `PI Objective` or a `Feature` leaf front
- PI-committed non-`Epic` work must also carry non-backlog `Iteration`
- PI-committed initiative scope must include at least one `PI Objective`
- PI-committed `Feature` work must keep at least one open `User story` or
  `Defect` child
- executable `User story` and `Task` creation or moves require a PI-committed
  parent
- backlog features may keep `new` planned `User story` children only while
  they remain non-executable future decomposition

### Read Endpoints

- `GET /v1/delivery-work-items/{work_item_id}/continuation-context`

### Command Endpoints

- `POST /v1/delivery-work-items`
- `POST /v1/delivery-work-items/bulk-update`
- `POST /v1/delivery-work-items/{work_item_id}/blocker`
- `POST /v1/delivery-work-items/{work_item_id}/dependency`
- `POST /v1/delivery-work-items/{work_item_id}/update`
- `POST /v1/delivery-work-items/{work_item_id}/parking`
- `POST /v1/delivery-work-items/{work_item_id}/move`
- `POST /v1/delivery-work-items/{work_item_id}/complete`
- `POST /v1/delivery-work-items/{work_item_id}/stale-open-close`

### Stale-Open Closeout Contract

`POST /v1/delivery-work-items/{work_item_id}/stale-open-close` closes one
stale-open ART work item through a guarded broker workflow.

It should:

- verify the work item is still open
- verify it has child work
- verify every child is already terminal
- require explicit stale-open justification
- reuse the standard completion-evidence contract

The route is not a generic bypass around completion rules. It exists for the
specific case where a parent shell stayed open after all of its child work
already completed or retired and the operator is explicitly attesting that the
completed child scope satisfies the parent item.

Stale-open closeout responses may return `note_applied = null` when the broker
did not append an extra operator note section.

### Execution Summary Contract

The execution summary should provide a stable read model for operators and
broker clients without exposing raw OpenProject query semantics.

Minimum summary shape:

- initiative identity and subject
- top-level status
- PM² phase
- target PI
- counts by status, type, PI, and assignee
- blocked item count
- dependency-blocked item count
- parked item count
- retired item count
- recursive execution tree

### Governance Contract

`POST /v1/delivery-initiatives/{delivery_id}/governance` updates only
initiative-level fields on the top-level delivery Epic.

The route is intentionally narrow:

- it does not expose generic OpenProject field patching
- it does not accept child work-item fields
- it preserves PM² and initiative meaning on the top-level Epic only

Supported governance fields are:

- `status`
- `target_pi`
- `assignee_login`
- `responsible_login`
- `owner_repo`
- `initiative_family`
- `lineage_role`
- `architecture_anchor_ref`
- `required_upstream_ref`
- `pm2_phase`
- `sponsor`
- `business_objective`
- `success_criteria`
- `system_demo_evidence`
- `inspect_and_adapt_actions`
- `nfr_category`
- `description`

When `assignee_login` or `responsible_login` is supplied on the initiative
governance route, it must resolve through the same live assignable-principal
surface used for work-item writes. Initiative closeout uses those stored values
too, so top-level epics must not be forced onto a separate unsafe admin path
just to satisfy completion requirements.

When `owner_repo` is supplied on the initiative governance route, the broker
applies the same live form-backed custom-field mapping used for work-item
`Owner Repo` writes. Top-level epics should not require a separate OpenProject
admin or Rails-only path just to carry the same machine-readable owner metadata
that child work already uses.

Initiative-lineage rules are now broker-enforced too:

- a top-level Epic may remain unclassified only while it is the brand-new
  `new` + `PM² Phase = Initiating` shell with blank `Target PI`
- once the initiative leaves that shell posture, it must carry:
  - `initiative_family`
  - `lineage_role`
- follow-on top-level epics must also carry:
  - `architecture_anchor_ref` when their lineage role requires an anchor
  - `required_upstream_ref` when their lineage role requires an upstream gate
- `architecture_anchor_ref` must point to an existing top-level Epic in the
  same initiative family
- `required_upstream_ref` must point to an existing ART record inside the same
  initiative family chain

PM² initiative-review transition rules:

- `PM² Phase = Closing` is not a free label
- the initiative may enter `Closing` only after:
  - `System Demo Evidence` is recorded
  - there are no open descendants outside `done` or `retired`
  - there are no blocked descendants
  - there are no unresolved dependency relations
  - there are no done descendants missing or weakening completion evidence
  - there are no done descendants still carrying weak done-state narrative evidence
  - there are no done descendants missing top-level ownership fields
- initiative status may move to `done` only when:
  - `PM² Phase = Closing`
  - `System Demo Evidence` is still present
  - `Inspect & Adapt Actions` is recorded
  - final closeout readiness is still clean
- initiative status may move to `retired` only when:
  - all descendants are already `done` or `retired`
  - `retired` is treated as a separate terminal status, not as a PM² phase
  - the broker clears the stored `PM² Phase` field during retirement

The broker now fail-closes on those transitions. `Closing` and final `done`
should be treated as initiative-review workflow states, not just board labels.
The broker also fail-closes initiative retirement when open descendant scope
would be left behind.

### Plan Apply Contract

`POST /v1/delivery-initiatives/{delivery_id}/plan/apply` owns bounded
reconciliation for the delivery tree below one initiative.

The broker should:

- reuse or update existing nodes by `parent + type + subject`
- create new nodes only when a matching node does not already exist
- validate readiness before publishing any `ready` node
- preserve the current reconcile modes used for live proof
- keep initiative updates separate from child-item updates

Supported reconcile controls are:

- `reconcile_missing=ignore|park`
- `reconcile_decision=retire|defer`
- `reconcile_reason`
- `reconcile_retirement_reason`
- `reconcile_review_date`

The plan payload may also include an initiative-level `epic_updates` section
for the top-level Epic when the delivery plan needs to refresh initiative
meaning alongside the tree reconciliation.

Created and updated child entries include the same projection evidence used by
direct work-item writes:

- created entries include `creation_applied`
- updated entries include `changes_applied`
- when Target PI cannot be projected into the OpenProject roadmap `version`
  field directly, those sections include
  `roadmap_version_projection.status = external_reconciler_required`

The broker-owned ART CLI treats that nested projection evidence as a projection
checkpoint signal for `plan/apply`, records the delivery id and affected child
work item ids in `.art/projection-state.json`, and delays the expensive
platform view sync until the next explicit projection checkpoint.

Active `PI Objective` plan items are part of the execution contract, not loose
portfolio labels. Before any OpenProject mutation, the broker rejects active
`PI Objective` plan items that omit:

- `piObjectiveType`
- `plannedBusinessValue`
- `actualBusinessValue`
- `assigneeLogin`
- `responsibleLogin`

Plan items may set `assigneeLogin` and `responsibleLogin`; the broker resolves
them through the live OpenProject form schema before create or update. This
keeps PI-objective activation from succeeding locally and only failing later in
scoped ART quality.

### PI Review Contract

`POST /v1/delivery-initiatives/{delivery_id}/pi-review` records objective
review outcome and actual business value for existing PI Objective work.

Each review entry uses:

- `target_work_package_id`
  - canonical JSON shape: positive integer OpenProject work-package id
  - broker compatibility shape: numeric string such as `"476"`
  - broker-shaped ids such as `work-item-476` are rejected for this field
- `review_outcome`
  - live OpenProject option value, for example `Met`
- `actual_business_value`
  - integer greater than or equal to `0`

Managed mutation-draft validation must reject invalid PI-review target id shape
before live submit.

### Planning Repair Contract

`POST /v1/delivery-initiatives/{delivery_id}/plan/repair` owns bounded
initiative-scoped planning repair for already-existing child work.

Use it when the operator intent is one of these:

- retarget real carryover to the next PI
- decommit eligible backlog-shaped work explicitly
- correct execution posture on the current initiative without stitching
  together ad hoc per-item update writes

Supported action classes are:

- `retarget`
  - requires `target_pi` and non-backlog `iteration`
- `decommit`
  - forces backlog posture by setting `status=new`, clearing `Target PI`, and
    applying the canonical backlog iteration label
- `execution_posture_correction`
  - fixes planning-governance posture such as `delivery_team`, assignee,
    responsible, `target_pi`, `iteration`, `status`, or risk posture fields
    like `roam_state`, `risk_owner`, `risk_review_date`, and
    `risk_disposition`

The broker fail-closes when:

- a target work item is not a descendant of the requested initiative
- a target work item is already terminal (`done` or `retired`)
- `decommit` is attempted on work that structurally requires `Target PI`
- `decommit` is attempted while open child scope still exists

The workflow records a planning-repair note on every repaired item so PI
retarget and decommit decisions stay auditable in the stored operator history.

#### Implemented v1 Slice

The first implemented delivery-plane routes are:

- `GET /v1/delivery-initiatives`
- `GET /v1/delivery-initiatives/{delivery_id}/execution-summary`
- `GET /v1/delivery-initiatives/{delivery_id}/planning`
- `GET /v1/delivery-initiatives/{delivery_id}/pi-objectives`
- `GET /v1/delivery-initiatives/{delivery_id}/closeout-readiness`
- `POST /v1/delivery-art/mutation-drafts`
- `POST /v1/delivery-art/mutation-drafts/validate`
- `POST /v1/delivery-art/wgcf/mutation-drafts`
- `POST /v1/delivery-art/review-packets`
- `POST /v1/delivery-art/review-packets/validate`
- `POST /v1/delivery-art/review-packets/readiness`
- `POST /v1/delivery-art/review-packets/finalize`
- `POST /v1/delivery-initiatives/{delivery_id}/governance`
- `POST /v1/delivery-initiatives/{delivery_id}/plan/apply`
- `POST /v1/delivery-initiatives/{delivery_id}/plan/repair`
- `POST /v1/delivery-initiatives/{delivery_id}/system-demo`
- `POST /v1/delivery-initiatives/{delivery_id}/inspect-and-adapt`
- `POST /v1/delivery-initiatives/{delivery_id}/pi-review`
- `POST /v1/delivery-initiatives/{delivery_id}/close`
- `POST /v1/delivery-work-items`
- `POST /v1/delivery-work-items/bulk-update`
- `GET /v1/delivery-work-items/{work_item_id}/continuation-context`
- `POST /v1/delivery-work-items/{work_item_id}/blocker`
- `POST /v1/delivery-work-items/{work_item_id}/dependency`
- `POST /v1/delivery-work-items/{work_item_id}/update`
- `POST /v1/delivery-work-items/{work_item_id}/parking`
- `POST /v1/delivery-work-items/{work_item_id}/move`
- `POST /v1/delivery-work-items/{work_item_id}/complete`

Current compatibility rules:

- `delivery_id` accepts the broker-shaped form `delivery-38`
- the broker also accepts a raw numeric OpenProject work package id during the
  migration period
- query flags:
  - `include_done=true|false`
  - `include_parked=true|false`

Example response shape:

```json
{
  "delivery_id": "delivery-38",
  "delivery_record_ref": "openproject://work_packages/38",
  "delivery_record_system": "openproject",
  "execution_summary": {
    "epic": {
      "id": 38,
      "record_ref": "openproject://work_packages/38",
      "status": "in-progress",
      "subject": "Productize governed local-agent platform",
      "type": "Epic"
    },
    "summary": {
      "blocked_count": 1,
      "by_assignee": {
        "_none_": 2,
        "admin": 1
      },
      "by_status": {
        "blocked": 1,
        "in-progress": 1,
        "new": 1
      },
      "by_target_pi": {
        "PI-2026-02": 2,
        "_none_": 1
      },
      "by_type": {
        "Feature": 1,
        "Task": 2
      },
      "dependency_blocked_count": 1,
      "dependency_count": 1,
      "include_done": true,
      "include_parked": false,
      "parked_count": 0,
      "retired_count": 0,
      "total_items": 3,
      "unresolved_dependency_count": 1
    },
    "dependency_relations": [],
    "unresolved_dependency_relations": [],
    "blocked_items": [],
    "parked_items": [],
    "retired_items": [],
    "execution_tree": {}
  },
  "workflow_id": "delivery-execution-summary"
}
```

### Continuation Context Contract

`GET /v1/delivery-work-items/{work_item_id}/continuation-context` provides the
minimum resumption packet needed to continue one ART item without scanning the
full execution summary by hand.

Minimum response shape:

- initiative identity for the enclosing delivery Epic, including lineage and
  PM² context
- target work item identity and current status
- target and related work-item machine classification where it exists
- parent chain from Epic to the target parent
- open siblings under the same parent
- direct open child items under the target
- previously completed related items, tagged by relation
- dependency context for the target item
- initiative-level active and ready fronts
- fail-closed behavior when the requested item is the top-level delivery `Epic`
  itself: the route returns HTTP `422` `validation_failure` with
  `initiative_epic_not_executable` because Epic shells must be handled through
  initiative planning, governance, or review-pack surfaces before selecting a
  child execution front

Example response shape:

```json
{
  "delivery_id": "delivery-38",
  "delivery_record_ref": "openproject://work_packages/38",
  "delivery_record_system": "openproject",
  "work_item_id": "work-item-177",
  "work_item_record_ref": "openproject://work_packages/177",
  "work_item_record_system": "openproject",
  "continuation_context": {
    "delivery_epic": {
      "architecture_anchor_ref": null,
      "id": 38,
      "initiative_family": "governed-ai-control-plane",
      "lineage_role": "architecture-anchor",
      "pm2_phase": "Executing",
      "record_ref": "openproject://work_packages/38",
      "required_upstream_ref": null,
      "status": "in-progress",
      "subject": "Productize governed local-agent platform",
      "type": "Epic"
    },
    "target_item": {
      "execution_classification": null,
      "id": 177,
      "record_ref": "openproject://work_packages/177",
      "status": "in-progress",
      "subject": "Add supporting-component readiness contracts for shared stage and prod services",
      "type": "Task"
    },
    "parent_chain": [
      {
        "execution_classification": "Enabler",
        "id": 172,
        "record_ref": "openproject://work_packages/172",
        "status": "in-progress",
        "subject": "Enabler: Standardize governed source-to-stage-to-prod release control across products and shared components",
        "type": "Feature"
      }
    ],
    "open_siblings": [
      {
        "execution_classification": null,
        "id": 178,
        "record_ref": "openproject://work_packages/178",
        "status": "new",
        "subject": "Add aggregate fail-closed environment readiness validation and operator workflow",
        "type": "Task"
      }
    ],
    "previously_completed_related_items": [
      {
        "item": {
          "execution_classification": null,
          "id": 176,
          "record_ref": "openproject://work_packages/176",
          "status": "done",
          "subject": "Add governed OpenProject release records and runbook",
          "type": "Task"
        },
        "relation": "completed_sibling"
      }
    ],
    "dependency_context": {
      "depends_on": [],
      "required_by": [],
      "unresolved_dependencies": []
    }
  },
  "workflow_id": "delivery-work-item-continuation-context"
}
```

The continuation packet stays intentionally bounded. It is still not a second
initiative-review or planning surface. The extra fields above are included only
so operators can resume truthfully from the current ART machine model instead
of inferring initiative lineage or `Enabler` / `Improvement` posture from
subject text alone.

### Implemented Work-Item Create Contract

The next broker-owned delivery command surface is:

- `POST /v1/delivery-work-items`

Request shape:

- required:
  - `parent_work_item_id`
  - `type`
  - `subject`
- optional:
  - `status`
  - `target_pi`
  - `execution_classification`
  - `assignee_login`
  - `responsible_login`
  - `owner_repo`
  - `description`
  - `start_date`
  - `due_date`
  - `estimated_work`
  - `remaining_work`
  - `percent_complete`
  - `delivery_team`
  - `iteration`
  - `acceptance_criteria`
  - `definition_of_ready`
  - `definition_of_done`
  - `nfr_category`
  - `pi_objective_type`
  - `planned_business_value`
  - `actual_business_value`
  - `roam_state`
  - `risk_owner`
  - `risk_review_date`
  - `risk_disposition`
  - `wsjf_user_business_value`
  - `wsjf_time_criticality`
  - `wsjf_rr_oe`
  - `wsjf_job_size`

Compatibility rules:

- `parent_work_item_id` accepts the broker-shaped form `work-item-61`
- the broker also accepts a raw numeric OpenProject work package id during the
  migration period
- when `assignee_login` is supplied, it must resolve to a principal that
  OpenProject exposes as assignable in the target project or work-item form
- when `responsible_login` is supplied, it must resolve to a principal that
  OpenProject exposes as assignable in the target project or work-item form
- operator workflow preflight should read the live assignable-principal list
  before setting those fields, using the broker-pod helper:
  `node scripts/show_delivery_art_assignables.mjs`
- the broker resolves delivery custom fields from the live OpenProject form
  schema instead of requiring a large static custom-field-id registry
- `status=done` is intentionally rejected
- `target_pi` drives the writable delivery PI signal used by the broker-owned
  workflow surface; when present or inherited, create writes set the matching
  roadmap `version` projection only when the live OpenProject form marks
  `version` writable
- when OpenProject marks `version` read-only, create still writes `Target PI`
  and reports `creation_applied.roadmap_version_projection.status` as
  `external_reconciler_required`
- structural types are:
  - `Epic`
  - `PI Objective`
  - `Feature`
  - `User story`
  - `Defect`
  - `Task`
  - `Milestone`
  - `Risk`
- `Enabler` and `Improvement` are not structural types
  - express them through `execution_classification` on `Feature` or
    `User story`

Example request shape:

```json
{
  "input": {
    "parent_work_item_id": "work-item-61",
    "type": "User story",
    "execution_classification": "Enabler",
    "subject": "Brokerize delivery work-item move",
    "status": "ready",
    "target_pi": "PI-2026-02",
    "owner_repo": "operator-orchestration-service",
    "assignee_login": "operator-orchestration-service",
    "responsible_login": "operator-orchestration-service",
    "delivery_team": "Workflow Integration",
    "iteration": "PI-2026-02 / Iteration 2",
    "acceptance_criteria": "- Operator can create one child task through the broker."
  }
}
```

Example response shape:

```json
{
  "work_item_id": "work-item-69",
  "work_item_record_ref": "openproject://work_packages/69",
  "work_item_record_system": "openproject",
  "parent_work_item_id": "work-item-61",
  "work_item": {
    "assigneeLogin": "Operator Orchestration-Service",
    "descriptionPresent": true,
    "executionClassification": "Enabler",
    "parentId": 61,
    "recordRef": "openproject://work_packages/69",
    "status": "ready",
    "subject": "Enabler: Brokerize delivery work-item move",
    "targetPi": "PI-2026-02",
    "type": "User story"
  },
  "creation_applied": {
    "execution_classification": "Enabler",
    "status": "ready",
    "target_pi": "PI-2026-02",
    "type": "User story"
  },
  "workflow_id": "delivery-work-item-create"
}
```

Before live submission, validate create payloads locally:

```bash
npm run validate:work-item-create -- payload.json
```

That preflight mirrors the broker-side active execution contract for create
payloads. In particular, active `PI Objective` creation must include the
required ready fields plus a description with `Outcome`, `Why This PI`,
`Success Signal`, and `Execution Context` headings. This avoids discovering
narrative-contract failures only after a live broker mutation attempt.

The OpenAPI contract also exposes a first-class
`DeliveryActivePiObjectiveCreateInput` schema branch under
`DeliveryWorkItemCreateInput`. `npm run validate:api-docs` fails closed if that
schema branch is missing, if it is shadowed by the general work-item create
schema, or if its required narrative-heading metadata drifts from the broker
preflight rules.

### Implemented Work-Item Update Contract

The first broker-owned delivery command surface is:

- `POST /v1/delivery-work-items/{work_item_id}/update`

Current compatibility rules:

- `work_item_id` accepts the broker-shaped form `work-item-56`
- the broker also accepts a raw numeric OpenProject work package id during the
  migration period
- allowed request fields in this first slice:
  - `status`
  - `target_pi`
  - `clear_target_pi`
  - `assignee_login`
  - `clear_assignee`
  - `responsible_login`
  - `clear_responsible`
  - `description`
  - `clear_description`
  - `work_note`
  - `start_date`
  - `clear_start_date`
  - `due_date`
  - `clear_due_date`
  - `estimated_work`
  - `clear_estimated_work`
  - `remaining_work`
  - `clear_remaining_work`
  - `percent_complete`
  - `owner_repo`
  - `delivery_team`
  - `iteration`
  - `acceptance_criteria`
  - `definition_of_ready`
  - `definition_of_done`
  - `nfr_category`
  - `pi_objective_type`
  - `planned_business_value`
  - `actual_business_value`
  - `roam_state`
  - `risk_owner`
  - `risk_review_date`
  - `risk_disposition`
  - `wsjf_user_business_value`
  - `wsjf_time_criticality`
  - `wsjf_rr_oe`
  - `wsjf_job_size`
- setting or clearing `target_pi` also updates the matching roadmap `version`
  projection on the same broker write when the live form marks `version`
  writable
- ordinary update writes repair an already-present roadmap projection when a
  PI-committed item still carries stale or missing `version` state and the live
  form allows the write
- when OpenProject marks `version` read-only, ordinary update writes keep the
  canonical `Target PI` change and report
  `changes_applied.roadmap_version_projection.status` as
  `external_reconciler_required`
- active PI-committed `Feature` updates still require an open `User story` or
  `Defect` child as the executable leaf front, except for a terminal-child
  parent closeout metadata repair
- terminal-child parent closeout metadata repair is allowed only when all leaf
  children are already `done` or `retired` and the update is limited to
  required closeout metadata fields such as `acceptance_criteria`,
  `definition_of_ready`, `definition_of_done`, `description`,
  `owner_repo`, `delivery_team`, `iteration`, execution classification, and a
  work note
- `status=done` is intentionally rejected
  - evidence-backed completion remains a separate workflow

### Implemented Work-Item Bulk Update Contract

The broker-owned batch execution surface is:

- `POST /v1/delivery-work-items/bulk-update`

Request shape:

- required:
  - `schema_version`
  - `updates`
- each update entry requires:
  - `target_work_package_id`
- each update entry otherwise accepts the same bounded fields as the single
  `update` route

Compatibility rules:

- `schema_version` must equal `1`
- batch execution applies the same broker validation used by the single-item
  update route
- the broker stops on the first invalid or missing work item instead of hiding
  failures behind partial direct-runner behavior

Example request shape:

```json
{
  "input": {
    "status": "in-progress",
    "target_pi": "PI-2026-02",
    "assignee_login": "operator-orchestration-service",
    "responsible_login": "operator-orchestration-service",
    "work_note": "Started broker update implementation."
  }
}
```

Example response shape:

```json
{
  "work_item_id": "work-item-56",
  "work_item_record_ref": "openproject://work_packages/56",
  "work_item_record_system": "openproject",
  "work_item": {
    "assigneeLogin": "Operator Orchestration-Service",
    "description": "## Purpose\n\nBroker mapping is underway.",
    "descriptionHeadings": [
      "Purpose",
      "Operator work notes"
    ],
    "descriptionPresent": true,
    "recordRef": "openproject://work_packages/56",
    "status": "in-progress",
    "subject": "Add bounded delivery work-item update mapping in the broker service layer",
    "targetPi": "PI-2026-02",
    "type": "Task",
    "updatedAt": "2026-04-21T02:12:00Z"
  },
  "changes_applied": {
    "status": {
      "from": "ready",
      "to": "in-progress"
    },
    "target_pi": {
      "from": null,
      "to": "PI-2026-02"
    },
    "assignee_login": {
      "from": null,
      "to": "admin"
    },
    "description": {
      "from_present": true,
      "to_present": true
    },
    "work_note": {
      "applied": true
    }
  },
  "workflow_id": "delivery-work-item-update"
}
```

### Closeout Readiness Contract

The closeout-readiness surface should answer whether terminal proposal closeout
is allowed without executing closeout itself.

Minimum result shape:

- `ready_for_closeout`
- unmet checks such as:
  - initiative not `done`
  - open descendants present
  - active blockers present
  - unresolved dependencies present

## Delivery Work Item API Family

### Purpose

Own bounded workflow commands for child execution items inside one delivery
initiative.

### Planned Endpoints

- `POST /v1/delivery-work-items`
- `POST /v1/delivery-work-items/bulk-update`
- `GET /v1/delivery-work-items/{work_item_id}`
- `POST /v1/delivery-work-items/{work_item_id}/update`
- `POST /v1/delivery-work-items/{work_item_id}/move`
- `POST /v1/delivery-work-items/{work_item_id}/blocker`
- `POST /v1/delivery-work-items/{work_item_id}/dependency`
- `POST /v1/delivery-work-items/{work_item_id}/parking`

### Create Contract

Create one bounded child item under an existing initiative or parent item.

Minimum request intent:

- parent identity
- work item type
- subject
- optional status
- optional target PI
- optional assignee
- optional description

The broker should reject duplicate sibling intent when the target parent, type,
and subject already describe the same active work item.

### Update Contract

Update one existing work item through explicit workflow fields only.

Allowed fields in v1:

- status
- target PI
- assignee
- description
- work note

The broker must not accept arbitrary field bags.

### Move Contract

Move one work item to a different valid parent within the same delivery
initiative.

Implemented route:

- `POST /v1/delivery-work-items/{work_item_id}/move`

Request shape:

- required:
  - `new_parent_work_item_id`
- optional:
  - `work_note`

Compatibility rules:

- `work_item_id` accepts the broker-shaped form `work-item-63`
- `new_parent_work_item_id` accepts the broker-shaped form `work-item-75`
- the broker also accepts raw numeric OpenProject work package ids during the
  migration period
- the route is intentionally limited to delivery hierarchy mutation, not
  generic structure editing

The broker should reject moves that would:

- cross initiative boundaries silently
- create parent loops
- move into unsupported parent type relationships
- create duplicate sibling placement under the new parent

`previous_parent_work_item_id` is nullable. Root-repair moves can reattach a
delivery work item that was incorrectly left at the project root, in which case
there is no prior parent work item to report.

Example request shape:

```json
{
  "input": {
    "new_parent_work_item_id": "work-item-75",
    "work_note": "Move this task under the new broker feature parent."
  }
}
```

Example response shape:

```json
{
  "work_item_id": "work-item-63",
  "work_item_record_ref": "openproject://work_packages/63",
  "work_item_record_system": "openproject",
  "parent_work_item_id": "work-item-75",
  "previous_parent_work_item_id": "work-item-61",
  "work_item": {
    "descriptionPresent": true,
    "executionClassification": "Enabler",
    "parentId": 75,
    "recordRef": "openproject://work_packages/63",
    "status": "ready",
    "subject": "Enabler: Brokerize delivery work-item move",
    "targetPi": "PI-2026-02",
    "type": "User story"
  },
  "changes_applied": {
    "parent": {
      "from": 61,
      "to": 75
    },
    "work_note": {
      "applied": true
    }
  },
  "note_applied": "description_section",
  "workflow_id": "delivery-work-item-move"
}
```

Move responses may return `note_applied = null` when the broker did not append
an extra operator note section.

### Blocker Contract

Record or clear blocker governance on one work item.

Primary operator checklist:

- `platform-engineering/products/openproject/runbooks/manage-delivery-blockers.md`

Implemented route:

- `POST /v1/delivery-work-items/{work_item_id}/blocker`

Request shape:

- required:
  - `action`
- required for `action=set`:
  - `blocker_statement`
  - `blocker_impact`
  - `blocker_owner`
  - `blocker_discovered_on`
  - `blocker_decision_path`
  - `blocker_justification`
- conditionally required for `action=set` when `blocker_decision_path != remove`:
  - `blocker_follow_up_owner`
  - `blocker_review_date`
- required for `action=clear`:
  - `resume_status`

Minimum blocker semantics:

- blocker statement
- blocker impact
- blocker owner
- blocker discovered date
- decision path
- justification
- follow-up owner
- optional review date

Compatibility rules:

- `work_item_id` accepts the broker-shaped form `work-item-64`
- the broker also accepts raw numeric OpenProject work package ids during the
  migration period
- generic create, update, and planning-repair routes do not set or clear
  blocked status
- `resume_status` must be one of:
  - `new`
  - `ready`
  - `in-progress`
- `blocker_discovered_on` and `blocker_review_date` must be ISO dates
  (`YYYY-MM-DD`) when provided

Recording doctrine:

- record the blocker as soon as the exact next committed ART step cannot
  proceed
- do not continue adjacent ART mutation on the same initiative once the exact
  blocker is known but still unrecorded
- when the blocker is caused by a live system or workflow control bug, open or
  update a real `Defect` in ART
- when the exposure is broader than one blocked item, represent that exposure
  as a `Risk` with ROAM fields as well
- after containing a newly discovered defect, classify it before fixing as
  `immediate_blocker`, `deferred_defect`, `absorbed_same_slice_fix`, or `risk`
- classify a discovered defect as `immediate_blocker` only when safe
  continuation is impossible because quality remains unhealthy, the next
  mutation would corrupt state, evidence cannot be trusted, the runtime path is
  down, or an open security/trust exposure exists
- if containment restores safe continuation, record the defect or follow-up and
  continue the active committed front instead of context-switching into an
  unplanned fix

Example request shape:

```json
{
  "input": {
    "action": "set",
    "blocker_statement": "Broker blocker route is under live proof in devint.",
    "blocker_impact": "Task #64 cannot complete until set and clear semantics are verified against OpenProject.",
    "blocker_owner": "mfshaf7",
    "blocker_discovered_on": "2026-04-21",
    "blocker_decision_path": "workaround",
    "blocker_justification": "Use the broker route itself for proof, then clear the blocker back to active execution.",
    "blocker_follow_up_owner": "mfshaf7",
    "blocker_review_date": "2026-04-21"
  }
}
```

Example response shape:

```json
{
  "action_applied": "set",
  "blocker": {
    "statement": "Broker blocker route is under live proof in devint.",
    "impact": "Task #64 cannot complete until set and clear semantics are verified against OpenProject.",
    "owner": "mfshaf7",
    "discovered_on": "2026-04-21",
    "decision_path": "workaround",
    "justification": "Use the broker route itself for proof, then clear the blocker back to active execution.",
    "follow_up_owner": "mfshaf7",
    "review_date": "2026-04-21"
  },
  "changes_applied": {
    "status": {
      "from": "in-progress",
      "to": "blocked"
    }
  },
  "work_item_id": "work-item-64",
  "work_item_record_ref": "openproject://work_packages/64",
  "work_item_record_system": "openproject",
  "work_item": {
    "executionClassification": "Enabler",
    "recordRef": "openproject://work_packages/64",
    "status": "blocked",
    "subject": "Enabler: Brokerize delivery blocker management",
    "targetPi": "PI-2026-02",
    "type": "User story"
  },
  "workflow_id": "delivery-work-item-blocker"
}
```

### Dependency Contract

Record or clear explicit predecessor relationships between delivery items.

Implemented route:

- `POST /v1/delivery-work-items/{work_item_id}/dependency`

Request shape:

- required:
  - `action`
  - `depends_on_work_item_id`
- optional for `action=set`:
  - `lag`
  - `clear_lag`
  - `description`
  - `clear_description`

Minimum dependency semantics:

- predecessor identity
- successor identity
- optional lag
- optional description

Compatibility rules:

- `work_item_id` and `depends_on_work_item_id` accept the broker-shaped form
  `work-item-65`
- the broker also accepts raw numeric OpenProject work package ids during the
  migration period
- a work item cannot depend on itself
- `lag` and `clear_lag=true` are mutually exclusive
- `description` and `clear_description=true` are mutually exclusive
- both work items must belong to the configured delivery project
- the broker preserves operator semantics:
  - the target work item depends on the predecessor work item
  - the underlying OpenProject relation is created as `follows` from the
    predecessor to the target
- duplicate dependency rows for the same predecessor-target pair are collapsed
  during `action=set`

Example request shape:

```json
{
  "input": {
    "action": "set",
    "depends_on_work_item_id": "work-item-67",
    "lag": 2,
    "description": "Governance update must land before plan-reconcile brokerization starts."
  }
}
```

Example response shape:

```json
{
  "action_applied": "set",
  "created": false,
  "depends_on_work_item_id": "work-item-67",
  "relation": {
    "id": 12,
    "relation_type": "follows",
    "lag": 2,
    "description": "Governance update must land before plan-reconcile brokerization starts.",
    "depends_on": {
      "id": 67,
      "record_ref": "openproject://work_packages/67",
      "subject": "Enabler: Brokerize delivery initiative governance update",
      "status": "ready"
    },
    "target": {
      "id": 70,
      "record_ref": "openproject://work_packages/70",
      "subject": "Enabler: Brokerize delivery plan apply and reconciliation",
      "status": "new"
    }
  },
  "removed_duplicate_relation_ids": [
    13
  ],
  "target_work_item_id": "work-item-70",
  "updated": true,
  "workflow_id": "delivery-work-item-dependency"
}
```

### Parking Contract

Park or resume a work item without hard deletion.

Implemented route:

- `POST /v1/delivery-work-items/{work_item_id}/parking`

Request shape:

- required:
  - `action`
- required for `action=park`:
  - `park_decision`
  - `park_reason`
- conditionally required for `action=park` when `park_decision=defer`:
  - `park_review_date`
- conditionally required for `action=park` when `park_decision=retire`:
  - `retirement_reason`
- required for `action=resume`:
  - `resume_status`
- optional:
  - `work_note`

Minimum parking semantics:

- park decision
- park reason or note
- resume status when unparked

Parked work items remain in history and reporting, but are hidden from active
execution views by default.

Compatibility rules:

- `work_item_id` accepts the broker-shaped form `work-item-66`
- the broker also accepts raw numeric OpenProject work package ids during the
  migration period
- `park_decision` must be `defer` or `retire`
- `park_review_date` must be an ISO date (`YYYY-MM-DD`) when required
- `retirement_reason` is required only for `park_decision=retire`
- `resume_status` must not be `parked` or `retired`
- parking clears active blocker fields on the same work item
- retiring PI-committed work clears stale `work_item.targetPi` and resets the
  item to `Not committed to a PI iteration yet.`
- retiring backlog or retired-scope work also clears `startDate` and `dueDate`
  so inactive scope does not retain concrete schedule dates
- execution-summary read models treat both `parked` and `retired` as inactive
  scope when `include_parked=false`
- parking responses may return:
  - `parking.review_date = null` when the decision is `retire`
  - `work_item.targetPi = null` when the item is not committed to a PI
  - `note_applied = null` when no extra operator note section is appended

Example request shape:

```json
{
  "input": {
    "action": "park",
    "park_decision": "defer",
    "park_reason": "Keep this task out of active scope until the next slice starts.",
    "park_review_date": "2026-05-01",
    "work_note": "Parking proof is running through the broker route."
  }
}
```

Example response shape:

```json
{
  "action_applied": "park",
  "changes_applied": {
    "status": {
      "from": "ready",
      "to": "parked"
    },
    "work_note": {
      "applied": true
    }
  },
  "note_applied": "description_section",
  "parking": {
    "decision": "defer",
    "reason": "Keep this task out of active scope until the next slice starts.",
    "review_date": "2026-05-01",
    "retirement_reason": null
  },
  "work_item_id": "work-item-66",
  "work_item_record_ref": "openproject://work_packages/66",
  "work_item_record_system": "openproject",
  "work_item": {
    "executionClassification": "Enabler",
    "recordRef": "openproject://work_packages/66",
    "status": "parked",
    "subject": "Enabler: Brokerize delivery parking and resume",
    "targetPi": "PI-2026-02",
    "type": "User story"
  },
  "workflow_id": "delivery-work-item-parking"
}
```

### Completion Contract

Complete one delivery work item through evidence-backed closeout semantics.

Implemented route:

- `POST /v1/delivery-work-items/{work_item_id}/complete`

Request shape:

- required:
  - `completion_summary`
  - `changed_surfaces`
  - `test_result_evidence`
  - `validation_evidence`
- optional:
  - `completion_note`
  - `residual_follow_up`
  - `test_result_artifact`

Compatibility rules:

- `work_item_id` accepts the broker-shaped form `work-item-181`
- the broker also accepts raw numeric OpenProject work package ids during the
  migration period
- completion is a separate workflow and is not available through generic
  `update`
- `update` revalidates the done-state narrative contract before patching
  OpenProject whenever the resulting work item remains `done`
- completion rejects work items that still have active blocker state
- completion rejects work items with missing required execution-contract fields
- completion rejects any work item that still has descendants outside `done` or
  `retired`
- parent items must not close before the full child tree is terminal
- completion preserves or repairs the roadmap `version` projection for
  PI-committed work before moving the work item to `done` only when the live
  form marks `version` writable; otherwise completion keeps the canonical
  `Target PI` state and reports that the platform projection reconciler is
  required
- completion evidence must satisfy the ART attestation formatting rules before
  the broker patches the OpenProject record
- `changed_surfaces` is not a file inventory; each bullet must explain what
  changed on that surface, code-format source paths, and use a markdown link
  or URL for PR references
- the broker validates the final stored body after any broker-added note, not
  just the user-supplied completion payload
- done-state descriptions must also satisfy the stronger narrative contract
  before the broker patches the OpenProject record
- broker-added completion or work notes must stay inside `Operator work notes`
  rather than leaking into evidence sections
- broker rewrites must update `Execution Context` in place rather than
  appending it after later sections such as `Operator work notes`
- `Execution Context` must stay a flat bullet list and keep the stored:
  - `Owner repo`
  - `Parent item` when a parent exists
  - `Delivery team` when that field is set
  - `Iteration` when that field is set
- `test_result_evidence` lines must start with:
  - `- PASS:`
  - `- FAIL:`
  - `- NOT APPLICABLE:`
  - `- Attached artifact:`
- `validation_evidence` lines must start with:
  - `- PASS:`
  - `- FAIL:`
  - `- CHECK:`
  - `- NOT APPLICABLE:`
  - `- Attached artifact:`
- use the local preflight before the broker write:
  - `npm run validate:completion-evidence -- <payload.json>`
- the local ART CLI accepts either the broker route envelope
  `{ "input": { ... } }` or the inner completion-evidence object accepted by
  `npm run validate:completion-evidence`, and wraps the inner object before
  submitting to the broker.
- completion responses may return `note_applied = null` when the broker did not
  append an extra operator note section

Execution-summary reads surface the same closeout signal for done items:

- `done_narrative_contract_applicable`
- `done_narrative_contract_satisfied`
- `done_narrative_contract_issues`

This keeps parent closeout honest even when a merged repo slice exists before
the ART child tree is actually finished.

## Operator Surface Rule

These broker routes are the supported delivery execution surface.

`platform-engineering` may keep direct OpenProject runners only for bootstrap,
board/view projection repair, break-glass recovery, and one-time
normalization. It must not reintroduce product-local delivery execution
scripts or a second operator-facing command family for ART reads and writes,
and normal ART quality/readiness execution should consume broker-native reads
instead of direct Rails runners.

## Related Sources

- `docs/architecture/overview.md`
- `docs/architecture/runtime-shape.md`
- `docs/architecture/delivery-workflow-api-boundary.md`
- `docs/contracts/openproject-adapter-v1.md`
- `docs/contracts/accepted-idea-delivery-consumption-v1.md`
- `docs/contracts/accepted-idea-delivery-closeout-v1.md`
