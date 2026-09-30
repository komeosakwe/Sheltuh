# Sheltüh architecture

One Next.js app (hosted on Vercel), backed by Supabase (Postgres plus Auth),
with Stripe Connect for payments. There's no separate backend service:
the API is this app's own route handlers under `app/api/`.

```
Browser ── Supabase Auth (sign-up, sign-in, sessions)
   │
   │  fetch /api/*  + Authorization: Bearer <Supabase access token>
   ▼
Next.js route handlers (app/api/** → lib/server/handlers/*)
   │  verify token with Supabase Auth · authorise · validate
   ├──▶ Postgres (Supabase), via DATABASE_URL
   └──▶ Stripe (Connect accounts, Checkout Sessions)
                      │
Stripe ──webhook──▶ /api/stripe/webhook
```

## Design principles

- **The browser never talks to the database.** Supabase's Data API is shut
  out: RLS is on for every table, with no policies, and the anon and
  authenticated roles have no grants. All access goes through
  `lib/server/`, which enforces authorisation in one place and is covered
  by tests. If a future feature needs direct client access (e.g. realtime
  "Who's Going"), add narrow RLS policies for just that. New functions in
  `private` also revoke `execute` explicitly (Postgres grants it to PUBLIC
  by default); `tests/server/schema-grants.test.ts` checks all of this.
- **The database enforces the rules that matter most.** Whatever the
  application code does:
  - Overselling is impossible: a `quantity_sold <= quantity_available` check
    on `ticket_types`.
  - Slugs are unique.
  - There's one organiser application per account.
  - A ticket type that has sold tickets can't be deleted.
- **Multi-step changes are single database functions**, each atomic. They
  live in the `private` schema (see "Database functions" below).
- **Ownership comes from the verified token, never the request.** An
  organiser's id is looked up from the caller's user id. Someone else's
  event is a 404, not a 403, so its existence isn't leaked.
- **Admin is `app_metadata.role = "admin"` on the Supabase user.** Only a
  secret key can set it (`scripts/promote-admin.ts`). The API re-reads it
  from Supabase Auth on every request.

## Tables (`supabase/migrations/`)

| Table | Key | Notes |
|---|---|---|
| `organisers` | `id` | `owner_user_id` is unique, one application per account. It's null for platform-managed organisers (events Sheltüh lists on someone's behalf, and seed data). `status`: pending → approved / rejected. Also holds the Stripe Connect account id and `payouts_enabled`. |
| `events` | `id` | Belongs to an organiser. Globally unique `slug`. `status`: draft → pending_review → published / rejected; unpublish returns it to draft. `is_free` is kept up to date for the feed's free/paid filter. `whos_going_enabled` (default true) is an admin-only kill switch for that event's Who's Going, set in SQL (`docs/supabase-setup.md`). |
| `ticket_types` | `(event_id, id)` | `id` is stable across draft edits. `quantity_sold` only ever changes in `fulfil_order`. |
| `event_images` | `event_id` | Optional organiser photo (≤2 MB, JPEG/PNG/WebP) stored as `bytea` — no Storage bucket or extra secret. Public via `GET /api/events/[id]/image` once published (cached for a day, versioned URL); before that only the owner/admins with a token. Move to Storage/CDN if volume grows. |
| `event_moderation_log` | `id` | Append-only: submitted / approved / rejected / unpublished, by whom, and why. |
| `orders` | `id` (`ord_…`) | Priced snapshot of the line items and totals. `status`: pending → paid / failed, or oversold_refund_required → refunded. `tickets_emailed_at` records the ticket email. |
| `tickets` | `code` | One row per admitted person. This is the future home of check-in. |
| `profiles` | `user_id` | A member's social identity: `display_name` (1–40 characters), `adult_confirmed_at` (required: no profile without an 18+ confirmation). Deleted with the Supabase account. `social_suspended_at` is deprecated and ignored (see `private.social_suspensions`). |
| `event_attendees` | `id` | One row per Who's Going opt-in, unique per `(event_id, user_id)`. `id` is the opaque `attendeeId` shown to members: a fresh one per event, so it can't be linked across events or to a user. Deleted with the profile or the event, and by `purge_social_data` 30 days after the event ends. |
| `private.social_suspensions` | `user_id` | Admin-set Who's Going suspensions (SQL only, `docs/supabase-setup.md`). Keyed on the auth user, not the profile, so a member can't clear one by deleting and recreating their profile. Deleted with the Supabase account. |
| `private.rate_limits` | `(user_id, bucket)` | Fixed-window per-member request counters (`take_rate_limit`). Deleted with the account; stale rows purged daily. |
| `conversations` | `id` | One per pair of members, ever: `(user_low, user_high)` unique with `user_low < user_high`. `initiator_id` sent the request; `status`: requested → accepted (a reply) / declined. `event_id` is where they met (set null if the event is deleted). Per-side last-read message ids; `last_message_at` for ordering and retention. `id` is the opaque `conversationId`. Deleted with either member's profile, and 12 months after the last message. |
| `messages` | `id` (identity) | Plain text, 1–1000 characters (check constraint). The id is the opaque, increasing `messageId` (keyset cursor). Deleted with the conversation or the sender's profile. |
| `user_blocks` | `id` | `(blocker_id, blocked_id)` unique, keyed on the accounts (not profiles), so recreating a profile doesn't lift a block. `id` is the opaque `blockId`, shown only to the blocker. |
| `private.user_reports` | `id` | A member's report: copies of the reported message, up to 20 messages of context and the reported display name. Every reference is `on delete set null`, so the evidence survives the messages and both accounts. `status`: open → actioned (suspended) / dismissed. Resolved reports are deleted 2 years after resolution. |

