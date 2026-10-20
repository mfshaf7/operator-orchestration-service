# Workspace Intake

Workspace Intake classifies a repository, product, or component as out of
scope, proposed, or admitted. It does not activate inventory, provision a
repository, deploy runtime, or promote product maturity.

## Availability

The OOS workflow is pinned to the merged Workspace Governance authority and
WGCF readiness manifests from ART #1206 and #1207. The manifest's
`ready-for-console-adapter` state is source readiness, not standalone routine
operation authority. Availability depends on the accepted runtime composition.
The Console adapter (#1209), Security decision (#1216), Platform composition
(#1217), and composed operating proof (#1210) remain mandatory and ordered.
Do not interpret source readiness, a prepared review, or a WGCF receipt as
routine availability. Stage, production, external, and multi-user operation
remain unavailable.

The Console is the normal operator client. Every operation below is an OOS
API, not a Console-local state machine or a CLI-only procedure. Before an
operator authors a decision, `POST /v1/workspace-intake/preparations` reads the
current committed authority revision and optimistic-concurrency bindings for
one target. It does not create workflow state, accept a decision, or mutate
authority. Requests use a
caller-specific credential; shared-secret fallback and recommendation-only
callers are denied. A decision's operator reference must match that admitted
caller. This is the current authenticated service-caller boundary, not a claim
that end-user identity delegation has already been implemented.

## Procedure

### Preparing From An Existing Custody Result

The source-qualified owner-admission extension consumes the exact WG/WGCF
bundles on its review branch. Those producer pins are engineering proof, not
merged runtime authority: replace them with actual canonical merged commits
in the coordinated acceptance window before activation. Do not bypass bundle
digests, caller bindings or the existing exact activation chain.

For a repository already provisioned or linked through Repository Custody,
the existing preparation API additionally accepts:

```json
{
  "target": { "kind": "repo", "name": "selected-owner" },
  "repository_custody": {
    "request_id": "<actual retained custody request id>",
    "requested_record": {
      "kind": "repo",
      "repo_class": "<operator-selected class>",
      "requires_security_bindings": false,
      "security_owner": null,
      "notes": "<operator-reviewed classification context>"
    }
  }
}
```

OOS reads its retained, integrity-checked successful custody result and derives
the provider/full-name/numeric-ID binding. The target must match the custody
request's selected workspace owner. A caller cannot substitute provider
coordinates or turn a failed custody result into provenance. The returned
optional `source_candidate` binds the exact custody receipt, provider readback,
target and requested record. Preparation remains read-only: it creates neither
an attestation nor an acknowledged Intake request. The existing body bound is
4 KiB; no token, provider response or arbitrary file is accepted.

Use that exact source/target/requested-record in the existing explicit Intake
request and decision. At submit, OOS rereads custody, independently reconstructs
and compares the source candidate, then retains its own immutable attestation
inside the existing Intake store before acknowledgement. This is an explicit
write, not a hidden preparation effect. The classification still needs the
normal WGCF decision, human source review/merge and canonical readback.
Custody alone is not proposed/admitted status, active Inventory or permission
to issue ordinary source credentials. Direct, Prototype and Delivery source
adapters retain their existing semantics; the Console cannot claim to be the
authenticated OOS source owner at the generic attestation endpoint.

### Classification And Reviewed Source

For a new source-only repository requesting `admitted` with explicit provider
binding and `covered-by-owner-repo` / `product-runtime-source` validation,
complete the existing [owner bootstrap/checkout workflow](repository-owner-bootstrap-operator-surface.md)
first. OOS rereads the actual current owner profile and requires completed
canonical checkout/control evidence before acknowledging the admission. Missing
or changed owner controls are a named prerequisite, not permission to create a
dummy passing profile or defer the failure until cross-repo CI. Existing valid
controls take the non-source checkout path without a fake PR. This proves only
owner controls: normal WGCF evaluation, explicit classification review and
Inventory promotion remain separate, and no app/runtime acceptance is inferred.
Proposed/out-of-scope and legacy/non-source classification keep their existing
semantics. Private/client source readiness is not qualified by the current
public synthetic source adapter.

1. POST one target kind and name to `/v1/workspace-intake/preparations`. Retain
   the returned exact authority revision, canonical target, register digest,
   record version, and record digest. A response is preparation only, not
   admission or mutation authority.
2. Collect a Workspace Governance v2 request from the direct, repository,
   prototype, or delivery source adapter. Preserve its source reference and
   digest. Prototype Studio first posts its exact candidate to
   `/v1/workspace-intake/source-candidates`; Delivery closeout and the
   repository-custody owner do the same inside OOS. OOS retains this immutable
   source-owner attestation before accepting a non-direct request. Direct
   entries are operator-authored and do not claim an external source owner.
   Bind the canonical state returned by preparation.
3. Review its classification, owner routing, and complete proposed record.
   Record explicit acceptance in the digest-bound v2 decision. AI suggestions
   remain suggestions; the decision retains their provenance and disposition.
4. POST `/v1/workspace-intake/requests` with `request`, `decision`, exact
   `authority_revision`, `session_ref`, and `execution_ref`. HTTP 202 confirms
   durable acknowledgement only. Retain `request_id`.
5. POST `{}` to `/v1/workspace-intake/requests/{request_id}/continue`. OOS
   evaluates through WGCF, prepares the canonical owner command in an isolated
   review branch, and opens or recovers the one matching pull request.
6. At `review-required`, inspect the returned review URL. Complete owner
   validation and required exact-head reviews, including Security when the
   change affects trust. Merge through the provider's human review process.
   OOS has no merge endpoint and never writes `main`.
7. Continue again. OOS proves that the exact reviewed change entered canonical
   main history, reads the merged register, and compares the record digest.
   Only `succeeded` with a `merged-authority` receipt proves completion.

GET `/v1/workspace-intake/requests/{request_id}` returns durable progress,
findings, history, the review, and terminal evidence without advancing work.
The API contract and examples are in [OpenAPI](../api/openapi.json).

## Recovery

For repository-custody candidates, the Console reopens retained requests via
`GET /v1/workspace-intake/requests?target_kind=repo&target_name=<owner>&custody_request_id=<exact-id>`.
This read verifies the matching successful custody authority and returns only
that caller/target/custody's original candidates and progress locators, newest
first. It never creates a journal, attests a candidate, submits a classification
or advances a workflow. The original request's existing GET/continue/cancel
actions remain the recovery path; do not manufacture a new classification to
replace a lost acknowledgement.

Pages contain at most 25 records and at most 512 KiB of projected record data.
Use the returned opaque `next_cursor` for the same selector. The durable-history
revision and pending-request count cover the entire selected set, not just the
visible page. A pending original request therefore blocks the Console's new
classification preparation even when that request is on a later page. An
unavailable/corrupt read remains unavailable, not an empty-history fallback.

| Situation | Operator action |
| --- | --- |
| Preparation is stale | Prepare again before submitting. Never rewrite an acknowledged request with new authority bindings. |
| Lost acknowledgement | Resubmit the identical command; the original acknowledgement is returned. |
| Source candidate missing or altered | Re-emit the exact candidate from its authenticated source owner. Do not reconstruct provenance in the browser. |
| Service or host restarted | Read the request, then continue. Persisted preparation and provider identity prevent duplicate mutation. |
| Dependency unavailable | Restore the dependency or credential, then continue. Do not change an acknowledged command. |
| Stale authority or conflicting review head | Inspect the review; cancel the obsolete request and submit a newly reviewed request with new identities. Never force-push or overwrite. |
| WGCF rejects or requires action | Correct the reported finding and submit a new reviewed request. No source change was authorized. |
| PR rejected | The request remains rejected; a new decision requires a new request identity. |
| Operator cancels | POST `{}` to `/v1/workspace-intake/requests/{request_id}/cancel`. OOS closes a matching unmerged review but retains evidence. |
| Merge races cancellation | OOS records the actual merged result instead of claiming cancellation. Reversal is a separate reviewed change. |
| Corrupt or missing coordination state | Stop writes and restore its persisted volume. Do not recreate receipts or infer success from an absent session. |

An admitted classification is still intake. Active inventory promotion and
inventory lifecycle changes use their separate owner workflows. A prepared
branch, WGCF allowance, or successful HTTP response is not active inventory or
runtime permission.

## Runtime Boundary

Platform supplies an exact-repository installation token through a mounted
file, not a PAT or ambient `gh` login. The adapter re-reads it for rotation and
checks that it selects only the configured Workspace Governance repository.
Only GitHub or an explicitly injected loopback test provider is supported.
Redirects and unbounded provider responses are denied.

The runtime needs a trusted Workspace Governance checkout refreshed by its
owner, Git, Python with PyYAML/jsonschema, and `flock`. The OOS image includes
these tools. The checkout is read-only authority; preparation uses a private
temporary clone and runs the committed owner command. OOS persists workflow
coordination on its existing local volume, never a second canonical workspace
database. Kernel locking and fsync protect single-host transactions across
process death. This is not a multi-host storage claim.

Configure the `OOS_WORKSPACE_INTAKE_*` and `WGCF_WORKSPACE_INTAKE_*` fields in
`src/config.js` only through the Platform admission/activation work. Secrets
are never stored in requests, history, provider review text, or receipts.
Source-owner callers also require distinct caller-bound credentials; a shared
secret or the Console caller cannot attest Prototype provenance.

## Verification

```bash
node --test test/workspace-intake-*.test.js
npm run validate:workspace-intake-openapi
npm run validate:api-docs
npm run test:workspace-intake-source -- --authority-root <committed-workspace-governance-checkout>
```

The contract tests also reject stale authority, stale WGCF custody, and
premature runtime activation. The last command creates only temporary Git repositories and workflow state,
then removes them. It exercises the real pinned owner command and a simulated
provider, including forced process death. It does not write an actual provider
repository or activate production credentials. Routine composed proof is ART
#1210 after the ordered Console, Security, and Platform work.
