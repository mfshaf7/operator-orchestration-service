# Delivery Project Members

## Availability and authority

This maintenance extension is implemented for preview and native qualification.
It is not activated by changing documentation. The coordinated Console, OOS and
Platform source must be reviewed and commissioned together. OpenProject remains
the canonical identity and membership authority; OOS owns the bounded workflow.

Use **Delivery → Catalog → Assignee / Responsible → Manage Members**. The
Console lists current members with their project roles and protected access.
Search and 25/50/100-row pagination read bounded native pages. Navigation and
opening a form do not change access.

## Add, change or remove

1. Add Member selects an existing visible user or group, then existing project
   roles. Accounts already in the project are edited from their member row.
   Search narrows the existing-account choices; it never creates an account.
2. Change Roles shows current roles and the proposed replacement. Role labels
   and whether they support work assignment or membership administration come
   from OpenProject. Global, built-in entity-only and internal service roles
   cannot be granted here.
3. Remove Member reviews loss of this project membership. It does not delete
   the account or rewrite historical work assignments. Group-inherited roles
   are managed through the group. Installation service and administrator access
   are protected, including groups containing protected identities.
4. The operator explicitly applies the reviewed form. Server-derived caller,
   operator and project authority cannot be supplied by the browser. Native
   membership services enforce current role permissions and group inheritance.
5. Success requires exact native readback and its transactional receipt. The
   Console then reloads membership and Catalog; a failed list refresh retains
   the successful outcome and prevents further changes until a current read.

Catalog's assignable lookup uses the same native `possible_assignee` rule as
the OpenProject assignment picker, including eligible users, groups and
placeholders. Plain membership or an active account does not imply assignment
permission. Reader membership remains visible in Project Members but is absent
from assignment choices. Placeholder membership is inspectable and managed in
OpenProject; the Console mutation scope is existing users/groups.

Account creation, invitations, global roles and identity-provider configuration
remain outside this project-membership workflow. Unavailable accounts do not
justify granting global directory enumeration. Configure account visibility in
OpenProject when needed; the form explicitly reports no eligible accounts.

## Errors and recovery

A failed initial read replaces the member section with an error and Retry
loading. Live failure never displays disconnected sample members. Permission
denial is distinct from an empty eligible list.

A stale review requires reloading current membership and reviewing again.
An unconfirmed response freezes the accepted request. Retry same change and
Recover pending change resend the same request ID, roles and reviewed target.
Closing a form does not undo a committed operation or enable a replacement
while that request remains unconfirmed. After a new browser session, reopen
members and inspect the latest recorded outcome/current roles before making a
new decision. The ten most recent caller/operator outcomes remain in the
projection; all receipts remain in the existing private OpenProject store.

Membership effects and their request-bound receipts commit in the same
OpenProject transaction. A conflicting reuse of a request ID, foreign project,
global role or protected/inherited target is rejected. Original receipt replay
remains valid after a later legitimate role change and does not reapply it.

## Configuration, rollback and verification

The existing accepted-idea-delivery profile gives its non-admin broker the
Project membership manager role only in the Delivery project. Proposal and
platform-integrated production permissions remain unchanged. The existing
Catalog backend credential authenticates the closed membership adapter; it
does not expose a generic administration runner. Caller-specific OOS
credentials and the configured operator binding are required for both reads
and writes. Console session role/authority verification precedes the adapter.

Rollback the paired source and remove only the added Delivery role from the
broker; retain existing memberships and immutable receipts. Do not delete
project access to simulate rollback. Native qualification uses synthetic
fixtures inside a rollback-only database transaction. Browser tests use an
explicitly disconnected sample or intercepted transport and do not establish
live commissioned operation.

API contract: `GET /v1/delivery-memberships/projection` and
`POST /v1/delivery-memberships/mutations`, documented in
[OpenAPI](../api/openapi.json). The canonical request has no project, caller or
operator fields; these are established server-side.
