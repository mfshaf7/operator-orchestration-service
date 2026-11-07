# Console register queries

Growing registers use bounded pages and independent original-record inspection.
Register pages are read projections, never workflow, approval or completion authority.
The existing authenticated caller and source-envelope boundaries remain unchanged.

- Orchestration: `GET /v1/orchestration/runs?view=register&limit=25` returns
  `runs` and `next_cursor`. Pass the opaque cursor with the same caller and
  selection to reach older Temporal executions. Only the selected page's run
  projections are read. The retained legacy bounded-list shape is unchanged.
  A disabled runtime returns no runs and no continuation; this does not activate it.
- Prototype: `GET /v1/prototypes?view=register` returns at most 25 project
  identities, their referenced immutable owner evidence and caller-scoped workflow
  progress. `page.next_cursor` binds the exact owner revision. A changed source
  requires restarting at the first page. `id=<studio-slug>` reads an exact original
  independently. Global file-count limits do not become project lifetime limits;
  file and byte budgets apply to the selected evidence. Landing and Maturity
  retain the newest progress per transition. Closure retains all qualifying owner
  outcomes for the selected projects; historical graduation confirmations are not
  collapsed into the newest action. Exact workflow request/history reads remain available.
- Delivery: `GET /v1/delivery-initiatives?view=register` reads a native root page,
  preserving closed/inactive packages and deriving phase from the actual scoped
  active child graph. `register_page.next_cursor` binds native total and the
  previous page's ordered identities. Source drift requires first-page refresh.
  `id=delivery-<number>` reads an exact root independently. Native scan totals may
  include filtered non-root records; they are not filtered business totals.
  The existing global Console overview/Execution Board remains a separate read.

- Repository setup history: `GET /v1/repository-owner-bootstrap/requests?owner_repo=<repo>&view=register&limit=25`
  adds `next_cursor` to the existing list result. Keep the same authenticated
  caller, attributed operator, owner repository, limit and view for continuation.
  The pending original is returned independently of the visible page; older
  pages cannot authorize a competing request. The default response keeps its
  legacy closed shape. Register cursors do not accept another scope's marker.

Console Repository Requests scans the native Proposal register independently of
its bounded overview projection. Search and status filtering can continue through
sparse source windows; exact receipt inspection remains separate.

Console adapters can scan bounded successive owner pages for sparse searches.
An empty search window with continuation is not an empty collection. Counters,
boards and dependencies must describe global coverage or explicitly state their
page/partial scope. A source denial must never become an empty successful page.
Private source details do not gain automatic AI access from pagination.

These are source changes in a preview maintenance batch. Runtime operating proof
requires the matching reviewed owner and Console versions. Source tests and a
short-list compatibility read do not prove that an older deployed reader supports
new continuation. The owner dependency must be published before its Console consumer.

Console display windows offer 25/50/100 rows (default 25), independently of native
transport chunks. They compose/slice a bounded number of validated source pages,
retain native cursors unchanged and reject drift or source denial. Configuration
snapshots resize locally. They do not establish global board/count completeness.

The private Registry reader additionally accepts `limit=25|50|100` on
`GET /v1/workspace-inventory/instance-records` (omitted means 25). Its existing
indexed catalog already supports 100. The owner signs the actual requested page;
the Console must not combine smaller signed pages and reuse a digest for different
content. Search/scope/caller controls and canonical counts remain unchanged.
Publish this owner support before its Console consumer uses larger Registry pages.
