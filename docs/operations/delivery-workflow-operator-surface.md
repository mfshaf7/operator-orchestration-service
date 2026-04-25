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
- ART quality validation and one-time normalization
- clean-start, backup, restore, and uninstall controls

Do not add delivery execution scripts back into `platform-engineering`.

## Roadmap Projection

`Target PI` is the canonical ART planning field. The OpenProject roadmap page
is a derived compatibility surface that reads project `version`, not the ART
custom field directly.

That means:

- broker writes set and read `Target PI`
- platform-owned OpenProject controls project matching `version` values from
  `Target PI`
- work with blank `Target PI` still projects into the derived roadmap bucket
  `Not yet committed to a PI`
- roadmap drift is a projection problem, not a second planning source

## Planning Workflow

Broker planning-workflow metadata mirror:

- [delivery-planning-workflow.json](../../src/delivery-planning-workflow.json)

Broker initiative-review workflow mirror:

- [delivery-initiative-review-workflow.json](../../src/delivery-initiative-review-workflow.json)

That mirror must stay aligned to the canonical OpenProject owner contract in
`platform-engineering/products/openproject/delivery-art-planning-workflow.json`.

Use one planning path for newly accepted work:

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

Broker guardrails now enforce that:

- `PI Objective`, `User story`, `Task`, and `Milestone` work cannot exist
  without `Target PI`
- `User story` and `Task` creation or moves require a PI-committed parent
- active non-`Epic` work cannot stay uncommitted
- PI-committed non-`Epic` work must also carry non-backlog `Iteration`

## Phase-To-Route And Gate Matrix

Use this as the broker-side view of the planning workflow:

| Phase | Main Broker Surface | Key Gates |
| --- | --- | --- |
| `consume` | `POST /v1/ideas/{idea_id}/consume` | `consume-top-level-shell-only`, `consume-must-use-proposal-handoff` |
| `frame` | `POST /v1/delivery-work-items`, `POST /v1/delivery-work-items/{work_item_id}/update` | `backlog-feature-must-stay-umbrella-shaped`, `active-non-epic-must-not-stay-uncommitted` |
| `pi-plan` | `POST /v1/delivery-initiatives/{delivery_id}/governance`, `POST /v1/delivery-work-items`, `POST /v1/delivery-work-items/{work_item_id}/update` | `target-pi-required-on-committed-leaf-types`, `committed-non-epic-must-carry-non-backlog-iteration`, `roadmap-version-must-match-target-pi-projection` |
| `elaborate` | `POST /v1/delivery-work-items`, `POST /v1/delivery-work-items/{work_item_id}/move`, `POST /v1/delivery-work-items/bulk-update` | `story-and-task-parent-must-be-committed`, `target-pi-required-on-committed-leaf-types`, `committed-non-epic-must-carry-non-backlog-iteration` |
| `execute` | `GET /v1/delivery-work-items/{work_item_id}/continuation-context`, `POST /v1/delivery-work-items/{work_item_id}/update` | `active-non-epic-must-not-stay-uncommitted`, `execute-from-leaf-front` |
| `review-carryover` | `POST /v1/delivery-initiatives/{delivery_id}/pi-review`, `POST /v1/delivery-work-items/{work_item_id}/update`, `POST /v1/delivery-work-items/{work_item_id}/complete` | `pi-review-must-carry-review-outcome-and-actual-value`, `carryover-must-be-retargeted-or-decommitted` |

## PM² Initiative Review And Closing

Use one explicit initiative-review path for top-level `Epic` closeout:

1. record `System Demo Evidence`
   - `POST /v1/delivery-initiatives/{delivery_id}/system-demo`
2. move the initiative into PM² `Closing`
   - `POST /v1/delivery-initiatives/{delivery_id}/governance`
3. record `Inspect & Adapt Actions`
   - `POST /v1/delivery-initiatives/{delivery_id}/inspect-and-adapt`
4. mark the initiative `done`
   - `POST /v1/delivery-initiatives/{delivery_id}/governance`
5. retire the initiative only as a separate terminal path
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

### Proposal To Delivery

- `POST /v1/ideas/{idea_id}/consume`
- `POST /v1/ideas/{idea_id}/closeout`

`POST /v1/ideas/{idea_id}/consume` creates one top-level `Epic` shell in
`Workspace Delivery ART`. It is the initiative entry point, not the place to
pre-expand a full execution tree. When the durable initiative owner is already
known, the same consume route may also set top-level `owner_repo` so the epic
lands with machine-readable ownership from the first write.

### Delivery Initiative Reads

- `GET /v1/delivery-initiatives`
- `GET /v1/delivery-initiatives/{delivery_id}/execution-summary`
- `GET /v1/delivery-initiatives/{delivery_id}/planning`
- `GET /v1/delivery-initiatives/{delivery_id}/pi-objectives`
- `GET /v1/delivery-initiatives/{delivery_id}/closeout-readiness`

### Delivery Initiative Writes

- `POST /v1/delivery-initiatives/{delivery_id}/governance`
- `POST /v1/delivery-initiatives/{delivery_id}/plan/apply`
- `POST /v1/delivery-initiatives/{delivery_id}/system-demo`
- `POST /v1/delivery-initiatives/{delivery_id}/inspect-and-adapt`
- `POST /v1/delivery-initiatives/{delivery_id}/pi-review`

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

Use `POST /v1/delivery-work-items` and the update surfaces for rolling-wave
elaboration only after PI commitment exists. They are not intended to create
pre-PI story forests.

### Completion Write Preflight

Before `POST /v1/delivery-work-items/{work_item_id}/complete`, validate the
evidence payload locally:

- `npm run validate:completion-evidence -- <payload.json>`

Then confirm the done-state description still follows the strong narrative
shape before writing:

- required narrative headings for the item type stay present
- `Execution Context` stays a flat bullet list
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
completed related items, and target dependency context without forcing the
operator to scan the entire execution tree by hand.

## Strict Exception Rule

Direct OpenProject runners are allowed only for:

- bootstrap before the broker runtime is available
- break-glass recovery
- platform-admin maintenance that is not part of the delivery execution plane

Those exceptions are not a second supported operator surface.
