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
    on `ticket_types` (and `quantity_sold >= 0`).
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
| `organisers` | `id` | `owner_user_id` is unique, one application per account. It's null for platform-managed organisers (events Sheltüh lists on someone's behalf, and seed data). `status`: pending → approved / rejected. Also holds the Stripe Connect account id and `payouts_enabled`. Optional social handles (`instagram_handle`, `tiktok_handle`, `facebook_page`, `x_handle`), stored without `@` and pattern-checked by the database; `website_url` must be http(s), at most 2048 characters (check constraint; the API only takes new `https://` addresses, see "Organiser profiles"). An admin takedown sets `rejected` (see "Organiser profiles"). |
| `private.organiser_profile_edits` | `id` (identity) | Append-only log per organiser: each profile edit made without review (`profile_edit`: old and new value of each changed field, by the owner) and each admin takedown (`suspended`, with the admin and reason). A trigger refuses updates (except the `actor_id` foreign key's own set-null when that account is deleted). Admins see the newest 20 per organiser. Kept while the organiser exists; deleted with it. |
| `events` | `id` | Belongs to an organiser. Globally unique `slug`. `status`: draft → pending_review → published / rejected; unpublish returns it to draft. `is_free` (true only when the event has ticket types and all are free) is kept up to date by `replace_ticket_types` for the feed's free filter. `whos_going_enabled` (default true) is an admin-only kill switch for that event's Who's Going, set in SQL (`docs/supabase-setup.md`). |
| `ticket_types` | `(event_id, id)` | `id` is stable across draft edits. `quantity_sold` only ever goes up in `fulfil_order`, and down only in `record_payment_refund` (a paid order refunded in full). |
| `event_images` | `event_id` | Optional organiser photo (≤2 MB, JPEG/PNG/WebP) stored as `bytea` — no Storage bucket or extra secret. Public via `GET /api/events/[id]/image` once published (cached for a day, versioned URL); before that only the owner/admins with a token. Move to Storage/CDN if volume grows. |
| `event_moderation_log` | `id` | Append-only: submitted / approved / rejected / unpublished, by whom, and why. |
| `orders` | `id` (`ord_…`) | Priced snapshot of the line items and totals. `status`: pending → paid / failed / oversold_refund_required; oversold_refund_required → refunded (our automatic refund); paid → refunded (refunded in full in Stripe, see "Refunds made in Stripe"). `amount_refunded_cents` (≥ 0, default 0) is Stripe's cumulative refunded amount, recorded only for paid orders (a partial refund leaves the order paid). Indexed on `stripe_payment_intent_id` (partial, not null) for the refund webhook. `tickets_emailed_at` records the ticket email. `tracking_code` is the event tracking link the checkout came through (checked against the event's links when the order is created; null otherwise). |
| `tickets` | `code` | One row per admitted person. Rows are kept when their order is refunded, but only a `paid` order's tickets are valid: check-in checks the order's status. `checked_in_at`: when the ticket was admitted at the door (null until then, and again after an undo; cleared 25 months after the event ends). Indexed on `(event_id, ticket_type_id)` for the check-in counts. |
| `ticket_check_ins` | `id` (identity) | The check-in log (see "Check-in"): one row per scan or undo, with a random `public_id` (uuid, unique: the only id the API shows, as `checkInId`; the sequential `id` stays internal, so ids don't reveal platform-wide scan volume), the event scanned for, the ticket `code` (null for an `invalid` scan: what was scanned is never stored), the acting account, the client's `request_id` (unique per event: the idempotency key), the `result` and, for an undo only, its `reason` (3–200 characters). Check constraints tie `invalid` to a null code and `undone` to a reason. Deleted with the event or the ticket, and by `purge_analytics` 25 months after the event ends. No buyer data. |
| `private.platform_rate_limits` | `bucket` | Platform-wide fixed-window counters (`take_platform_rate_limit`): the hourly and 24-hour confirmation-email caps. Idle rows purged daily. |
| `private.free_order_refusals` | `(day, reason)` | Counts of refused free bookings per Melbourne day and reason. No personal data. Deleted after 13 months. |
| `private.email_outbox` | `id` | One ticket-email job per paid order (`(order_id, kind)` unique): status, attempts, next attempt, lease, redacted last error. No address or content (read from the order at send time). Deleted with the order. |
| `profiles` | `user_id` | A member's social identity: `display_name` (1–40 characters), `adult_confirmed_at` (required: no profile without an 18+ confirmation). Deleted with the Supabase account. `social_suspended_at` is deprecated and ignored (see `private.social_suspensions`). |
| `event_attendees` | `id` | One row per Who's Going opt-in, unique per `(event_id, user_id)`. `id` is the opaque `attendeeId` shown to members: a fresh one per event, so it can't be linked across events or to a user. Deleted with the profile or the event, and by `purge_social_data` 30 days after the event ends. |
| `private.social_suspensions` | `user_id` | Admin-set Who's Going suspensions (SQL only, `docs/supabase-setup.md`). Keyed on the auth user, not the profile, so a member can't clear one by deleting and recreating their profile. Deleted with the Supabase account. |
| `private.rate_limits` | `(user_id, bucket)` | Fixed-window per-member request counters (`take_rate_limit`). Deleted with the account; stale rows purged daily. |
| `conversations` | `id` | One per pair of members, ever: `(user_low, user_high)` unique with `user_low < user_high`. `initiator_id` sent the request; `status`: requested → accepted (a reply) / declined. `event_id` is where they met (set null if the event is deleted). Per-side last-read message ids; `last_message_at` for ordering and retention. `id` is the opaque `conversationId`. Deleted with either member's profile, and 12 months after the last message. Every conversation has a row in `private.conversation_pairs`. |
| `messages` | `id` (identity) | Plain text, 1–1000 characters (check constraint). The id is the opaque, increasing `messageId` (keyset cursor). Deleted with the conversation or the sender's profile. |
| `user_blocks` | `id` | `(blocker_id, blocked_id)` unique, keyed on the accounts (not profiles), so recreating a profile doesn't lift a block. `id` is the opaque `blockId`, shown only to the blocker. `blocked_display_name` is a snapshot of the blocked member's name taken when the block was made, never refreshed (the live name would tell the blocker about renames and deletions). It's kept, like the block, until either account is deleted or the block is lifted. |
| `private.conversation_pairs` | `(user_low, user_high)` | Content-free record that two accounts have had a conversation: the pair and when the first request was sent. References `auth.users` only (not profiles), so deleting and recreating a profile, which deletes the conversation, doesn't reset "one conversation per pair" or undo a decline. Deleted with either account, and by `purge_social_data` once no conversation remains and it's over 12 months old. |
| `event_favourites` | `(user_id, event_id)` | A member's favourites (account, not profile). At most 500 per account (`add_favourite`). Kept when the event is unpublished, but hidden until it's published again. Deleted with the account or the event. Never counted or shown to anyone else. |
| `event_tracking_links` | `id` | Up to 20 per event (`create_tracking_link`): a server-made `code` (8 characters, `[2-9a-hjkmnp-z]`, unique per event) and an organiser `label` (1–40 characters, unique per event ignoring case). Deleted with the event. |
| `event_view_counts` | `(event_id, day, source, coalesce(link_code, ''))` (unique index) | Aggregate page-view counters, one row per event, Melbourne day, source bucket and tracking code: no visitor data of any kind. `link_code` is a plain copy of the code (no foreign key), so a deleted link's counts are kept. Deleted with the event, and by `purge_analytics` after 25 months. |
| `private.event_rate_limits` | `(event_id, bucket)` | Fixed-window counters keyed on an event, never a person (`take_event_rate_limit`): caps the views counted per event per minute. Deleted with the event; idle rows purged daily. |
| `private.event_view_cap_days` | `(event_id, day)` | A marker that the event's view cap was reached on that Melbourne day, so reports can flag the day's views as a lower bound. No visitor data. Deleted with the event, and by `purge_analytics` after 25 months. |
| `private.analytics_settings` | single row | `views_tracked_since`: the Melbourne day view counting started (when its migration ran), so reports show earlier days as "not counted" rather than 0. |
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
| `purge_social_data` | Retention: deletes Who's Going opt-ins 30 days after their event ended, rate-limit rows idle for a day, conversations (with their messages) 12 months after their last message, resolved reports 2 years after resolution, and pair records with no conversation 12 months after the pair's first request. Idempotent. Scheduled daily with Supabase Cron (`docs/supabase-setup.md`), not by a migration. |
| `request_conversation` | A first message to the member behind an `attendeeId`, checked in one step: the sender isn't suspended and is opted in to the same event, which is open; the recipient isn't suspended; neither blocks the other; the pair has no conversation yet and none on record (`conversation_pairs`: a pair whose conversation went with a deleted profile is `unavailable`); the sender is within both rate limits; and the recipient is within their cap on requests received (over it, `unavailable`). Locks the sender's profile first (`for no key update`, so it doesn't block the other member's FK checks and mutual requests can't deadlock). Two members requesting each other at once: the pair's primary key makes the second insert fail, which rolls back its rate-limit hits (and the recipient's count) and returns `exists` (409). The recipient's profile or account deleted mid-call is `unavailable`. Returns `sent`, `sender_suspended`, `not_going`, `unavailable`, `self`, `exists` or `rate_limited`. |
| `send_message` | Locks the sender's profile, then the conversation, then checks visibility (blocks, the other member's suspension, a declined request), that the sender isn't waiting on their own request, and the rate limit, before inserting. A reply to a request accepts it; a reply and a decline racing can't both win. Returns `sent`, `sender_suspended`, `not_found`, `awaiting_reply` or `rate_limited`. |
| `file_report` | Checks the reporter is in the conversation (and the message is the other member's), takes the rate limit and copies the evidence into the report in one step. Key-share-locks the conversation, then the message, when it finds them, so a profile deletion or retention purge waits for the report; one already under way means the report finds nothing (`not_found`, 404). The reported account deleted mid-call (a foreign-key failure) or a deadlock with an account deletion is also `not_found`, never a 500. |
| `create_block` | Blocks, in one step, only a member the blocker can currently see: the other member of a conversation visible to them, or of a request they declined; or an `attendeeId` on a Who's Going list they may view right now (event published, enabled and not ended; blocker has a profile and isn't suspended; attendee isn't suspended; neither blocks the other). Anything else is `not_found`. Snapshots the display name, takes the rate limit, and inserts; a block the blocker already has comes back unchanged with the same result. Returns `blocked`, `not_found`, `self` or `rate_limited`. |
| `resolve_report` | Closes an open report only (a second admin gets 409); `suspend` also records the suspension in the same step. |
| `add_favourite` | Favourites a published event, idempotently, within the per-account cap (favourites of published events only: hidden ones don't count). A transaction-scoped advisory lock on the account serialises one member's adds, so concurrent requests can't both take the last slot. Returns `added`, `exists`, `not_found` or `limit`. |
| `take_event_rate_limit` | `take_rate_limit`'s fixed-window counter, keyed on an event instead of a member. Once a live window is over the limit it refuses with a plain read and writes nothing, so a flood isn't a write per request. |
| `record_view` | Counts one view: the event must be published; the source is bucketed (unknown → `other`); a code that's one of the event's tracking codes makes it `tracking` under that code (any other code is ignored); then the event's per-minute cap (a refused view records the day in `event_view_cap_days`; after the first, that's a no-op); then one upsert increment. No row lock on the event and no exception block, to keep the hot path to two small upserts. Returns `recorded`, `not_found` or `rate_limited`. |
| `create_tracking_link` | Adds a link to an event the organiser owns, under an advisory lock on the event (so the 20-link cap holds under concurrency, without locking the events row that checkouts share-lock). Returns `created`, `not_found`, `limit`, `label_taken`, or `code_taken` (the API retries with a fresh code). |
| `purge_analytics` | Retention: deletes view counters for days over 25 months ago and per-event rate-limit rows idle for a day, and, for events that ended over 25 months ago, the check-in log and the tickets' `checked_in_at`. Idempotent. Scheduled daily with Supabase Cron (`docs/supabase-setup.md`). |
| `check_in_ticket` | One scan, in one step (see "Check-in"): the event must be the organiser's (`not_found`); a hit on the account's `check_in` allowance (`rate_limited`, nothing logged); then, under an advisory lock on (event, request id), a request id already logged returns its original result unchanged, or `conflict` (nothing logged; the API's 409) if the submitted code doesn't resolve to the logged one. Otherwise: a code that isn't one of the organiser's tickets is `invalid`; another of their events' tickets is `other_event`; else it share-locks the order, then locks the ticket (`for update`), and decides `not_admissible` (order not `paid`), `already_checked_in` (with the first time, and `admission_id`: the ticket's current admission, for undo) or `admitted` (sets `checked_in_at`; `admission_id` is the new row). Every result but `not_found`, `rate_limited` and `conflict` logs exactly one row. Ids returned are public ids. |
| `undo_check_in` | Reverses an admission (an `admitted` log row of the event, by its `public_id`) with a reason: same ownership check, allowance and locks as `check_in_ticket`. Returns `undone` (clears `checked_in_at`, logs an `undone` row with the reason), `not_found`, `not_checked_in` (already undone), `superseded` (admitted again since: undo the newer one) or `rate_limited`. Only `undone` logs a row. |
| `place_free_order` | A member's free order, created and fulfilled in one step under an advisory lock on (event, person): the per-person cap, then the daily allowance, then `fulfil_order`. A refusal or sell-out writes nothing (beyond a refusal count). Returns `paid`, `person_event_limit`, `member_daily_limit` or `sold_out`. |
| `request_free_order` | A guest's pending free order: the platform's hourly and 24-hour caps (read-only), then, under an advisory lock on the address, the hourly link limit, then a hit on each platform cap. Returns `requested`, `address_limited`, `platform_limited` or `platform_daily_limited`. (The previous 13-argument form delegates to it with the same daily cap, for the deploy window; the app doesn't call it.) |
| `confirm_free_order` | Confirms by token hash: locks the order, then (event, person), then the event (share) to check every ticket type is still free, then `fulfil_order`'s locks. Idempotent within the link's 24 hours. Returns `confirmed`, `already_confirmed`, `expired_confirmed`, `not_found`, `expired`, `unavailable`, `person_event_limit`, `no_longer_free` or `sold_out` (the last three mark the order `failed`). |
| `purge_operational_data` | Retention for free-ticket and outbox data (see "Free tickets" and "Payment flow"); sent outbox jobs after 90 days, failed ones after a year. Idempotent; Supabase Cron daily. |
| `claim_email_jobs`, `finish_email_job`, `resend_email_job`, `admin_resend_email_job` | The ticket-email outbox: lease due jobs with `skip locked` (an expired lease is taken again; one that expired on the 6th attempt fails), record an outcome only for the current lease holder, and an admin resend (not while leased, not twice in 5 minutes). `admin_resend_email_job` takes a hit on the admin's hourly allowance only when the resend is queued, in the same transaction (over it: `rate_limited`, nothing changed). |
| `edit_organiser_profile` | An approved organiser's profile edit (`PATCH /organisers/me`): locks the organiser row, checks it's still approved (`not_approved` → 409), writes only the fields sent whose value really changes, and appends their old and new values to `organiser_profile_edits`, in one step. A no-op edit writes nothing. Returns `updated`, `unchanged`, `not_approved` or `not_found`. |
| `suspend_organiser` | An admin takedown, only from `approved` (a second admin gets 409): locks the organiser row, then its published and pending-review events in id order; sets the organiser `rejected` with the reason and reviewer; moves each published event to draft (`unpublished`) and each pending one to `rejected`, through `transition_event`, so the event moderation log records each with the admin and reason; logs the takedown. Deletes nothing. Returns the result and how many events moved. |
| `record_payment_refund` | Records a `charge.refunded` by payment intent (see "Refunds made in Stripe"). Locks the order (`for update`), and acts only on a `paid` one. Full refund: `refunded`, the amount recorded, and each line item's quantity taken off its ticket type's `quantity_sold` (never below 0), updating ticket types in `ticketTypeId` order like `fulfil_order`, so the two can't deadlock. Partial: only `amount_refunded_cents`, which only grows. A redelivery (already refunded, or no larger amount) changes nothing, so inventory is released exactly once. Returns `refunded`, `partial`, `unchanged` or `not_found`, with the order id when found (logged by short reference only). |
| `fulfil_order` | Queues the ticket email in the same step (see "Payment flow"). Takes inventory for every line item, issues the tickets and marks the order paid. If any ticket type has sold out, or the event is no longer published, it takes nothing and marks the order `oversold_refund_required`. Rows are locked in a fixed order, so concurrent orders can't deadlock. It's idempotent, so Stripe's webhook redeliveries are harmless. |

## Payment flow

1. `POST /api/events/[eventId]/checkout` (guest, no account):
   - Prices come from the database, never the client.
   - An optional `trackingCode` is stored on the order only if it's one of
     the event's tracking codes (anything else is silently ignored). It's
     attribution only: it never changes the price, the status, or what's
     sent to Stripe.
   - The order is inserted as `pending` *before* Stripe is called, so a
     payment can never arrive without an order to attach it to.
   - A Checkout Session is created as a destination charge to the
     organiser's Express account, with `application_fee_amount` set to the
     booking fee.
   - Free orders skip Stripe: see "Free tickets" below.
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
   - `charge.refunded` → `record_payment_refund` (see "Refunds made in
     Stripe").
   - Any other event type is acknowledged (200) and ignored.
   - Inventory is only taken here, so an abandoned checkout never holds
     tickets.
4. Once an order is paid (free orders included), the buyer is emailed their
   ticket codes over SMTP (`lib/server/email.ts`) through a durable outbox
   (`private.email_outbox`, `lib/server/email-outbox.ts`):
   - `fulfil_order` queues the job in the same transaction that marks the
     order paid, so it can't be lost; a redelivered webhook never reaches
     that point again, and `(order_id, kind)` is unique.
   - The first attempt runs straight after the response (`Deps.defer`, Next's
     `after()`), for that order only. `GET /api/cron/email-outbox` (Vercel
     Cron, `vercel.json`: daily at 17:00 UTC on the Hobby plan, so ticket
     emails still send right after purchase and only retries wait; every 5
     minutes once on Pro; bearer `CRON_SECRET` compared in constant time)
     sends everything else that's due. A run stops claiming
     jobs after 30 seconds, so the last one claimed can still be sent within
     the route's 60-second `maxDuration`.
   - Workers lease one job at a time (`claim_email_jobs`, `for update skip
     locked`, 2-minute lease), so concurrent workers never take the same job;
     only the lease holder can record the outcome (`finish_email_job`). A
     worker that dies leaves a lease that expires and is retried.
   - Retries after 1 min, 5 min, 30 min, 2 h and 6 h (±20% jitter); the 6th
     failed attempt is final (`failed`). An order that's no longer paid, or
     has no address, fails at once.
   - Delivery is at-least-once: a crash between SMTP accepting the message
     and recording it means it's sent again.
   - A mail failure never touches the order. `tickets_emailed_at` is set when
     a send succeeds.
   - Admins see jobs at `/admin/emails` (order reference and masked address
     only) and can resend one (20 per admin per hour, once per job per 5
     minutes). A resend refused for the job (unknown, being sent, too soon)
     doesn't count towards the 20.
   - Errors are stored and logged with addresses redacted, and logs name an
     order by its short reference (`#7C1F2E0A`), never its id.
   - The email (`lib/server/ticket-email.ts`) is rebuilt from the order on
     every attempt, images included, so the outbox stores no content. It's
     in the brand's four colours (black, white, cream `#fffae7`, Signal
     Orange `#ff4800`): the official wordmark on a black band, "YOU'RE IN.",
     the event's date, time, venue and address, a card per ticket, a "VIEW
     MY TICKETS" button (black on orange) to `/checkout/success` for the
     order (the same link as ever), the order reference and total, support,
     and a decorative brand banner. The wordmark is a PNG rendered from
     `public/brand/sheltuh-wordmark.svg` (`scripts/render-email-wordmark.ts`:
     `public/brand/sheltuh-wordmark-email.png`, embedded as base64 in
     `lib/server/email-wordmark.ts`) and attached inline (`cid:`). The banner
     (`EMAIL_FOOTER_IMAGE_URL`, `public/images/email-footer.png`) is the only
     remote image: the same for everyone, no order data. Each
     ticket whose code matches `TICKET_CODE_PATTERN` gets a QR code
     (`SH1:` + code, level Q, version 1: `lib/ticket-qr.ts` over the vendored
     encoder `lib/qr/qrcodegen.ts`) as a 1-bit PNG (`lib/server/png.ts`, about
     300 bytes, 348 px shown at 174 px) attached inline (`cid:`, a
     multipart/related part, `EmailMessage.inlineImages`, named
     `ticket-<n>-qr.png`, never after the code), so it shows even where
     remote images are blocked. Alt text names the ticket and points at the
     backup code printed beneath it, and the plain-text part lists every code and tells
     text-only readers to show the entry code (the QR is in the full email). A code
     that doesn't match the pattern gets no QR. Emails sent before QR codes
     (and the plain-text part) rely on the door typing in the code, which
     check-in accepts the same way. The encoder was verified by decoding
     over a thousand codes, as matrices, PNGs and rendered email, with two
     independent decoders (jsQR, ZXing) outside the repo; the tests check the
     symbol's structure against the standard and pin a decoder-verified
     matrix. Email clients themselves aren't tested.
   Free orders require the buyer's email address at checkout; for paid
   orders, Stripe collects it.
5. `/checkout/success?session_id=<order id>` polls
   `GET /api/orders/by-session/<id>`. The unguessable order id is the
   credential, so the response is only what that page shows: status, short
   reference, event title and slug, a masked email (`m***@example.com`),
   subtotal, buyer fee, total; only while the order is `paid`, the event's
   current start and end, venue name and suburb (public event details; never
   the street address), and the ticket codes with type names and each
   ticket's `checkedInAt` (when it was admitted at the door, or null), so
   each ticket on the page shows the event, its QR and backup code, and
   "Ready to scan" or "Checked in 8:42 pm"; and, for a refunded or
   refund-pending order, `refundReason`: `oversold` (no tickets were ever
   issued) or `refunded` (paid, then refunded in full; its tickets are void).
   Never the order, event or organiser ids, fee split, Stripe ids, line
   items or the order's own timestamps. Every response is `private, no-store`, an id that isn't shaped
   like one (`ord_` + 32 hex) is a 404 without a query, and a pending order
   reveals only its status. `/checkout/*` pages send `Referrer-Policy:
   no-referrer` and `X-Robots-Tag: noindex, nofollow` (`next.config.ts`).

## Refunds made in Stripe

Refunds of paid orders are made in the Stripe dashboard (there's no refund
button in the app). Stripe tells us with `charge.refunded`, whose charge
carries its payment intent, its cumulative `amount_refunded`, and `refunded`
(true once the whole charge is refunded). The webhook passes those to
`private.record_payment_refund` (`supabase/migrations/20261020000000_payment_refunds.sql`):

- **Order states.** `pending` → `paid` (fulfilled) → `refunded` (refunded in
  full). The automatic path for orders that couldn't be fulfilled is
  separate and unchanged: `oversold_refund_required` → `refunded`, settled by
  `refund.updated` / `refund.failed` by refund id. `charge.refunded` only
  ever changes a `paid` order.
- **Full refund** of a paid order: it becomes `refunded`, the amount is
  recorded, and its inventory is released (each line item's quantity off its
  ticket type's `quantity_sold`), so the tickets can be sold again. Its ticket
  rows are kept but void: `GET /orders/by-session` no longer returns their
  codes (`refundReason: "refunded"`), the ticket email refuses an order that
  isn't paid, and check-in must accept `paid` orders only.
- **Partial refund**: `amount_refunded_cents` is recorded and the order stays
  `paid` with valid tickets. It's logged (`console.error`, by short order
  reference) for someone to decide what to do, e.g. refund the rest.
- **Idempotent.** Stripe redelivers: a delivery for an order already
  `refunded`, or a partial one that doesn't raise the recorded amount, is
  `unchanged`. Two deliveries at once serialise on the order row, so
  inventory is released exactly once.
- **Not ours.** A payment intent no order has (another integration's
  payment, or a malformed event) is acknowledged with 200 and logged by
  Stripe's event id, never a 500, so Stripe doesn't retry it for days.
- **Refund status events for dashboard refunds** (`refund.updated` /
  `refund.failed` without `metadata.orderId`; only our automatic refunds carry
  one) change nothing: `charge.refunded` records the refund. They're logged
  by Stripe's event id and, when the refund's payment intent is one of our
  orders', that order's short reference, so a dashboard refund that failed
  is visible: `failed`, `canceled` and `requires_action` with
  `console.error`, any other status with `console.info`
  (`logUnmatchedRefund`, `lib/server/handlers/orders.ts`).
- Logs name an order only by its short reference (`#7C1F2E0A`): never its id,
  the buyer, or the payment intent.

### Accepted limits (refunds)

- **Disputes (chargebacks) aren't handled.** `charge.dispute.*` is ignored: a
  disputed order stays `paid`. Handle disputes in the Stripe dashboard; if
  one is lost, refund-and-void isn't automatic.
- **Partial refunds don't void anything.** No ticket is cancelled and no
  inventory released for a partial refund, since we can't know which tickets
  it was for. Refunding the remainder (so the charge is fully refunded) voids
  the whole order.
- **Who's Going opt-ins survive a refund.** An opt-in isn't revisited when
  its order stops being `paid` (as for a changed email; see "Not built yet").
  The member can't opt in again to an event they hold no paid order for.
- **A refund that arrives before the payment is recorded is lost.** The
  payment intent is stored by `fulfil_order`, so a `charge.refunded`
  processed before the order's own payment webhook commits (only possible if
  that webhook failed and is awaiting Stripe's retry when the dashboard
  refund is made) finds no order and is acknowledged; the order then becomes
  `paid` with valid tickets. The log line (Stripe event id) is the signal to
  reconcile by hand.
- **A manual refund of an `oversold_refund_required` order** (its automatic
  refund failed) doesn't change it: `charge.refunded` only acts on `paid`
  orders, and a dashboard refund carries no order id for `refund.updated`.
  After refunding it in Stripe, set it `refunded` in SQL
  (`docs/supabase-setup.md`).
- **A dashboard refund that fails after it voided the order isn't undone.**
  `charge.refunded` can arrive (and void the order, release its inventory)
  before the refund settles; if it then fails or is canceled, the order stays
  `refunded` with void tickets, though the buyer got nothing back. Nothing
  reverses that automatically: the `console.error` line (Stripe event id and
  short order reference) is the signal to sort it out by hand, e.g. refund
  again in Stripe, or restore the order and its inventory in SQL.
- **The money side is Stripe's.** For a destination charge, a dashboard
  refund only reverses the organiser's transfer and refunds Sheltüh's
  application fee if those options are chosen in Stripe. We record only the
  amount refunded to the buyer.

## Free tickets

Free tickets are rate-limited without IP addresses (forwarded headers are
only trustworthy when Vercel is the first hop, and shared Wi-Fi puts many
people behind one address) and without a CAPTCHA
(`lib/server/handlers/free-orders.ts`,
`supabase/migrations/20261014000100_free_order_protection.sql`,
`supabase/migrations/20261017000000_free_order_caps.sql`):

- **A signed-in member booking with their own verified email** (the request
  carries their token, and the buyer email matches the account's, ignoring
  case) gets the tickets straight away: `201 {url}` (`place_free_order`). At
  most 10 free orders per account per 24 hours (429). Refused or sold-out
  attempts don't use the allowance.
- **Anyone else** gets `202 {status: "confirmation_sent", expiresInHours: 24}`.
  The order is recorded as `pending` with only a SHA-256 hash of a 256-bit
  token, holding no inventory: requesting links takes nothing, and only a
  confirmed link issues tickets. That bounds, but doesn't prevent, a
  determined guest draining an event's free tickets with inboxes they
  control: see "Accepted risks (free tickets)".
  The token is emailed as `/checkout/confirm#token=…` (the fragment is never
  sent to a server). That page has a Confirm button that POSTs
  `/api/orders/confirm {token}`, so a mail scanner opening the link can't
  confirm it. Confirmation issues the tickets (`confirm_free_order`) and
  returns the success page's URL; confirming again within the 24 hours
  returns the same URL. Expired after 24 hours (410), confirmed or not.
  Confirmation re-checks that every ticket type is still free (price 0) and
  still exists; if not, nothing is issued, the order is marked failed and
  the answer is 409.
- **Caps**: 4 free tickets per order (400, `fieldErrors.lineItems`), in any
  order: a paid order with free lines is held to it too. A paid order is
  identified by its Stripe payment, so it gets no emailed confirmation and
  its free tickets don't count towards (or against) the per-person
  allowance, which counts wholly free orders only. 4 per person per event
  across all their free orders (409), counted on a normalised address
  (`private.email_key`: lower case, no `+tag`, no dots for Gmail,
  googlemail.com folded into gmail.com; if that leaves nothing before the
  `@`, as for `+promo@…`, the whole local part is kept) under an advisory
  lock on (event, person); 3 unconfirmed links per address per hour; 60
  confirmation emails per hour and 400 per 24 hours platform-wide (503
  either way; `FREE_LIMITS` in `free-orders.ts`). The platform caps are
  checked (read-only) before anything about the address, so their 503 is
  the same whichever address asks, and they're only taken for a link that's
  about to be sent.
- **No enumeration**: a guest is never told anything about an address's
  history. Over the hourly link limit, the response is the same 202 and no
  email is sent (the owner already has 3 links). The per-person cap is only
  reported at confirmation, to whoever holds the emailed link.
- If the confirmation email can't be sent, the pending order is deleted and
  the response is 503.
- A ticket code that clashes with an existing one (40 random bits) is retried
  once with fresh codes, on every fulfilment path.
- **Refusal counts** (`private.free_order_refusals`): per Melbourne day and
  reason only (`order_too_large`, `member_daily_limit`, `person_event_limit`,
  `address_hourly_limit`, `platform_hourly_limit`, `platform_daily_limit`).
  No address, account, event or IP. Each count stops at 10,000 a day (read
  first, then no write), and the platform counters refuse with a read once
  over, so a flood isn't a write per request.
- **Addresses** (`lib/server/email-address.ts`, `isPlainEmailAddress`): buyer
  and organiser contact emails must be one plain address: an unquoted local
  part of `[A-Za-z0-9._%+-]` (at most 64), DNS-label domain, at most 254 in
  all. Display names, comments, quoted local parts, groups and lists
  (`, ; < > ( ) " : [ ] \` and spaces) are a 400. Mail is sent with the
  recipient as a nodemailer address object (`mailOptions` in
  `lib/server/email.ts`), so even a malformed stored value is one recipient,
  never a list.
- **Retention** (`purge_operational_data`, daily): unconfirmed or refused
  guest orders a week after their link expired; refusal counts after 13
  months.
- Live mode without SMTP configured can't send a confirmation link, so every
  guest free booking is a 503 (members booking with their own verified
  email are unaffected).

### Accepted risks (free tickets)

- **Guests share the mail quota with ticket emails.** Confirmation emails go
  out over the same Google Workspace SMTP account as ticket emails (about
  2,000 messages a day). Mitigated: at most 60 an hour and 400 per 24-hour
  window platform-wide (503 beyond that, nothing recorded). The windows are
  fixed, not rolling, so across a window boundary up to 800 can go out in
  24 hours, and each confirmed link adds one ticket email. Even then about
  400 a day are left for paid orders' ticket emails, and normally far more.
  Accepted: a flood can make guest free bookings unavailable (503) for the
  rest of the window, without an IP address or CAPTCHA to tell people
  apart. Members booking with their own verified email aren't affected.
  Supabase Auth's emails (sign-up confirmation, password reset) use the same
  mailbox if it's set as Supabase's custom SMTP, and aren't counted here.
  Move to a transactional email provider before volume approaches the quota.
- **Disposable or catch-all inboxes can still claim free tickets.** Someone
  who controls many addresses (a catch-all domain, a disposable-inbox
  service) can request and confirm links for each. Bounded: 4 tickets per
  address per event, 4 per link, and at most 60 links an hour and 400 per 24
  hours platform-wide, so at most 240 free tickets an hour and 1,600 a
  window across all events (twice that across a window boundary), and an
  event never loses more than its free stock. Not prevented: there's no bot
  check. **Recommended later step, not built and needing the owner's
  approval:** a bot check (e.g. Cloudflare Turnstile) on the guest free
  path only.
- **Alerting is manual.** A burst of `platform_hourly_limit` or
  `platform_daily_limit` refusals means guest free bookings are being
  refused for everyone. Watch `private.free_order_refusals`
  (`docs/supabase-setup.md`); an automated alert on those two reasons is
  advised but not built.
- **Timing.** The platform-cap 503 doesn't depend on the address, but the
  other outcomes can still differ slightly in response time (an
  address-limited request skips the platform write, the insert and the SMTP
  send, so its 202 comes back faster than a real one). Accepted: telling
  that an address has 3 unconfirmed links in the last hour needs repeated
  timing measurements and reveals little; sending in the background instead
  would lose the 503 when a link can't be sent.

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
  `/profiles/me`) are sent `cache-control: private, no-store`, and so is
  every error response from any route (`lib/server/route.ts`).
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
  60 messages per hour (requests included), 20 reports per 24 hours, 30
  blocks per 24 hours. Per recipient: 20 requests received per 24 hours (a
  fixed-window counter, against many throwaway accounts each spending their
  own allowance on one person); over it, a request is the same 404 as an
  unavailable member. Refused attempts don't use any allowance.
- **Blocks** are silent. While either blocks the other, their conversation is
  hidden from both (404 everywhere), neither can message the other, and each
  is left out of the other's Who's Going list (the public count is
  unchanged). A block by `attendeeId` works before any conversation exists.
  Only a member the blocker can currently see can be blocked (see
  `create_block`); anything else, including someone already blocked either
  way, is the same 404, so blocking can't be used to test whether two
  per-event `attendeeId`s are the same person, or whether someone blocked
  you. A success is always 201 with the block. The blocks list shows the name
  as it was when blocked.
- **Suspended members** (`private.social_suspensions`) can't send (403), and
  their conversations disappear for everyone else.
- **Reports** keep copies (the message, up to 20 messages of context, the
  display name) that outlive the messages and both accounts. Admins work the
  queue at `/api/admin/reports`; resolving with `suspend` suspends the member.
  A report can only be made while the conversation exists (see "Accepted
  risks").
- **Privacy**: members appear only as display names; conversations, messages
  and blocks only by opaque ids. No user id or email is ever sent. Every
  response is `cache-control: private, no-store`. Messages are plain text,
  to be rendered as text: the API normalises line breaks, trailing spaces and
  blank lines, and rejects control characters, line/paragraph separators and
  every invisible format character (`\p{Cf}`: zero-width spaces, bidi
  controls and marks, soft hyphens, BOM, ...) except the zero-width joiner and
  non-joiner, and the tag characters of emoji flag sequences. Input over
  4000 UTF-16 units is refused before any cleaning runs, every cleaning step
  is linear, and request bodies over 256 KB are refused (413) before parsing.
  First messages can't contain links; they're looked for on a folded copy
  (NFKC, invisible characters removed, other full stops as ".") and catch the
  usual disguises (`example . com`, `example dot com`, `example[.]com`,
  fullwidth letters and dots, a domain split by joiners).
- **Retention**: conversations are deleted 12 months after the last message,
  resolved reports 2 years after resolution (`purge_social_data`). Deleting a
  profile deletes that member's conversations (for both sides) straight away;
  reports keep their copies. The pair record stays (no content), so the pair
  still can't start a new conversation: a request is the same 404 as an
  unavailable member. It goes with either account, or 12 months after the
  first request once no conversation remains.
- Access is read-by-request (the client polls `?after=` and
  `/conversations/unread`); there's no realtime channel.

### Accepted risks (messages)

- **Evidence can vanish before it's reported.** Deleting a profile deletes
  that member's conversations for both sides at once. A member who's sent
  something abusive can delete their profile before the recipient reports
  it, and the recipient then has nothing to report from (reports made
  earlier keep their copies). Not solved for now: holding deleted members'
  conversations for a window (say 30 days) so the other side can still
  report them is a privacy and product decision (what the deleting member
  was told, what the other side still sees), not a code fix. Needs a
  decision before launch.
- **Blocks can be inferred with effort.** Blocked members are left out of
  each other's lists, while the public count still includes them, so a
  member who compares the count with the names they can see (or asks a
  friend what they see) can work out that someone on the list has blocked
  them or been blocked. Accepted: hiding it would mean making counts depend
  on the viewer.
- **`messageId` is global.** It's the `messages` identity, so the gaps
  between a conversation's ids show roughly how many messages the whole
  platform carried in between. Accepted: it's a volume signal, not content,
  and a per-conversation ordinal would mean a counter per conversation on
  every send.

## Favourites

A signed-in member's private list (`lib/server/handlers/favourites.ts`).
No verified email is needed: nothing here involves anyone else.

- Only a published event can be favourited (404 otherwise). Unpublishing
  keeps the row but hides it from the list and the ids; publishing again
  brings it back. Past events stay listed.
- At most 500 visible favourites per account (409, which on this route means
  only that). Favourites of unpublished events are hidden and don't count:
  the member can't see them to remove them. If hidden ones are published
  again, an account can briefly hold more than 500; `GET /favourites/ids`
  returns the newest 500, and further adds are refused until it's back
  under. `PUT` and `DELETE` are idempotent. `DELETE` always
  removes an existing favourite, whatever state its event is in; without
  one, it's a 404 unless the event is published, so it can't be used to
  probe for unpublished events.
- Nobody else sees favourites, and there's no public count. Every response
  is `private, no-store`. Deleting the account or the event deletes them.

## Organiser analytics

Stages A (page views and sales) and B (tracking links), in
`lib/server/handlers/analytics.ts`, `event-views.ts` and `tracking-links.ts`.

**Privacy first.** Page views are aggregate daily counters
(`event_view_counts`): event, Melbourne day, a source bucket and, for
tracking links, the code. No cookie, IP address, user id, email, user agent
or referrer URL is stored, so there are no unique-visitor counts. The browser
buckets the referrer itself and sends only `{source, code}`.

**Counting a view** (`POST /api/events/{id}/view`, public): 204 whether or
not it was counted, 404 only for an event that isn't published. Not counted:
obvious bots, link previews, HTTP libraries and prefetches (user agent and
`Sec-Purpose`/`Purpose` headers, checked and never stored), anything but a
JSON body (`Content-Type: application/json`, so a cross-site form post or
`navigator.sendBeacon`'s `text/plain` never counts), a `Sec-Fetch-Site`
other than `same-origin` when the browser sends one (the app's own beacon is
a same-origin `fetch` with `keepalive`, `lib/api/analytics.ts`), bodies over
1 KB, and anything past the event's cap of 300 views a minute
(`take_event_rate_limit`, keyed on the event, not on anyone). A day on which
the cap was reached is flagged `viewsUnreliable` in reports (on the day, the
range's totals, and in the overview the event and the organiser's totals),
with no conversion rate for the range or its tracking links, and the CSV
names those days. The cap bounds
how fast anyone can inflate an event's views; it doesn't stop a determined
faker below it (accepted: numbers are indicative, and nothing is paid on
them). Sources: `direct`, `search`, `instagram`, `facebook`, `x`, `tiktok`,
`email`, `eventbrite`, `other`, and `tracking` (set by the server, only for
one of the event's codes).

**Tracking links**: up to 20 per event, each a server-made code shared as
`/events/{slug}?ref={code}`. A view or checkout carrying the code is counted
under it. Deleting a link keeps its numbers (shown without a label); the URL
still opens the event, but nothing more is counted under it.

**Sales** come from `paid` orders only (free orders are A$0 paid orders;
pending, failed, refunded and refund-pending ones are left out), counted on
the Melbourne day the order was placed. Money is integer cents from the
orders' own snapshots: gross is `total_cents` (what buyers paid), fees is
`application_fee_cents` (the platform's booking fee, whoever paid it), net
is gross − fees (what Stripe pays the organiser; Stripe's processing fee is
the platform's). Only the per-ticket-type split is re-derived, with
`lib/fees.ts`, and then reconciled to the snapshots so the rows always add
up to the totals, even if the fee rules change. Conversion is orders ÷ views
(null with no views, or when part of the range is before views were counted).

**Access**: approved organisers, own events only. Another organiser's event
is a 404; admins get nothing extra (no organiser of their own is a 403).
Every response, CSVs included, is `private, no-store`.

**Ranges**: inclusive Melbourne dates, at most 731 days (400 otherwise).
Defaults: an event's whole life (from its creation, capped), or the last 30
days for the overview. `compare=prevPeriod` adds the period of the same
length just before.

**CSV exports** contain no buyer data. Every cell is quoted; text starting
with `= + - @`, a tab or a carriage return (after any leading whitespace) gets
a leading `'` so spreadsheets don't run it as a formula; money is decimal
dollars; the file starts with a UTF-8 BOM for Excel.

**Attendance**: the event report's `attendance` compares tickets checked in
at the door with tickets sold (tickets of `paid` orders, all-time rather than
for the range, per ticket type). It's null until a ticket is sold. A ticket
whose order is refunded after it was checked in drops out of both counts.

**Retention**: view counters and cap markers are deleted after 25 months (`purge_analytics`),
and reports never claim views from before then were counted. Check-in times
and the check-in log go 25 months after the event ends (so attendance then
reads 0). Orders (and so their `tracking_code`) are kept as financial records.

### Accepted risks (analytics)

- **A flood can still cost an event its view counts.** The per-event cap is
  shared by everyone viewing that event, so a client sending more than 300
  views a minute uses it up and real views in that minute aren't counted.
  This is now visible (the day is flagged `viewsUnreliable` and has no
  conversion rate) but not prevented: preventing it would mean telling
  visitors apart (IP addresses or cookies), which the no-identifier design
  rules out. Nothing is paid on view numbers. Revisit if organisers rely on
  them commercially (e.g. promoted listings priced on views).
- `Sec-Fetch-Site` and `Content-Type` stop other websites making visitors'
  browsers count views. They don't stop a script outside a browser, which
  can send any headers: the cap bounds that.

**Later stages (not built):**

- Attendee registrations with geography: needs a privacy review; at most a
  suburb or postcode, from Stripe Checkout.
- Unique visitors: deliberately impossible under the no-cookie, no-IP model.
- Orders by referrer source: orders only carry a tracking code, not the
  view's source bucket.

Booking fee: 4% of face value + A$0.50 per paid ticket (`lib/fees.ts`,
which the API and the UI both use). It's either buyer-paid or absorbed by
the organiser, set per ticket type. Either way the platform keeps it.

## Check-in

Door check-in for an organiser's own events (`lib/server/handlers/check-ins.ts`,
`supabase/migrations/20261021000000_ticket_check_in.sql` and
`20261021130000_check_in_followups.sql`, `lib/ticket-code.ts`), with the door
scanner at `/dashboard/[eventId]/check-in` (`components/check-in/*`,
`lib/check-in/*`; design in `docs/design/check-in.md`).

- **The scanner page.** The camera decodes QR codes with the browser's own
  `BarcodeDetector` where it reads QR (Chrome on Android), otherwise with the
  `barcode-detector` ponyfill (ZXing-C++ as WebAssembly), loaded only on this
  page from our own copy under `public/vendor/zxing-wasm/<version>/` (no
  third-party request at the door; cached as immutable, `next.config.ts`).
  Codes can also be typed (`lib/check-in/manual-code.ts`). One request at a
  time, an 8-second timeout, and a result panel per scan: Let in, Don't let
  in, or Not verified (`lib/check-in/door-copy.ts`). An answer the client
  doesn't recognise fails closed (Not verified). A scan that wasn't verified
  keeps its request id for a minute, so scanning that code again replays the
  server's original answer. The panel for `already_checked_in` offers "Undo
  check-in" for the ticket's current admission (the result's `checkInId`),
  as well as Undo on undoable rows in Recent scans.
- **The code is the ticket.** A ticket code is 8 characters from a 32-letter
  alphabet without 0/O/1/I, split 4-4 (`7KQM-2HXD`): 40 random bits, one
  `crypto.getRandomValues` byte per character (32 divides 256, so
  `byte % 32` has no bias), unique as `tickets`' primary key (a clash is
  retried with fresh codes). The QR
  carries `SH1:` plus the code. Check-in accepts either form, in any case,
  with surrounding whitespace (`parseTicketCode`); anything else is an
  `invalid` scan, not an error. No separate token: the only way to test a
  code is check-in, which needs the organiser's login, only ever covers their
  own event, and is rate-limited.
