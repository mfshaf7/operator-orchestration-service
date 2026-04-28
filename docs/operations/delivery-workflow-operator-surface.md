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
- broker `plan/apply` writes that set `Target PI` also set the matching
  roadmap `version` in the same OpenProject write when the version already
  exists
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

Broker guardrails now enforce that:

- `PI Objective`, `User story`, `Task`, and `Milestone` work cannot exist
  without `Target PI`
- `Milestone` remains an `Epic`-level checkpoint only; it does not replace a
  `PI Objective` or a `Feature` leaf front
- PI-committed initiative scope must include at least one `PI Objective`
- PI-committed `Feature` work must keep at least one open `User story` or
  `Defect` child
- `User story` and `Task` creation or moves require a PI-committed parent
- active non-`Epic` work cannot stay uncommitted
- PI-committed non-`Epic` work must also carry non-backlog `Iteration`
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
| `elaborate` | `POST /v1/delivery-initiatives/{delivery_id}/plan/apply`, `POST /v1/delivery-work-items`, `POST /v1/delivery-work-items/{work_item_id}/move`, `POST /v1/delivery-work-items/bulk-update` | `story-and-task-parent-must-be-committed`, `target-pi-required-on-committed-leaf-types`, `committed-non-epic-must-carry-non-backlog-iteration`, `pi-committed-feature-must-have-open-leaf-child` |
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

- `npm run art -- bootstrap`
- `npm run art -- workflow-health`
- `npm run art -- initiative review-pack <delivery-id>`
- `npm run art -- initiative execution-summary <delivery-id>`
- `npm run art -- initiative planning <delivery-id>`
- `npm run art -- initiative planning-repair <delivery-id> <payload.json>`
- `npm run art -- initiative closeout-readiness <delivery-id>`
- `npm run art -- initiative close <delivery-id> <payload.json>`
- `npm run art -- item continuation <work-item-id>`
- `npm run art -- item blocker <work-item-id> <payload.json>`
- `npm run art -- item complete <work-item-id> <payload.json>`
- `npm run art -- item stale-open-close <work-item-id> <payload.json>`
- `npm run art -- scaffold item-complete <work-item-id> <output.json> [repo-root...]`
- `npm run art -- scaffold initiative-close <delivery-id> <output.json> [repo-root...]`

The CLI keeps the operator surface broker-owned while hiding the pod-exec
mechanics that are still required by the active devint profile.

The scaffold commands are local helpers on the same entrypoint. They generate
editable closeout payloads from repo state so operators do not have to hand-build
every JSON body for item completion or initiative closeout. When multiple repo
roots are supplied, the scaffold links them together into one closeout packet by
including changed surfaces, branch/head references, and changed change-record
paths across those repos.

Use the blocker workflow when the exact next committed ART step cannot proceed.
Do not use generic update to move work into or out of `blocked`.

### Proposal To Delivery

- `POST /v1/ideas/{idea_id}/consume`
- `POST /v1/ideas/{idea_id}/closeout`

`POST /v1/ideas/{idea_id}/consume` creates one top-level `Epic` shell in
`Workspace Delivery ART`. It is the initiative entry point, not the place to
pre-expand a full execution tree. When the durable initiative owner is already
known, the same consume route may also set top-level `owner_repo` so the epic
lands with machine-readable ownership from the first write.

### Delivery Session Reads

- `GET /v1/delivery-session/bootstrap`
- `GET /v1/delivery-session/workflow-health`
- `GET /v1/delivery-session/quality-pack`

### Delivery Initiative Reads

- `GET /v1/delivery-initiatives`
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
elaboration only after PI commitment exists. They are not intended to create
pre-PI story forests.

Use `POST /v1/delivery-work-items/{work_item_id}/stale-open-close` only when a
bounded read already shows a stale-open candidate shape:

- the parent work item is still open
- its children are all terminal
- the operator is explicitly attesting that completed child scope satisfies the
  parent item

That route still requires normal completion evidence. It is a guarded closeout
helper, not a bypass around ART completion discipline.

Use `POST /v1/delivery-initiatives/{delivery_id}/plan/repair` when the operator
intent is explicitly planning repair instead of generic item patching.

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

That route fail-closes when:

- a target work item is outside the requested initiative
- a target work item is already `done` or `retired`
- `decommit` is attempted on work that structurally requires `Target PI`
- `decommit` is attempted while open child scope still exists

### Completion Write Preflight

Before `POST /v1/delivery-work-items/{work_item_id}/complete`, validate the
evidence payload locally:

- `npm run validate:completion-evidence -- <payload.json>`

Then confirm the done-state description still follows the strong narrative
shape before writing:

- required narrative headings for the item type stay present
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

- use direct top-level `k3s kubectl` calls against the broker deployment
- when the broker image lacks `curl`, execute `node` inside the broker pod and
  call `fetch(...)` directly from that runtime
- source the caller headers from the broker pod environment:
  - `x-oos-caller-id` = first value from `CALLER_ALLOWED_IDS`
  - `x-oos-caller-secret` = `CALLER_AUTH_SHARED_SECRET`
- prefer that in-pod `node fetch` path over local Python wrappers,
  product-local OpenProject scripts, or ad hoc background port-forward bridges
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

## Continuation Default

When resuming active ART work:

1. use `GET /v1/delivery-initiatives/{delivery_id}/planning` to find the
   current in-progress front when the target item is not already known
2. use `GET /v1/delivery-work-items/{work_item_id}/continuation-context` to
   retrieve one compact resumption packet for the chosen item
3. if planning surfaces a `ready` `PI Objective`, `Feature`, or another
   umbrella item such as a `Feature` or `User story` classified as `Enabler`,
   do not treat planning as sufficient proof that it is executable next work
4. inspect that item's continuation packet before recommending it as the next
   front
5. if the continuation packet shows `open_child_count=0` and completed related
   scope already satisfies the item, treat it as a stale-open closeout
   candidate instead of the active execution front

The continuation packet is the default resume read for ART work because it
returns the target item, parent chain, related open siblings, previously
completed related items, target dependency context, target execution
classification, and enclosing initiative lineage context without forcing the
operator to scan the entire execution tree by hand.

## Strict Exception Rule

Direct OpenProject runners are allowed only for:

- bootstrap before the broker runtime is available
- break-glass recovery
- platform-admin maintenance that is not part of the delivery execution plane

Those exceptions are not a second supported operator surface.
