# Sheltüh — accounts, organisers, admin milestone architecture

This documents the data model and API surface for the AWS milestone (Cognito +
DynamoDB + Lambda + API Gateway), before any code was written. It covers
accounts, organiser applications, event submissions, and admin review. It does
**not** cover payments or ticket issuance — those stay out of scope.

## Design principles

- Every table is queried by key or a GSI. No route does a full table scan.
- Ownership is enforced server-side from the authenticated caller's identity
  (Cognito `sub`), never trusted from client-supplied IDs.
- State transitions are validated centrally (`lambda/shared/state.ts`) so
  "draft → pending_review → published" style rules live in one place.
- Admin status is a Cognito group (`admins`), checked from the verified JWT's
  `cognito:groups` claim. It is never settable through any API route.

## Cognito

- One User Pool, email as the username, email verification required before
  sign-in.
- Standard attributes only (email). No custom "role" attribute — that would
  let a user claim admin/organiser status via their own token payload before
  a database record backs it up. Organiser status lives in DynamoDB;
  admin status lives in the `admins` Cognito group.
- App client: public SPA client (no client secret), used by the Next.js
  frontend for the standard auth flows (sign up, confirm, sign in, refresh,
  forgot/reset password).
- `admins` group: created by the CDK stack, empty by default. Membership is
  granted only via `scripts/promote-admin.ts` (wraps
  `AdminAddUserToGroup`), run by someone holding real deploy-level AWS
  credentials, against a real email supplied on the command line — never
  hardcoded, never self-service. See docs/aws-setup.md.

## DynamoDB tables

All tables use on-demand (pay-per-request) billing — no capacity planning
needed for a dev-scale prototype, and it keeps idle cost at ~0.

### `Organisers`

One item per applicant. The partition key is the Cognito `sub`, which makes
"do I already have an application" and "get my status" a single `GetItem`,
and makes duplicate-pending-application prevention a property of the key
schema rather than application logic.

| Attribute | Type | Notes |
|---|---|---|
| `ownerUserId` (PK) | S | Cognito `sub` of the applicant |
| `organiserId` | S | ULID, minted once, stable across resubmission; what `Events` items reference |
| `displayName` | S | |
| `contactEmail` | S | |
| `description` | S | |
| `categories` | SS | subset of the event category enum |
| `websiteUrl` | S? | optional |
| `status` | S | `pending` \| `approved` \| `rejected` |
| `rejectionReason` | S? | set on rejection, cleared on resubmit |
| `reviewedBy` | S? | admin's Cognito `sub` |
| `reviewedAt` | S? | ISO instant |
| `createdAt` / `updatedAt` | S | ISO instant |

**GSI `status-index`**: PK `status`, SK `updatedAt`. Used by the admin queue
(`GET /admin/organisers?status=pending`) to page through applications by
status without scanning the table.

**Access patterns covered:**
- Applicant creates/reads/resubmits their own application → `GetItem`/`PutItem` on PK.
- Admin lists applications by status, paginated → `Query` on `status-index`.
- Approve/reject → conditional `UpdateItem` on PK (see below).

### `Events`

One item per event, partitioned by the owning organiser so "list my events"
and the "only my organisation's private records" isolation rule are both a
single `Query` on the partition key — no cross-organiser leakage is possible
even if application logic had a bug, because a `Query` is bounded to the
caller's own `organiserId` partition.

| Attribute | Type | Notes |
|---|---|---|
| `organiserId` (PK) | S | owning organiser |
| `eventId` (SK) | S | ULID (time-sortable) |
| `slug` | S | public URL slug, uniqueness enforced via `EventSlugs` |
| `title`, `description`, `category` | S | |
| `venueName`, `venueAddress`, `suburb` | S | |
| `startsAt`, `endsAt` | S | ISO instant; see "Timestamps" below |
| `organiserName` | S | denormalised from `Organisers` at write time, so the public feed never joins across tables |
| `ticketTypes` | L | `{id, name, description?, priceCents, feePolicy, quantityAvailable}[]` — definitions/fee previews only, no inventory tracking yet |
| `status` | S | `draft` \| `pending_review` \| `published` \| `rejected` |
| `rejectionReason` | S? | |
| `moderationLog` | L | append-only `{action, by, at, reason?}[]` |
| `createdAt` / `updatedAt` | S | |