Timestamps are `timestamptz`. Organisers enter Australia/Melbourne local
times, which are converted to instants honouring daylight saving
(`lib/server/melbourne-time.ts`).

## Database functions (schema `private`)

| Function | What it guarantees |
|---|---|
| `create_event_draft`, `update_event_draft` | Event row and ticket types saved together. Updates only succeed while the event is draft or rejected and owned by the caller's organiser. |
| `replace_ticket_types` | Upserts by id and removes ticket types that were dropped. Refuses to remove one with sales, or to cut a quantity below what's already sold. |
| `transition_event` | Changes status and writes the moderation log entry in one step. It only moves an event from an expected status, so two admins acting at once can't both succeed; the loser gets a 409. |
| `set_going` | Opts a member in to an event's Who's Going, checking everything in one step: the event is published, enabled and hasn't ended; the member isn't suspended (checked before the profile, so a suspended member without one still gets `suspended`); they have a profile; and a `paid` order for the event has their verified email (case-insensitive). Share-locks the event, then the profile, so an unpublish or profile deletion can't interleave. A suspension recorded mid-call can't be locked in advance, but every count and list filters suspensions at read time. Idempotent. Returns `going`, `event_unavailable`, `suspended`, `no_profile` or `not_eligible`. |
| `take_rate_limit` | Records one hit on a member's `(user, bucket)` counter and says whether it's within the limit for the window. One upsert, so concurrent requests can't both take the last slot. |
| `purge_social_data` | Retention: deletes Who's Going opt-ins 30 days after their event ended, rate-limit rows idle for a day, conversations (with their messages) 12 months after their last message, and resolved reports 2 years after resolution. Idempotent. Scheduled daily with Supabase Cron (`docs/supabase-setup.md`), not by a migration. |
| `request_conversation` | A first message to the member behind an `attendeeId`, checked in one step: the sender isn't suspended and is opted in to the same event, which is open; the recipient isn't suspended; neither blocks the other; the pair has no conversation yet; and the sender is within both rate limits. Locks the sender's profile first (`for no key update`, so it doesn't block the other member's FK checks and mutual requests can't deadlock). Two members requesting each other at once: the unique pair makes the second insert fail, which rolls back its rate-limit hits and returns `exists` (409). Returns `sent`, `sender_suspended`, `not_going`, `unavailable`, `self`, `exists` or `rate_limited`. |
| `send_message` | Locks the sender's profile, then the conversation, then checks visibility (blocks, the other member's suspension, a declined request), that the sender isn't waiting on their own request, and the rate limit, before inserting. A reply to a request accepts it; a reply and a decline racing can't both win. Returns `sent`, `sender_suspended`, `not_found`, `awaiting_reply` or `rate_limited`. |
| `file_report` | Checks the reporter is in the conversation (and the message is the other member's), takes the rate limit and copies the evidence into the report in one step. |
| `resolve_report` | Closes an open report only (a second admin gets 409); `suspend` also records the suspension in the same step. |
| `fulfil_order` | Takes inventory for every line item, issues the tickets and marks the order paid. If any ticket type has sold out, or the event is no longer published, it takes nothing and marks the order `oversold_refund_required`. Rows are locked in a fixed order, so concurrent orders can't deadlock. It's idempotent, so Stripe's webhook redeliveries are harmless. |

## Payment flow

1. `POST /api/events/[eventId]/checkout` (guest, no account):
   - Prices come from the database, never the client.
   - The order is inserted as `pending` *before* Stripe is called, so a
     payment can never arrive without an order to attach it to.
   - A Checkout Session is created as a destination charge to the
     organiser's Express account, with `application_fee_amount` set to the
     booking fee.
   - Free orders skip Stripe and are fulfilled immediately.
2. The buyer pays on Stripe's hosted page. Card details never touch
   Sheltüh.
3. `POST /api/stripe/webhook`:
   - The signature is verified.
   - `checkout.session.completed` (when the session is paid) or
     `async_payment_succeeded` → `fulfil_order`.
   - If `fulfil_order` finds the tickets sold out, or the event no longer
     published, the payment is refunded straight away (`reverse_transfer`
     and `refund_application_fee`, idempotency-keyed per order). The order
     becomes `refunded` only when Stripe reports the refund succeeded;
     `refund.updated` / `refund.failed` settle pending ones. A refund call
     that errors returns 500, so Stripe redelivers and it's retried.
   - `expired` / `async_payment_failed` → the order is marked `failed`.
   - Inventory is only taken here, so an abandoned checkout never holds
     tickets.
4. Once an order is paid (free orders included), the buyer is emailed their
   ticket codes over SMTP (`lib/server/email.ts`). This is best-effort: a
   failed send is logged and leaves `orders.tickets_emailed_at` null. Free
   orders require the buyer's email address at checkout; for paid orders,
   Stripe collects it.
5. `/checkout/success?session_id=<order id>` polls
   `GET /api/orders/by-session/<id>`. The unguessable order id is the
   credential. A pending order reveals only its status.

## Who's Going

A member is shown as going to an event only when all of these hold:

- They're signed in, and Supabase Auth has confirmed their email
  (`Caller.emailVerified`, from `email_confirmed_at`; `requireVerifiedCaller`
  returns 403 otherwise).
- A `paid` order for the event (free tickets are A$0 paid orders) has a
  `buyer_email` equal, ignoring case, to that verified email. Guest checkout
  has no account, so the email is the only link between a ticket and a
  member.
- They've created a profile (display name plus an 18+ confirmation) that
  isn't suspended.
- They opted in for that event. It's off by default.

Who sees what:

- The public sees only a count (`{count, closed, countHidden}`), and not even
  that below 3 people: `count` is then 0 with `countHidden: true`, so 0, 1
  and 2 look the same.
- Verified members with a profile that isn't suspended see display names,
  paginated (at most 50 a page), with an opaque per-event `attendeeId`.
  Never an email, user id or ticket type. The list is rate-limited per
  member (30 requests per 10 minutes, then 429).
- Suspended members (`private.social_suspensions`) are left out of every
  count and list, can't see names, and can't create, rename or recreate a
  profile. Deleting their profile doesn't lift the suspension.
- Responses about the caller (`/going/me`, `/going/attendees`,
  `/profiles/me`) are sent `cache-control: private, no-store`.
- Retention: opt-ins are deleted 30 days after the event ends
  (`purge_social_data`, run daily by Supabase Cron).
- Once the event ends, or `whos_going_enabled` is off, it's `closed`: the
  count is 0, the list is empty, and new opt-ins are refused.
- Opting out (`DELETE …/going/me`) and deleting the profile always work,
  whatever state the event is in, and need no verified email.

## Messages

Direct messages between members who met on a Who's Going list
(`lib/server/handlers/messages.ts`, `blocks.ts`, `reports.ts`):

- **First contact** is one request message (1–1000 characters, plain text,
  no links), and only between two members opted in to the same event while
  its Who's Going is open, neither suspended nor blocking the other. The
  client only knows the recipient's per-event `attendeeId`; the server
  resolves it. One conversation per pair, ever (a second request either way
  is a 409).
- **Accepting** is replying. Until then the sender can't send more (409).
  **Declining** is silent: the conversation disappears for the recipient,
  and the sender keeps seeing their request as waiting, exactly as before.
  After acceptance the conversation carries on whatever happens to the event.
- **Limits** (`take_rate_limit`, per sender): 10 new requests per 24 hours,
  60 messages per hour (requests included), 20 reports per 24 hours. Refused
  attempts don't use the allowance.
- **Blocks** are silent. While either blocks the other, their conversation is
  hidden from both (404 everywhere), neither can message the other, and each
  is left out of the other's Who's Going list (the public count is
  unchanged). A block by `attendeeId` works before any conversation exists.
- **Suspended members** (`private.social_suspensions`) can't send (403), and
  their conversations disappear for everyone else.
- **Reports** keep copies (the message, up to 20 messages of context, the
  display name) that outlive the messages and both accounts. Admins work the
  queue at `/api/admin/reports`; resolving with `suspend` suspends the member.
- **Privacy**: members appear only as display names; conversations, messages
  and blocks only by opaque ids. No user id or email is ever sent. Every
  response is `cache-control: private, no-store`. Messages are plain text,
  to be rendered as text: the API normalises line breaks and blank lines,
  and rejects control and bidi-override characters.
- **Retention**: conversations are deleted 12 months after the last message,
  resolved reports 2 years after resolution (`purge_social_data`). Deleting a
  profile deletes that member's conversations (for both sides) straight away;
  reports keep their copies.
- Access is read-by-request (the client polls `?after=` and
  `/conversations/unread`); there's no realtime channel.

Booking fee: 4% of face value + A$0.50 per paid ticket (`lib/fees.ts`,
which the API and the UI both use). It's either buyer-paid or absorbed by
the organiser, set per ticket type. Either way the platform keeps it.

## API

All routes are JSON under `/api`. "Organiser" means a signed-in user whose
application is approved.

| Method & path | Who |
|---|---|
| `GET /events?q&category&pricing&onOrAfter&cursor&limit` | public (published only) |
| `GET /events/slug/{slug}` | public (published only) |
| `POST /events/{eventId}/checkout` | public |
| `GET /orders/by-session/{orderId}` | public (id is the credential). Includes `eventTitle` and `eventSlug` for linking back to the event |
| `POST /stripe/webhook` | Stripe (signature-verified) |
| `POST /organisers/apply` · `GET /organisers/me` · `PATCH /organisers/me` | signed in |
| `POST /organisers/me/connect/onboard` · `…/connect/refresh` | organiser |
| `POST /events` · `PATCH /events/{id}` · `POST /events/{id}/submit` | organiser (own events) |
| `GET /organisers/me/events` · `GET /organisers/me/events/{id}` | organiser (own events) |
| `PUT /events/{id}/image` · `DELETE /events/{id}/image` | organiser (own events, while draft or rejected) |
| `GET /events/{id}/image` | public once published; before that, the owning organiser or an admin |
| `GET /events/{id}/going` | public (published only): `{count, closed, countHidden}` |
| `GET /events/{id}/going/attendees?cursor` | verified email with a profile that isn't suspended (403 otherwise); published only; 429 when rate-limited |
| `GET /events/{id}/going/me` · `DELETE /events/{id}/going/me` | signed in (own opt-in) |
| `PUT /events/{id}/going/me` | verified email, eligible ticket holder with a profile. 404 if Who's Going isn't open, 409 without a profile, 403 if not eligible or suspended |
| `GET /profiles/me` · `DELETE /profiles/me` | signed in (own profile; DELETE also removes every opt-in, and every conversation the member is in, for both sides) |
| `PUT /profiles/me` | verified email, not suspended (403). Creating needs `adultConfirmed: true` (an explicit `false` is a 400); a rename (no `adultConfirmed`) with no profile is a 404. Display names are checked in `lib/server/profile-input.ts`: no control, invisible or default-ignorable characters (U+FE0E/FE0F allowed), at least one letter or digit, at most 4 combining marks per character, no links, emails or @handles, no Latin/Cyrillic/Greek mix within a word, and no reserved names, compared on a lookalike skeleton |
| `GET /conversations?cursor` | verified member: own conversations, newest activity first |
| `POST /conversations` `{attendeeId, body}` | verified member going to the same open event. 201; 400 invalid/links/self, 403 not going or suspended, 404 member unavailable, 409 conversation exists, 429 |
| `GET /conversations/unread` | verified member: `{count}` of conversations with something unread |
| `GET /conversations/{id}/messages?after\|before` · `POST …/messages` `{body}` | verified participant (404 otherwise). POST: 409 while awaiting a reply, 403 suspended, 429 |
| `POST /conversations/{id}/decline` | signed-in recipient of a request (204, idempotent); 409 otherwise; 404 non-participant |
| `POST /conversations/{id}/read` `{lastReadMessageId?}` | verified participant (204) |
| `GET /blocks?cursor` · `POST /blocks` `{conversationId}\|{attendeeId}` · `DELETE /blocks/{blockId}` | signed in (own blocks). POST 201 new / 200 existing; DELETE 204, idempotent |
| `POST /reports` `{conversationId, messageId?}\|{attendeeId}, reason, details?` | signed in. 201; 404 not yours; 429 |
| `GET /admin/reports?status` · `POST /admin/reports/{id}/resolve` `{action, note?}` | admin. 409 if already resolved |
| `GET /admin/organisers?status` · `POST /admin/organisers/{id}/approve` · `…/reject` | admin |
| `GET /admin/events?status` · `POST /admin/events/{id}/approve` · `…/reject` · `…/unpublish` | admin |

Lists are paginated with an opaque `cursor` (`nextCursor` in the
response). It's currently a row offset, fine at this scale.

## Code map

- `lib/server/handlers/*`: one function per route. Each takes
  `(request, params, deps)`, so tests can pass a real test database and a
  fake Stripe.
- `lib/server/records.ts`: the SQL that reads each record, and the
  row → API-shape mappers.
- `lib/server/deps.ts`: the production wiring (postgres.js, Supabase Auth,
  Stripe, SMTP), read from env.
- `lib/api/*`: the browser-side client for the same routes.
- `lib/auth/AuthContext.tsx`: Supabase Auth in the browser.
- `tests/server/*`: API tests against a real Postgres. By default that's
  PGlite in-process. With `TEST_DATABASE_URL=postgres://…` set, they run
  against a real server through the production driver.

## Not built yet

- QR check-in.
- Venue coordinates (the map falls back to suburb centroids).
- Who's Going beyond increment 2: no admin UI for suspensions or the
  per-event switch (SQL only, `docs/supabase-setup.md`), and an opt-in isn't
  revisited if the member later changes their email or the order stops being
  `paid`.
- Messages: no realtime delivery or email notifications (clients poll), no
  attachments, and a declined pair can't start over (one conversation per
  pair, ever).
