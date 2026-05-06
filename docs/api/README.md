# API Reference Front

This directory is the canonical API reference front for
`operator-orchestration-service`.

It is layered under the existing workflow/operator docs:

- workflow meaning stays in
  [../operations/delivery-workflow-operator-surface.md](../operations/delivery-workflow-operator-surface.md)
- route and payload reference lives here

## Source Of Truth

- machine-readable source:
  [openapi.json](openapi.json)
- browsable Redoc front:
  [index.html](index.html)
- fast CLI lookup:
  `npm run api:contract -- <METHOD> <PATH>`
- live contract probe:
  `npm run api:probe -- <METHOD> <PATH>`
- completion-evidence preflight:
  `npm run validate:completion-evidence -- <payload.json>`

Use this order by default when working on an existing broker route:

1. `npm run api:contract -- <METHOD> <PATH>` for the bounded route contract
2. `npm run api:probe -- <METHOD> <PATH>` when live broker truth matters
3. `openapi.json` or Redoc when you need the fuller surrounding context
4. `src/app.js` and service code only to confirm implementation details or
   resolve drift

For `POST /v1/delivery-work-items/{work_item_id}/complete`, insert the
completion-evidence preflight before the broker write:

1. `npm run api:contract -- POST /v1/delivery-work-items/{work_item_id}/complete`
2. `npm run validate:completion-evidence -- <payload.json>`
3. confirm the done-state description still follows the strong narrative
   template, especially `Execution Context`
4. remember the broker may append a completion note, and the final stored body
   still has to keep that note inside `Operator work notes`
5. broker write through the bounded delivery route

For `POST /v1/delivery-work-items/{work_item_id}/update`, the broker now
revalidates the final stored body before patching OpenProject whenever the
resulting work item remains `done`, including:

- completion-evidence section formatting
- the stronger done-state narrative contract
- broker-added work notes staying inside `Operator work notes`

Execution-summary reads now surface the same closeout signal on done nodes:

- `done_narrative_contract_applicable`
- `done_narrative_contract_satisfied`
- `done_narrative_contract_issues`

For initiative closeout, the broker now applies a governed PM² review path:

1. record `System Demo Evidence`
2. move the initiative into `PM² Phase = Closing`
3. record `Inspect & Adapt Actions`
4. mark the initiative `done`
5. or use initiative `retired` as the separate non-success terminal path only
   after all descendants are already `done` or `retired`
   and the stored `PM² Phase` is cleared

`GET /v1/delivery-initiatives/{delivery_id}/closeout-readiness` now answers three
separate questions:

- is the initiative ready to enter `Closing`?
- is the initiative ready for final `done`?
- is the initiative ready for terminal `retired`?

`GET /v1/delivery-initiatives/{delivery_id}/active-session-packet` is the
compact initiative resume surface. It combines active fronts, next-ready
fronts, quality drift counts, stale-open candidates, and closeout readiness
without embedding the full execution tree.

`GET /v1/delivery-initiatives/{delivery_id}/evidence-packet` is the compact
initiative evidence surface for review and closeout. It exposes evidence
presence and quality signals without forcing a raw tree reread.

`GET /v1/delivery-work-items/{work_item_id}/evidence-packet` is the compact
item evidence surface. It exposes completion-evidence state, done-narrative
state, ready-contract state, child status summary, and continuation context
without embedding raw description bodies.

`GET /v1/delivery-session/workflow-health` is the fast broker summary for
roadmap projection drift, PM² projection drift, and the compatible
OpenProject-view model behind the ART lane.

`GET /v1/delivery-session/quality-pack` is the broker-native portfolio payload
used by the platform ART quality checker so the normal quality/readiness path
no longer needs direct OpenProject Rails dumps.

The broker also owns the local ART artifact lifecycle used before writes and
closeout evidence:

- `POST /v1/delivery-art/mutation-drafts`
- `POST /v1/delivery-art/mutation-drafts/validate`
- `POST /v1/delivery-art/review-packets`
- `POST /v1/delivery-art/review-packets/validate`
- `POST /v1/delivery-art/review-packets/finalize`

Use these through `npm run art -- draft ...` and
`npm run art -- review-packet ...` so operators no longer have to keep
long-lived loose payloads under `.tmp/`.

Large compact CLI responses are projected through CGG by default. The CLI keeps
the normal `.art/outputs` reference and adds a `cgg_packet_ref` for model-safe
packet, manifest, receipt, and digest lookup. Oversized `--json` responses are
also admitted this way instead of raw-printing. Use `ART_CGG_PACKETING=off`
only for explicit local debugging, or `ART_CGG_PACKETING=required` to fail
closed when packet projection is unavailable.

Local Review Packet drafts can target explicit source repos:

```bash
npm run art -- review-packet draft <delivery-id> .art/review-packets/<name>.json <work-item-id...> --repo-root <source-repo>
```

Use one `--repo-root` per source repo. Broker-local `.art` scratch artifacts are
not source landing-unit evidence.

## Scope

The reference front covers the currently implemented broker route families:

- health and version
- workflow catalog
- idea workflow routes
- delivery initiative routes
- delivery work-item routes
- delivery mutation draft and Review Packet artifact routes

It does not change workflow meaning, trust boundaries, or the rule that the
broker remains a bounded workflow surface rather than a generic OpenProject
proxy.

## How To Read The Broker Payloads

- `/v1/...` routes are broker contracts, not raw OpenProject work-package
  payloads.
- Most write routes use an `input` envelope. The mutable fields you should fill
  live under that object.
- Idea capture and bounded idea decisions also use an `operator` envelope so
  the broker can attribute the human action that created, triaged, or decided
  the idea.
- Broker-shaped ids look like:
  - `idea-40`
  - `delivery-38`
  - `work-item-177`
- Clear-style booleans such as `clear_target_pi` mean "remove the current
  stored value" rather than "set this field to false".

## What Improved In The Redoc Front

- each route now explains when to use it
- write routes now carry concrete request examples
- shared request schemas now include examples as well, so expanding the schema
  panel still shows realistic payloads
- internal-only routes are called out explicitly so the front does not blur
  source-adapter commands with broker control writes

## Internal And Operator-Facing Routes

This front intentionally documents both:

- operator-facing broker routes
- internal-only broker routes such as proposal consumption, closeout, and
  evaluation metadata writes

Those internal-only routes are marked as such in the spec descriptions so the
reference front does not blur adapter-visible workflow commands with internal
broker control paths.

The OpenAPI operations now also carry machine-readable route metadata:

- `x-oos-surface`
- `x-oos-primary-caller`
- `x-oos-owner`
- `x-oos-workflow-family`

That metadata is there so contract lookup, live probing, and future automation
do not have to infer caller/surface intent from prose alone.

## Local Use

Serve the directory locally, then open the Redoc front in a browser:

```bash
python3 -m http.server 18186 --directory docs/api
```

Then open:

```text
http://127.0.0.1:18186/
```

For a fast terminal lookup instead of opening the whole front:

```bash
npm run api:contract -- GET /v1/delivery-work-items/work-item-188/continuation-context
```

For the ART lane health summary:

```bash
npm run api:contract -- GET /v1/delivery-session/workflow-health
```

For a live probe against the active broker in devint:

```bash
npm run api:probe -- GET /v1/delivery-work-items/work-item-188/continuation-context
```

For a local completion-evidence preflight before the completion write:

```bash
npm run validate:completion-evidence -- payload.json
```

## Validation

The local drift check compares the documented route surface in `openapi.json`
to the implemented HTTP route surface in `src/app.js`, enforces route metadata,
and validates documented request/response examples against their schemas.

Run:

```bash
npm run validate:api-docs
```