**GSI `status-startsAt-index`**: PK `status`, SK `startsAt`. Serves both:
- the public feed (`GET /events`, `status = published`), and
- the admin event queue (`GET /admin/events`, `status = pending_review`),

paginated and pre-sorted by start time, with no scan.

**Access patterns covered:**
- Organiser lists their own events → `Query` PK = own `organiserId`.
- Organiser creates/edits a draft → `PutItem`/`UpdateItem` on PK+SK, gated by
  a conditional expression on `status IN (draft, rejected)`.
- Admin lists pending events → `Query` on `status-startsAt-index`.
- Admin approve/reject/unpublish → conditional `UpdateItem` on PK+SK.
- Public feed reads → `Query` on `status-startsAt-index`, `status = published`.

### `EventSlugs`

A thin table purely to make slugs globally unique with a single atomic
write, since DynamoDB GSIs don't enforce uniqueness.

| Attribute | Type |
|---|---|
| `slug` (PK) | S |
| `organiserId` | S |
| `eventId` | S |

Written with `PutItem` + `attribute_not_exists(slug)` when a draft's slug is
first set. The public "get by slug" Lambda does `GetItem` here, then
`GetItem` on `Events` — two point reads, still no scan.

## Conditional updates (race safety)

Every review decision (organiser approve/reject, event approve/reject/
unpublish) is a DynamoDB `UpdateItem` with a `ConditionExpression` requiring
the record to still be in the expected pre-review status (e.g.
`status = pending_review`). Two admins clicking "approve" at the same moment
results in one success and one `ConditionalCheckFailedException`, which the
Lambda turns into a 409 — no duplicate/conflicting decisions, no need for
locks.

## Timestamps and timezone

All stored timestamps are ISO 8601 UTC instants (`new Date().toISOString()`),
consistent with the state each item is actually in. `startsAt`/`endsAt` for
events are captured from an organiser-submitted **Australia/Melbourne**
local date+time and converted to a UTC instant at write time (accounting for
AEST/AEDT via `Intl`/`Temporal`-safe conversion — never a fixed UTC+10
offset, since Melbourne observes daylight saving). The existing frontend
formatters already render any stored instant back into Melbourne local time
for display, so this is a drop-in replacement for the naive sample-data
strings used in the local-only milestone.

## API surface

| Method & path | Auth | Notes |
|---|---|---|
| `GET /events` | none | published only, paginated, `category`/`onOrAfter`/`pricing` filters |
| `GET /events/{slug}` | none | published only |
| `POST /organisers/apply` | verified user | 409 if a non-rejected application already exists |
| `GET /organisers/me` | verified user | own record, 404 if none |
| `PATCH /organisers/me` | verified user | only if `status = rejected`; resets to `pending` |
| `POST /events` | approved organiser | creates a `draft`, `organiserId` taken from caller, never from the body |
| `PATCH /events/{organiserId}/{eventId}` | owning organiser | only if `status IN (draft, rejected)` |
| `POST /events/{organiserId}/{eventId}/submit` | owning organiser | `draft`/`rejected` → `pending_review` |
| `GET /organisers/me/events` | approved organiser | paginated, own partition only |
| `GET /organisers/me/events/{eventId}` | owning organiser | single record for the edit form |
| `GET /admin/organisers` | `admins` group | `?status=pending` etc., paginated |
| `POST /admin/organisers/{ownerUserId}/approve` | `admins` group | conditional on `status = pending` |
| `POST /admin/organisers/{ownerUserId}/reject` | `admins` group | body `{ reason }` |
| `GET /admin/events` | `admins` group | `?status=pending_review` etc., paginated |
| `POST /admin/events/{organiserId}/{eventId}/approve` | `admins` group | conditional on `status = pending_review` |
| `POST /admin/events/{organiserId}/{eventId}/reject` | `admins` group | body `{ reason }` |
| `POST /admin/events/{organiserId}/{eventId}/unpublish` | `admins` group | conditional on `status = published`, → `draft` |

Every route (aside from the two public reads) requires a valid Cognito JWT
via the API Gateway HTTP API's built-in JWT authorizer — no route re-invents
authentication, only per-route authorization (approved-organiser / owns-this-
record / admins-group) inside the handler.

This API shape is plain JSON over HTTP with no web-only assumptions, so a
future mobile app can call it directly.