- **Who.** The approved organiser who owns the event (`requireApprovedOrganiser`;
  ownership is checked again inside `check_in_ticket`). Anyone else's event is
  a 404; an admin with no organiser of their own a 403; signed out a 401.
  Admins can't check people in. Platform-managed organisers (no owner
  account) can't be checked in by anyone for now: a per-event staff table
  (scanner or supervisor) is the planned way to add door staff.
- **Outcomes** (`POST …/check-ins {code, requestId}`, always 200):
  `admitted` (the ticket is now checked in; carries the `checkInId` to undo),
  `already_checked_in` (with the first check-in time, and the `checkInId` of
  the ticket's current admission so the door can undo it from there; absent
  when there's none on record; re-entry is refused),
  `not_admissible` (its order isn't `paid`, e.g. refunded in Stripe: the
  ticket is void), `other_event` (one of the organiser's other events, named)
  and `invalid` (malformed, unknown, or another organiser's ticket). Every
  outcome but `invalid` also returns the ticket type, "ticket n of N" in the
  ticket email's order (ticket type id, then code) and the code's last four
  characters.
- **Errors mean "couldn't verify".** 400 (`code` not a string, `requestId` not
  a uuid), 404, 409 (a request id reused for another code), 413 (body over
  1 KB), 429 or a network failure: nothing was marked, and the scanner must
  say verification is unavailable, never that someone is in.
- **Retries are safe.** The client sends a fresh uuid per scan and reuses it
  for that scan's retries. A request id already logged for the event returns
  the original result unchanged, with no new row: a retry after a lost
  response says `admitted`, not `already_checked_in`. A replayed
  `already_checked_in` carries the admission it saw only while that's still
  the ticket's current one. The submitted code must resolve to the logged
  one (the organiser's ticket, or nothing for an `invalid` row), else 409
  with nothing logged: a retry always resends its own code, so a different
  one is a client bug or tampering, and replaying would describe another
  ticket.
- **Atomic and race-free.** One transaction: event (key share), the caller's
  rate-limit row, an advisory lock on (event, request id), the order (share),
  the ticket (update). Two scans of one ticket at once: exactly one is
  admitted. `fulfil_order` and `record_payment_refund` lock the order first
  and never lock tickets, so a refund and a check-in can't deadlock: whichever
  commits first wins, and a refund that wins makes the scan `not_admissible`.
- **Check-in ids are random.** `checkInId` (an admission's, a log entry's,
  an undo's) is the log row's `public_id`, a uuid. The log's sequential key
  never leaves the database: consecutive ids would show an organiser how
  many check-ins the whole platform logged in between. Undo looks an
  admission up by (event, public id); anything that isn't a uuid, an old
  numeric id included, is a 404 without a query.
- **Undo** (`POST …/check-ins/{checkInId}/undo {reason}`): reverses an
  admission, with a required reason (3–200 characters counted in code
  points, `MIN_UNDO_REASON_LENGTH` / `MAX_UNDO_REASON_LENGTH` in
  `lib/api/types.ts`, shared by the API and the dialog; cleaned like a
  message). Returns `undone`, `not_checked_in` (undone already) or
  `superseded` (admitted again since); 404 if it isn't an admission of this
  event. Logged with the reason.
- **Rate limit**: 600 check-ins and undos per account per 5 minutes
  (`take_rate_limit`, bucket `check_in`; `CHECK_IN_LIMIT`), then 429 with
  nothing logged. Retries count.
- **Summary** (`GET …/check-ins`): checked in and sold (tickets of `paid`
  orders) per ticket type with capacity, and the newest 20 log entries
  (result, time, ticket type, last four characters of the code, an undo's
  reason, and whether an admission can still be undone).
- **Privacy.** A scan shows no buyer identity: no name, email or order id,
  anywhere in check-in. The log stores the event, ticket code (never the
  text of an invalid scan), acting account, result, an undo's reason and the
  time, and responses show only codes' last four characters. Every response
  is `private, no-store`. Deleted 25 months after the event ends
  (`purge_analytics`).

### Accepted limits (check-in)

- **One shared organiser login.** Everyone on the door signs in as the
  organiser, so the log can't tell door staff apart, and they share one
  rate limit (600 per 5 minutes, roughly 2 a second sustained; enough for a
  few doors, not for a large venue's opening rush). Per-event staff accounts
  are the planned fix.
- **No offline mode.** Every scan needs the server; without a connection
  the scanner can only say verification is unavailable.
- **A screenshot of a QR admits whoever arrives first.** The code is a
  bearer credential: a copied ticket gets in once, and the real holder then
  sees `already_checked_in` (with the time, so staff can judge). Undo
  (offered right on that refusal panel) plus a manual decision is the remedy.
- **Only paid orders admit.** A refunded order's tickets are refused; a
  partial refund leaves them valid (see "Refunds made in Stripe"); a
  disputed order stays `paid` and admits.
- **Timing.** An unknown code and another organiser's ticket return the
  same bytes, but the second does one more lookup's work; telling them
  apart by response time would need many precise measurements against a
  rate-limited endpoint, by an organiser.
- **A retried undo** whose response was lost says `not_checked_in` rather
  than `undone` (undo has no request id): the ticket's state is the same.

## Organiser profiles

"Who posted this event" (`lib/server/handlers/public-organisers.ts`,
`lib/server/organiser-input.ts`).

- **Social links are handles, never URLs.** Instagram and TikTok
  `[A-Za-z0-9._]{1,30}`, Facebook page `[A-Za-z0-9.]{5,50}`, X
  `[A-Za-z0-9_]{1,15}`, each with at least one letter or digit. The API trims
  them and strips one leading `@` (anything else invalid is a 400); the same
  patterns are check constraints. The public profile builds the `https://`
  URLs itself, so a link can only point at the network it names. The website
  is the one free URL, stored as typed. A new value must start with
  `https://` and can't carry a username or password (`https://bank.example@evil.example`),
  whitespace, control or invisible characters (NUL included) or backslashes
  (400). An `http://` address stored before this rule is kept when it's sent
  back unchanged, so a client sending the whole record doesn't fail; changing
  it needs `https://`. The database still allows http(s) (check constraint).
- **Bio** (`description`, at most 2000 characters, counted like the
  database): cleaned like a message (`parseMessageText`): control, invisible
  and text-direction characters are a 400 (never a database error), line
  endings, trailing spaces and runs of blank lines are normalised, and stacked
  combining marks are refused. Links are allowed.
- **Editing**: `PATCH /organisers/me` by an approved organiser changes only
  the fields sent (`description`, `websiteUrl`, the handles; null or blank
  clears one) with no new review and no status change. `displayName`,
  `contactEmail` and `categories` were reviewed, so they may be sent back
  unchanged but not changed (400). A rejected applicant's PATCH is still the
  full resubmission; handles it doesn't send are kept.
- **Compensating controls for unreviewed edits.** Every edit that changes
  something is appended, with old and new values, to
  `private.organiser_profile_edits` in the same transaction
  (`edit_organiser_profile`), and the admin organiser queue shows each
  organiser's newest 20 entries with their social handles. An admin who finds
  something wrong takes the organiser down:
  `POST /admin/organisers/{id}/suspend {reason}` (`suspend_organiser`).
- **Takedown.** The organiser becomes `rejected` with the reason, which they
  see as a reviewer note, like a rejection. Their public profile is a 404, and
  they lose every organiser route (events, payouts, analytics). Their
  **published events are unpublished** (back to draft), so they leave the
  feed, their pages and Who's Going are 404, and checkout refuses them. Events
  **waiting for review are rejected** with the reason, and approving an event
  now also requires its organiser to be approved (409 otherwise). The
  organiser row is share-locked before the event, so an approval racing a
  takedown can't publish an event for a suspended organiser. Drafts, earlier
  rejected events, orders and tickets are untouched: **nothing is deleted**,
  and paid tickets stay valid. Refunding them is a separate, manual decision
  in Stripe. A payment already under way for an unpublished event is refused
  and refunded by `fulfil_order`, as for any unpublished event, and a pending
  free-ticket link fails at confirmation. Events stay where they are when the
  organiser is reinstated (they reapply, and an admin approves them). Each
  event goes through review again. The takedown stays on the organiser's log,
  so the admin reviewing that reapplication sees it.
- **Privacy.** Once approved, the bio, website and social handles are public
  (the profile page and the event pages that link to it), and the edit log
  keeps earlier versions for admins. The Privacy Policy and Organiser
  Agreement must say so before launch.
- **Recommended future work, not built:** email the organiser when their
  profile changes (so a hijacked account's edits are noticed), and an alert
  to admins on edits to recently approved organisers.
- **Public profile** (`GET /organisers/{id}/profile`): only approved
  organisers. Only `organiserId`, `displayName`, `description`,
  `categories`, `websiteUrl`, `socialLinks`, `memberSince` (Melbourne
  `YYYY-MM` of the application) and their published events in the feed's
  public shape: `upcomingEvents` (not yet ended, soonest first), then
  `recentEvents` (ended, most recent first), 24 in all. The organiser query
  reads no private column (contact email, owner, Stripe, payouts, review). Not
  personalised, so it's sent without `private, no-store`, like the event feed.
  Like the other public reads, it isn't rate-limited (no IPs or cookies):
  each request is three indexed queries and a bounded response.

## API

All routes are JSON under `/api`. "Organiser" means a signed-in user whose
application is approved.

| Method & path | Who |
|---|---|
| `GET /events?q&category&pricing&onOrAfter&upcoming&cursor&limit` | public (published only), soonest first. `upcoming=1` (or `true`): only events that haven't ended (`ends_at > now()`, in progress included); the home page and /events always send it. `pricing=free`: has ticket types, all free; `paid`: has a paid ticket type (an event with no ticket types is neither). 400 for an unknown `category`, `pricing` or `upcoming` value |
| `GET /events/slug/{slug}` | public (published only) |
| `POST /events/{eventId}/checkout` | public (a member's token is read, optionally, for free orders). 201 `{url}`; 202 free order waiting on its emailed link; 400 (incl. over 4 free tickets in any order, paid or free); 404; 409 sold out or the person's free allowance for the event; 429 member's daily free allowance; 503 free bookings busy or the confirmation email failed |
| `POST /orders/confirm` `{token}` | public (the emailed token is the credential). 200 `{url}` (also when already confirmed, within 24 hours); 400 malformed; 404 unknown; 410 expired (confirmed or not); 409 sold out, allowance used, or a ticket type no longer free |
| `GET /orders/by-session/{orderId}` | public (id is the credential). `CustomerOrder` only (see "Payment flow"), `private, no-store` |
| `GET /cron/email-outbox` | Vercel Cron (`Authorization: Bearer $CRON_SECRET`, 401 otherwise): sends due ticket emails, returns counts |
| `GET /admin/emails?status&cursor` · `POST /admin/emails/{jobId}/resend` | admin. Status `failed` (default), `pending`, `sending`, `sent`. Resend: 404 unknown, 409 being sent, 429 resent in the last 5 minutes or over 20 an hour |
| `POST /stripe/webhook` | Stripe (signature-verified) |
| `POST /organisers/apply` · `GET /organisers/me` · `PATCH /organisers/me` | signed in. PATCH: a rejected application is resubmitted in full (back to pending); an approved organiser edits their profile (see "Organiser profiles"); pending is a 409 |
| `GET /organisers/{organiserId}/profile` | public (approved organisers only; anything else, or a non-uuid id, is a 404) |
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
| `POST /conversations` `{attendeeId, body}` | verified member going to the same open event. 201; 400 invalid/links/self, 403 not going or suspended, 404 member unavailable (also: blocked either way, a pair whose conversation was deleted, or the recipient over their incoming cap), 409 conversation exists, 429 |
| `GET /conversations/unread` | verified member: `{count}` of conversations with something unread |
| `GET /conversations/{id}/messages?after\|before` · `POST …/messages` `{body}` | verified participant (404 otherwise). POST: 409 while awaiting a reply, 403 suspended, 429 |
| `POST /conversations/{id}/decline` | signed-in recipient of a request (204, idempotent); 409 otherwise; 404 non-participant |
| `POST /conversations/{id}/read` `{lastReadMessageId?}` | verified participant (204) |
| `GET /blocks?cursor` · `POST /blocks` `{conversationId}\|{attendeeId}` · `DELETE /blocks/{blockId}` | signed in (own blocks). POST 201 (new, or one the caller already has), 400 self, 404 not something the caller can currently see (including already blocked either way), 429 (30 per 24 hours); DELETE 204, idempotent |
| `POST /reports` `{conversationId, messageId?}\|{attendeeId}, reason, details?` | signed in. 201; 404 not yours; 429 |
| `GET /admin/reports?status` · `POST /admin/reports/{id}/resolve` `{action, note?}` | admin. 409 if already resolved |
| `GET /favourites?cursor&limit` | signed in: own favourited published events, newest favourite first, in the feed's public shape plus `favouritedAt` |
| `GET /favourites/ids` | signed in: `{eventIds}` (at most 500) |
| `PUT /events/{id}/favourite` · `DELETE /events/{id}/favourite` | signed in (no verified email needed). `{eventId, favourited}`. PUT: 404 not published, 409 at 500. DELETE: idempotent; 404 only with no favourite and the event not published |
| `POST /events/{id}/view` `{source?, code?}` | public. 204 (counted or not); 404 not published |
| `GET /organisers/me/events/{id}/tracking-links` · `POST …` `{label}` · `DELETE …/tracking-links/{linkId}` | organiser (own events). POST 201; 400 label; 409 label taken or 20 links. DELETE 204, idempotent |
| `GET /organisers/me/events/{id}/analytics?from&to&compare` · `…/analytics.csv` | organiser (own events). 400 bad range |
| `POST /organisers/me/events/{id}/check-ins` `{code, requestId}` · `GET …/check-ins` · `POST …/check-ins/{checkInId}/undo` `{reason}` | organiser (own events; see "Check-in"). Every ticket outcome is 200; 400 bad body, 404, 409 request id reused for another code, 413, 429. `checkInId`s are uuids |
| `GET /organisers/me/analytics/overview?from&to&compare` · `…/overview.csv` | organiser: all own events. 400 bad range |
| `GET /admin/organisers?status` · `POST /admin/organisers/{id}/approve` · `…/reject` | admin. Items (and the decision responses) are `AdminOrganiserRecord`: the full record plus `recentEdits` (newest 20 log entries). Approve/reject: 409 unless pending |
| `POST /admin/organisers/{id}/suspend` `{reason}` | admin. Takedown of an approved organiser (see "Organiser profiles"). 200 `{organiser, eventsUnpublished, submissionsRejected}`; 400 reason missing, over 500 characters or with control/invisible characters; 404 unknown; 409 not approved |
| `GET /admin/events?status` · `POST /admin/events/{id}/approve` · `…/reject` · `…/unpublish` | admin. Approve: 409 if the event's organiser isn't approved |

Lists are paginated with an opaque `cursor` (`nextCursor` in the
response). It's currently a row offset, fine at this scale.

JSON request bodies over 256 KB are refused with 413. Every error response
is `cache-control: private, no-store`.

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
- `app/dashboard/[eventId]/check-in/page.tsx` → `components/check-in/*`: the
  door scanner (`DoorConsole` wires the summary, `useDoorScan`'s scan rules,
  the camera, `ResultPanel`, `RecentScans` and `UndoCheckInDialog`).
  `lib/check-in/*`: its framework-free parts (QR detection, decode
  de-duplication, typed-code parsing, words, timings, sound and vibration,
  wake lock). `public/vendor/zxing-wasm/<version>/`: the vendored ZXing
  WebAssembly decoder and its licences.
- `components/tickets/TicketQr.tsx` / `lib/ticket-qr.ts`: the ticket QR,
  as inline SVG on `/checkout/success` and as a PNG in the ticket email.

## Not built yet

- Per-event door staff accounts for check-in (everyone on the door shares
  the organiser's login; see "Accepted limits (check-in)"), and an offline
  mode for the scanner.
- Analytics beyond stages A and B (see "Organiser analytics").
- Venue coordinates (the map falls back to suburb centroids).
- Who's Going beyond increment 2: no admin UI for suspensions or the
  per-event switch (SQL only, `docs/supabase-setup.md`), and an opt-in isn't
  revisited if the member later changes their email or the order stops being
  `paid`.
- Messages: no realtime delivery or email notifications (clients poll), no
  attachments, and a declined pair can't start over (one conversation per
  pair, ever).
