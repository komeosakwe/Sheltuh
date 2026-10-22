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
| `organisers` | `id` | `owner_user_id` is unique, one application per account. It's null for platform-managed organisers (events Sheltüh lists on someone's behalf, and seed data), which admins create (`POST /admin/organisers`), which sell no paid Sheltüh tickets, and whose events only admins check in (see "Admin authoring" and "Check-in"); their `contact_email` should be a Sheltüh alias, never a person's own address (`docs/supabase-setup.md`); check constraint `organisers_platform_no_payouts`: such an organiser has no Stripe account and no payouts. `status`: pending → approved / rejected. Also holds the Stripe Connect account id and `payouts_enabled`. Optional social handles (`instagram_handle`, `tiktok_handle`, `facebook_page`, `x_handle`), stored without `@` and pattern-checked by the database; `website_url` must be http(s), at most 2048 characters (check constraint; the API only takes new `https://` addresses, see "Organiser profiles"). An admin takedown sets `rejected` (see "Organiser profiles"). `featured_video_provider` (`youtube` or `vimeo`) and `featured_video_id`: the featured video, provider and id only, never a URL (check constraint `organisers_featured_video_check`: both or neither, id pattern per provider). |
| `private.organiser_profile_edits` | `id` (identity) | Append-only log per organiser: each profile edit made without review (`profile_edit`: old and new value of each changed field, by the owner, or by an admin with a reason: removing the featured video, logged as `featured_video` `"provider:id"`) and each admin takedown (`suspended`, with the admin and reason; a takedown must have a reason). A trigger refuses updates (except the `actor_id` foreign key's own set-null when that account is deleted). Admins see the newest 20 per organiser. Kept while the organiser exists; deleted with it. |
| `events` | `id` | Belongs to an organiser. Globally unique `slug`. `status`: draft → pending_review → published / rejected; unpublish returns it to draft. `is_free` (true only when the event has ticket types and all are free; for an external event, `external_free`) is kept up to date by `replace_ticket_types` for the feed's free filter. `whos_going_enabled` (default true) is an admin-only kill switch for that event's Who's Going, set in SQL (`docs/supabase-setup.md`). `ticketing_mode` (`sheltuh`, the default, or `external`), `external_ticket_url` and `external_free`: see "External ticketing". Check constraints: an external event has a link, a Sheltüh-ticketed one has no link and isn't `external_free`, and an external event's `is_free` equals `external_free`. The trigger `events_external_ticket_url_valid` checks a link against `private.external_ticket_url_ok` when it's inserted or changed (only then, so tightening the rules never blocks a later status change; see "External ticketing"). `updated_at` changes on every update of the row, a photo change included (trigger `event_images_touch_event`). Triggers refuse ticket types and orders for an external event, and switching an event with ticket types to external. |
| `ticket_types` | `(event_id, id)` | `id` is stable across draft edits. A trigger refuses a price above 0 for a platform-managed organiser's event (`ticket_types_platform_free_only`). `quantity_sold` only ever goes up in `fulfil_order`, and down only in `record_payment_refund` (a paid order refunded in full). `seated`: the tier has seats on the event's seat map; its `quantity_available` is then always its unblocked seats (trigger `ticket_types_seated_capacity`, whatever is written; see "Reserved seating"). |
| `event_seat_maps` | `event_id` | An event's optional seat map (see "Reserved seating"): `layout` (the validated template, `lib/seating/template.ts`), `seat_count` (1–10,000) and `version` (from the sequence `private.seat_map_versions`: never reused, not even after a delete). Every write bumps the event's `updated_at` (`event_seat_maps_touch_event`). Refused for an external event (`event_seat_maps_sheltuh_only`). Deleted with the event. |
| `event_seats` | `(event_id, id)` | The map's seats, derived from the layout in the same step (`write_seat_map`): `position` (map order: the availability bit), section, row (may be empty) and seat labels, `ticket_type_id` (no-action foreign key `event_seats_ticket_type_fkey`: a tier with seats can't be removed), `kind` (standard, wheelchair, companion), `blocked`; `hold_order_id` / `hold_expires_at` (a pending order's hold) and `sold_order_id`. Checks: never held and sold at once (`event_seats_one_owner`), never held or sold while blocked (`event_seats_blocked_unsold`). Deleted with the map. |
| `event_images` | `event_id` | Optional organiser photo (≤2 MB, JPEG/PNG/WebP) stored as `bytea` — no Storage bucket or extra secret. Public via `GET /api/events/[id]/image` once published (cached for a day, versioned URL); before that only the owner/admins with a token. Every write (insert, update, delete) bumps the event's `updated_at` in the same transaction (`event_images_touch_event`), so a photo change is a new version of the event (see "Admin authoring"); writers lock the event row (for no key update) before the image row. Move to Storage/CDN if volume grows. |
| `event_moderation_log` | `id` | Append-only: submitted / approved / rejected / unpublished / ticketing_changed / created / edited / curated, by whom, and why. `details` (jsonb object, null for the other actions): for `ticketing_changed`, the old and new value of each ticketing field the admin changed (full ticket links: see "External ticketing"); for `edited`, the old and new value of each other field an admin changed (see "Admin authoring"); for `curated`, the old and new `boost` and `excluded` (see "Trending"). Shown to the event's organiser and to admins (`moderationLog[].changes`), never publicly, except `curated` entries, which only admins see (`GET /admin/events/{id}/curation`). `by` is the actor's account id for admins; the organiser's view shows `"Sheltüh team"` (`SHELTUH_TEAM_ACTOR`) for anyone but the organiser's own account. No update trigger: personal information in `details` or `reason` is redacted in place (`docs/supabase-setup.md`, APP 11/13). |
| `orders` | `id` (`ord_…`) | Priced snapshot of the line items and totals. `status`: pending → paid / failed / oversold_refund_required; oversold_refund_required → refunded (our automatic refund); paid → refunded (refunded in full in Stripe, see "Refunds made in Stripe"). `amount_refunded_cents` (≥ 0, default 0) is Stripe's cumulative refunded amount, recorded only for paid orders (a partial refund leaves the order paid). Indexed on `stripe_payment_intent_id` (partial, not null) for the refund webhook, and on `(event_id, created_at)` (partial, `paid`) for the trending refresh's 14-day read. `tickets_emailed_at` records the ticket email. `tracking_code` is the event tracking link the checkout came through (checked against the event's links when the order is created; null otherwise). `seat_ids` (1–10): a seated order's seats, set when it's made and never changed (what fulfilment and refunds act on). |
| `tickets` | `code` | One row per admitted person. Rows are kept when their order is refunded, but only a `paid` order's tickets are valid: check-in checks the order's status. `checked_in_at`: when the ticket was admitted at the door (null until then, and again after an undo; cleared 25 months after the event ends). Indexed on `(event_id, ticket_type_id)` for the check-in counts. `seat_id`: its seat (reserved seating); the foreign key `ticket_seats_sold_fkey` (event, seat, order, ticket type) → `event_seats (event_id, id, sold_order_id, ticket_type_id)` means a ticket can only name a seat sold to its own order in its own tier, and `tickets_seat_key` one ticket per seat. A full refund clears it (the order's `seat_ids` keeps the history). |
| `ticket_check_ins` | `id` (identity) | The check-in log (see "Check-in"): one row per scan or undo, with a random `public_id` (uuid, unique: the only id the API shows, as `checkInId`; the sequential `id` stays internal, so ids don't reveal platform-wide scan volume), the event scanned for, the ticket `code` (null for an `invalid` scan: what was scanned is never stored), the acting account (the organiser's, or the admin's for a platform-managed organiser's event), the client's `request_id` (unique per event: the idempotency key), the `result` and, for an undo only, its `reason` (3–200 characters). Check constraints tie `invalid` to a null code and `undone` to a reason. Deleted with the event or the ticket, and by `purge_analytics` 25 months after the event ends. No buyer data. |
| `private.platform_rate_limits` | `bucket` | Platform-wide fixed-window counters (`take_platform_rate_limit`): the hourly and 24-hour confirmation-email caps. Idle rows purged daily. |
| `private.free_order_refusals` | `(day, reason)` | Counts of refused free bookings per Melbourne day and reason. No personal data. Deleted after 13 months. |
| `private.email_outbox` | `id` | Transactional email jobs of three kinds: `ticket_email`, one per paid order (`(order_id, kind)` unique), `waitlist_available`, one per person told that tickets are available again (`waitlist_entry_id`; at most one pending or sending per entry), and `organiser_new_events`, a follower's new-event email (`follow_id`; at most one pending or sending per follow; see "Following organisers"). A check ties each kind to its key. Status, attempts, next attempt, lease, redacted last error. No address or content (read from the order, the waitlist entry or the follow, at send time). Deleted with the order, the entry or the follow. |
| `private.event_waitlist` | `id` | One entry per `(event_id, email_key)` (see "Waitlist"): the address as typed and `private.email_key` of it, `user_id` (only when a member joined with their own verified email; deleted with the account), `confirmed_at` (on the list from then: join order), `unsubscribed_at` (left), `notified_at` and `notify_count`. Deleted with the event, and by `purge_social_data` 30 days after the event ends. Never shown to organisers except as a count. |
| `private.event_waitlist_tokens` | `token_hash` | SHA-256 hashes of emailed waitlist tokens, never the tokens: `confirm` (a guest's join link, 24 hours, used once) and `leave` (one per notification email, valid while the entry exists). Deleted with the entry; expired confirmation links a week after expiry. |
| `profiles` | `user_id` | A member's social identity: `display_name` (1–40 characters), `adult_confirmed_at` (required: no profile without an 18+ confirmation). Deleted with the Supabase account. `social_suspended_at` is deprecated and ignored (see `private.social_suspensions`). Member profile fields (see "Member profiles"): `public_id` (random uuid, unique: the opaque `profileId`, never the user id; a recreated profile gets a new one), `profile_visible` (opt-in, default false), `bio` (1–200 characters) and `instagram_handle` (Instagram's username pattern, check constraint), both optional. |
| `private.profile_avatars` | `user_id` | The member's photo as the server re-encoded it: `image` (512 × 512 WebP, ≤ 512 KB) and `thumb` (96 × 96 WebP, ≤ 64 KB), no metadata. Deleted with the profile. |
| `private.profile_moderation_log` | `id` (identity) | An admin's removal of a member's photo, bio or Instagram handle: the member's account, the admin, which fields (never the content) and the reason (1–500). Deleted with the member's account, and 2 years after the entry (`purge_social_data`). |
| `event_attendees` | `id` | One row per Who's Going opt-in, unique per `(event_id, user_id)`. `id` is the opaque `attendeeId` shown to members: a fresh one per event, so it can't be linked across events or to a user. Deleted with the profile or the event, and by `purge_social_data` 30 days after the event ends. |
| `private.social_suspensions` | `user_id` | Admin-set Who's Going suspensions (SQL only, `docs/supabase-setup.md`). Keyed on the auth user, not the profile, so a member can't clear one by deleting and recreating their profile. Deleted with the Supabase account. |
| `private.rate_limits` | `(user_id, bucket)` | Fixed-window per-member request counters (`take_rate_limit`). Deleted with the account; stale rows purged daily. |
| `conversations` | `id` | One per pair of members, ever: `(user_low, user_high)` unique with `user_low < user_high`. `initiator_id` sent the request; `status`: requested → accepted (a reply) / declined. `event_id` is where they met (set null if the event is deleted). Per-side last-read message ids; `last_message_at` for ordering and retention. `id` is the opaque `conversationId`. Deleted with either member's profile, and 12 months after the last message. Every conversation has a row in `private.conversation_pairs`. |
| `messages` | `id` (identity) | Plain text, 1–1000 characters (check constraint). The id is the opaque, increasing `messageId` (keyset cursor). Deleted with the conversation or the sender's profile. |
| `user_blocks` | `id` | `(blocker_id, blocked_id)` unique, keyed on the accounts (not profiles), so recreating a profile doesn't lift a block. `id` is the opaque `blockId`, shown only to the blocker. `blocked_display_name` is a snapshot of the blocked member's name taken when the block was made, never refreshed (the live name would tell the blocker about renames and deletions). It's kept, like the block, until either account is deleted or the block is lifted. |
| `private.conversation_pairs` | `(user_low, user_high)` | Content-free record that two accounts have had a conversation: the pair and when the first request was sent. References `auth.users` only (not profiles), so deleting and recreating a profile, which deletes the conversation, doesn't reset "one conversation per pair" or undo a decline. Deleted with either account, and by `purge_social_data` once no conversation remains and it's over 12 months old. |
| `organiser_follows` | `id` | A member following an approved organiser (see "Following organisers"): `(user_id, organiser_id)` unique, keyed on the account (not the profile). `notify_new_events` (chosen when following; off unless chosen, default false), `notified_through` (the newest announcement already emailed) and `next_notify_at` (24 hours after the last email). Never shown to anyone else; counted for the organiser's profile (from 10) and analytics. Deleted with the account or the organiser. |
| `private.organiser_follow_tokens` | `token_hash` | SHA-256 hashes of the unsubscribe tokens in follower emails (one per email), never the tokens. Deleted with the follow, and 90 days after the email (`purge_social_data`). |
| `private.organiser_event_announcements` | `event_id` | Each event the first time it's published (organiser, time), so publishing it again emails nobody, and an email can list what was announced since the last. Backfilled with every event approved before the migration. Deleted with the event. |
| `event_favourites` | `(user_id, event_id)` | A member's favourites (account, not profile). At most 500 per account (`add_favourite`). Kept when the event is unpublished, but hidden until it's published again. Deleted with the account or the event. Never shown to anyone else; counted only as an aggregate input to the trending score, never per event or per person (see "Trending"). Indexed on `(event_id, created_at)` for that count. |
| `event_tracking_links` | `id` | Up to 20 per event (`create_tracking_link`): a server-made `code` (8 characters, `[2-9a-hjkmnp-z]`, unique per event) and an organiser `label` (1–40 characters, unique per event ignoring case). Deleted with the event. |
| `event_view_counts` | `(event_id, day, source, coalesce(link_code, ''))` (unique index) | Aggregate page-view counters, one row per event, Melbourne day, source bucket and tracking code: no visitor data of any kind. `link_code` is a plain copy of the code (no foreign key), so a deleted link's counts are kept. Deleted with the event, and by `purge_analytics` after 25 months. |
| `event_outbound_clicks` | `(event_id, day)` | Clicks on an external event's ticket link, one row per event and Melbourne day: `clicks` (≥ 0) and `cap_reached` (the per-minute click cap was reached that day, so `clicks` is a lower bound). No visitor data of any kind. Deleted with the event, and by `purge_analytics` after 25 months. |
| `private.event_rate_limits` | `(event_id, bucket)` | Fixed-window counters keyed on an event, never a person (`take_event_rate_limit`): caps the views (bucket `views`) and ticket-link clicks (`outbound`) counted per event per minute. Deleted with the event; idle rows purged daily. |
| `private.client_rate_limits` | `(client_key, bucket)` | Fixed-window counters keyed on a client (`take_client_rate_limit`): the per-client seat-hold limit (buckets `seat_holds:<event id>` and `seat_holds`, see "Reserved seating"). `client_key` is the API's keyed SHA-256 (HMAC) of the client's IP address (an IPv6 address's /64), salted with a value derived from `STRIPE_WEBHOOK_SECRET` (`lib/server/client-key.ts`); the raw address is never stored or sent to the database (check constraint: 64 hex characters). Idle rows purged daily (`purge_operational_data`). |
| `private.event_view_cap_days` | `(event_id, day)` | A marker that the event's view cap was reached on that Melbourne day, so reports can flag the day's views as a lower bound. No visitor data. Deleted with the event, and by `purge_analytics` after 25 months. |
| `private.event_curation` | `event_id` | An admin's trending curation (see "Trending"): `boost` (0.5 to 2, default 1, check constraint) and `excluded`, with who changed it last and when (null until changed). Written only by `set_event_curation`. Deleted with the event. |
| `private.trending_snapshot` | `rank` | The ranked trending list (at most 24): rank, event (unique), score and when it was computed. Rebuilt as a whole by `refresh_trending`; holds no counts. Deleted with the event. |
| `private.analytics_settings` | single row | `views_tracked_since`: the Melbourne day view counting started (when its migration ran), so reports show earlier days as "not counted" rather than 0. |
| `private.user_reports` | `id` | A member's report: copies of the reported message, up to 20 messages of context and the reported display name; `target_type` (`conversation`, `attendee` or `profile`); for a profile report, copies of the bio, Instagram handle and photo (512 px WebP: `reported_avatar_sha256`, a key into `private.report_photos`; reports made before that keep the copy inline in `reported_avatar`, never both: `user_reports_one_avatar_copy`). At most one open profile report per reporter and reported member (partial unique index `user_reports_open_profile_key`). Every reference is `on delete set null`, so the evidence survives the messages and both accounts. `status`: open → actioned (suspended) / dismissed. Resolved reports are deleted 2 years after resolution. |
| `private.report_photos` | `sha256` | Profile reports' photo copies, once per distinct image (`sha256 = sha256(image)`, check constraint), however many reports take it. `last_used_at` is bumped whenever a report takes it. Deleted by `purge_social_data` once no report references it and it's been unused for a day. |

Timestamps are `timestamptz`. Organisers enter Australia/Melbourne local
times, which are converted to instants honouring daylight saving
(`lib/server/melbourne-time.ts`).

## Database functions (schema `private`)

| Function | What it guarantees |
|---|---|
| `create_event_draft`, `edit_event_draft` | Event row (ticketing fields included) and ticket types saved together. `edit_event_draft` locks the event row, and only succeeds while the event is draft or rejected (`not_editable`) and owned by the caller's organiser (`not_found`); once the event has ever been approved, a change to its ticketing mode or link is `ticketing_frozen` (409) and nothing is saved. Switching to external removes the ticket types first. (`update_event_draft`, the earlier boolean form, is kept for the deploy window and no longer called; drop it once that's over: see "Not built yet".) |
| `admin_create_event` | An admin's new event (see "Admin authoring"): share-locks the organiser, which must exist and be approved; refuses a paid Sheltüh ticket type for a platform-managed organiser (`platform_paid`); then `create_event_draft`, a `created` log entry and, if asked, `transition_event` to published (`approved`), in one step. Nothing is written on a refusal. |
| `admin_edit_event` | An admin's edit of any event, any status: share-locks the organiser, then locks the event; refuses (`stale`) unless its `updated_at` still equals the version the admin edited (to the millisecond); computes each changed field; decides every refusal (`platform_paid`, `has_orders`, `reason_required`, `organiser_not_approved`) before writing; then ticketing through `admin_set_event_ticketing`, the other fields, `replace_ticket_types`, one `edited` entry with old and new values, and the optional publish. Nothing changing is `unchanged` (nothing written). |
| `admin_put_event_image`, `admin_delete_event_image` | An admin's photo change on any event, any status, with an `edited` entry (`{"image": {old, new}}`, `"set"` or null). Locks the event row (for no key update) first; the write bumps the event's `updated_at`. Deleting when there's no photo is `unchanged`, not logged. |
| `admin_set_event_ticketing` | An admin's change to an event's ticketing, any status: locks the event row; nothing changing is `unchanged` (nothing logged); switching to external an event with any order is `has_orders` (409), otherwise its ticket types are deleted; then the update and a `ticketing_changed` moderation log entry with the reason and the old and new values, in one step. |
| `external_ticket_url_ok` | Immutable check behind the `events_external_ticket_url_valid` trigger (run when a link is inserted or changed): the stored ticket link's rules (see "External ticketing"). Its shortener and non-public-name lists mirror `lib/ticketing.ts`; `tests/server/ticketing-url.test.ts` checks they agree. |
| `replace_ticket_types` | Upserts by id and removes ticket types that were dropped. Refuses to remove one with sales, or to cut a quantity below what's already sold. |
| `transition_event` | Changes status and writes the moderation log entry in one step. It only moves an event from an expected status, so two admins acting at once can't both succeed; the loser gets a 409. |
| `set_going` | Opts a member in to an event's Who's Going, checking everything in one step: the event is published, enabled, Sheltüh-ticketed and hasn't ended; the member isn't suspended (checked before the profile, so a suspended member without one still gets `suspended`); they have a profile; and a `paid` order for the event has their verified email (case-insensitive). Share-locks the event, then the profile, so an unpublish or profile deletion can't interleave. A suspension recorded mid-call can't be locked in advance, but every count and list filters suspensions at read time. Idempotent. Returns `going`, `event_unavailable`, `suspended`, `no_profile` or `not_eligible`. |
| `take_rate_limit` | Records one hit on a member's `(user, bucket)` counter and says whether it's within the limit for the window. One upsert, so concurrent requests can't both take the last slot. |
| `purge_social_data` | Retention: deletes Who's Going opt-ins 30 days after their event ended, profile moderation log entries after 2 years, follower-email unsubscribe tokens after 90 days, report photos no report references (after a day unused), rate-limit rows idle for a day, conversations (with their messages) 12 months after their last message, resolved reports 2 years after resolution, pair records with no conversation 12 months after the pair's first request, and the waitlist (see "Waitlist": entries 30 days after their event ended, unconfirmed entries 8 days after their last link, entries 30 days after their person left, expired confirmation links after a week). Idempotent. Scheduled daily with Supabase Cron (`docs/supabase-setup.md`), not by a migration. |
| `request_conversation` | A first message to the member behind an `attendeeId`, checked in one step: the sender isn't suspended and is opted in to the same event, which is open; the recipient isn't suspended; neither blocks the other; the pair has no conversation yet and none on record (`conversation_pairs`: a pair whose conversation went with a deleted profile is `unavailable`); the sender is within both rate limits; and the recipient is within their cap on requests received (over it, `unavailable`). Locks the sender's profile first (`for no key update`, so it doesn't block the other member's FK checks and mutual requests can't deadlock). Two members requesting each other at once: the pair's primary key makes the second insert fail, which rolls back its rate-limit hits (and the recipient's count) and returns `exists` (409). The recipient's profile or account deleted mid-call is `unavailable`. Returns `sent`, `sender_suspended`, `not_going`, `unavailable`, `self`, `exists` or `rate_limited`. |
| `send_message` | Locks the sender's profile, then the conversation, then checks visibility (blocks, the other member's suspension, a declined request), that the sender isn't waiting on their own request, and the rate limit, before inserting. A reply to a request accepts it; a reply and a decline racing can't both win. Returns `sent`, `sender_suspended`, `not_found`, `awaiting_reply` or `rate_limited`. |
| `file_report` | Checks the reporter is in the conversation (and the message is the other member's), takes the rate limit and copies the evidence into the report in one step. Key-share-locks the conversation, then the message, when it finds them, so a profile deletion or retention purge waits for the report; one already under way means the report finds nothing (`not_found`, 404). The reported account deleted mid-call (a foreign-key failure) or a deadlock with an account deletion is also `not_found`, never a 500. |
| `create_block` | Blocks, in one step, only a member the blocker can currently see: the other member of a conversation visible to them, or of a request they declined; or an `attendeeId` on a Who's Going list they may view right now (event published, enabled and not ended; blocker has a profile and isn't suspended; attendee isn't suspended; neither blocks the other). Anything else is `not_found`. Snapshots the display name, takes the rate limit, and inserts; a block the blocker already has comes back unchanged with the same result. Returns `blocked`, `not_found`, `self` or `rate_limited`. |
| `resolve_report` | Closes an open report only (a second admin gets 409); `suspend` also records the suspension in the same step. |
| `add_favourite` | Favourites a published event, idempotently, within the per-account cap (favourites of published events only: hidden ones don't count). A transaction-scoped advisory lock on the account serialises one member's adds, so concurrent requests can't both take the last slot. Returns `added`, `exists`, `not_found` or `limit`. |
| `take_event_rate_limit` | `take_rate_limit`'s fixed-window counter, keyed on an event instead of a member. Once a live window is over the limit it refuses with a plain read and writes nothing, so a flood isn't a write per request. |
| `record_outbound_click` | Counts one click on an external event's ticket link: the event must be published and external (`not_found` otherwise); then the event's per-minute cap (`take_event_rate_limit`, bucket `outbound`; a refused click flags the day `cap_reached`: the first refusal writes the flag, and every later one is plain reads, the cap's counter and then the flag, with no write, row lock or transaction id, `20261022000200_external_ticketing_hardening.sql`); then one upsert increment. Like `record_view`, no row lock on the event and no exception block. Returns `recorded`, `not_found` or `rate_limited`. |
| `record_view` | Counts one view: the event must be published; the source is bucketed (unknown → `other`); a code that's one of the event's tracking codes makes it `tracking` under that code (any other code is ignored); then the event's per-minute cap (a refused view records the day in `event_view_cap_days`; after the first, that's a no-op); then one upsert increment. No row lock on the event and no exception block, to keep the hot path to two small upserts. Returns `recorded`, `not_found` or `rate_limited`. |
| `create_tracking_link` | Adds a link to an event the organiser owns, under an advisory lock on the event (so the 20-link cap holds under concurrency, without locking the events row that checkouts share-lock). Returns `created`, `not_found`, `limit`, `label_taken`, or `code_taken` (the API retries with a fresh code). |
| `refresh_trending` | Rebuilds the trending snapshot in one step (see "Trending"): an advisory lock serialises concurrent runs, the old rows are deleted (not truncated, so readers are never blocked and see the previous snapshot until it commits), and the eligible events are scored and ranked. Takes an optional `now` (tests). Returns `eligible` and `ranked` counts. |
| `trending_day_utility`, `trending_decay`, `trending_shrink`, `trending_proximity` | The trending formula's parts, immutable, so the SQL is the formula's only definition (tests call them directly). |
| `set_event_curation` | An admin's boost and exclusion for any event, any status: key-share-locks the event, then locks its curation row; nothing changing is `unchanged` (nothing logged); otherwise the update and a `curated` moderation log entry (admin, reason, old and new values), in one step. Returns `updated`, `unchanged` or `not_found`. |
| `purge_analytics` | Retention: deletes view and outbound-click counters for days over 25 months ago and per-event rate-limit rows idle for a day, and, for events that ended over 25 months ago, the check-in log and the tickets' `checked_in_at`. Idempotent. Scheduled daily with Supabase Cron (`docs/supabase-setup.md`). |
| `check_in_ticket` | One scan, in one step (see "Check-in"): the event must be the organiser's (`not_found`; for an admin, the API passes the platform-managed organiser's id); a hit on the account's `check_in` allowance (`rate_limited`, nothing logged); then, under an advisory lock on (event, request id), a request id already logged returns its original result unchanged, or `conflict` (nothing logged; the API's 409) if the submitted code doesn't resolve to the logged one. Otherwise: a code that isn't one of the organiser's tickets is `invalid`; another of their events' tickets is `other_event`; else it share-locks the order, then locks the ticket (`for update`), and decides `not_admissible` (order not `paid`), `already_checked_in` (with the first time, and `admission_id`: the ticket's current admission, for undo) or `admitted` (sets `checked_in_at`; `admission_id` is the new row). Every result but `not_found`, `rate_limited` and `conflict` logs exactly one row. Ids returned are public ids. Also returns the ticket's seat (section, row, seat, kind) when it has one. |
| `undo_check_in` | Reverses an admission (an `admitted` log row of the event, by its `public_id`) with a reason: same ownership check, allowance and locks as `check_in_ticket`. Returns `undone` (clears `checked_in_at`, logs an `undone` row with the reason), `not_found`, `not_checked_in` (already undone), `superseded` (admitted again since: undo the newer one) or `rate_limited`. Only `undone` logs a row. |
| `place_free_order` | A member's free order, created and fulfilled in one step under an advisory lock on (event, person): the per-person cap, then the daily allowance, then `fulfil_order`. A refusal or sell-out writes nothing (beyond a refusal count). Returns `paid`, `person_event_limit`, `member_daily_limit` or `sold_out`. |
| `request_free_order` | A guest's pending free order: the platform's hourly and 24-hour caps (read-only), then, under an advisory lock on the address, the hourly link limit, then a hit on each platform cap. Returns `requested`, `address_limited`, `platform_limited` or `platform_daily_limited`. (The previous 13-argument form delegates to it with the same daily cap, for the deploy window; the app doesn't call it.) |
| `confirm_free_order` | Confirms by token hash: locks the order, then (event, person), then the event (share) to check every ticket type is still free, then `fulfil_order`'s locks. Idempotent within the link's 24 hours. Returns `confirmed`, `already_confirmed`, `expired_confirmed`, `not_found`, `expired`, `unavailable`, `ended` (the event ended before the link was confirmed: read before the allowance, and again under the event's share lock), `person_event_limit`, `no_longer_free`, `seats_taken` (a seated order's seats went to someone else since the link was sent) or `sold_out` (the last five mark the order `failed`). A seated order takes the seat lock before the order row. |
| `purge_operational_data` | Retention for free-ticket and outbox data (see "Free tickets" and "Payment flow"); sent outbox jobs after 90 days, failed ones after a year; per-client counters (`client_rate_limits`) idle for a day. Idempotent; Supabase Cron daily. |
| `claim_outbox_jobs`, `finish_email_job`, `resend_email_job`, `admin_resend_email_job` | The email outbox: lease due jobs of any kind (optionally one order's, or one kind) with `skip locked` (an expired lease is taken again; one that expired on the 6th attempt fails), record an outcome only for the current lease holder, and an admin resend of a ticket email (not while leased, not twice in 5 minutes; a waitlist email is `not_found`). `admin_resend_email_job` takes a hit on the admin's hourly allowance only when the resend is queued, in the same transaction (over it: `rate_limited`, nothing changed). `claim_email_jobs`, the earlier form, now claims ticket emails only and is kept for the deploy window (see "Not built yet"). |
| `waitlist_join_state` | Whether an event's waitlist takes joins: `open` (published, Sheltüh-ticketed, not ended, has ticket types and every one is sold out), else `not_found` (missing or not published), `external`, `ended` or `not_sold_out`. |
| `join_waitlist` | A member's join with their own verified email (the API checks it's theirs): on the list at once, idempotently (`already_joined`); someone who left, or never confirmed, joins again at the back. An entry already on the list is linked to the member's account only if its address is exactly theirs (ignoring case), never by a normalised match (`+tag`, Gmail dots). Returns `joined`, `already_joined` or a `waitlist_join_state` refusal. |
| `request_waitlist_join` | Anyone else's join: the event's state; the platform's hourly and daily caps (read-only, before anything about the address); then under an advisory lock on the address: already on the list (`already_joined`, nothing recorded), the address's hourly cap (`address_limited`), taking both platform caps, and a pending entry with the confirmation token's hash. Returns `requested`, `already_joined`, `address_limited`, `platform_limited`, `platform_daily_limited` or a state refusal. |
| `confirm_waitlist_join` | Confirms by token hash: locks the token, then the entry. Returns `joined`, `already_joined`, `not_found`, `expired`, `used` (confirmed before, and left since) or `closed` (the event isn't published, is external or has ended; it needn't still be sold out). |
| `leave_waitlist` | Takes the entry behind a leave token off the list, idempotently (`left`, or `not_found`). |
| `notify_waitlist` | Queues "tickets are available again" emails for an event with tickets left (see "Waitlist"): target 3 per ticket left, at most 100, within a 12-hour window; only the shortfall from people told in the window is queued, so calling it again is a no-op until more tickets free up or the window passes. People never told first, then join order; skips buyers (paid orders, by normalised address), people with an email still waiting, and stops at 500 a day platform-wide. Advisory lock per event. Called at commit by deferred constraint triggers on `ticket_types` (insert with tickets; update leaving more tickets than before) and `events` (status becomes `published`). The triggers catch any error from it and raise a warning instead (event id and SQLSTATE only), so queueing emails can never fail the refund, edit or approval that freed the tickets. |
| `edit_organiser_profile` | An approved organiser's profile edit (`PATCH /organisers/me`): locks the organiser row, checks it's still approved (`not_approved` → 409), writes only the fields sent whose value really changes (the featured video as `"provider:id"`), and appends their old and new values to `organiser_profile_edits`, in one step. A no-op edit writes nothing. Returns `updated`, `unchanged`, `not_approved` or `not_found`. |
| `admin_remove_featured_video` | An admin removes an organiser's featured video (any status): locks the organiser row (for update), clears it and logs a `profile_edit` by the admin with the reason. Returns `removed`, `unchanged` (none: nothing logged) or `not_found`. |
| `member_profile_visible` | The one rule for seeing a member profile (stable SQL): the member behind a `profileId` if the viewer has a profile, neither is suspended, neither blocks the other, and the profile is visible or the viewer's own; else null. Used by every read and write by `profileId`; the API also requires a verified email. |
| `file_profile_report` | A report about a profile: key-share-locks the profile; only one the reporter can see now (`member_profile_visible`) or a member they've blocked (else `not_found`, the unknown-id answer); an open profile report by the same reporter about the same member is returned as it is (`already_open`, no allowance used; two at once: the unique index makes the second find the first); then the reports rate limit, the photo copied once per distinct image (`report_photos`, upserted so a concurrent purge skips it), and the insert (`target_type` `profile`). Returns `filed`, `already_open`, `not_found`, `self` or `rate_limited`. |
| `create_block_by_profile` | `create_block` for a profile the blocker can see now (`member_profile_visible`); same snapshot, rate limit and results. |
| `request_conversation_by_profile` | A first message by `profileId`: the profile must be visible to the sender (`unavailable` otherwise, 404); picks the soonest open event both are opted in to (`not_going` if none) and hands over to `request_conversation` with that attendeeId, so every other rule is the same code. |
| `admin_remove_profile_content` | An admin removes a member's photo, bio and/or Instagram handle: locks the profile (no key update), then the photo; removes only what's there; logs the fields, admin and reason in `profile_moderation_log`. Returns `removed` (with the fields), `unchanged` or `not_found`. |
| `follow_organiser` | A follow (or a change of its email choice): key-share-locks the approved organiser (`not_found` otherwise; `self` for its own account), then an advisory lock on the account; an existing follow is `exists` (its choice updated if sent); else the 500-follow cap (`limit`) and the 60-an-hour allowance (`rate_limited`) before the insert (`followed`, emails off unless the choice sent was true). |
| `unsubscribe_follow` | Turns a follow's emails off by an unsubscribe token's hash (the follow stays). Idempotent: `unsubscribed` or `not_found`. |
| `notify_followers` | Run at commit by the deferred constraint trigger `events_followers_announce` (status becomes `published`): for a published, upcoming event of an approved organiser, records the announcement (once per event ever: a republish is a no-op), then, under an advisory lock per organiser, queues one `organiser_new_events` job per follower with emails on and a confirmed email (`auth.users.email_confirmed_at`) who has none waiting, due at the later of now and 24 hours after their last, until the platform's 500 a day. Locks each follow row as it's queued. |
| `claim_email_outbox` | `claim_outbox_jobs` for every kind, also returning the follow. `claim_outbox_jobs` (the previous release's) now leaves `organiser_new_events` alone, for the deploy window. |
| `suspend_organiser` | An admin takedown, only from `approved` (a second admin gets 409): locks the organiser row, then its published and pending-review events in id order; sets the organiser `rejected` with the reason and reviewer; moves each published event to draft (`unpublished`) and each pending one to `rejected`, through `transition_event`, so the event moderation log records each with the admin and reason; logs the takedown. Deletes nothing. Returns the result and how many events moved. |
| `record_payment_refund` | Records a `charge.refunded` by payment intent (see "Refunds made in Stripe"). Locks the order (`for update`), and acts only on a `paid` one. Full refund: `refunded`, the amount recorded, and each line item's quantity taken off its ticket type's `quantity_sold` (never below 0), updating ticket types in `ticketTypeId` order like `fulfil_order`, so the two can't deadlock. Partial: only `amount_refunded_cents`, which only grows. A redelivery (already refunded, or no larger amount) changes nothing, so inventory is released exactly once. Returns `refunded`, `partial`, `unchanged` or `not_found`, with the order id when found (logged by short reference only). A full refund of a seated order also frees its seats (tickets' `seat_id` cleared, then the seats' sale), after the seat lock. |
| `replace_seat_map`, `delete_seat_map` | The organiser's map (see "Reserved seating"): the seat lock, then the event row (owned by the organiser, else `not_found`); only while draft or rejected (`not_editable`) and never approved (`frozen`), not external (`external`), and the event has no orders of any status (`has_orders`); then `write_seat_map` / `clear_seat_map`. |
| `admin_replace_seat_map` | An admin's replacement (layout) or removal (null), any status, only while the event has no orders of any status (`has_orders`); a reason is required; logged `edited` with `changes.seatMap` (old and new `{version, seatCount}`). Nothing changing is `unchanged`, nothing logged. |
| `write_seat_map`, `clear_seat_map` | Internal: store a layout (the seats derived from it in SQL, so the two can't disagree; at most 5 tiers, `event_seat_maps_max_tiers`; then every tier's `seated` and capacity recomputed) or remove it. An identical layout is `unchanged` (version kept). Either refuses (check_violation, `event_seat_maps_no_orders`, the API's 409) when the event has any order, whatever the caller checked: defence in depth, so no caller can rewrite seats a pending order holds or a paid one has sold. |
| `hold_seats` | A paid seated checkout's pending order and its holds, all or nothing (see "Reserved seating"): the seat lock; a used-up hold window refused with a plain read (`rate_limited`, nothing written); then the order, the event (published, Sheltüh-ticketed), the map version, every seat free (else `seats_unavailable` with the ids), lines matching the seats' tiers, and the held-seat cap; only then, with every refusal decided, one hit on the event's hold counter (`take_event_rate_limit`, bucket `seat_holds`, its row locked last) and the holds. A refusal writes nothing at all, so refused attempts (the cap above all) never use up the allowance (`20261102000000_seating_hardening.sql`). Returns `held` (with `hold_expires_at`), `rate_limited`, `not_on_sale`, `version`, `seats_unavailable`, `tier_mismatch` or `hold_cap`. |
| `release_seat_holds` | A pending order marked `failed` and its holds cleared, under the seat lock; anything not pending is returned unchanged (its status). |
| `take_client_rate_limit`, `take_seat_hold_attempt` | `take_rate_limit`'s fixed-window counter keyed on a client key. `take_seat_hold_attempt` takes one hit on the client's `seat_holds:<event id>` bucket, then one on its `seat_holds` (all events) bucket, in that order (nothing else writes them), and returns `ok`, `event` or `all`; a refusal keeps neither hit (`20261103000000_seat_hold_client_limits.sql`). |
| `place_free_seated_order`, `request_free_seated_order` | `place_free_order` / `request_free_order` for a seated free order (the seat lock first; the order records its seats). A guest's order holds nothing until confirmed. `seats_unavailable` when a member's seat is gone. |
| `fulfil_order` | Queues the ticket email in the same step (see "Payment flow"). Takes inventory for every line item, issues the tickets and marks the order paid. If any ticket type has sold out, or the event is no longer published, it takes nothing and marks the order `oversold_refund_required`. Rows are locked in a fixed order, so concurrent orders can't deadlock. It's idempotent, so Stripe's webhook redeliveries are harmless. A seated order takes the event's seat lock first, needs every seat (free, its own hold, or an expired hold) and lines that match its seats exactly (no order buys a seated tier without seats), and gives each ticket one of its tier's seats; otherwise the oversold path, which also clears its holds. |

## Payment flow

1. `POST /api/events/[eventId]/checkout` (guest, no account):
   - Prices come from the database, never the client.
   - An event that has ended (`ends_at <= now()`, the definition used
     everywhere) takes no new order or seat hold, paid or free: 409 "This
     event has ended." The database enforces it for every caller: the
     `orders_not_ended` trigger refuses any insert into `orders` for an
     ended event (share-locking the event row, as `orders_sheltuh_only`
     does), which covers this insert, `hold_seats`, `place_free_order`,
     `request_free_order` and their seated forms, and the API maps it to the
     same 409 (`supabase/migrations/20261103000100_refuse_ended_event_orders.sql`).
     `fulfil_order` doesn't check it: a payment Stripe confirms after the
     end, for an order made before it, is still fulfilled (the buyer was
     charged).
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
   - A payment (`completed` and paid, or `async_payment_succeeded`) for an
     order that's already `failed` (its checkout errored or was cancelled, or
     its session expired, before Stripe reported the payment) is logged
     (`console.warn`, short reference) and refunded in full the same way
     (`reverse_transfer`, `refund_application_fee`, idempotency key
     `failed-order-refund-{orderId}`); the refund id and payment intent are
     recorded on the order, which stays `failed`, so a redelivery asks
     nothing more. A refund call that errors returns 500 (Stripe redelivers);
     a refund that fails later is logged by `refund.updated` / `refund.failed`.
   - `charge.refunded` → `record_payment_refund` (see "Refunds made in
     Stripe").
   - Any other event type is acknowledged (200) and ignored.
   - Inventory is only taken here, so an abandoned checkout never holds
     tickets.
   - Seated orders: see "Reserved seating" (holds, `expires_at`, the
     `cancel_url`, and releasing seats on expiry or failure).
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
     on the shared layout (below): the official uppercase wordmark above the
     card, "You're in.", the event's date, time, venue and address, a card
     per ticket (number and type, seat for reserved seating, QR, backup
     code), a "View your ticket(s)" button (black on Signal Orange) to
     `/checkout/success` for the order (the same link as ever), the order
     reference and total, support, and a decorative brand banner. For an
     event that's no longer published (unpublished, back in draft or review,
     rejected) the date, time, venue and address are replaced by "This event
     is no longer listed. Contact support@…" (the ticket page's rule, and
     the public routes' `status = 'published'`); the tickets still go out,
     and a resend follows the event's status at the time. The wordmark is a
     PNG (black on cream, 212×48 shown at 106×24, brand-direction-one.md §11
     #6, about 4 KB) rendered from `public/brand/sheltuh-wordmark.svg`
     (`scripts/render-email-wordmark.ts`: `public/brand/sheltuh-wordmark-email.png`,
     embedded as base64 in `lib/server/email-wordmark.ts`) and attached
     inline (`cid:`) like the QR codes, so it shows where Outlook blocks
     remote images; alt text "SHELTÜH". The banner
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
     matrix. Email clients themselves aren't tested. Every transactional
     email (tickets, free-ticket confirmation, waitlist, follower) is built
     on one layout, `lib/server/email-layout.ts` (Brand Direction One:
     cream page, white card, black text, Signal Orange only on the one
     button, with black text on it; the button keeps its size in Outlook
     for Windows via `mso-padding-alt`, and the preheader is hidden there
     with `mso-hide:all`), so they can't drift apart;
     `tests/server/email-brand.test.ts` holds every builder to it.
   Free orders require the buyer's email address at checkout; for paid
   orders, Stripe collects it. The same outbox carries waitlist emails
   (see "Waitlist"), claimed by the same workers (`claim_outbox_jobs`).
5. `/checkout/success?session_id=<order id>` polls
   `GET /api/orders/by-session/<id>`. The unguessable order id is the
   credential, so the response is only what that page shows: status, short
   reference, event title and slug, a masked email (`m***@example.com`),
   subtotal, buyer fee, total; only while the order is `paid`, `eventListed`
   (whether the event is still published) and, only while it is, the
   event's current start and end, venue name and suburb (public event
   details; never the street address), and the ticket codes with type
   names, seat (reserved seating) and each ticket's `checkedInAt` (when it
   was admitted at the door, or null), so each ticket on the page shows the
   event (or, once it's unlisted, "This event is no longer listed" with the
   support address and no link to its page), its QR and backup code, and
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
  the answer is 409. A link confirmed after the event ended issues nothing
  either (409 "This event has ended.", the order marked failed); one
  confirmed before the end still answers with the same URL afterwards.
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
- The confirmation email is sent straight after the response (`Deps.defer`),
  so the 202 never waits on SMTP. If it can't be sent, the pending order is
  deleted (it holds nothing) and the failure is logged by short reference;
  the guest, already told to check their inbox, books again. The only 503s
  are the platform caps, which don't depend on the address.
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
- Live mode without SMTP configured can't send a confirmation link: every
  guest free booking gets its 202, the send fails after the response
  (logged) and the order is dropped, so nothing can be confirmed (members
  booking with their own verified email are unaffected).

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
- **Timing.** The platform-cap 503 doesn't depend on the address, and the
  link is emailed after the response, so no outcome waits on SMTP. What's
  left is a few milliseconds of database work: an address-limited request
  skips the platform-cap write and the insert, so its 202 can come back
  slightly faster than a real one. Accepted: telling that an address has 3
  unconfirmed links in the last hour would need many repeated timing
  measurements and reveals little. The cost of sending after the response:
  a link that can't be sent is no longer a 503; the guest sees the usual
  202 and gets no email (the order is dropped and the failure logged).

## Waitlist

People can join the waitlist of a sold-out event and are emailed when
tickets free up (`lib/server/handlers/waitlist.ts`,
`lib/server/waitlist-email.ts`,
`supabase/migrations/20261024000000_waitlist.sql`, `lib/api/waitlist.ts`;
UI states in `docs/design/brand-direction-one.md` §6.11).

- **Sold-out data.** Public event payloads (the feed, `slug`, favourites,
  organiser profiles, trending) carry, per ticket type, `soldOut` and
  `remaining` only when 10 or fewer are left (`REMAINING_SHOWN_AT_MOST`; 0
  when sold out), so an exact large stock (and, through it, sales) is never
  shown; and the event's `soldOut`: every ticket type sold out (false with
  no ticket types, and always for an external event). What's left is
  `quantity_available − quantity_sold`: pending orders, paid or free, hold
  nothing (inventory is only taken in `fulfil_order`), so there are no holds
  to subtract. `quantityAvailable` is still the capacity. Organiser and admin
  records are unchanged. The server computes no "from" price; the browser's
  `lib/pricing.ts` must skip sold-out tiers.
- **Who can join.** Only a published, Sheltüh-ticketed event that hasn't
  ended and is sold out (every ticket type): an event that isn't published
  is a 404 (as everywhere); external, ended or not sold out is a 409. No
  per-tier waitlist.
- **Joining.** One entry per person per event, the person being the
  normalised address (`private.email_key`, as for free tickets). A
  signed-in member with a verified email who leaves `email` out, or sends
  that address (ignoring case), is on the list at once (201, or 200
  `alreadyJoined`), with no email. Anyone else (a guest, another address, an
  unverified account) gets `202 {status: "confirmation_sent",
  expiresInHours: 24}` and a link, `/waitlist/confirm#token=…`: the token is
  in the fragment and the page POSTs it on a button press
  (`POST /api/waitlist/confirm`), as for free tickets, so a mail scanner
  can't join anyone. Only the token's SHA-256 hash is stored. An entry made
  this way never gets a `user_id`, so nobody can see or leave someone else's
  entry from their account.
- **No enumeration.** A guest gets the same 202 whether the address is new,
  already on the list (no email sent: they have one) or over its hourly cap
  (no email sent). Refusals about the event (404, 409) don't depend on the
  address.
- **Caps** (`WAITLIST_LIMITS`): 3 confirmation links per address per hour
  (any event, normalised); 30 an hour and 200 per 24 hours platform-wide
  (503 for everyone, checked before anything about the address and taken
  only for a link that's about to be sent). The link is emailed straight
  after the response (`Deps.defer`), so the 202 never waits on SMTP; one
  that can't be sent is dropped (it doesn't use the address's cap) and
  logged, with no address. Members joining with their own verified email
  send nothing and aren't capped.
- **Status and leaving.** `GET …/waitlist/status` (signed in): on the list by
  account, or by exactly their verified email, ignoring case (a guest link
  they confirmed counts); never by the normalised key, which folds `+tags`
  and Gmail dots, so `fan+x@…` can't see or leave `fan@…`'s entry.
  `DELETE …/waitlist` (signed in) leaves, idempotently, whatever the
  event's state. Every notification email has its own leave link,
  `/waitlist/leave#token=…` (a page that POSTs the token,
  `POST /api/waitlist/leave`), also sent as `List-Unsubscribe`; it works
  until the entry is deleted, and answers with the event's title only while
  it's published. Leaving sets `unsubscribed_at`; a queued email
  to someone who has left isn't sent. Joining again puts them at the back.
- **Notification** (`private.notify_waitlist`): run at commit by deferred
  constraint triggers whenever a transaction leaves an event with more
  tickets than before (a full refund in Stripe releasing inventory, an admin
  raising capacity or adding a ticket type on a published event, an event
  published again with tickets left, e.g. after the organiser raised
  capacity on a draft), whichever path did it. It queues
  `waitlist_available` outbox jobs: up to 3 people per ticket left, at most
  100 per event within a 12-hour window, each person at most once per 12
  hours (people told in the window count towards the target, so repeated
  calls, several triggers in one transaction and redelivered webhooks queue
  nothing more), people never told first and then in join order, skipping
  anyone with a paid order for the event (normalised address) and anyone
  whose email is still waiting, and at most 500 a day platform-wide (they
  share the mail quota). An expired or abandoned checkout frees nothing:
  pending orders hold no tickets. Routes that can free tickets (the Stripe
  webhook after a full refund, an admin's event edit, an approval) send the
  queued emails straight after the response (`sendWaitlistEmailsSoon`, up to
  100, 30 seconds; `maxDuration = 60` on those routes); the cron route sends
  the rest and retries failures like ticket emails.
- **The email** ("Tickets are available again", `buildWaitlistAvailableEmail`):
  the event, when and where, a "Get tickets" link to
  `/events/{slug}#tickets`, that it's first come, first served and nothing is
  held, why they're getting it, and the leave link. Brand Direction One
  colours (black on cream and white, Signal Orange only as the button, with
  black text). The subject (here and on the confirmation email) has control,
  invisible and text-direction characters of the title replaced by a space
  (`subjectLine`, `lib/server/email.ts`: every email's subject goes through
  it, the ticket, free-confirmation and follower emails' too, and
  `mailOptions` applies it again before sending). Rebuilt at send time; skipped (not retried) if the person has
  left, the event is no longer open, or it has sold out again since.
  Transactional (about one event the person asked to hear about), with a
  functional unsubscribe (Spam Act 2003).
- **Privacy.** Waitlist addresses are personal data. Organisers never see
  them: their event analytics show only `waitlistCount` (people on the list
  now). Admins see no waitlist emails at `/admin/emails` (ticket emails
  only). Logs name a job by id only. Retention (`purge_social_data`, daily):
  entries 30 days after the event ends, unconfirmed entries 8 days after
  their last link was requested, entries 30 days after their person left;
  an account's own entries go with the account. Every response is
  `private, no-store`.

**Privacy Policy wording needed before go-live** (owner to approve):

- That when someone joins an event's waitlist, Sheltüh keeps their email
  address (and, if signed in, links it to their account) to email them,
  about that event only, if tickets become available; that guests confirm
  by email first; and that every such email has a link to leave the
  waitlist.
- That the organiser sees only how many people are on the waitlist, never
  who, and that waitlist details are deleted 30 days after the event ends
  (sooner if the person leaves the waitlist or never confirms).
- That joining doesn't reserve a ticket: tickets that come up are first
  come, first served, and not everyone on the waitlist is emailed at once.

### Accepted risks (waitlist)

- **Not everyone is told.** At most 3 people per ticket freed (100 per
  window per event, 500 a day platform-wide) are emailed, so a long list
  hears in turns, and if nobody buys, nobody else is told until more tickets
  free up or the 12-hour window passes and another freeing happens. A ticket
  freed with no further change never re-runs the round on its own (there's
  no periodic sweep).
- **No reservation.** The email is a heads-up; someone not on the list can
  buy the freed ticket first. The email says so.
- **Delay on Hobby.** Emails the after-response run doesn't send within 30
  seconds wait for the cron, which is daily on Vercel's Hobby plan (every 5
  minutes on Pro). A burst of 100 is normally sent in that time.
- **Cooldown without an email.** A queued email that's skipped (sold out
  again, or the event closed) still counts as the person's notification for
  the 12-hour window.
- **Mail quota.** Waitlist confirmations (200 a day) and notifications (500
  a day) share the Workspace SMTP quota (about 2,000 a day) with ticket
  emails and free-ticket links (400 a day). Move to a transactional email
  provider before volume approaches it.
- **Timing.** The link is emailed after the response, so no answer waits on
  SMTP. A guest's 202 for an address already on the list, or over its cap,
  can still come back a few milliseconds faster (less database work); as
  for free tickets, telling them apart needs many repeated timing
  measurements. A link that can't be sent is no longer a 503: the guest
  sees the usual 202 and no email arrives.
- **The count.** An organiser sees the exact number on the list, so with a
  tiny list they could correlate a change with someone they know. It's a
  count only, with no identity.
- **Concurrency** is enforced in the database (an advisory lock per event for
  rounds, per address for guest links, the unique `(event, person)` key);
  the race tests run only on a real Postgres (`TEST_DATABASE_URL`).

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
  paginated (at most 50 a page), with an opaque per-event `attendeeId`, and,
  only for a member who made their member profile visible, its `profileId`
  and photo thumbnail (`hasAvatar`, `avatarThumbUrl`; see "Member profiles").
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
  count is 0, the list is empty, and new opt-ins are refused. An external
  event's Who's Going is always closed (its tickets aren't ours, so nobody
  can show they hold one).
- Opting out (`DELETE …/going/me`) and deleting the profile always work,
  whatever state the event is in, and need no verified email.

## Messages

Direct messages between members who met on a Who's Going list
(`lib/server/handlers/messages.ts`, `blocks.ts`, `reports.ts`):

- **First contact** is one request message (1–1000 characters, plain text,
  no links), and only between two members opted in to the same event while
  its Who's Going is open, neither suspended nor blocking the other. The
  client only knows the recipient's per-event `attendeeId`, or their
  `profileId` from a member profile (the server picks the soonest shared open
  event, `request_conversation_by_profile`); the server resolves it. Blocks
  and reports can also be made by `profileId` (see "Member profiles"). One conversation per pair, ever (a second request either way
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

## Member profiles

Clickable Who's Going names (owner request, 21 Oct 2026;
`lib/server/handlers/member-profiles.ts`, `profiles.ts`, `lib/server/avatar.ts`,
`supabase/migrations/20261024000100_member_profiles.sql`).

- **Opt-in.** A member profile is off by default (`profile_visible`). Turned
  on (`PATCH /profiles/me {profileVisible: true}`), other members who may see
  it get the display name, an optional bio (1–200 characters, cleaned like an
  organiser's bio: no control, invisible or text-direction characters, line
  breaks normalised; links allowed) and Instagram handle (the organiser
  handle rule; the server builds the URL), the photo, and the open events the
  member has opted in to (published, Who's Going on, not ended; at most 24).
  Never an email, user id or attendeeId. Members who haven't opted in stay
  plain text on Who's Going lists (no `profileId`).
- **The profile id** is `profiles.public_id`: random, stable for the
  profile's life, not the user id and not a per-event attendeeId. It links a
  visible member's opt-ins across events, which is what a profile is for;
  hidden members keep only per-event attendeeIds. Deleting and recreating the
  profile gives a new id (and starts hidden, without bio, handle or photo).
- **Who may see one** (`private.member_profile_visible`, the same gate as
  Who's Going names): a signed-in member with a verified email and a
  profile, not suspended; the profile's member not suspended; neither blocks
  the other; and the profile visible (or their own). Anything else is the
  same 404, unknown ids included, so existence never leaks. Rate-limited like
  the attendee list (30 views per 10 minutes, then 429). Responses are
  `private, no-store`.
- **Message, Block, Report.** `canMessage` mirrors the messaging rules (a
  shared open event both are opted in to, and never a conversation between
  them); `conversationId` when a visible one exists. `POST /conversations
  {profileId, body}`, `POST /blocks {profileId}` and `POST /reports
  {profileId, reason, details?}` work as their attendeeId forms. A profile
  report is only for a profile the reporter can see now, or a member they've
  blocked (anything else is the unknown-id 404, so a report can't probe for a
  hidden profile); one open report per reporter and member (another is a 200
  with the open one, using no allowance). It copies the display name, bio,
  handle and photo into the report (kept like message copies, 2 years after
  resolution; the photo once per distinct image, `private.report_photos`).
- **Photos.** `PUT /profiles/me/avatar` takes the raw bytes: JPEG, PNG or WebP
  sniffed from the bytes (the declared type is ignored; SVG, GIF, HEIC and
  anything else are a 400), at most 5 MB, read as a stream and cut off past
  it (413). A header-only read then confirms libvips itself chose its JPEG,
  PNG or WebP loader, so a polyglot (an image signature followed by SVG, say)
  can't reach another decoder. sharp decodes it once (first frame only, at most 24 megapixels,
  refused from the header, so a small file can't claim a huge canvas),
  applies the EXIF orientation, crops to a 512 px square of raw sRGB pixels,
  and writes from those a 512 px WebP and a 96 px thumbnail with **no
  metadata at all** (no EXIF, GPS, camera, ICC or XMP). The upload itself is
  never stored. 20 uploads a day (429). At most 2 photos are decoded at once
  per server instance, 8 more wait, and past that it's a 503
  (`AVATAR_ENCODE_CONCURRENCY`).
  sharp is the version Next ships (declared in package.json), on Next's
  server-external list, so Vercel's file tracing includes its native binary.
- **Serving photos.** `GET /profiles/{profileId}/avatar[?size=thumb]` needs
  the bearer token (never public, so the browser fetches it and shows a blob
  URL), the same gate as the profile (404 otherwise), and admins (any
  profile, for moderation). Members are rate-limited (600 fetches per 10
  minutes, 304s included, then 429; `AVATAR_VIEW_RATE_LIMIT`). `private,
  no-cache` with an ETag: the browser may keep it, but every use is
  re-checked (a 304 only after the gate passes; a matching `If-None-Match`
  for a profile hidden or blocked since is the 404), so a block or a hidden
  profile applies at once. `Cross-Origin-Resource-Policy:
  same-origin`. URLs carry a version (`?v=`), and no photo shows initials.
- **Moderation.** Admins see `targetType`, the copies and `reportedProfileId`
  on reports, read any profile (`GET /admin/profiles/{profileId}`, with its
  moderation log) and remove a photo, bio or handle with a reason
  (`POST /admin/profiles/{profileId}/remove-content`), logged in
  `private.profile_moderation_log` (fields, admin, reason; never the
  content). Every admin read of a member's profile or photo, or a report's
  photo copy, is logged (`console.info`: the admin's account id and the
  opaque profile or report id, never the member's name, content or account
  id). Suspension (resolving a report with `suspend`) hides the profile
  and photo from everyone; a suspended member can't change their profile or
  upload a photo, and can always delete them.
- **Retention.** The photo, bio and handle are deleted with the profile
  (`DELETE /profiles/me`, or the account) and the photo alone with
  `DELETE /profiles/me/avatar`. Report copies follow the reports' retention;
  the moderation log goes 2 years after each entry or with the account.

**Privacy Policy wording needed before go-live** (owner to approve):

- That a member can choose to make a profile (display name, optional short
  bio, Instagram username and photo, and the upcoming events they've said
  they're going to) visible to other signed-in members with a verified email
  and a profile; that it's off unless they turn it on, and they can turn it
  off, change it or delete it at any time.
- That uploaded photos are re-encoded and all embedded information (camera
  details, location/GPS, date) is removed before storage, and that photos are
  only shown to signed-in members who can see the profile, never publicly.
- That blocking hides profiles both ways; that reports keep a copy of the
  reported profile content for moderation (deleted 2 years after the report
  is resolved); and that Sheltüh staff may remove a photo, bio or handle and
  keep a record of the removal (not the content) for up to 2 years.

### Accepted risks (member profiles)

- **Bios can carry links.** As organiser bios do (owner decision: "like the
  organiser bio"). Members only see them on profiles they opened; reports and
  admin removal are the control. Revisit if spam appears.
- **A visible member can be followed across events.** That's the point of a
  profile, and it's opt-in; hidden members stay per-event.
- **Images are decoded on the server.** Bounded: 5 MB, 24 megapixels, first
  frame, three sniffed formats, one decode per upload, 2 at once per
  instance, 20 a day per member, verified members only. A libvips
  vulnerability would still be reachable; keep sharp updated. A photo over
  24 megapixels (some phones' full-resolution mode) has to be downsized
  first.
- **A hidden profile can't be reported.** A member who hides their profile
  after someone saw it can't be reported by profile any more (unless the
  reporter blocked them); reports by conversation or attendee still work.
- **A screenshot outlives a block.** Nothing can stop a member keeping a copy
  of a photo they once saw.

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
- Favourites are **counted only as an aggregate input to the trending
  score** (owner decision, 21 Oct 2026): how many favourites an event gained
  each day goes into its score with views, opt-ins and orders, and only the
  final score is kept. No per-event or per-person favourite count is stored,
  shown or exported, to the public, organisers or admins (see "Trending").

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

**Ticket-link clicks** (external events, `POST /api/events/{id}/outbound`,
public): the "Get tickets on …" link's click beacon, counted exactly like a
view (same bot, prefetch, `Content-Type` and `Sec-Fetch-Site` rules; 204
whether counted or not, 404 only for an event that isn't a published external
one) into `event_outbound_clicks`, with its own cap of 300 a minute per event
(`OUTBOUND_RATE_LIMIT`). The body is never read: a declared `Content-Length`
over 1 KB isn't counted. A capped day is flagged (`unreliable`). The event
report has `outboundClicks` (`{total, unreliable, byDay[{date, clicks,
unreliable}], previous?}`; null for a Sheltüh-ticketed event) and
`event.ticketingMode`; the overview has each external event's
`outboundClicks` (`{total, unreliable, previous?}`) and `ticketingMode`, and
the organiser-wide `outboundClicks` (null with no external event). The CSVs
add a "Ticket link clicks" section for external events only. Sales of
external events happen elsewhere: their sales figures are zero.

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

**Followers**: the overview's `followerCount` is the exact number of members
following the organiser now (the public profile only shows it from 10).

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

## Trending

The home page's Trending section (`lib/server/handlers/trending.ts`,
`supabase/migrations/20261023000000_trending.sql` and
`20261023000200_trending_distinct.sql`, `lib/api/trending.ts`).
Computed in the database into a snapshot, which the public endpoint serves.

**Score** `S = R · P · B`, defined only in SQL (`private.trending_*`):

- **Daily utility**, per Melbourne day:
  `u = 6·ln(1+V) + 8F + 15G + 25Op + 10Of`. V: page views (`event_view_counts`,
  all sources), capped at 300 a day, and 0 on a day the view cap was reached
  (`event_view_cap_days`: a flood day counts no views at all). F: favourites
  added that day. G: Who's Going opt-ins that day, not counting suspended
  members. Op: `paid` orders with a price; Of: `paid` A$0 (free) orders.
  F, G, Op and Of are each capped at 50 a day. Pending, failed and refunded
  orders don't count.
- **People.** Each favourite, opt-in and order belongs to a person: a
  normalised email address (`private.email_key`: lower case, trimmed, no
  `+tag`, Gmail dots and googlemail.com folded) where there is one (the
  account's email for favourites and opt-ins, the buyer email for orders),
  else the account's user id. So a member's favourite and their guest
  checkout are one person. An order without a buyer email adds to the score
  but to nobody's count.
- **The organiser's own activity is left out**: favourites and opt-ins by
  the owner account, and anything by a person whose normalised email is the
  owner account's or the organiser's contact email (so `owner+promo@` and an
  account registered with the contact email don't count either). Activity
  from other accounts the organiser controls can't be told apart (see
  "Accepted risks").
- **Decay**: `R_raw = Σ u · 0.5^(age/3)` over the last 14 Melbourne days
  (age 0 is today, 13 the oldest): a 3-day half-life.
- **Shrinkage**: `R = (n·R_raw + 2·median) / (n + 2)`, where n is the
  number of distinct people who engaged (below) and the median is over the
  eligible events' `R_raw`. An event few people engaged with is pulled
  towards the typical score, so 3 lucky favourites don't top the list.
- **Start proximity** P: 1 when the event starts within 7 days (or has
  started), falling linearly to 0.3 at 60 days.
- **Admin boost** B: 0.5 to 2, default 1.

**Eligible**: published; organiser approved; not ended; starts within 60
days; its latest approval at least 6 hours old (time for a second look, and
a re-approved event waits again); not excluded by an admin; and at least 3
**different people** who engaged in the window (favourite, opt-in, or a
paid order, free ones included), after the exclusions (manager decision,
21 Oct 2026). One person favouriting, opting in and buying tickets is still
one person, so nobody can make an event trend alone. Views aren't
engagement (anyone can send them without an account). At most 2 events per
organiser (their best two), then the top 24. Ties (equal score): sooner
start, then id. Days are Melbourne days (`at time zone
'Australia/Melbourne'`), so the window's midnight follows daylight saving.
External events are eligible like any other (they gain only views and
favourites).

**Refresh**: Vercel Cron `GET /api/cron/trending` (`CRON_SECRET`, through
`lib/server/cron-auth.ts`) calls `private.refresh_trending()`. The project is
on Vercel's Hobby plan, which allows daily crons only, so `vercel.json` runs
it daily at 17:20 UTC (early morning in Melbourne). **On the Pro plan, make it
every 15 minutes** (`*/15 * * * *`). On Hobby, Supabase Cron can call
`select private.refresh_trending();` more often instead
(`docs/supabase-setup.md`). The public list works from a day-old snapshot:
the read-time checks below keep it correct, it only reacts more slowly.

**Public read** (`GET /api/events/trending`): the snapshot in rank order,
re-checked at read time (published, not ended, organiser approved, not
excluded), so an unpublished, ended, taken-down or excluded event drops out
straight away. With fewer than 3 left, `items` is `[]` (the home hides the
section). Each item is `{event, label, goingCount?}`, `event` in the feed's
public shape, and the label is:

- `going`, with `goingCount`, when Who's Going is open (enabled, not ended,
  Sheltüh-ticketed: never an external event) and at least 5 members are
  going (`TRENDING_GOING_THRESHOLD`; suspended members aren't counted, as
  on the event page);
- else `just-announced` when the event was first approved within 72 hours;
- else `popular`.

It never carries a score, rank number, view count or favourite count. It's
not personalised, so the CDN caches it (`public, max-age=0, s-maxage=300,
stale-while-revalidate=600`); error responses stay `private, no-store`.

**Curation** (`PUT /api/admin/events/{id}/curation {boost, excluded,
reason}`, admin, any status): `set_event_curation` stores it in
`private.event_curation` and logs `curated` with the admin, the reason and
the old and new values. A boost applies at the next refresh; an exclusion
hides the event from the public list at once. `curated` entries are
editorial: they're left out of the event's `moderationLog` (which the
organiser sees), and admins read them, newest 20, from
`GET /api/admin/events/{id}/curation`.

**Privacy.** Favourites are an aggregate input only (owner decision, 21 Oct
2026): the refresh counts them per event and day, inside the database,
and keeps only the final score. No favourite count, per event or per
person, is stored, shown or exported, to anyone (the snapshot holds rank,
event, score and time; admins see no breakdown). The public label shows a
going count only at 5 or more, above the event page's own threshold of 3.

**Privacy Policy wording needed before go-live** (owner to approve):

- That the events a member saves (favourites), whether they've said they're
  going (Who's Going), and ticket orders are used, combined and counted
  together with other members' activity, to rank events in a "Trending"
  list; that this ranking never shows who did what or how many people saved
  an event; and that page views are counted without cookies or any
  identifier.
- That organisers' own activity on their events is excluded, and that
  Sheltüh staff can boost or remove events from Trending at their
  discretion (editorial curation), so the list isn't purely algorithmic.

### Accepted risks (trending)

- **Gaming with fake accounts.** Favourites need only a signed-in account
  (no verified email), and views need nothing. A ring of accounts can lift
  an event. Bounded, not prevented: views are logarithmic and capped at 300
  a day (and a flood day counts none), each other signal is capped at 50 a
  day, the score decays in days, shrinkage damps small numbers, at most 2
  events per organiser rank, and admins can exclude an event at once.
  Orders cost money (or a confirmed free booking under the free-ticket
  caps). Counting distinct people makes one account (or one address, with
  its `+tag` and Gmail-dot variants) count once, but three throwaway
  accounts or addresses on different domains are still three people. The
  owner exclusion only covers the organiser's own account and contact
  email (normalised).
- **Staleness.** On Hobby, scores change once a day; read-time checks still
  drop events that end, are unpublished, are taken down or are excluded,
  and labels (going count, just announced) are worked out at read time.
- **CDN window.** A change can take up to 5 minutes (plus the
  stale-while-revalidate window) to show to visitors.
- **Concurrency** of two refreshes is serialised by an advisory lock; the
  tests run refreshes sequentially (PGlite has one connection), so run the
  suite on a real Postgres before go-live.

## Check-in

Door check-in for an organiser's own events, and by admins for
platform-managed organisers' events (`lib/server/handlers/check-ins.ts`,
`supabase/migrations/20261021000000_ticket_check_in.sql`,
`20261021130000_check_in_followups.sql` and
`20261023000100_review_hardening.sql`, `lib/ticket-code.ts`), with the door
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
  code is check-in, which needs the organiser's login (or an admin's, for a
  platform-managed organiser's event), only ever covers that organiser's
  events, and is rate-limited.
- **External events** have no Sheltüh tickets: a scan, an undo and the
  summary are a 409 for the owning organiser, or an admin for a
  platform-managed organiser's event (anyone else still gets 404).
  A scan isn't preceded by a read of the event: the `ticket_check_ins_guard`
  trigger refuses the log row, so the whole call rolls back (nothing logged,
  no allowance used) and the API answers 409. An undo reads the event only
  after `undo_check_in` found nothing (it has taken one allowance hit by
  then).
- **Who.** The approved organiser who owns the event (`requireApprovedOrganiser`;
  ownership is checked again inside `check_in_ticket`), and admins for events
  of platform-managed organisers (no owner account; owner decision, 21 Oct
  2026, `docs/FEATURE_PLAN.md`), whatever that organiser's status. Anyone
  else's event is a 404, an admin's included (an organiser's event, or one
  that doesn't exist); a non-admin without an approved organiser a 403;
  signed out a 401. An admin who also owns an organiser checks in for its
  events as usual. For an admin, the API reads the event first and passes
  the platform-managed organiser to `check_in_ticket` / `undo_check_in`, so
  the same atomic step, idempotency, per-account rate limit (the admin's)
  and log apply, with the admin as the acting account. The database enforces
  the split whatever the API does: `ticket_check_ins_guard` refuses a
  check-in row for a platform-managed organiser's event unless its actor is
  an admin (`auth.users.raw_app_meta_data ->> 'role'`, the `app_metadata`
  the API reads), and one by an admin who isn't the owner for an organiser's
  event (`ticket_check_ins_actor_allowed`; the API answers 404, nothing
  logged or counted). The door page lets an admin straight through to the
  console; the API decides. A per-event staff table (scanner or supervisor)
  is the planned way to add door staff.
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
  reason, whether an admission can still be undone, and, for a seated
  ticket of this event, its seat: `seat {section, row, seat, kind}`, absent
  otherwise, including for `other_event` entries and once a refund has
  freed the seat).
- **Privacy.** A scan shows no buyer identity: no name, email or order id,
  anywhere in check-in. The log stores the event, ticket code (never the
  text of an invalid scan), acting account, result, an undo's reason and the
  time, and responses show only codes' last four characters. Every response
  is `private, no-store`. Deleted 25 months after the event ends
  (`purge_analytics`).

### Accepted limits (check-in)

- **One shared organiser login.** Everyone on the door signs in as the
  organiser (or, for a platform-managed organiser's event, as an admin), so
  the log can't tell door staff sharing a login apart, and they share one
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

## External ticketing

Events whose tickets are sold on another site, which Sheltüh lists and links
to (`lib/ticketing.ts`, `lib/server/event-input.ts`,
`supabase/migrations/20261022000000_external_ticketing.sql`).

- **Modes.** `ticketing_mode` is `sheltuh` (tickets sold here; the default,
  and what a request without the field gets) or `external`. An external
  event has a ticket link (`external_ticket_url`), an optional "free entry"
  flag (`external_free`), and no ticket types, orders, booking fee, Who's
  Going or check-in. The database enforces it: check constraints tie the
  mode to the link and flag, and triggers refuse a ticket type or an order
  for an external event, and switching to external while ticket types
  exist. Checkout is a 409 before anything else (and an order racing an
  admin's switch is refused by the trigger, which share-locks the event row:
  also a 409). Who's Going reads as closed and `set_going` refuses it.
  Check-in, undo and the check-in summary are a 409 for the owner.
- **The link's rules** (`checkExternalTicketUrl`, and the
  `events_external_ticket_url_valid` trigger over the stored form, run when a
  link is inserted or changed): typed with
  `https://`; at most 2048 characters; no username or password; no IP
  address (any IPv4 form the parser accepts, or IPv6; the database also
  refuses any host whose last label is all digits or starts with `0x`, the
  forms a parser reads as IPv4, such as `0x7f.1`); no port, not even
  `:443`; a plain DNS host (letters, digits and hyphens, at least two
  labels, no trailing dot); not localhost or another non-public name
  (`.local`, `.internal`, `.localdomain`, `home.arpa`, `.lan`, `.test`,
  `.invalid`, `.example`, `.onion`); not a link shortener or link-in-bio
  redirector (`bit.ly`, `tinyurl.com`, `t.co`, `goo.gl`, `ow.ly`, `buff.ly`,
  `rebrand.ly`, `is.gd`, `cutt.ly`, `shorturl.at`, `lnkd.in`, `j.mp`,
  `linktr.ee`, `lnk.to`, `ffm.to`, `smarturl.it` and others, with their
  subdomains: `LINK_SHORTENER_HOSTS`); none of `URL_DISALLOWED` (whitespace, control and invisible
  characters, backslashes). It's stored as the URL parser writes it: host
  lower case, an international name in punycode (so a lookalike shows as
  `xn--…` to the reviewing admin), non-ASCII percent-encoded; the database
  accepts only printable ASCII. The server never fetches the link, so a
  host that resolves to a private address is no SSRF risk.
- **Tightening the rules later.** The database checks a link only when it's
  written (a trigger, not a check constraint, which Postgres re-evaluates on
  every update of the row), so an event holding a link that a later rule
  refuses can still be unpublished, taken down or edited otherwise. Such a
  migration should list those events (`20261023000100_review_hardening.sql`
  stops, naming them). Runbook: replace the link with
  `PATCH /admin/events/{id}/ticketing`, or unpublish the event
  (`docs/supabase-setup.md`, "A ticket link refused after a rule change").
- **Provider name.** `externalProvider` is a known ticketing site's name
  (`KNOWN_TICKETING_HOSTS`: Humanitix, Eventbrite, TryBooking, Moshtix,
  Oztix, Ticketek, Ticketmaster, DICE, Resident Advisor, Luma, Peatix; host
  or subdomain) or null, which the UI shows as "the organiser's site", never
  the bare host (owner decision). Punycode hosts are always null.
- **Pricing.** No price is shown or known for an external event. For the
  feed's filters, `external_free` counts as free (`is_free` follows it) and
  an external event is never `paid`. The browser-side "under A$X" filters
  (`lib/scene-map-filters.ts`, the home's low-cost rail) see no ticket types,
  so no external event matches them, free ones included (price unknown;
  revisit in F1/F3 if free external events should count as "under").
- **Review, then frozen.** The admin review queue (`GET /admin/events`)
  shows the link, the provider name and `ticketingLocked`. Once an event has
  been approved (an `approved` moderation log entry), the organiser can no
  longer change its mode or link, even after it's unpublished
  (`edit_event_draft` → `ticketing_frozen`, 409 with fieldErrors);
  everything else, `externalFree` included, stays editable on a draft and is
  reviewed again on resubmission. An edit that leaves `ticketingMode` out
  keeps the stored ticketing (mode, and link and free flag unless sent), so
  an older client never converts an external event or trips the freeze; it
  can't send ticket types for one (400). Switching mode is always explicit.
  Only an admin can change them:
  `PATCH /admin/events/{id}/ticketing`, any status, logged as
  `ticketing_changed` with the admin, the reason, and in `details` the old
  and new value of each changed field. The log keeps **full links**, not
  just hosts: they're public event data, not personal data, and an audit of
  a swapped link needs the exact address. The organiser sees their own
  event's log; the public never does.
- **Outbound clicks**: see "Organiser analytics".

### Accepted risks (external ticketing)

- **The page behind an approved link can change.** The freeze stops the
  link being edited on Sheltüh, not what the other site serves, and an open
  redirect on an allowed domain could still forward buyers elsewhere.
  Shorteners are refused for that reason; other redirectors aren't
  detected. Admins should check the link at review; a bad one is fixed with
  the admin PATCH, or the event unpublished.
- **The shortener list is only a speed bump.** Any domain an organiser
  controls (their own site, a page on a link-in-bio service not on the list)
  can be re-pointed after approval just as a shortener can, and new
  shorteners appear all the time. Admin review, and unpublishing when a link
  goes bad, are the real control.
- **Any public site is allowed.** Not just the known ticketing sites:
  organisers often sell on their own site. Phishing is mitigated by admin
  review, punycode display and the freeze, not prevented. The UI should open
  the link with `rel="noopener"` (and say where it goes: "Get tickets on
  {provider}" / "the organiser's site").
- **`externalFree` is the organiser's word.** It isn't verified, and it puts
  the event under `pricing=free`. Reviewed at approval; editable afterwards
  on a draft, which is reviewed again before it's republished.
- **Click counts are indicative**, like views: no uniques, inflatable below
  the 300-a-minute cap, and a flood above it loses that minute's real clicks
  (the day is flagged). Nothing is paid on them.
- **An admin switching an external event back to Sheltüh ticketing** leaves
  it published with no ticket types (listed, neither free nor paid, not on
  sale). The organiser can add ticket types only after an unpublish.
  Switching the other way is refused while the event has any order.
- **Switching back to Sheltüh ticketing hides the event's click history in
  its own report.** The per-event report's `outboundClicks` is null for a
  Sheltüh-ticketed event, so clicks counted while it was external aren't
  shown there any more (they're kept, and still count in the overview's
  organiser-wide totals until the 25-month purge).
- **Concurrency is enforced in the database** (row locks in
  `edit_event_draft` and `admin_set_event_ticketing`, the share lock in the
  orders trigger), but the tests exercise the race only sequentially (a
  stale read, then the switch, then the order); run the suite on a real
  Postgres before go-live.

## Admin authoring

Admins create events themselves, for any organiser
(`lib/server/handlers/admin-authoring.ts`,
`supabase/migrations/20261022000100_admin_event_authoring.sql`; UI at
`/admin/events/new` and `/admin/events/[eventId]/edit`, the organiser's
`EventEditor` with `mode="admin"`).

- **Platform-managed organisers** (`POST /admin/organisers`): no owner
  account, approved straight away with the admin as reviewer. The fields and
  rules are an organiser application's (same parser); the contact email
  should be a Sheltüh alias (`docs/supabase-setup.md`). Their profile is public
  like any approved organiser's. Nobody can edit them through the API yet.
- **What they can't do.** No paid Sheltüh tickets: only free ones, or
  external ticketing. Enforced by the database whatever the code does: a
  ticket type with a price (`ticket_types_platform_free_only`), an order with
  a price (`orders_platform_free_only`), a Stripe account or payouts
  (`organisers_platform_no_payouts`), moving an event with paid ticket types
  to such an organiser or removing an organiser's owner while it has some
  (`events_platform_free_only`, `organisers_platform_free_only`). The API
  refuses first: 400 with `fieldErrors.ticketTypes` on admin create and edit,
  and checkout is a 409 for a paid line. Check-in is by admins only, there
  being no owner to sign in (see "Check-in"); the admin editor
  (`AdminEditEvent`) links such an event, when Sheltüh-ticketed, to its door
  check-in, `/dashboard/{eventId}/check-in`. Paid ticket types stored before
  the migration (dev seed data) are left, but checkout refuses them and they
  can't be saved again with a price; `npm run seed-dev-data` now skips the
  paid sample events.
- **Creating** (`POST /admin/events`): the organiser's event body and rules
  (`parseEventInput`, external ticketing included), plus `organiserId` (any
  approved organiser) and optional `publish`. Logged `created` by the admin;
  `publish: true` also publishes it in the same transaction through
  `transition_event` (`approved`, so its ticketing is then frozen for the
  organiser, as after a review). An organiser's own events list shows events
  an admin created for them, and they can edit them while they're drafts.
- **Editing** (`PATCH /admin/events/{id}`): the whole event, any status
  (published events change live), with `ticketingMode` required (as on
  `PATCH …/ticketing`) and `expectedUpdatedAt`, the `updatedAt` the admin
  loaded. Optimistic concurrency: the event row is locked and its
  `updated_at` compared to the millisecond; a different version (another
  admin, the organiser, a ticketing change) is a 409 with
  `fieldErrors.expectedUpdatedAt`, and nothing is saved. The editor then says
  so and offers to reload (discarding what was typed). Ticketing changes go
  through `admin_set_event_ticketing` (logged `ticketing_changed`, same
  `has_orders` rule; `PATCH …/ticketing` is unchanged and still works); a
  change of mode or link on an event approved before needs a `reason`
  (400 otherwise), like that endpoint. Every other changed field goes in one
  `edited` entry (`changes`: old and new values; dates as ISO instants with
  an offset, ticket types as the whole list before and after), with the
  optional `reason`. Removing a sold ticket type or cutting it below what's
  sold is a 409, as for organisers. `publish: true` publishes a draft,
  pending or rejected event in the same step (409 if the organiser isn't
  approved); unpublishing stays `POST …/unpublish`. The event's organiser
  can't be changed. Saving nothing new is a 200 with nothing logged.
- **Photos** (`PUT` / `DELETE /admin/events/{id}/image`): the organiser
  upload's rules (2 MB, JPEG/PNG/WebP sniffed from the bytes), any status,
  logged `edited` with `changes.image`. Any photo change (the organiser's
  too) bumps the event's `updatedAt` in the same transaction, so a PATCH made
  from a version loaded before it is stale (409): an admin can't publish a
  photo they haven't seen. The photo routes answer with the event, and the
  editor takes its next `expectedUpdatedAt` from that answer.
- **Audit.** `created`, `edited` and `ticketing_changed` entries carry the
  admin's user id, which admin routes show; the event's organiser sees the
  entries in their event's `moderationLog` with `by: "Sheltüh team"` instead
  (an admin's account id isn't theirs to know; the public never sees the
  log). `curated` entries (trending
  curation, see "Trending") are the exception: only admins see them.
- **Responses** are `AdminEventRecord`: an `EventRecord` plus
  `organiserPlatformManaged`.

### Accepted limits (admin authoring)

- **Millisecond versions.** `updatedAt` is sent to the millisecond, so two
  saves whose transactions start within the same millisecond, the second
  made from the first's version, can't be told apart. Not a practical risk
  for human edits.
- **Photo writes aren't checked against a version.** A photo change makes
  any edit from an earlier version stale, but the photo upload itself takes
  no `expectedUpdatedAt`: two photo changes at once, last write wins (each
  logged for admins).
- **Admin edits to a published event aren't reviewed again.** The admin is
  the reviewer; the `edited` entry is the record.

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
- **Featured video.** One YouTube or Vimeo video, given as a pasted link
  (`featuredVideoUrl`) on the application (reviewed with it) or an approved
  organiser's profile edit (no review, logged with old and new value, like
  the bio). Only exactly `youtube.com/watch?v={id}` (also `www.`, `m.`),
  `youtu.be/{id}`, `youtube.com/shorts/{id}` (11 characters of
  `[A-Za-z0-9_-]`) and `vimeo.com/{digits}` (1–12) are accepted, with http(s)
  or no scheme, no credentials or port (`lib/api/featured-video.ts`; anything
  else is a 400 on `featuredVideoUrl`). Only the provider and id are stored
  (a check constraint repeats the rules); the page builds the
  privacy-enhanced player (`youtube-nocookie.com`, Vimeo `dnt=1`) and loads it
  only when the visitor presses play. Admins remove it with a reason
  (`POST /admin/organisers/{id}/remove-video`), logged as a `profile_edit` by
  the Sheltüh team (`byStaff`).
- **Public profile** (`GET /organisers/{id}/profile`): only approved
  organisers. Only `organiserId`, `displayName`, `description`,
  `categories`, `websiteUrl`, `socialLinks`, `memberSince` (Melbourne
  `YYYY-MM` of the application), `featuredVideo` (`{provider, id}` or null),
  `followerCount` (only from 10 followers, else null: see "Following
  organisers"), `eventsHosted` (published events that have ended) and their
  published events in the feed's public shape: `upcomingEvents` (not yet ended, soonest first), then
  `recentEvents` (ended, most recent first), 24 in all. The organiser query
  reads no private column (contact email, owner, Stripe, payouts, review). Not
  personalised, so it's sent without `private, no-store`, like the event feed.
  Like the other public reads, it isn't rate-limited (no IPs or cookies):
  each request is three indexed queries and a bounded response.

## Following organisers

Members follow organisers (owner request, 21 Oct 2026;
`lib/server/handlers/follows.ts`, `lib/server/follower-email.ts`,
`supabase/migrations/20261024000200_organiser_follows.sql`, `lib/api/follows.ts`).

- **Following** (`POST /organisers/{id}/follow {notifyNewEvents?}`):
  signed-in members with a verified email, approved organisers only (404),
  not their own (400). `notifyNewEvents` must be a boolean if sent (null or
  anything else is a 400); a new follow's emails are off unless it's `true`.
  Idempotent (201 new, 200 again; sending `notifyNewEvents` again changes
  it, leaving it out keeps the choice). At most 500 follows per account (409)
  and 60 new follows an hour (429). `DELETE` unfollows (204, idempotent,
  whatever the organiser's state). Keyed on the account, like favourites.
- **Who sees what.** Nobody sees who follows whom. The public profile shows
  `followerCount` only from 10 (`FOLLOWER_COUNT_THRESHOLD`; null below, as
  Who's Going hides small counts); the organiser's analytics overview shows
  the exact `followerCount`.
- **The home rail**: `GET /me/following/events` (published, upcoming events of
  followed approved organisers, soonest first, paginated, public event
  shape); `GET /me/following` lists the organisers (taken-down ones drop out;
  the follow is kept).
- **New-event emails.** Chosen when following (off unless chosen), and only
  to an account whose email Supabase Auth has confirmed
  (`email_confirmed_at`: checked when queueing and again when sending). When an event is
  published for the first time (an approval, an admin's create or edit, any
  path: a deferred constraint trigger, `notify_followers`), each follower
  with emails on gets one `organiser_new_events` outbox job, at most one per
  organiser per 24 hours: a follower with an email already waiting gets the
  new event in it, and one emailed in the last 24 hours gets the next 24
  hours after it. The email ("New from {organiser}", Brand Direction One) is
  built when it's sent, listing every event announced since their last that's
  still published and upcoming (at most 6, then "and N more"); none left, it's
  skipped. Publishing an event again (after an unpublish) emails nobody.
  At most 500 queued a day platform-wide (shared SMTP quota). Sent straight
  after the publishing response (`sendPublishEmailsSoon`, sharing the 30-second
  budget with the waitlist's) and by the outbox cron.
- **Unsubscribing.** Every email has its own link,
  `/following/unsubscribe#token=…` (a page that POSTs the fragment's token on a
  button press, `POST /follows/unsubscribe`), also sent as `List-Unsubscribe`.
  It turns that organiser's emails off and keeps the follow. Only the token's
  SHA-256 hash is stored; links work for 90 days (Spam Act 2003: at least 30),
  or until unfollowing.
- **Retention.** Follows go with the account or the organiser; tokens with the
  follow or after 90 days; queued emails with the follow.

**Privacy Policy wording needed before go-live** (owner to approve):

- That members can follow organisers; that organisers see only how many
  people follow them (the public sees the number from 10), never who.
- That followers who choose to are emailed when an organiser they follow
  publishes new events (at most one email a day per organiser), and every
  email has a link to stop them.

### Accepted risks (follows)

- **Counts can be inflated** with verified throwaway accounts (60 an hour
  each). It's a display number only; nothing is paid on it.
- **Not everyone is told** past 500 emails a day platform-wide; the rest see
  the event on their home rail. A skipped email (event unpublished first)
  still counts as that day's email.
- **One-click unsubscribe (RFC 8058)** isn't offered (the link is a page);
  Gmail and Yahoo require it only from 5,000 messages a day.
- **Concurrency** (the cap, two publishes at once) is enforced in the
  database (advisory locks per account and per organiser, the unique active
  job per follow); run the suite on a real Postgres before go-live.

## Reserved seating

Optional seat maps for concert-style events (owner request, 21 Oct 2026;
`docs/SEATING_PLAN.md`, design `docs/design/seating.md`;
`supabase/migrations/20261101000000_reserved_seating.sql` and
`20261101000100_seat_holds.sql`; `lib/server/handlers/seating.ts`, the seated
branch of `lib/server/handlers/orders.ts`, `lib/seating/*`, `lib/api/seating.ts`).
General admission stays the default: its payloads and code paths are
unchanged.

- **The map.** Sections → rows → seats (`lib/seating/template.ts`, the one
  validator, run by the editor and the API): SVG user units (a seat is 24u),
  stage, focus point ("best seats" face it; never shown to buyers), section
  label anchors and row ends (filled in when left out), seat id (client-chosen,
  `[A-Za-z0-9_-]{1,40}`, unique), labels (section 1–40 characters, row 0–10,
  seat 1–10: letters, digits, spaces and `- ' ’ . & / ( ) # +`, NFC, no
  control or invisible characters), rotation, tier (one of the event's ticket
  types), kind (standard, wheelchair, companion), blocked. At most 10,000
  seats and 5 tiers (the database checks both). Bodies up to 1 MB.
- **Tiers.** Seats point at the event's ticket types, so fees, all-inclusive
  prices, orders, analytics, refunds and the waitlist keep working on ticket
  types. A tier with seats is `seated`: its capacity is its unblocked seats
  (a trigger, whatever is written; edits' quantities for it are replaced by
  the stored one), it carries `seated: true` in payloads, and it's sold only
  with seats (`fulfil_order` refuses an order whose seated lines don't match
  its seats). A mixed event's other tiers are general admission, bought as
  quantities beside the seats; they don't count towards the 10 seats.
- **Who changes it.** The organiser, while the event is a draft (or
  rejected) that has never been approved: the map freezes at first approval,
  like the ticketing (and never once it has orders: the database functions
  refuse, whoever calls them). After that, admins only, any status, only while the
  event has no orders of any status (a pending order may hold seats), with a
  reason, logged `edited` with `changes.seatMap` (the organiser sees "Sheltüh
  team"). A map change bumps the event's `updatedAt`. Switching to external
  ticketing removes the map; a tier with seats can't be removed (409).
- **Public reads.** `GET …/seat-map?v={version}` is cached for a year at the
  current version (a new map is a new version: versions come from a sequence
  and are never reused); any other `v`, or none, is a `307` to
  `?v={current}` with `Cache-Control: no-store`, answered without reading
  the layout, so the full body is only ever served (and read) at the
  cacheable URL, and a guessed future version can't be cached with today's
  map. Before publishing, the owner and admins get the map at any `v`,
  never cached. `GET …/seat-availability`
  is a bitmap by seat position (`lib/seating/availability.ts`): sold, held and
  blocked are one state (decision 3), cached 5 seconds at the CDN; the seat
  page polls it every 10 seconds while visible. Before publishing, both are
  the owner's and admins' only (404 otherwise). `PublicEvent.seating` is
  `{version}` for a seated event and absent otherwise.
- **Holds.** Made when the buyer presses Checkout, in the same transaction as
  the pending order (`hold_seats`), all or nothing, for 35 minutes; Stripe's
  page expires after 31 (its minimum is 30, and buyers are told 30). They
  expire lazily (no cron: an expired hold is simply free) and are released at
  once on a Stripe error at checkout, the buyer cancelling (Stripe's
  `cancel_url` is `/checkout/cancelled?order={orderId}`, whose page calls
  `POST /orders/by-session/{id}/cancel`: the session is expired first, so it
  can't be paid afterwards), `checkout.session.expired` and
  `async_payment_failed`. Anti-hoarding (decision 5), per event: 120 holds
  per 10 minutes (`take_event_rate_limit`, bucket `seat_holds`), and at most
  the larger of 20 seats or 30% of the unblocked seats held at once; either
  is a 429 with the seats asked for. Every refusal (the cap, taken seats, a
  changed map) is decided before the counter and writes nothing, so only
  real holds count: refused attempts can't use up the allowance and lock
  buyers out.
  An event that has ended takes no hold (409 "This event has ended.", before
  the client's allowance is touched; `orders_not_ended` refuses the order in
  `hold_seats` too), but seats held before the end and paid for after it
  are still sold (see "Payment flow").
- **Per-client hold limit** (a manager decision;
  `20261103000000_seat_hold_client_limits.sql`, `lib/server/client-key.ts`,
  `SEAT_HOLD_LIMITS.perClient`). Before `hold_seats`, every paid seated
  checkout takes one attempt from its client's allowance
  (`take_seat_hold_attempt`): 20 per event and 60 across all events per 10
  minutes (fixed windows). Over either is a 429 `client_rate_limited` with
  the seats asked for ("You've started a lot of checkouts…"), and nothing
  else is written. Unlike the event's counter, every attempt that reaches
  `hold_seats` counts, refused or not: this is the bound on refused attempts
  per client. Attempts turned away before it (a seat visibly taken, a
  changed map, bad input), general admission and free seats don't count.
  Why these numbers: a buyer whose seats keep going retries a handful of
  times, so 20 leaves room for them and for a few buyers sharing one
  address (venue wifi, a phone network's shared address), while one client
  now needs at least six addresses to use up an event's 120; 60 bounds a
  client working through many events. The client is its IP address as
  Vercel reports it: the first hop of `x-forwarded-for` (Vercel overwrites
  that header, so it can't be spoofed there), else `x-real-ip`; an IPv6
  address counts by its /64, an IPv4-mapped one as IPv4. Only a keyed
  SHA-256 is stored (`client_rate_limits`), never the address; the salt is
  derived (HMAC, labelled `sheltuh/client-key/v1`) from
  `STRIPE_WEBHOOK_SECRET`, which paid checkout needs anyway, so there's no
  new environment variable, and rotating that secret only restarts the
  counters. It fails open, with a log line that carries no request detail,
  when there's no usable IP header (never on Vercel) or the secret isn't set.
- **Back from Stripe.** A paid checkout's 201 (seated `{url,
  holdExpiresAt, orderId}`, general admission `{url, orderId}`, both
  `private, no-store`) carries the pending order's id, so the page can keep
  it for the session and call `POST /orders/by-session/{orderId}/cancel`
  when the buyer comes back without paying. That adds no exposure: the id
  goes only to the client that made the order, which already gets it in
  Stripe's success and cancel URLs, and the cancel route's model is
  unchanged: the id (`ord_` + 32 hex, 128 random bits) is the credential
  (anything else shaped differently is a 404 without a query), a paid order
  is never changed (`paid`), Stripe already holding the payment is
  `processing`, a guest's free booking is a 404, and the Stripe session is
  expired before anything is released, so nothing can be paid for seats
  that are no longer held. A general admission order cancelled this way is
  simply `failed` (it held nothing).
- **Payment.** `fulfil_order` sells the seats (free, held by the order, or an
  expired hold nobody took) with the inventory and gives each ticket a seat of
  its tier. A seat that went elsewhere (a late async payment after its hold
  lapsed) is the oversold path: refunded, as for a sell-out.
- **Refunds.** A full refund (`charge.refunded`) frees the order's seats: its
  tickets' seat is cleared (the order's `seat_ids` keeps the history), the
  tiers' `quantity_sold` goes down, so the waitlist is told as for any freed
  tickets. A partial refund frees nothing.
- **Free seats.** A member booking with their own verified email gets the
  seats at once (`place_free_seated_order`, through `fulfil_order`). A guest's
  booking holds nothing until the emailed link is confirmed (decision 7); if
  a seat went meanwhile, confirmation is a 409 `seats_taken` naming the seats
  (with the event's slug), and nothing is issued. The usual free-ticket caps
  apply (4 per order).
- **Seats downstream.** `CustomerOrder.tickets[].seat`, the ticket email
  ("Stalls · Row F · Seat 12", plain text "Seat: Stalls, Row F, Seat 12";
  `lib/seating/format.ts`), the free confirmation email (the chosen seats, and
  that they're held only once confirmed) and check-in (`ticket.seat`) carry
  `{section, row, seat, kind}`, and so do the door's Recent scans
  (`CheckInLogEntry.seat`, for this event's seated tickets only).
- **Lock order**, everywhere: the event's seat advisory lock
  (`lock_event_seats`), the order, the event, ticket types in id order, seats
  in id order. Seated paths read the order's event (immutable) without a lock
  to take the advisory lock before the order row. `edit_event_draft` and
  `admin_set_event_ticketing` lock the event row and never take the advisory
  lock (holds share-lock the event row before any seat, so that excludes
  them). General admission orders never take it.
- **Tests**: `tests/seating/*` (template, bitmap, wording),
  `tests/server/seat-maps.test.ts`, `tests/server/seated-checkout.test.ts`,
  and `tests/server/seating-races.test.ts` (overlapping holds, opposite
  orders, a lapsed hold's payment against a new hold, refund against hold,
  free member against paid hold, the cap, a flood of cap refusals using no
  allowance, duplicate webhooks), which runs only
  on a real Postgres (`TEST_DATABASE_URL`).
  `tests/server/seat-hold-client-limits.test.ts` covers the per-client limit
  (client IP parsing, the keyed hash, both buckets, windows, fail-open; its
  concurrency cases need `TEST_DATABASE_URL`), and
  `tests/server/email-subjects.test.ts` every email's subject cleaning.

### Accepted risks (reserved seating)

- **A busy on-sale hits the hold limits.** 120 holds per 10 minutes is per
  event and shared by every buyer: a popular on-sale gets 429s ("a lot of
  people are checking out") until the window passes. That's the anti-hoarding
  decision; raise `SEAT_HOLD_LIMITS` if it bites. Refused attempts no longer
  count, so the window is only used up by real holds (each one also bounded
  by the held-seat cap); a hoarder holding up to the cap can still keep
  others to the seats left, for 35 minutes at a time.
- **Refused hold attempts aren't rate-limited per event.** A flood of
  attempts that will be refused (at the cap, or for taken seats) writes
  nothing to the event, but each briefly takes the event's seat lock (the
  API's early checks turn most taken-seat attempts away before it). Each
  client gets 20 such attempts per event per 10 minutes; a client with many
  addresses (a botnet, or rotating IPv6 /64s) isn't bounded beyond that. A
  bot check on holds (Turnstile, "Not built yet") is the next step if it's
  abused.
- **Shared addresses share the per-client limit.** People behind one
  address (venue or campus wifi, a phone network's shared IPv4 address) get
  20 hold attempts per event between them per 10 minutes. Small Melbourne
  on-sales shouldn't come near it; raise `SEAT_HOLD_LIMITS.perClient` if
  one does. It fails open without an IP header (logged), which only happens
  off Vercel; if the app is ever hosted behind a proxy that appends to
  `x-forwarded-for`, `clientIp` must change, since the first hop would then
  be the client's to choose.
- **Free seated bookings are capped at 4 seats** by the per-order free-ticket
  cap, though paid orders can take 10.
- **A cached map outlives an unpublish.** The public map URL is cached for a
  year; it's only a layout (no sales, no personal data).
- **Availability can be 5 seconds old**, plus the 10-second poll: a seat can
  look free and be refused at Checkout (409, the page removes it).
- **Late async payments.** A delayed payment method completing after its
  35-minute hold has lapsed gets its seats only if nobody took them;
  otherwise it's refunded automatically.

## API

All routes are JSON under `/api`. "Organiser" means a signed-in user whose
application is approved.

| Method & path | Who |
|---|---|
| `GET /events?q&category&pricing&onOrAfter&upcoming&cursor&limit` | public (published only), soonest first. `upcoming=1` (or `true`): only events that haven't ended (`ends_at > now()`, in progress included); the home page and /events always send it. `pricing=free`: has ticket types, all free, or is external with `externalFree`; `paid`: has a paid ticket type (an event with no ticket types is neither, and so is an external event that isn't free: its price isn't known). 400 for an unknown `category`, `pricing` or `upcoming` value. Every item carries `ticketingMode`, `externalFree`, `externalProvider` and, for external events only, `externalTicketUrl` (see "External ticketing") |
| `GET /events/slug/{slug}` | public (published only); same shape as a list item. Every public event (list, slug, favourites, organiser profile, trending) carries `soldOut`, and per ticket type `soldOut` and `remaining` (only when 10 or fewer are left): see "Waitlist" |
| `GET /events/{slug}/calendar.ics` (a page route, not under `/api`: `app/events/[slug]/calendar.ics/route.ts`) | public (published only; demo mode: the sample events). The event as an iCalendar file (`lib/calendar.ts` `buildIcs`, its URL from `NEXT_PUBLIC_SITE_URL`), `text/calendar; charset=utf-8`, `Content-Disposition: inline`, `public, max-age=300`. 404 (JSON, `private, no-store`) otherwise. No personal data |
| `POST /events/{eventId}/waitlist` `{email?}` · `DELETE /events/{eventId}/waitlist` | POST: public (a member's token is read, optionally). 201/200 `{status: "joined", maskedEmail, alreadyJoined}` for a member's own verified email; 202 `{status: "confirmation_sent", expiresInHours}` for anyone else, whatever the address's history; 400 email; 404 not published; 409 external, ended or not sold out; 503 busy (the platform caps; the link is emailed after the response, so a failed send isn't reported). DELETE: signed in, leaves (204, idempotent) |
| `GET /events/{eventId}/waitlist/status` | signed in: `{joined, maskedEmail?}`; 404 not published |
| `POST /waitlist/confirm` `{token}` · `POST /waitlist/leave` `{token}` | public (the emailed token is the credential). Confirm: 200 `{status: "joined", eventTitle, eventSlug, ticketsAvailable}` (also when already on the list); 400; 404; 410 expired or used; 409 closed. Leave: 200 `{status: "left", eventTitle?}` (the title only while the event is published; idempotent); 400; 404 |
| `POST /events/{eventId}/checkout` | public (a member's token is read, optionally, for free orders). 409 for an external event, before anything else is read; 409 for a paid order from a platform-managed organiser. 201 `{url}` (a paid order: `{url, orderId}`, `private, no-store`; see "Reserved seating", "Back from Stripe"); 202 free order waiting on its emailed link; 400 (incl. over 4 free tickets in any order, paid or free); 404; 409 sold out or the person's free allowance for the event; 429 member's daily free allowance; 503 free bookings busy (the guest's link is emailed after the response). 409 for too many of a ticket type names the number left only when it's 10 or fewer |
| `POST /events/{eventId}/checkout` with `seats: {mapVersion, seatIds}` | public: a seated checkout (see "Reserved seating"). Paid: 201 `{url, holdExpiresAt, orderId}` (private, no-store). Free: as above (201 member, 202 guest). 400 (bad seats, over 10, a seated tier in `lineItems`, no map); 404; 409 `seats` taken (body `code`, `seatIds`) or `seatMapVersion` changed; 429 too many seats held or hold attempts for the event, or this client's hold attempts used up (`code: "client_rate_limited"`; body `seatIds`) |
| `GET /events/{eventId}/seat-map?v=` | public once published (`public, max-age=31536000, immutable`, only at the current `v`; any other `v` or none is a `307` to `?v={current}`, `no-store`, no body); before that the owning organiser or an admin (bearer), private. `SeatMapRecord`. 404 no map or not visible |
| `GET /events/{eventId}/seat-availability` | as above: `SeatAvailability` (the bitmap), `public, max-age=0, s-maxage=5` once published |
| `PUT /events/{eventId}/seat-map` `{template}` · `DELETE …` | organiser (own event, draft or rejected, never approved). Up to 1 MB. 200 `SeatMapRecord` / 204; 400 `fieldErrors["template.…"]`; 404; 409 not editable, locked, external or has orders |
| `PUT /admin/events/{eventId}/seat-map` `{template, reason}` · `DELETE …` `{reason}` | admin, any status, no orders. 200 `SeatMapRecord` / 204; 400; 404; 409 has orders (`fieldErrors.template`) or external |
| `POST /orders/by-session/{orderId}/cancel` | public (the order id is the credential; only the client that made the order gets it: the checkout's 201 and Stripe's URLs): expires the Stripe session, then cancels the order and releases its seats; a paid order is never changed. 200 `{status: "released" \| "paid" \| "processing", eventTitle, eventSlug?}`; 404; 409 still being set up |
| `POST /orders/confirm` `{token}` | public (the emailed token is the credential). 200 `{url}` (also when already confirmed, within 24 hours); 400 malformed; 404 unknown; 410 expired (confirmed or not); 409 sold out, allowance used, or a ticket type no longer free |
| `GET /orders/by-session/{orderId}` | public (id is the credential). `CustomerOrder` only (see "Payment flow"), `private, no-store` |
| `GET /cron/email-outbox` | Vercel Cron (`Authorization: Bearer $CRON_SECRET`, 401 otherwise): sends due ticket emails, returns counts |
| `GET /cron/trending` | Vercel Cron (same secret, 401 otherwise): rebuilds the trending snapshot, returns `{eligible, ranked}` |
| `GET /events/trending` | public: `{items: [{event, label, goingCount?}]}` (see "Trending"), at most 24, best first; `items: []` with fewer than 3. `cache-control: public, max-age=0, s-maxage=300, stale-while-revalidate=600` |
| `GET /admin/emails?status&cursor` · `POST /admin/emails/{jobId}/resend` | admin. Status `failed` (default), `pending`, `sending`, `sent`. Resend: 404 unknown, 409 being sent, 429 resent in the last 5 minutes or over 20 an hour |
| `POST /stripe/webhook` | Stripe (signature-verified) |
| `POST /organisers/apply` · `GET /organisers/me` · `PATCH /organisers/me` | signed in. PATCH: a rejected application is resubmitted in full (back to pending); an approved organiser edits their profile (see "Organiser profiles"); pending is a 409 |
| `GET /organisers/{organiserId}/profile` | public (approved organisers only; anything else, or a non-uuid id, is a 404) |
| `POST /organisers/me/connect/onboard` · `…/connect/refresh` | organiser |
| `POST /events` · `PATCH /events/{id}` · `POST /events/{id}/submit` | organiser (own events). Body adds `ticketingMode` (absent: `sheltuh` on POST; on PATCH, the stored ticketing is kept), `externalTicketUrl`, `externalFree` (see "External ticketing"). PATCH: 409 unless draft or rejected; 409 (fieldErrors on the field) changing the mode or link of an event that has been approved before |
| `GET /organisers/me/events` · `GET /organisers/me/events/{id}` | organiser (own events) |
| `PUT /events/{id}/image` · `DELETE /events/{id}/image` | organiser (own events, while draft or rejected). Admins: `…/admin/events/{id}/image` |
| `GET /events/{id}/image` | public once published; before that, the owning organiser or an admin |
| `GET /events/{id}/going` | public (published only): `{count, closed, countHidden}` |
| `GET /events/{id}/going/attendees?cursor` | verified email with a profile that isn't suspended (403 otherwise); published only; 429 when rate-limited |
| `GET /events/{id}/going/me` · `DELETE /events/{id}/going/me` | signed in (own opt-in) |
| `PUT /events/{id}/going/me` | verified email, eligible ticket holder with a profile. 404 if Who's Going isn't open, 409 without a profile, 403 if not eligible or suspended |
| `GET /profiles/me` · `DELETE /profiles/me` | signed in (own profile; DELETE also removes every opt-in, every conversation the member is in, for both sides, and the photo, bio and handle). GET also has `profileId`, `profileVisible`, `bio?`, `instagramHandle?`, `hasAvatar`, `avatarUrl?`, `avatarThumbUrl?` |
| `PATCH /profiles/me` `{displayName?, profileVisible?, bio?, instagramHandle?}` | verified email, a profile (404), not suspended (403). Absent: unchanged; null or "" clears bio or handle. 400 fieldErrors |
| `PUT /profiles/me/avatar` (raw JPEG/PNG/WebP) · `DELETE …/avatar` · `GET …/avatar[?size=thumb]` | PUT: verified, a profile (404), not suspended (403); 200 the profile; 400 not a supported image (or over 24 megapixels); 413 over 5 MB; 429 over 20 a day; 503 too many photos being decoded on the instance. DELETE: signed in, 204 idempotent. GET: the caller's own |
| `GET /profiles/{profileId}` | verified member with a profile, not suspended: `MemberProfile` (see "Member profiles"); 404 for anything they can't see; 429 |
| `GET /profiles/{profileId}/avatar[?size=thumb]` | the same gate (404 otherwise, also with a matching `If-None-Match`), or an admin (logged). WebP, `private, no-cache`, ETag (304); 429 over 600 per 10 minutes (members) |
| `GET /admin/profiles/{profileId}` · `POST …/remove-content` `{fields, reason}` | admin. `AdminMemberProfile` (with the moderation log; remove-content adds `removed`). 400; 404 |
| `GET /admin/reports/{reportId}/avatar` | admin: a profile report's copy of the photo. 404 none |
| `GET /organisers/{organiserId}/follow` · `POST …/follow` `{notifyNewEvents?}` · `DELETE …/follow` | GET signed in, `{following, notifyNewEvents}` (404 not approved). POST verified email: 201 new (emails off unless `notifyNewEvents: true`) / 200 existing; 400 not a boolean (null included) or own organiser; 404; 409 500 follows; 429. DELETE signed in, 204 idempotent |
| `GET /me/following?cursor&limit` · `GET /me/following/events?cursor&limit` | signed in: `FollowedOrganiser` items; upcoming events of followed organisers (public event shape), soonest first |
| `POST /follows/unsubscribe` `{token}` | public (the emailed token is the credential). 200 `{status: "unsubscribed", organiserName?}` (idempotent); 400; 404 |
| `POST /admin/organisers/{organiserId}/remove-video` `{reason}` | admin. 200 `AdminOrganiserRecord` (unchanged, nothing logged, without a video); 400; 404 |
| `PUT /profiles/me` | verified email, not suspended (403). Creating needs `adultConfirmed: true` (an explicit `false` is a 400); a rename (no `adultConfirmed`) with no profile is a 404. Display names are checked in `lib/server/profile-input.ts`: no control, invisible or default-ignorable characters (U+FE0E/FE0F allowed), at least one letter or digit, at most 4 combining marks per character, no links, emails or @handles, no Latin/Cyrillic/Greek mix within a word, and no reserved names, compared on a lookalike skeleton |
| `GET /conversations?cursor` | verified member: own conversations, newest activity first |
| `POST /conversations` `{attendeeId, body}` \| `{profileId, body}` | verified member going to the same open event. 201; 400 invalid/links/self, 403 not going or suspended, 404 member unavailable (also: blocked either way, a pair whose conversation was deleted, or the recipient over their incoming cap), 409 conversation exists, 429 |
| `GET /conversations/unread` | verified member: `{count}` of conversations with something unread |
| `GET /conversations/{id}/messages?after\|before` · `POST …/messages` `{body}` | verified participant (404 otherwise). POST: 409 while awaiting a reply, 403 suspended, 429 |
| `POST /conversations/{id}/decline` | signed-in recipient of a request (204, idempotent); 409 otherwise; 404 non-participant |
| `POST /conversations/{id}/read` `{lastReadMessageId?}` | verified participant (204) |
| `GET /blocks?cursor` · `POST /blocks` `{conversationId}\|{attendeeId}\|{profileId}` · `DELETE /blocks/{blockId}` | signed in (own blocks). POST 201 (new, or one the caller already has), 400 self, 404 not something the caller can currently see (including already blocked either way), 429 (30 per 24 hours); DELETE 204, idempotent |
| `POST /reports` `{conversationId, messageId?}\|{attendeeId}\|{profileId}, reason, details?` | signed in (a verified email for `profileId`). 201; 200 with the open report when the caller already has one about that profile's member; 400 yourself; 404 not yours (for `profileId`: not visible to the caller and not someone they blocked); 429. Admin reports carry `targetType`, `reportedProfileId?` and, for profiles, the copies |
| `GET /admin/reports?status` · `POST /admin/reports/{id}/resolve` `{action, note?}` | admin. 409 if already resolved |
| `GET /favourites?cursor&limit` | signed in: own favourited published events, newest favourite first, in the feed's public shape plus `favouritedAt` |
| `GET /favourites/ids` | signed in: `{eventIds}` (at most 500) |
| `PUT /events/{id}/favourite` · `DELETE /events/{id}/favourite` | signed in (no verified email needed). `{eventId, favourited}`. PUT: 404 not published, 409 at 500. DELETE: idempotent; 404 only with no favourite and the event not published |
| `POST /events/{id}/view` `{source?, code?}` | public. 204 (counted or not); 404 not published |
| `POST /events/{id}/outbound` | public, no body needed (`{}`). 204 (counted or not); 404 not a published external event |
| `GET /organisers/me/events/{id}/tracking-links` · `POST …` `{label}` · `DELETE …/tracking-links/{linkId}` | organiser (own events). POST 201; 400 label; 409 label taken or 20 links. DELETE 204, idempotent |
| `GET /organisers/me/events/{id}/analytics?from&to&compare` · `…/analytics.csv` | organiser (own events). 400 bad range. The JSON has `waitlistCount` (people on the event's waitlist now: a count only) |
| `POST /organisers/me/events/{id}/check-ins` `{code, requestId}` · `GET …/check-ins` · `POST …/check-ins/{checkInId}/undo` `{reason}` | organiser (own events), or admin (platform-managed organisers' events only; anything else 404); see "Check-in". Every ticket outcome is 200; 400 bad body, 404, 409 request id reused for another code, 413, 429. `checkInId`s are uuids |
| `GET /organisers/me/analytics/overview?from&to&compare` · `…/overview.csv` | organiser: all own events. 400 bad range |
| `GET /admin/organisers?status&q&limit&cursor` · `POST /admin/organisers/{id}/approve` · `…/reject` | admin. Items (and the decision responses) are `AdminOrganiserRecord`: the full record plus `recentEdits` (newest 20 log entries), most recently updated first. `q` (optional, at most 100 characters used): name, contact email or social handle containing it, ignoring case and accents (NFKD, combining marks removed; a leading `@` is ignored for handles; LIKE wildcards match literally); no index (a substring of a folded expression), it scans one status's organisers. `limit` 20 by default, at most 50. The admin event editor's organiser picker searches with it. Approve/reject: 409 unless pending |
| `POST /admin/organisers/{id}/suspend` `{reason}` | admin. Takedown of an approved organiser (see "Organiser profiles"). 200 `{organiser, eventsUnpublished, submissionsRejected}`; 400 reason missing, over 500 characters or with control/invisible characters; 404 unknown; 409 not approved |
| `GET /admin/events?status` · `POST /admin/events/{id}/approve` · `…/reject` · `…/unpublish` | admin. Approve: 409 if the event's organiser isn't approved. Items are `EventRecord`s, so the review queue shows `ticketingMode`, `externalTicketUrl`, `externalProvider` and `ticketingLocked` |
| `POST /admin/organisers` | admin. A platform-managed organiser (see "Admin authoring"): the application's fields and rules. 201 `AdminOrganiserRecord`; 400 fieldErrors |
| `GET /admin/events/{id}` · `POST /admin/events` · `PATCH /admin/events/{id}` | admin (see "Admin authoring"). `AdminEventRecord`. POST: the event body plus `organiserId`, `publish?`; 201; 400 fieldErrors (`organiserId` unknown; `ticketTypes` paid for a platform-managed organiser); 409 organiser not approved. PATCH: the event body with `ticketingMode` required, `expectedUpdatedAt`, `publish?`, `reason?` (≤500); 200 (unchanged if nothing changes); 400 fieldErrors (incl. `reason` to change an approved event's mode or link); 404; 409 stale version (`fieldErrors.expectedUpdatedAt`), orders on a switch to external, sold ticket types, or organiser not approved when publishing |
| `PUT /admin/events/{id}/image` · `DELETE /admin/events/{id}/image` | admin, any status. As the organiser's (413, 400), logged `edited`; 404 |
| `GET /admin/events/{id}/curation` · `PUT …/curation` `{boost, excluded, reason}` | admin, any status (see "Trending"). `{eventId, boost, excluded, updatedAt, log}` (newest 20 changes). PUT: 200 (unchanged, nothing logged, if nothing changes; logged `curated` otherwise); 400 fieldErrors (`boost` a number from 0.5 to 2, rounded to 2 places; `excluded` a boolean; `reason` 1–500 characters); 404 |
| `PATCH /admin/events/{id}/ticketing` `{ticketingMode, externalTicketUrl?, externalFree?, reason}` | admin. Any status. 200 with the event (logged as `ticketing_changed`; unchanged, and nothing logged, if nothing would change); 400 fields (`ticketingMode` is required) or reason (1–500 characters); 404; 409 switching to external an event with orders |

Lists are paginated with an opaque `cursor` (`nextCursor` in the
response). It's currently a row offset, fine at this scale.

JSON request bodies over 256 KB are refused with 413. Every error response
is `cache-control: private, no-store`, and so is every admin response
(`admin.ts`, `admin-authoring.ts`, `email-outbox.ts`, `reports.ts`,
`trending.ts`).

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
- `lib/seating/*`: reserved seating's pure modules, shared by the browser
  and the API: `template.ts` (the map's shape and validator), `availability.ts`
  (the bitmap), `format.ts` (how a seat is said). `lib/sample-seat-maps.ts`:
  the demo's seated sample.
- `components/tickets/TicketQr.tsx` / `lib/ticket-qr.ts`: the ticket QR,
  as inline SVG on `/checkout/success` and as a PNG in the ticket email.
- Link previews: `lib/share-metadata.ts` builds title, description,
  canonical, Open Graph and Twitter/X metadata from public fields only;
  `lib/server/share-metadata.ts` is live mode's server-side read for
  `generateMetadata` on `/events/[slug]` (`status = 'published'`, as
  `GET /api/events/slug/{slug}`) and `/organisers/[organiserId]`
  (`status = 'approved'`). The page bodies still load client-side. Anything
  not public gets one noindex "not found"; a database error gets a generic
  title, never a 500. Absolute URLs come from `NEXT_PUBLIC_SITE_URL`, never
  the Host header. An event's `og:image` is its reviewed cover at
  `/api/events/{id}/image?v=…` (public for published events), or the site's
  `app/opengraph-image.tsx` (inherited from the parent segment, since a
  page's `openGraph` replaces the parent's whole object).

## Not built yet

- Reserved seating, later (plan): live block/unblock (SQL runbook for now,
  `docs/supabase-setup.md`), a move-seat tool (likewise), standing areas on
  the map, venue templates, Realtime, the Companion Card flow, and
  per-visitor protection on holds (Turnstile or a Vercel WAF rule; until
  then, admins don't approve seated events for real on-sales). There's no
  seating on/off switch.
- Add to calendar on `/checkout/success` (the event page has it;
  `CustomerOrder` carries no event start, end or venue; `docs/FEATURE_PLAN.md`).
- Drop `private.user_reports.reported_avatar` (inline photo copies, superseded
  by `private.report_photos` in `20261102000100_social_hardening.sql`) once
  no report has one (reports made before it are deleted 2 years after
  resolution), with its `user_reports_one_avatar_copy` check, and the
  `coalesce` in `adminGetReportAvatar`.
- Drop `private.claim_outbox_jobs` (superseded by `claim_email_outbox` in
  `20261024000200_organiser_follows.sql`) once the deploy window is over.

- Drop `private.claim_email_jobs` (superseded by `claim_outbox_jobs` in
  `20261024000000_waitlist.sql`, kept only so a deploy still running the
  previous app version can send ticket emails) once that deploy window is over.

- Drop `private.update_event_draft` (superseded by `edit_event_draft` in
  `20261022000000_external_ticketing.sql`, kept only so a deploy still
  running the previous app version works) in a migration once that deploy
  window is over, and remove it from the unpinned list in
  `tests/server/schema-grants.test.ts`.
- Per-event door staff accounts for check-in (everyone on the door shares
  the organiser's login; see "Accepted limits (check-in)"), and an offline
  mode for the scanner.
- Analytics beyond stages A and B (see "Organiser analytics").
- Admin trending UI (F5): curation has an API (`…/admin/events/{id}/curation`),
  but there's no admin read of the ranked snapshot yet.
- Venue coordinates (the map falls back to suburb centroids).
- Who's Going beyond increment 2: no admin UI for suspensions or the
  per-event switch (SQL only, `docs/supabase-setup.md`), and an opt-in isn't
  revisited if the member later changes their email or the order stops being
  `paid`.
- Messages: no realtime delivery or email notifications (clients poll), no
  attachments, and a declined pair can't start over (one conversation per
  pair, ever).
