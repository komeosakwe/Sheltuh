# Sheltüh architecture

One Next.js app (hosted on Vercel), backed by Supabase (Postgres plus Auth),
with Stripe Connect for payments. There's no separate backend service:
the API is this app's own route handlers under `app/api/`.

```
Browser ── Supabase Auth (sign-up, sign-in, sessions)
   │            └──▶ Google / Apple (full-page redirects only, PKCE)
   │
   │  fetch /api/*  + Authorization: Bearer <Supabase access token>
   ▼
Next.js route handlers (app/api/** → lib/server/handlers/*)
   │  verify token with Supabase Auth · authorise · validate
   ├──▶ Postgres (Supabase), via DATABASE_URL
   ├──▶ Google Places API (New) (the organiser's venue search; key in a header)
   └──▶ Stripe (Connect accounts, embedded Checkout Sessions)
                      │
Stripe ──webhook──▶ /api/stripe/webhook
```

The one place the browser talks to Stripe directly is the payment page,
`/checkout/pay`: Stripe.js mounts Stripe's embedded Checkout form there (an
iframe served by Stripe), with the publishable key
`NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` (see "Payment flow").

## Design principles

- **The browser never talks to the database.** Supabase's Data API is shut
  out: RLS is on for every table, with no policies, and the anon and
  authenticated roles have no grants. All access goes through
  `lib/server/`, which enforces authorisation in one place and is covered
  by tests. If a future feature needs direct client access (e.g. realtime
  "Who's Going"), add narrow RLS policies for just that. New functions in
  `private` also revoke `execute` explicitly (Postgres grants it to PUBLIC
  by default); `tests/server/schema-grants.test.ts` checks all of this.
  The browser does reach Supabase directly in two places, neither of them
  the database: Supabase Auth (sign-up, sign-in, sessions; the diagram
  above), including signing in with Google or Apple, where the browser is
  only ever *redirected* (Supabase Auth → Google or Apple → Supabase Auth →
  our `/auth/callback`): no Google or Apple script runs on our pages and the
  app never calls their sign-in APIs (see "Sign in with Google and Apple");
  and, for event clips, a PUT of the file straight
  to Supabase Storage through a signed upload URL (one new object, no
  overwrite, 2 hours) the API issues for one path it chose (`uploads/{event}/{account}/{upload}.mp4`
  in the private `event-clips` bucket, which has no `storage.objects`
  policies). The API then checks the object and writes the copy that's
  served itself (see "Event clips").
- **Third-party APIs that need a secret key are called from the server.**
  The browser calls our own route and the server calls the provider with a
  server-only key: Stripe, and Google Places API (New) for the organiser's
  venue search, through `POST /api/places/autocomplete` and
  `/api/places/details` (a server-side proxy: `lib/server/places.ts`,
  `GOOGLE_MAPS_API_KEY` sent in a header, never in a URL; approved
  organisers and admins only, rate-limited; see "Venue location"). The
  browser itself loads only keyless or public-key resources: Stripe.js on
  the payment page (above), map tiles (Mapbox Streets with a public token,
  else Esri: `docs/maps.md`), and a featured video's player
  once it's clicked. No Google Maps script loads on our pages, and no
  Google Places content is shown on our maps, which stay Leaflet.
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
| `organisers` | `id` | `owner_user_id` is unique, one application per account. It's null for platform-managed organisers (events Sheltüh lists on someone's behalf, and seed data), which admins create (`POST /admin/organisers`), which sell no paid Sheltüh tickets, and whose events only admins check in (see "Admin authoring" and "Check-in"); their `contact_email` should be a Sheltüh alias, never a person's own address (`docs/supabase-setup.md`); check constraint `organisers_platform_no_payouts`: such an organiser has no Stripe account and no payouts. `status`: pending → approved / rejected. Also holds the Stripe Connect account id and `payouts_enabled`. Optional social handles (`instagram_handle`, `tiktok_handle`, `facebook_page`, `x_handle`), stored without `@` and pattern-checked by the database; `website_url` must be http(s), at most 2048 characters (check constraint; the API only takes new `https://` addresses, see "Organiser profiles"). An admin takedown sets `rejected` (see "Organiser profiles"). `featured_video_provider` (`youtube` or `vimeo`) and `featured_video_id`: the featured video, provider and id only, never a URL (check constraint `organisers_featured_video_check`: both or neither, id pattern per provider). `event_review_required` (default false; `20261111000000_event_publish_now.sql`): an admin's switch that sends every publish of this organiser's events to the review queue (see "Publishing events"), changed only through `private.set_event_review_required` and logged in `organiser_profile_edits`. |
| `private.organiser_profile_edits` | `id` (identity) | Append-only log per organiser: each profile edit made without review (`profile_edit`: old and new value of each changed field, by the owner, or by an admin with a reason: removing the featured video, logged as `featured_video` `"provider:id"`, or the logo, logged as `logo` with its version), each admin takedown (`suspended`, with the admin and reason; a takedown must have a reason), the organiser's creation by an accepted admin invite or an organiser link, or a link's approval of their pending application (`invite_accepted`, by the new owner: `status` null or pending → approved; see "Account invites" and "Organiser links"), and an admin's review switch (a `profile_edit` by the admin with a reason, `event_review_required` `"on"` / `"off"`; see "Publishing events"). A trigger refuses updates (except the `actor_id` foreign key's own set-null when that account is deleted). Admins see the newest 20 per organiser. Kept while the organiser exists; deleted with it. |
| `private.organiser_logos` | `organiser_id` | An organiser's logo as the server re-encoded it: `image` (512 × 512 WebP, ≤ 512 KB) and `thumb` (96 × 96 WebP, ≤ 64 KB), the whole logo fitted on white, no transparency, no metadata. `updated_at` is its version (milliseconds since the epoch, in its URL and the log); every write moves it on by at least a millisecond. Deleted with the organiser (see "Organiser profiles"). |
| `events` | `id` | Belongs to an organiser. Globally unique `slug`. `status`: draft → pending_review → published / rejected, or, for an approved organiser's own publish, draft / rejected → published directly (see "Publishing events"); unpublish returns it to draft. `rejection_reason`: the admin's reason on a rejection, an unpublish (optional) or a takedown, shown to the organiser; any later status change through `transition_event` replaces it (a publish or submit clears it). `is_free` (true only when the event has ticket types and all are free; for an external event, `external_free`) is kept up to date by `replace_ticket_types` for the feed's free filter. `whos_going_enabled` (default true) is an admin-only kill switch for that event's Who's Going, set in SQL (`docs/supabase-setup.md`). `ticketing_mode` (`sheltuh`, the default, or `external`), `external_ticket_url`, `external_free` and `external_price_from_cents`: see "External ticketing". Check constraints: an external event has a link, a Sheltüh-ticketed one has no link and isn't `external_free`, and an external event's `is_free` equals `external_free`. The trigger `events_external_ticket_url_valid` checks a link against `private.external_ticket_url_ok` when it's inserted or changed (only then, so tightening the rules never blocks a later status change; see "External ticketing"). `updated_at` changes on every update of the row, a photo change included (trigger `event_images_touch_event`). Triggers refuse ticket types and orders for an external event, and switching an event with ticket types to external. `state` (default `VIC`) and `time_zone` (default `Australia/Melbourne`): the event's state or territory and the IANA zone its times are in; check constraint `events_place_check` allows only the zones `ZONES_BY_STATE` lists for the state (see "Events: state and time zone"). The venue's location (`20261111000100_event_venue_location.sql`; see "Venue location"): `location_source` (`legacy`, the default and every earlier event; `places`; `manual_pin`), `venue_place_id` (a Google place id, the only Google Places data stored) and `venue_lat` / `venue_lng` (the organiser's own pin, never Google's coordinates); checks `events_venue_pin_pair`, `events_venue_pin_bounds` (`AUSTRALIA_BOUNDS`), `events_venue_place_id_shape` and `events_location_source_check` (`legacy`: neither; `places`: a place id, pin optional; `manual_pin`: a pin and no place id). No index: nothing filters or sorts on them. |
| `ticket_types` | `(event_id, id)` | `id` is stable across draft edits. A trigger refuses a price above 0 for a platform-managed organiser's event (`ticket_types_platform_free_only`). `quantity_sold` only ever goes up in `fulfil_order`, and down only in `record_payment_refund` (a paid order refunded in full). `seated`: the tier has seats on the event's seat map; its `quantity_available` is then always its unblocked seats (trigger `ticket_types_seated_capacity`, whatever is written; see "Reserved seating"). |
| `event_seat_maps` | `event_id` | An event's optional seat map (see "Reserved seating"): `layout` (the validated template, `lib/seating/template.ts`), `seat_count` (1–10,000) and `version` (from the sequence `private.seat_map_versions`: never reused, not even after a delete). Every write bumps the event's `updated_at` (`event_seat_maps_touch_event`). Refused for an external event (`event_seat_maps_sheltuh_only`). Deleted with the event. |
| `event_seats` | `(event_id, id)` | The map's seats, derived from the layout in the same step (`write_seat_map`): `position` (map order: the availability bit), section, row (may be empty) and seat labels, `ticket_type_id` (no-action foreign key `event_seats_ticket_type_fkey`: a tier with seats can't be removed), `kind` (standard, wheelchair, companion), `blocked`; `hold_order_id` / `hold_expires_at` (a pending order's hold) and `sold_order_id`. Checks: never held and sold at once (`event_seats_one_owner`), never held or sold while blocked (`event_seats_blocked_unsold`). Deleted with the map. |
| `event_images` | `event_id` | Optional organiser photo (≤2 MB, JPEG/PNG/WebP) stored as `bytea` — no Storage bucket or extra secret. Public via `GET /api/events/[id]/image` once published (versioned URL, shared at the CDN for an hour at the current version, ETag and 304; see "CDN windows"); before that only the owner/admins with a token. Every write (insert, update, delete) bumps the event's `updated_at` in the same transaction (`event_images_touch_event`), so a photo change is a new version of the event (see "Admin authoring"); writers lock the event row (for no key update) before the image row. Move to Storage/CDN if volume grows. `focus_x` / `focus_y` (`20261115000000_event_image_focus.sql`; smallint 0..100, both null or both set, check constraint `event_images_focus_check`): where the photo's subject is, so cropped renderings centre on it (see "Photo focus"). No index: nothing filters on it. |
| `event_moderation_log` | `id` | Append-only: submitted / approved / rejected / unpublished / ticketing_changed / created / edited / curated, by whom, and why. `approved` means "went live": an admin's approval or publish, or an approved organiser's own publish (`private.publish_event`, logged by the organiser's own account), so every reader of "approved before" treats the two alike (see "Publishing events"). Partial index `event_moderation_log_approved_idx (created_at, event_id) where action = 'approved'` serves the admins' "recently published" list and the admin home's count. `details` (jsonb object, null for the other actions): for `ticketing_changed`, the old and new value of each ticketing field the admin changed (full ticket links: see "External ticketing"); for `edited`, the old and new value of each other field an admin changed (see "Admin authoring"); for `curated`, the old and new `boost` and `excluded` (see "Trending"). Shown to the event's organiser and to admins (`moderationLog[].changes`), never publicly, except `curated` entries, which only admins see (`GET /admin/events/{id}/curation`). `by` is the actor's account id for admins; the organiser's view shows `"Sheltüh team"` (`SHELTUH_TEAM_ACTOR`) for anyone but the organiser's own account. No update trigger: personal information in `details` or `reason` is redacted in place (`docs/supabase-setup.md`, APP 11/13). |
| `orders` | `id` (`ord_…`) | Priced snapshot of the line items and totals. `status`: pending → paid / failed / oversold_refund_required; oversold_refund_required → refunded (our automatic refund); paid → refunded (refunded in full in Stripe: Stripe's `refunded`, or at least `total_cents` refunded; see "Refunds made in Stripe"); pending → failed also when a paid session's amount or currency wasn't the order's (`private.fail_mismatched_order`, which also records the payment intent; the payment is then refunded). `amount_refunded_cents` (≥ 0, default 0) is Stripe's cumulative refunded amount, recorded only for paid orders (a partial refund leaves the order paid, whatever its amount; a refunded order with `amount_refunded_cents` below `total_cents` was voided by the tickets-only rule of `20261110000200_support_ticket_refund.sql`, before `20261111000300_refund_no_inference.sql` removed it). Indexed on `stripe_payment_intent_id` (partial, not null) for the refund webhook, and on `(event_id, created_at)` (partial, `paid`) for the trending refresh's 14-day read. `tickets_emailed_at` records the ticket email. `tracking_code` is the event tracking link the checkout came through (checked against the event's links when the order is created; null otherwise). `seat_ids` (1–10): a seated order's seats, set when it's made and never changed (what fulfilment and refunds act on). `support_cents` (0 to 50000, default 0; `20261110000100_order_support.sql`): Support Sheltüh, what the buyer added for the platform (see "Support Sheltüh"); only on an order with a paid ticket (`orders_support_paid_only`), and in `total_cents` (`orders_support_in_total`: total = subtotal + buyer fee + support when there is some), never in `subtotal_cents`, `buyer_fee_cents` or `application_fee_cents` (the booking fee). |
| `tickets` | `code` | One row per admitted person. Rows are kept when their order is refunded, but only a `paid` order's tickets are valid: check-in checks the order's status. `checked_in_at`: when the ticket was admitted at the door (null until then, and again after an undo; cleared 25 months after the event ends). Indexed on `(event_id, ticket_type_id)` for the check-in counts. `seat_id`: its seat (reserved seating); the foreign key `ticket_seats_sold_fkey` (event, seat, order, ticket type) → `event_seats (event_id, id, sold_order_id, ticket_type_id)` means a ticket can only name a seat sold to its own order in its own tier, and `tickets_seat_key` one ticket per seat. A full refund clears it (the order's `seat_ids` keeps the history). `wallet_serial` (uuid, random, unique `tickets_wallet_serial_key`; `20261109000500_ticket_wallet_serial.sql`): the id of the ticket's wallet pass, read only by the wallet routes (see "Wallet passes"). |
| `ticket_check_ins` | `id` (identity) | The check-in log (see "Check-in"): one row per scan or undo, with a random `public_id` (uuid, unique: the only id the API shows, as `checkInId`; the sequential `id` stays internal, so ids don't reveal platform-wide scan volume), the event scanned for, the ticket `code` (null for an `invalid` scan: what was scanned is never stored), the acting account (the organiser's, or the admin's for a platform-managed organiser's event), the client's `request_id` (unique per event: the idempotency key), the `result` and, for an undo only, its `reason` (3–200 characters). Check constraints tie `invalid` to a null code and `undone` to a reason. Deleted with the event or the ticket, and by `purge_analytics` 25 months after the event ends. No buyer data. |
| `private.platform_rate_limits` | `bucket` | Platform-wide fixed-window counters (`take_platform_rate_limit`): the hourly and 24-hour confirmation-email caps, the self-publish cap, and the Google Places caps per Google day (`places_*_day:<date>`, see "Venue location"). Idle rows purged daily. |
| `private.free_order_refusals` | `(day, reason)` | Counts of refused free bookings per Melbourne day and reason. No personal data. Deleted after 13 months. |
| `private.early_charge_refunds` | `payment_intent_id` | A `charge.refunded` that arrived before its order's payment was recorded, for a payment to one of our organisers' Stripe accounts (any other payment writes nothing): charge, destination, cumulative amount (the greatest seen), full flag (OR-ed), last Stripe event, and `applied_at` / `applied_order_id` once `fulfil_order` acted on it. No buyer data. Deleted 35 days after its last update (`purge_operational_data`). See "Refunds made in Stripe". |
| `private.refund_status_marks` | `refund_id` | The newest Stripe refund event applied per refund (its status, the event's `created` time and id), written by `record_refund_status` for events only (never for our own refund call's answer, which has no event time). An event older than the mark, delivered later, is `stale` and changes nothing: a `succeeded` that arrives before an older `requires_action` or `failed` leaves a resolved tombstone, so the late one opens no exception. Statuses only, no buyer data. Deleted 35 days after its last update (`purge_operational_data`). |
| `private.payment_exceptions` | `id` | Payment problems that need a person (see "Refunds made in Stripe"): `kind` `refund_not_completed` (keyed on the refund id, unique), `partial_refund`, `manual_refund_required` or `amount_mismatch` (`20261110000150_support_in_exceptions.sql`; one open per order); `status` open → resolved (`resolution` `auto` or `admin`, with the admin and a 1–500 character note); order (null until a payment is matched to one; set null if the order is deleted), payment intent, refund and latest Stripe event ids and that event's time (older events are ignored); `details`: amounts and statuses only (the order's total and its Support Sheltüh amount, `supportCents`, when the order is known; `20261110000150_support_in_exceptions.sql`; `supportKeptCents` only on a `partial_refund` closed by the tickets-only rule while `20261110000200_support_ticket_refund.sql` was the latest definition; nothing sets it since `20261111000300_refund_no_inference.sql`); `amount_mismatch` is always `urgent` and its payment is refunded automatically as it opens (`20261110000300_amount_mismatch_refund.sql`); `alerted_at` (an ops alert queued). Resolved ones are deleted 2 years after resolution; open ones never. |
| `private.email_outbox` | `id` | Transactional email jobs of nine kinds: `ticket_email`, one per paid order (`(order_id, kind)` unique), `waitlist_available`, one per person told that tickets are available again (`waitlist_entry_id`; at most one pending or sending per entry), `organiser_new_events`, a follower's new-event email (`follow_id`; at most one pending or sending per follow; see "Following organisers"), `event_review` / `organiser_review`, the admins' "waiting for your review" email (`event_id` / `organiser_id`; at most one pending or sending per event or application; see "Admin review emails"), `event_published`, the admins' "an organiser published an event" email (`event_id`, sharing the per-event active-job index with `event_review`; see "Publishing events"), `organiser_joined`, the admins' "an organiser joined with a link" email (`organiser_id`, sharing the per-organiser active-job index with `organiser_review`; see "Organiser links"), `onboarding`, a welcome or next-steps email to one account (`onboarding_id`, unique: one job per record, ever; see "Onboarding emails"), and `ops_alert`, keyed on `payment_exception_id` for a payment exception (see "Refunds made in Stripe") or on `ops_event_id` for a checkout surge (see "Checkout idempotency"), exactly one of the two, at most one pending or sending per exception and per event. A check ties each kind to its key. Status, attempts, next attempt, lease, redacted last error. No address or content (read from the order, the waitlist entry, the follow, the event, the application or the exception, at send time). Deleted with the order, the entry, the follow, the event, the organiser or the exception. |
| `private.onboarding_emails` | `id` | One row per (account, kind) ever queued: `member_welcome`, `organiser_welcome` or `organiser_next_steps` (`(user_id, kind)` unique, so none is ever queued twice; deleting the account deletes it and, through `email_outbox.onboarding_id`, its job). It outlives its job (the purge deletes sent jobs after 90 days, never these). RLS on, no grants. See "Onboarding emails". |
| `private.email_job_recipients` | `(job_id, recipient_hash)` | Which admins already have a review job's email (the lower-cased address's SHA-256 only), so a retry skips them. Deleted with the job. |
| `private.cron_runs` | `name` | One row per cron route (only `email_outbox` so far): when its last run finished and that run's counts (claimed, sent, retrying, failed), written by the route. Read by `GET /api/admin/emails/health`. Nothing personal. |
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
| `private.client_rate_limits` | `(client_key, bucket)` | Fixed-window counters keyed on a client (`take_client_rate_limit`): the per-client seat-hold limit (buckets `seat_holds:<event id>` and `seat_holds`, see "Reserved seating"), paid general admission checkouts per minute (`paid_checkouts`) and per 10 minutes (`checkouts:<event id>` and `checkouts`, see "Checkout idempotency"), and payment page reads (`order_payment`; see "Payment flow"). One bucket, `order_payment:order`, is keyed on an order instead: its `client_key` is the keyed SHA-256 of the order id (salt labelled `sheltuh/order-key/v1`), never the id. `client_key` is the API's keyed SHA-256 (HMAC) of the client's IP address (an IPv6 address's /56), salted with a value derived from `STRIPE_WEBHOOK_SECRET` (`lib/server/client-key.ts`); the raw address is never stored or sent to the database (check constraint: 64 hex characters). Idle rows purged daily (`purge_operational_data`). |
| `private.checkout_attempts` | `idempotency_key` | One paid checkout attempt per `Idempotency-Key` (see "Checkout idempotency"): event, kind (`ga` or `seated`), `fingerprint` (SHA-256 hex of the event, kind, canonical basket, normalised buyer email and tracking code: no email is stored), status (`in_progress` with a lease, `open` with the URL the client was given (our payment page, `/checkout/pay?order=…`) and the session's expiry and, seated, the hold's expiry, `failed`, `completed`), the order id (chosen before the order exists, so no foreign key), and `client_key`: the requester's keyed IP hash (null when the API had none), which a replay must match. Deleted 2 days after creation (`purge_operational_data`; `checkout_attempts_created_idx` serves it). |
| `private.event_view_cap_days` | `(event_id, day)` | A marker that the event's view cap was reached on that Melbourne day, so reports can flag the day's views as a lower bound. No visitor data. Deleted with the event, and by `purge_analytics` after 25 months. |
| `private.event_curation` | `event_id` | An admin's trending curation (see "Trending"): `boost` (0.5 to 2, default 1, check constraint) and `excluded`, with who changed it last and when (null until changed). Written only by `set_event_curation`. Deleted with the event. |
| `private.trending_snapshot` | `rank` | The ranked trending list (at most 24): rank, event (unique), score and when it was computed. Rebuilt as a whole by `refresh_trending`; holds no counts. Deleted with the event. |
| `private.analytics_settings` | single row | `views_tracked_since`: the Melbourne day view counting started (when its migration ran), so reports show earlier days as "not counted" rather than 0. |
| `private.user_reports` | `id` | A member's report: copies of the reported message, up to 20 messages of context and the reported display name; `target_type` (`conversation`, `attendee` or `profile`); for a profile report, copies of the bio, Instagram handle and photo (512 px WebP: `reported_avatar_sha256`, a key into `private.report_photos`; reports made before that keep the copy inline in `reported_avatar`, never both: `user_reports_one_avatar_copy`). At most one open profile report per reporter and reported member (partial unique index `user_reports_open_profile_key`). Every reference is `on delete set null`, so the evidence survives the messages and both accounts. `status`: open → actioned (suspended) / dismissed. Resolved reports are deleted 2 years after resolution. |
| `private.account_invites` | `id` | Admin invites (see "Account invites"): `kind` (`organiser`, with `organiser_profile`: the application's fields, the organisers columns as keys; or `member`, without), the address as typed, `token_hash` (SHA-256 of the emailed token, never the token; unique), `status` pending → accepted / revoked / expired (a pending invite past `expires_at` reads as expired), who invited, last sent, accepted and revoked it (each `on delete set null`), `expires_at` (14 days from the last send), `last_sent_at`, `last_send_failed_at`, `send_count`, `links_issued` (sign-up tokens requested with the current link), `accepted_organiser_id`. At most one pending invite per address, ignoring case (`account_invites_pending_email_key`). Check constraints tie a profile to organiser invites and `accepted_at` / `revoked_at` to their statuses. Deleted 90 days after it was accepted, revoked or expired (`purge_operational_data`). |
| `private.organiser_invite_links` | `id` | Organiser links (see "Organiser links"): `token_hash` (SHA-256 of the link's token, never the token; unique), `status` active → used / cancelled (an active link past `expires_at` reads as expired), who created, used and cancelled it (each `on delete set null`; cancelled with no canceller: its creator stopped being an admin), `expires_at` (7 days from creation, after `created_at`: check), `used_at`, `organiser_id` (the organiser it created or approved, `on delete set null`), `cancelled_at`. Check constraints tie `used_at` / `cancelled_at` to their statuses. `organiser_invite_links_created_idx` (created_at desc, id desc) serves the admin list. Deleted 90 days after it was used or cancelled, or expired (`purge_operational_data`). |
| `private.report_photos` | `sha256` | Profile reports' photo copies, once per distinct image (`sha256 = sha256(image)`, check constraint), however many reports take it. `last_used_at` is bumped whenever a report takes it. Deleted by `purge_social_data` once no report references it and it's been unused for a day. |

Timestamps are `timestamptz`. Organisers enter an event's times as local
times in the event's own zone (`events.time_zone`; Melbourne by default),
which are converted to instants honouring daylight saving
(`lib/time-zones.ts` `localToUtcIso`; see "Events: state and time zone").
Every other time (analytics days, trending, rate-limit days, retention,
admin and message times) is in the platform's zone, Australia/Melbourne.

## Database functions (schema `private`)

| Function | What it guarantees |
|---|---|
| `create_event_draft`, `edit_event_draft` | Event row (ticketing fields, refund policy, state and time zone included; the edit keeps the stored state and zone when they aren't sent) and ticket types saved together. `edit_event_draft` locks the event row, and only succeeds while the event is draft or rejected (`not_editable`) and owned by the caller's organiser (`not_found`); once the event has ever been approved, a change to its ticketing mode or link is `ticketing_frozen` (409) and nothing is saved. Switching to external removes the ticket types first. Both also save the venue location from `p_fields` (`locationSource`, `placeId`, `pinLat`, `pinLng`, validated by the API; `20261111000100_event_venue_location.sql`): without `locationSource`, create writes `legacy` and the edit keeps the stored location, so an older caller changes nothing. (`update_event_draft`, the earlier boolean form, is kept for the deploy window and no longer called, and doesn't touch the location; drop it once that's over: see "Not built yet".) |
| `submit_event` | The organiser's submit for review (`POST /events/{id}/submit`, the review path; `20261109000000_paid_events_need_payouts.sql`; `20261111000100_event_venue_location.sql` added a `location_required` refusal, which `20261111000400_submit_event_location_in_app.sql` removed again so the previous app's submit keeps working: the handler checks the pin instead, see "Venue location"): share-locks the organiser (still approved, else `not_found`), then locks the event (for no key update); only from draft or rejected (`not_submittable`); `payouts_required` for a paid Sheltüh ticket type without payouts; then `transition_event` to `pending_review` (`submitted`). Nothing is written on a refusal. |
| `publish_event` | The organiser's publish (`POST /events/{id}/publish`; `20261111000000_event_publish_now.sql`, redefined in `20261111000100_event_venue_location.sql`; see "Publishing events"). Share-locks the organiser (approved and owned by the caller, else `not_found`), then locks the event (for no key update), as `submit_event`. Refusals, nothing written: `already_published` (the API's idempotent 200), `in_review`, `ended`, `payouts_required`, `location_required` (no organiser's pin), `stale` (the ticket link isn't the one the API judged). Then the review exceptions (the organiser's `event_review_required`; the event rejected now, or an admin's latest decision about it `rejected` or `unpublished`; a seat map; the API's `p_force_review`), then the caps (`take_rate_limit` `event_publishes` 10 per 24 hours, then `take_platform_rate_limit` `event_self_publishes_daily` 100 per 24 hours; taken only when nothing else sends it to review): any of them sends it to `pending_review` (`submitted`, whose trigger queues the review email). Then the organiser's first paid Sheltüh event (`20261111000200_first_paid_event_review.sql`: paid on Sheltüh, and no paid Sheltüh event of theirs whose latest admin decision is an `approved` by someone other than the owner). Otherwise `transition_event` to `published`, logged `approved` by the organiser's own account, and `queue_review_email('event_published', …)`. Returns `published` or `submitted:<reason>` (`review_required`, `removed_before`, `seated`, `unknown_ticket_site`, `first_paid_event`, `daily_limit`: the first rule that applied), or the refusal. |
| `admin_unpublish_event` | An admin's unpublish with `reviewFuture` (`POST /admin/events/{id}/unpublish`; `20261111000200_first_paid_event_review.sql`; see "Publishing events"). Locks the organiser (for update, with the review switch) before the event; `transition_event` published → draft, logged `unpublished` with the reason; then `set_event_review_required(…, true, …)`. One transaction. Returns `unpublished`, `not_published` (nothing written) or `not_found`. |
| `set_event_review_required` | An admin turns review of an organiser's events on or off with a reason: locks the organiser row (for update), updates `event_review_required` and logs a `profile_edit` by the admin (`changed_fields.event_review_required`, `"on"` / `"off"`). Returns `updated`, `unchanged` (already so, nothing logged) or `not_found`. |
| `event_location_json` | Immutable helper: the `{source, placeId, pin}` object (null for `legacy`) that `admin_edit_event` logs as `changes.location`. |
| `admin_create_event` | An admin's new event (see "Admin authoring"): share-locks the organiser, which must exist and be approved; refuses a paid Sheltüh ticket type for a platform-managed organiser (`platform_paid`); then `create_event_draft`, a `created` log entry and, if asked, `transition_event` to published (`approved`), in one step. Nothing is written on a refusal. |
| `admin_edit_event` | An admin's edit of any event, any status: share-locks the organiser, then locks the event; refuses (`stale`) unless its `updated_at` still equals the version the admin edited (to the millisecond); computes each changed field (the venue location included, logged as `changes.location`: old and new `{source, placeId, pin}`, null for none); decides every refusal (`platform_paid`, `has_orders`, `reason_required`, `organiser_not_approved`) before writing; then ticketing through `admin_set_event_ticketing`, the other fields, `replace_ticket_types`, one `edited` entry with old and new values, and the optional publish. Nothing changing is `unchanged` (nothing written). |
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
| `release_tickets` | The organiser's "Release more tickets" (`POST /events/{id}/ticket-types/{id}/release`; `20261113000000_release_tickets.sql`; see "Releasing more tickets"). Share-locks the organiser (owned by the caller, else `not_found`; not approved, `not_approved`), locks the event (for no key update, so it also excludes `fulfil_order` and seat holds, which share-lock it) and the ticket type (for update), and rechecks under them: the event is theirs and published (`not_published`), not ended (`ended`), Sheltüh-ticketed (`external`), the tier isn't seated (`seated`), the new total is above the current one (`not_increase`) and at most the cap the API passes (`too_many`), then the event's `ticket_releases` allowance (`take_event_rate_limit`, 10 per 24 hours) and the organiser's (`take_rate_limit`, 30 an hour), both `rate_limited`, taken last so refusals cost nothing; a null actor is `not_found`, a null quantity or limit raises. It raises `quantity_available` only, bumps the event's `updated_at` (an admin's older edit is stale) and logs an `edited` entry with `ticketTypes {old, new}` (only the changed tier, `[{id, name, quantityAvailable}]`) by the organiser's account. Returns `result`, and the tier's `total` and `sold`. Not security definer; search_path pinned. |
| `check_in_ticket` | One scan, in one step (see "Check-in"): the event must be the organiser's (`not_found`; for an admin, the API passes the platform-managed organiser's id); a hit on the account's `check_in` allowance (`rate_limited`, nothing logged); then, under an advisory lock on (event, request id), a request id already logged returns its original result unchanged, or `conflict` (nothing logged; the API's 409) if the submitted code doesn't resolve to the logged one. Otherwise: a code that isn't one of the organiser's tickets is `invalid`; another of their events' tickets is `other_event`; else it share-locks the order, then locks the ticket (`for update`), and decides `not_admissible` (order not `paid`), `already_checked_in` (with the first time, and `admission_id`: the ticket's current admission, for undo) or `admitted` (sets `checked_in_at`; `admission_id` is the new row). Every result but `not_found`, `rate_limited` and `conflict` logs exactly one row. Ids returned are public ids. Also returns the ticket's seat (section, row, seat, kind) when it has one. |
| `undo_check_in` | Reverses an admission (an `admitted` log row of the event, by its `public_id`) with a reason: same ownership check, allowance and locks as `check_in_ticket`. Returns `undone` (clears `checked_in_at`, logs an `undone` row with the reason), `not_found`, `not_checked_in` (already undone), `superseded` (admitted again since: undo the newer one) or `rate_limited`. Only `undone` logs a row. |
| `place_free_order` | A member's free order, created and fulfilled in one step under an advisory lock on (event, person): the per-person cap, then the daily allowance, then `fulfil_order`. A refusal or sell-out writes nothing (beyond a refusal count). Returns `paid`, `person_event_limit`, `member_daily_limit` or `sold_out`. |
| `request_free_order` | A guest's pending free order: the platform's hourly and 24-hour caps (read-only), then, under an advisory lock on the address, the hourly link limit, then a hit on each platform cap. Returns `requested`, `address_limited`, `platform_limited` or `platform_daily_limited`. (The previous 13-argument form delegates to it with the same daily cap, for the deploy window; the app doesn't call it.) |
| `confirm_free_order` | Confirms by token hash: locks the order, then (event, person), then the event (share) to check every ticket type is still free, then `fulfil_order`'s locks. Idempotent within the link's 24 hours. Returns `confirmed`, `already_confirmed`, `expired_confirmed`, `not_found`, `expired`, `unavailable`, `ended` (the event ended before the link was confirmed: read before the allowance, and again under the event's share lock), `person_event_limit`, `no_longer_free`, `seats_taken` (a seated order's seats went to someone else since the link was sent) or `sold_out` (the last five mark the order `failed`). A seated order takes the seat lock before the order row. |
| `purge_operational_data` | Retention for free-ticket and outbox data (see "Free tickets" and "Payment flow"); sent outbox jobs after 90 days, failed ones after a year; per-client counters (`client_rate_limits`) idle for a day; account invites 90 days after they were accepted, revoked or expired (`account_invites_deleted`, `20261108000000_account_invites.sql`); early refund rows and refund status marks 35 days after their last update; resolved payment exceptions 2 years after resolution (open ones never); checkout attempts 2 days after creation, first failing any order a failed attempt kept pending with no session recorded (no Checkout Session lives that long); organiser links 90 days after they were used or cancelled, or expired (`organiser_invite_links_deleted`, `20261111000500_organiser_invite_links.sql`). Idempotent; Supabase Cron daily. |
| `begin_checkout_attempt` | Claims an `Idempotency-Key` for one request from one client key (see "Checkout idempotency"): insert-or-lock the attempt row, then `mismatch`, `other_client` (the attempt's client key differs; nothing given out or changed), `in_progress` (live lease; seconds left), `replay` (order, URL, hold expiry), `expired`, `completed` (with the order's status), or `create` under a 90-second lease (a new key, or a retry of a failed one). A new key's row and its limits are one subtransaction, so a limit refusal (`client_event_limit`, `client_all_limit`) writes nothing; `alert_queued` says the event's checkout circuit breaker queued an ops alert. A retry reuses a still-pending order with no session that's young enough (`reused`), else takes the limits again and releases the old pending order (seats freed). Lock order: the attempt row, the limit counters, then the seat lock and the order when releasing. |
| `finish_checkout_attempt` / `fail_checkout_attempt` | Lease-checked (`lost` otherwise, changing nothing). Finish locks the attempt, then the order: records the session on the still-pending order and opens the attempt (`open`), or fails the attempt if the order stopped being pending (`order_closed`). Fail releases the lease and, when asked, the order (`release_checkout_order`: a seated order through `release_seat_holds`, a general admission one directly). |
| `take_checkout_attempt` | General admission paid checkout limits: per client (skipped for a null key) 'checkouts:<event id>' then 'checkouts' (refusals: `event`, `all`; a refusal keeps no hit), then the event's alert-only circuit breaker, its 'checkouts' bucket (`take_event_rate_limit`): crossing it refuses nobody but queues an ops alert (`queue_checkout_surge_alert`), at most one per event per window (bucket 'checkout_surge_alert') and 10 a day platform-wide (bucket 'ops_alerts_checkout_surge', apart from the payment exceptions' 20). Returns `ok`, `surge` (ok, alert queued), `event` or `all`. `take_checkout_limits` picks it or (seated) `take_seat_hold_attempt`. |
| `create_account_invite` | An admin's invite (see "Account invites"): marks the address's expired pending invite `expired`; refuses an address with a pending invite (`already_invited`) or, for an organiser invite, one whose account already owns an organiser (`already_organiser`); then a hit on the admin's hourly allowance (`account_invites`) and the platform's daily one (`account_invites_daily`) and the insert, in one subtransaction, so a refusal keeps neither hit and two admins inviting the same address at once can't both succeed (the unique index; the loser is `already_invited`). Returns `created` with the id, or the refusal. |
| `account_invite_inviter_is_admin` | Whether an invite's `invited_by` still has `app_metadata.role = 'admin'` (false when null: the account was deleted). An invite whose inviter isn't is dead: read as revoked by `view` and `/invites/me`, and marked revoked by the three functions below. |
| `resend_account_invite` | Locks the invite; only a pending or expired one (`not_pending`; also when its inviter is no longer an admin, which marks it revoked), not within a minute of the last send (`too_soon`); the same allowances, taken only when it's resent; a new token hash, 14 days from now, link count reset, status pending again (`already_invited` if the address has another pending invite by then). |
| `issue_invite_account_link` | The invite page's "Create account", by token hash: locks the invite; `not_found`, `used`, `revoked` (also when its inviter is no longer an admin, which marks it revoked), `expired`; `has_account` when the address already has a confirmed account; `limit` past the per-link cap; otherwise counts one request and returns the address. |
| `accept_account_invite` | The invitee's acceptance: locks the invite; the caller's verified email must equal its address, ignoring case (`not_found` otherwise, revealing nothing); the same account again is `already_accepted` (idempotent), another one `used`; `revoked` (also when its inviter is no longer an admin, which marks it revoked), `expired`. An organiser invite inserts the organiser, approved, reviewed by the inviting admin, owned by the caller (`on conflict (owner_user_id) do nothing`: an account with an organiser, or an application committed meanwhile, is `has_organiser`, nothing written), and logs `invite_accepted`; then marks the invite accepted, in one step. |
| `create_organiser_invite_link` | An admin's organiser link (see "Organiser links"): a hit on the admin's hourly allowance (`take_rate_limit` `organiser_invite_links`, 20) and the platform's daily one (`take_platform_rate_limit` `organiser_invite_links_daily`, 50) and the insert, in one subtransaction, so a refusal (`rate_limited`) keeps neither hit. Returns `created` with the id. |
| `join_with_organiser_invite_link` | A signed-in, verified caller's join, by token hash (see "Organiser links"): locks the link; `unavailable` when there's none, or it's used by another account, cancelled or expired, or its creator is no longer an admin (`account_invite_inviter_is_admin`; then it's marked cancelled, `cancelled_by` null); `already_joined` (the organiser) for the account that used it. Then locks the caller's organiser row: approved → `already_organiser`; rejected (taken down included), or pending with a `suspended` entry on its log (taken down, then resubmitted) → `rejected`; both with the link left active; pending otherwise → approved as submitted (`reviewed_by` the link's creator); none → a new approved organiser (the typed name and categories, the caller's verified email as `contact_email`, an empty bio), `details_required` without them, `conflict` when an application committed meanwhile (`on conflict (owner_user_id) do nothing`). Logs `invite_accepted` (status null or pending → approved), marks the link used and queues the admins' `organiser_joined` email (`on conflict` on the per-organiser active-job index: nothing if a job for it is already waiting or being sent), in the same transaction. |
| `claim_outbox_jobs`, `finish_email_job`, `resend_email_job`, `admin_resend_email_job` | The email outbox: lease due jobs of any kind (optionally one order's, or one kind) with `skip locked` (an expired lease is taken again; one that expired on the 6th attempt fails), record an outcome only for the current lease holder, and an admin resend of a ticket email (not while leased, not twice in 5 minutes; a waitlist email is `not_found`). `admin_resend_email_job` takes a hit on the admin's hourly allowance only when the resend is queued, in the same transaction (over it: `rate_limited`, nothing changed). `claim_email_jobs`, the earlier form, now claims ticket emails only and is kept for the deploy window (see "Not built yet"). |
| `email_outbox_health(p_overdue_after)` | Per outbox kind: due, overdue (due, or leased by a worker that died, for longer than `p_overdue_after`), the oldest overdue job's age in seconds, waiting, sending, expired leases, failed and failed in the last 7 days. Sent jobs aren't read. Counts only; `GET /api/admin/emails/health` and the SQL editor (`20261109000300_email_outbox_health.sql`). |
| `waitlist_join_state` | Whether an event's waitlist takes joins: `open` (published, Sheltüh-ticketed, not ended, has ticket types and every one is sold out), else `not_found` (missing or not published), `external`, `ended` or `not_sold_out`. |
| `join_waitlist` | A member's join with their own verified email (the API checks it's theirs): on the list at once, idempotently (`already_joined`); someone who left, or never confirmed, joins again at the back. An entry already on the list is linked to the member's account only if its address is exactly theirs (ignoring case), never by a normalised match (`+tag`, Gmail dots). Returns `joined`, `already_joined` or a `waitlist_join_state` refusal. |
| `request_waitlist_join` | Anyone else's join: the event's state; the platform's hourly and daily caps (read-only, before anything about the address); then under an advisory lock on the address: already on the list (`already_joined`, nothing recorded), the address's hourly cap (`address_limited`), taking both platform caps, and a pending entry with the confirmation token's hash. Returns `requested`, `already_joined`, `address_limited`, `platform_limited`, `platform_daily_limited` or a state refusal. |
| `confirm_waitlist_join` | Confirms by token hash: locks the token, then the entry. Returns `joined`, `already_joined`, `not_found`, `expired`, `used` (confirmed before, and left since) or `closed` (the event isn't published, is external or has ended; it needn't still be sold out). |
| `leave_waitlist` | Takes the entry behind a leave token off the list, idempotently (`left`, or `not_found`). |
| `notify_waitlist` | Queues "tickets are available again" emails for an event with tickets left (see "Waitlist"): target 3 per ticket left, at most 100, within a 12-hour window; only the shortfall from people told in the window is queued, so calling it again is a no-op until more tickets free up or the window passes. People never told first, then join order; skips buyers (paid orders, by normalised address), people with an email still waiting, and stops at 500 a day platform-wide. Advisory lock per event. Called at commit by deferred constraint triggers on `ticket_types` (insert with tickets; update leaving more tickets than before) and `events` (status becomes `published`). The triggers catch any error from it and raise a warning instead (event id and SQLSTATE only), so queueing emails can never fail the refund, edit or approval that freed the tickets. |
| `edit_organiser_profile` | An approved organiser's profile edit (`PATCH /organisers/me`): locks the organiser row, checks it's still approved (`not_approved` → 409), writes only the fields sent whose value really changes (the featured video as `"provider:id"`), and appends their old and new values to `organiser_profile_edits`, in one step. A no-op edit writes nothing. Returns `updated`, `unchanged`, `not_approved` or `not_found`. |
| `admin_remove_featured_video` | An admin removes an organiser's featured video (any status): locks the organiser row (for update), clears it and logs a `profile_edit` by the admin with the reason. Returns `removed`, `unchanged` (none: nothing logged) or `not_found`. |
| `put_organiser_logo` | An approved organiser's logo (`PUT /organisers/me/logo`, already re-encoded): locks the organiser row (for no key update), checks it's still approved (`not_approved` → 409: nothing written), writes the logo, bumps the organiser's `updated_at` and logs a `profile_edit` by the owner (`logo`, old and new version), in one step. Returns `updated`, `not_approved` or `not_found`. |
| `delete_organiser_logo` | The organiser removes their logo, any status: locks the organiser row, deletes it, bumps `updated_at` and logs it. Returns `deleted`, `unchanged` (none: nothing written) or `not_found`. |
| `admin_remove_organiser_logo` | An admin removes an organiser's logo (any status), with a reason: as `delete_organiser_logo`, logged as a `profile_edit` by the admin with the reason (`byStaff`). Returns `removed`, `unchanged` (none: nothing logged) or `not_found`. |
| `member_profile_visible` | The one rule for seeing a member profile (stable SQL): the member behind a `profileId` if the viewer has a profile, neither is suspended, neither blocks the other, and the profile is visible or the viewer's own; else null. Used by every read and write by `profileId`; the API also requires a verified email. |
| `file_profile_report` | A report about a profile: key-share-locks the profile; only one the reporter can see now (`member_profile_visible`) or a member they've blocked (else `not_found`, the unknown-id answer); an open profile report by the same reporter about the same member is returned as it is (`already_open`, no allowance used; two at once: the unique index makes the second find the first); then the reports rate limit, the photo copied once per distinct image (`report_photos`, upserted so a concurrent purge skips it), and the insert (`target_type` `profile`). Returns `filed`, `already_open`, `not_found`, `self` or `rate_limited`. |
| `create_block_by_profile` | `create_block` for a profile the blocker can see now (`member_profile_visible`); same snapshot, rate limit and results. |
| `request_conversation_by_profile` | A first message by `profileId`: the profile must be visible to the sender (`unavailable` otherwise, 404); picks the soonest open event both are opted in to (`not_going` if none) and hands over to `request_conversation` with that attendeeId, so every other rule is the same code. |
| `admin_remove_profile_content` | An admin removes a member's photo, bio and/or Instagram handle: locks the profile (no key update), then the photo; removes only what's there; logs the fields, admin and reason in `profile_moderation_log`. Returns `removed` (with the fields), `unchanged` or `not_found`. |
| `follow_organiser` | A follow (or a change of its email choice): key-share-locks the approved organiser (`not_found` otherwise; `self` for its own account), then an advisory lock on the account; an existing follow is `exists` (its choice updated if sent); else the 500-follow cap (`limit`) and the 60-an-hour allowance (`rate_limited`) before the insert (`followed`, emails off unless the choice sent was true). |
| `unsubscribe_follow` | Turns a follow's emails off by an unsubscribe token's hash (the follow stays). Idempotent: `unsubscribed` or `not_found`. |
| `notify_followers` | Run at commit by the deferred constraint trigger `events_followers_announce` (status becomes `published`): for a published, upcoming event of an approved organiser, records the announcement (once per event ever: a republish is a no-op), then, under an advisory lock per organiser, queues one `organiser_new_events` job per follower with emails on and a confirmed email (`auth.users.email_confirmed_at`) who has none waiting, due at the later of now and 24 hours after their last, until the platform's 500 a day. Locks each follow row as it's queued. |
| `claim_email_outbox` | `claim_outbox_jobs` for every kind, also returning the follow. `claim_outbox_jobs` (the previous release's) now leaves `organiser_new_events` alone, for the deploy window. |
| `lease_outbox_jobs` | `claim_email_outbox` for every kind, also returning the event and the organiser (the review emails). `claim_email_outbox` (the previous release's) now leaves `event_review` and `organiser_review` alone, for the deploy window. Since `20261109000200_payment_reconciliation.sql`, `ops_alert` jobs only when asked for that kind (the app drains them first, then the rest), so a release that can't send them never leases one; `claim_email_outbox` never takes them either. Since `20261111000000_event_publish_now.sql`, `event_published` jobs likewise only when asked for by kind (this app's drain asks for them last), so the previous release's cron can't lease one and fail it as an unknown job. Since `20261111000500_organiser_invite_links.sql`, `organiser_joined` jobs the same way (drained after `event_published`). Since `20261111000700_onboarding_emails.sql`, without a kind it leases only an allowlist (`ticket_email`, `waitlist_available`, `organiser_new_events`, `event_review`, `organiser_review`): every other kind, `onboarding` included and kinds added later, only when asked for by name (drained last). |
| `queue_onboarding_email` | Records that an account is to get a welcome kind and queues its `onboarding` job to run at a given time, only if the `(user_id, kind)` record was new (returns whether it queued). Idempotent; never queues twice. |
| `queue_member_welcomes` | Called at the start of each cron run: queues `member_welcome` for up to N accounts with a confirmed email, not banned or deleted, with an address and no welcome record, oldest confirmation first, within a platform cap of 300 a day (`take_platform_rate_limit`, bucket `onboarding_emails_daily`; the rest wait for the next window). One run at a time (`pg_try_advisory_xact_lock`): a concurrent run queues nothing. |
| `organisers_onboarding_email` | The deferred triggers' function on `public.organisers`: queues `organiser_welcome` on insert with an owner, and `organiser_next_steps` one hour after the organiser is inserted approved or updated to approved. Never fails the organiser's change (an error is a warning with the organiser id and SQLSTATE). |
| `queue_review_email` | Queues the admins' review email for an event in review or a pending application of an account's organiser (called by deferred triggers on `events` and `organisers`), or (`event_published`, called by `publish_event`) the "an organiser published an event" email for a published event of an account's organiser: nothing if one is already waiting or being sent for the subject (whatever its kind), due an hour after the last one sent, at most 10 a day per account and 100 a day platform-wide. The published emails count in buckets of their own (`published_emails`, `admin_published_emails_daily`; the review emails' are `review_emails`, `admin_review_emails_daily`), so publishes never use up the review emails. An advisory lock per subject serialises calls. Returns whether it queued. A trigger deletes a still-waiting job when its subject leaves review, and `drop_published_email` (trigger `events_published_email_drop`) a still-waiting `event_published` job when its event leaves `published`. |
| `suspend_organiser` | An admin takedown, only from `approved` (a second admin gets 409): locks the organiser row, then its published and pending-review events in id order; sets the organiser `rejected` with the reason and reviewer; moves each published event to draft (`unpublished`) and each pending one to `rejected`, through `transition_event`, so the event moderation log records each with the admin and reason; logs the takedown. Deletes nothing. Returns the result and how many events moved. |
| `record_payment_refund` | Records a `charge.refunded` by payment intent (see "Refunds made in Stripe"). Takes the payment intent's lock first, then (seated) the seat lock, then the order (`for update`), and acts only on a `paid` one. Full refund (Stripe's `refunded`, or a cumulative amount of at least `total_cents`; `20261111000300_refund_no_inference.sql`, which removed `20261110000200`'s tickets-only rule): `refunded`, the amount recorded, and each line item's quantity taken off its ticket type's `quantity_sold` (never below 0), updating ticket types in `ticketTypeId` order like `fulfil_order`, so the two can't deadlock; an open `partial_refund` exception is resolved. Partial (anything less, whatever it was for: nothing is inferred from the amount): only `amount_refunded_cents`, which only grows, and a `partial_refund` exception. A redelivery (already refunded, or no larger amount) changes nothing, so inventory is released exactly once. No order yet but the charge's destination is one of our organisers' accounts: an `early_charge_refunds` row, `deferred`. Returns `refunded`, `partial`, `unchanged`, `deferred` or `not_found`, with the order id when found (logged by short reference only). A full refund of a seated order also frees its seats (tickets' `seat_id` cleared, then the seats' sale), after the seat lock. The 6-argument form (charge id, destination, Stripe event id) is the app's; the 3-argument form delegates to it without a destination (never defers), for the previous app version during the deploy window (see "Not built yet"). |
| `lock_payment_intent` | Transaction-scoped advisory lock per payment intent: the first lock `fulfil_order` (paid orders), `record_payment_refund` and `record_refund_status` take, so a refund and its own order's fulfilment serialise. Lock order: payment intent, seat lock, order. |
| `fail_mismatched_order` | A paid Checkout Session whose amount or currency isn't its order's (`20261110000300_amount_mismatch_refund.sql`; see "Payment flow"). Payment intent lock, (seated) the seat lock, the order (`for update`); only a `pending` order: `failed` with the payment intent recorded (so the refund's own `charge.refunded` finds it and answers `unchanged`, never `deferred`), a seated order's holds released, an unapplied `early_charge_refunds` row marked applied and unmatched exceptions tied to the order, then an `amount_mismatch` exception (the app's reason, amount and currency, plus `totalCents`, `supportCents`, `orderStatus`) and its ops alert. Returns the order's status (another status: left alone) and `alert_queued`. The app then refunds the payment as for any failed order. |
| `record_refund_status` | A refund's status (`refund.updated`, `refund.failed`, `charge.refund.updated`, or what our own refund call returned): takes the payment intent's lock; trusts the refund's `metadata.orderId` only when that order's payment intent is the refund's own (otherwise the order is found by payment intent); for an event, compares it with the refund's mark (`refund_status_marks`) and stops (`stale`, nothing written) if it's older than one already applied; then records our automatic refund on its `oversold_refund_required` order (refund id; `refunded` once it succeeded), then `failed` / `canceled` / `requires_action` raise a `refund_not_completed` exception and `succeeded` resolves an open one for the same refund (only for an event strictly newer than the last applied). A payment with no order and no early refund row writes nothing (`not_found`). |
| `raise_payment_exception`, `resolve_payment_exception` | Open or update an exception (`opened`, `reopened`: an automatically resolved refund exception failing again, `updated`, `unchanged`: one an admin resolved, `stale`: an older event), queuing an `ops_alert` outbox job on `opened` / `reopened` within 20 per 24 hours (platform counter `ops_alerts`). An admin closes an open one with a note (`resolved`, `not_open`, `not_found`). |
| `replace_seat_map`, `delete_seat_map` | The organiser's map (see "Reserved seating"): the seat lock, then the event row (owned by the organiser, else `not_found`); only while draft or rejected (`not_editable`) and never approved (`frozen`), not external (`external`), and the event has no orders of any status (`has_orders`); then `write_seat_map` / `clear_seat_map`. |
| `admin_replace_seat_map` | An admin's replacement (layout) or removal (null), any status, only while the event has no orders of any status (`has_orders`); a reason is required; logged `edited` with `changes.seatMap` (old and new `{version, seatCount}`). Nothing changing is `unchanged`, nothing logged. |
| `write_seat_map`, `clear_seat_map` | Internal: store a layout (the seats derived from it in SQL, so the two can't disagree; at most 5 tiers, `event_seat_maps_max_tiers`; then every tier's `seated` and capacity recomputed) or remove it. An identical layout is `unchanged` (version kept). Either refuses (check_violation, `event_seat_maps_no_orders`, the API's 409) when the event has any order, whatever the caller checked: defence in depth, so no caller can rewrite seats a pending order holds or a paid one has sold. |
| `hold_seats` | A paid seated checkout's pending order (with its Support Sheltüh amount, `p_support_cents`, default 0: `20261110000100_order_support.sql`) and its holds, all or nothing (see "Reserved seating"): the seat lock; a used-up hold window refused with a plain read (`rate_limited`, nothing written); then the order, the event (published, Sheltüh-ticketed), the map version, every seat free (else `seats_unavailable` with the ids), lines matching the seats' tiers, and the held-seat cap; only then, with every refusal decided, one hit on the event's hold counter (`take_event_rate_limit`, bucket `seat_holds`, its row locked last) and the holds. A refusal writes nothing at all, so refused attempts (the cap above all) never use up the allowance (`20261102000000_seating_hardening.sql`). Returns `held` (with `hold_expires_at`), `rate_limited`, `not_on_sale`, `version`, `seats_unavailable`, `tier_mismatch` or `hold_cap`. |
| `release_seat_holds` | A pending order marked `failed` and its holds cleared, under the seat lock; anything not pending is returned unchanged (its status). |
| `take_client_rate_limit`, `take_seat_hold_attempt` | `take_rate_limit`'s fixed-window counter keyed on a client key (or, for `order_payment:order`, an order key). `take_seat_hold_attempt` takes one hit on the client's `seat_holds:<event id>` bucket, then one on its `seat_holds` (all events) bucket, in that order (nothing else writes them), and returns `ok`, `event` or `all`; a refusal keeps neither hit (`20261103000000_seat_hold_client_limits.sql`). |
| `place_free_seated_order`, `request_free_seated_order` | `place_free_order` / `request_free_order` for a seated free order (the seat lock first; the order records its seats). A guest's order holds nothing until confirmed. `seats_unavailable` when a member's seat is gone. |
| `fulfil_order` | Queues the ticket email in the same step (see "Payment flow"). Takes inventory for every line item, issues the tickets and marks the order paid. If any ticket type has sold out, or the event is no longer published, it takes nothing and marks the order `oversold_refund_required`. Rows are locked in a fixed order, so concurrent orders can't deadlock. It's idempotent, so Stripe's webhook redeliveries are harmless. A seated order takes the event's seat lock first, needs every seat (free, its own hold, or an expired hold) and lines that match its seats exactly (no order buys a seated tier without seats), and gives each ticket one of its tier's seats; otherwise the oversold path, which also clears its holds. A paid order takes the payment intent's lock first and, after the pending check, applies an early refund recorded for its payment (once), by `record_payment_refund`'s rule (`20261111000300_refund_no_inference.sql`): in full (Stripe's `refunded`, or at least `total_cents`), the order becomes `refunded` with nothing taken, issued or emailed (holds cleared; returns `refunded`); in part (anything less), it's fulfilled as normal, then the amount is recorded and a `partial_refund` exception opened. The body is `fulfil_order_detailed`, which also returns `alert_queued` (that exception queued an ops alert), so the webhook drains the alert outbox only then; `fulfil_order` (same signature, the free paths') returns its status. |

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
   - A paid order needs card payments to be configured:
     `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` set, and of the same mode as
     `STRIPE_SECRET_KEY` (`pk_test_` with `sk_test_`/`rk_test_`, `pk_live_`
     with `sk_live_`/`rk_live_`; `lib/server/stripe-keys.ts`). Otherwise it's
     a 503 "Card payments aren't available right now." after the usual
     404/409/400 checks and before any order, seat hold or hold attempt is
     written or Stripe is called, so a misconfigured deploy leaves nothing
     behind. The server logs which variable is wrong and the modes, never a
     key's value. Free tickets don't need it. The key is inlined at build
     time (`Deps.stripePublishableKey`, a literal `process.env` reference), so
     the server checks the same value the browser's bundle was built with.
   - Then (general admission; seated has its own per-client hold limit) one
     hit on the client's paid checkout allowance
     (`CHECKOUT_RATE_LIMITS.paidCheckout`: 10 a minute per client, bucket
     `paid_checkouts`, keyed and failing open as the seat-hold limit: see
     "Reserved seating"), taken inside the checkout attempt with its
     per-10-minute limits (20 per event, 60 in all; "Checkout idempotency"),
     only when a new order is about to be made. Over any of them: 429
     `code: "client_rate_limited"`, nothing written in any bucket and
     Stripe not called. The 404/409/400/503 refusals, a settled answer for
     the request's `Idempotency-Key` (a replay, "in progress"), and a retry
     that reuses a kept order never count; free orders have their own
     limits. A buyer starts one, or a few after going Back: 10 leaves
     room for several buyers on one address (venue wifi, a phone network's
     shared address) and bounds the pending orders and Stripe sessions one
     client can make.
   - The order is inserted as `pending` *before* Stripe is called, so a
     payment can never arrive without an order to attach it to.
   - A paid checkout is one attempt per `Idempotency-Key`: a repeat gets the
     same order and session, never a second one, and Stripe is asked with a
     per-order idempotency key (see "Checkout idempotency" below).
   - An optional `supportCents` (Support Sheltüh, general admission and
     seated) is validated here and stored on the order before Stripe is
     called (see "Support Sheltüh"; paused by default: refused unless
     `NEXT_PUBLIC_SUPPORT_SHELTUH` is `1`).
   - A Checkout Session is created as a destination charge to the
     organiser's Express account, with `application_fee_amount` set to the
     booking fee plus any Support Sheltüh (so the organiser's transfer is
     the same with or without it). It's an embedded session (`ui_mode: "embedded_page"`) with
     a `return_url` of `{NEXT_PUBLIC_SITE_URL}/checkout/success?session_id={orderId}`
     (no `{CHECKOUT_SESSION_ID}` template: the order id is the only id the
     return page needs), and no `success_url` or `cancel_url` (that mode
     has neither; Back is our own link). Line items, fees, transfer,
     metadata, `customer_email` and `client_reference_id` are what the hosted
     session had. General admission sessions expire after an hour
     (`expires_at`, `GA_CHECKOUT_SESSION_MINUTES`; Stripe's default is 24
     hours and its minimum 30 minutes), which bounds how long the client
     secret is any use and how long a form already on screen stays payable
     after the page says `closed`; seated sessions after 31 minutes (see
     "Reserved seating").
   - Both sessions (general admission and seated) carry the same payment
     options (`SESSION_PAYMENT_OPTIONS`, `lib/server/checkout-attempts.ts`,
     which builds both sessions from the stored order):
     - `adaptive_pricing: { enabled: false }`, pinned whatever the Dashboard
       says. Buyers pay exactly the A$ total from `lib/fees.ts` that every
       page shows (ACL all-inclusive pricing). Left on, Stripe could charge
       a buyer abroad a converted amount plus its conversion fee.
     - No `payment_method_types`, `excluded_payment_method_types`,
       `payment_method_configuration` or `wallet_options`, so the
       platform's Dashboard payment methods apply (cards, Apple Pay, Google
       Pay and Link: step 2).
     - Nothing is saved for later: no `customer`, `customer_creation`,
       `saved_payment_method_options` or `payment_intent_data.setup_future_usage`.
       Anyone holding the order id can load the form, so it must never show
       a member's saved card.
     The API tests assert all three (`expectSessionPaymentOptions`,
     `tests/server/helpers/api.ts`) on both kinds of session.
   - If Stripe errors, or returns no `client_secret` (nobody could mount the
     form, so nobody could pay), the general admission order is marked
     `failed` (a seated one releases its holds) and the checkout is a 500;
     if Stripe didn't answer at all, the checkout is a 503: a general
     admission order is kept for a retry with the same key, a seated one is
     released at once, seats freed (see "Checkout idempotency").
     A missing `NEXT_PUBLIC_SITE_URL` fails the same way, since the
     `return_url` is built in that step.
   - The 201 is `{url, orderId}` (seated adds `holdExpiresAt`), `private,
     no-store`, with `url` our payment page, `/checkout/pay?order={orderId}`
     (relative). The client secret isn't in it: the payment page reads it.
   - Free orders skip Stripe: see "Free tickets" below.
2. The buyer pays on our payment page, `/checkout/pay?order={orderId}`, in
   Stripe's embedded Checkout form: an iframe served by Stripe, mounted with
   Stripe.js. Card details go from that iframe to Stripe; they never touch
   Sheltüh's servers or our page's own code. The page is under
   `/checkout/*`, so it gets `no-referrer` and `noindex` (below).
   - It reads `GET /api/orders/by-session/{orderId}/payment`
     (`getOrderPayment`), not the checkout's response, so a reload, a new
     tab, or Back then Forward all work, and the client secret is never
     stored in the browser. The order id is the only credential, as for the
     other `/orders/by-session` routes. Every answer is `private, no-store`
     (`OrderPaymentLookup`, `lib/api/types.ts`):
     - an id that isn't shaped like one: 404 without a query;
     - then one hit on the client's allowance (`paymentPerClient`: 30 reads
       a minute per client, bucket `order_payment`, unknown ids included, so
       it also bounds trying ids); over it, 429 before the order is read;
     - unknown, or a guest's free booking (not a card checkout): 404;
     - `done`: the order is `paid`, `refunded` or `oversold_refund_required`
       (Stripe isn't asked);
     - `closed`: the order is `failed`;
     - 409 while the order has no Stripe session yet (as the cancel route);
     - otherwise one hit on the order's allowance (`paymentPerOrder`: 20 a
       minute per order however many clients ask, bucket
       `order_payment:order`, keyed on an HMAC of the order id; 429 over it,
       Stripe not asked), then Stripe's session is retrieved. Only these
       answers call Stripe, so only they count per order. `complete` →
       `processing`
       (`delayed: true` while the payment hasn't cleared, for a payment
       method that takes time). `expired`, or past its `expires_at` →
       `closed`. `open` → `closed` if the event can no longer be booked: not
       published (unpublished by its organiser or an admin, or its organiser
       suspended, which unpublishes every event: what `fulfil_order`
       refuses), or ended (`ends_at <= now()`, as for new orders); else
       `sold_out` if a line's tickets aren't all left or (seated) one of its
       seats is sold, blocked, gone or held by another order (a non-binding
       read, `openOrderState`; `fulfil_order` decides); else `open`, with
       the session's `clientSecret`, its `expiresAt`, and a summary priced on
       the server: event title and slug, date, venue name and suburb, each
       line's all-inclusive unit and line totals (`calculateOrderSummary`,
       `lib/fees.ts`), whether that line includes a fee the buyer pays
       (`buyerPaysFee`: its ticket type is buyer-pays and paid; per line, so
       an order mixing fee policies says "incl. fee" only where it applies)
       and its seats, and the order's subtotal, buyer fee and total. Never the order, event or organiser ids, the fee split, the
       buyer's email or any other Stripe id.
     - `closed` and `sold_out` carry `eventTitle`, `eventSlug` (when the
       event still has one) and `seated`, for the way back.
   - The limits are `CHECKOUT_RATE_LIMITS` (`lib/server/handlers/orders.ts`):
     fixed windows on `take_client_rate_limit`, no migration (new bucket
     names). The page reads this on load, on Back-Forward and at expiry, and
     the return page once, so 30 a minute covers several buyers on one
     address; the per-order 20 caps Stripe retrieves for one order from any
     number of addresses. The per-client limit fails open (logged, no
     request detail) without a client IP; both fail open without
     `STRIPE_WEBHOOK_SECRET`. A 429 is `{error}`, `private, no-store`.
   - It writes nothing but those counters, and logs nothing about the order
     or the secret. An
     `open` session without a client secret (a hosted session from before
     embedded checkout) is a 500, logged without the order or session id.
   - `closed` and `sold_out` only change what the page shows. Stripe's
     session stays open until it expires or is cancelled, and a form that
     was already mounted can still be paid; the webhook then settles that
     payment as any other (step 3: refunded if the event is unpublished or
     the tickets are gone, fulfilled if it has only ended).
   - Stripe sends the buyer to the `return_url` when the form completes, and
     also back from a redirect-based payment method, whether or not it was
     paid; the return page tells those apart (step 5).
   - Leaving: the page's Back link goes to the event page (general
     admission, which holds nothing; its session expires on its own) or the
     seat page (seated, which cancels the order and releases the seats: see
     "Reserved seating", "Back from the payment page").
   - Stripe's form is branded in Stripe's Dashboard (white background, black
     button: `docs/supabase-setup.md` §2), not in code. Stripe.js loads on
     this page only.
   - **Wallets and Link** are switched on in the Dashboard, not in code
     (Settings → Payment methods; `docs/supabase-setup.md` §2, step 5). Stripe
     shows Apple Pay, Google Pay and Link in the embedded form only on a
     registered payment method domain where that method is `active` (the
     Stripe SDK's own description of payment method domains). Each domain
     serving `/checkout/pay` is registered with `npm run payment-domains`
     (`scripts/register-payment-domains.ts`, which checks by default and
     exits non-zero unless all three are active) or in the Dashboard. Link
     prefills the buyer's email when the checkout sent one (`customer_email`);
     Link's saved cards are behind Link's own one-time code to the buyer, so
     whoever holds the order id still can't pay with them. **Unverified**
     (sandbox checklist items 11–13): whether one registration covers test
     and live mode (the script reports `livemode`, so run it with each key);
     whether Apple Pay still needs
     `/.well-known/apple-developer-merchantid-domain-association` (if Stripe's
     error message asks for it, serve it from `public/.well-known/`;
     `proxy.ts` matches only `/checkout/pay`); that with destination charges
     and no `on_behalf_of` the platform's payment method settings and
     domains apply, not the connected account's; Link's availability in
     Australia. Afterpay, Klarna, Zip and PayPal stay off (no buy-now-pay-later
     without repricing, `docs/FEATURE_PLAN.md`).
3. `POST /api/stripe/webhook`:
   - The signature is verified.
   - `checkout.session.completed` (when the session is paid) or
     `async_payment_succeeded` → `fulfil_order`, but only when the session
     charged exactly the order's stored total in AUD (`amount_total` =
     `total_cents`, Support Sheltüh included, and `currency` = `aud`;
     `sessionMoneyMismatch`, `lib/server/handlers/orders.ts`). The session
     is built from the stored order, so this is defence in depth: on a
     mismatch (or a session with no amount or currency) nothing is issued
     or taken. `private.fail_mismatched_order` marks the order `failed`
     (with the payment intent recorded, and a seated order's holds
     released) and opens an `amount_mismatch` payment exception (one open
     per order; details: the reason, `amountChargedCents`, `currency`, the
     order's `totalCents`, `supportCents` and `orderStatus`), always
     `urgent`, with an ops alert. The payment is then refunded in full as a
     failed order's is (`refundPaymentForFailedOrder`: `reverse_transfer`,
     `refund_application_fee`, metadata reason `amount_mismatch`, chosen from
     the exception so every retry sends the same parameters; idempotency key
     `failed-order-refund-<order>`, and `stripe_refund_id` recorded). A
     redelivery finds the order `failed` and goes the failed-order way: no
     second refund. A refund call that errors answers 500 and Stripe's
     redelivery asks again. An admin checks the refund in Stripe and
     resolves the exception. Free orders never reach this (no Checkout
     Session), and the refund path for oversold orders is unchanged. A
     payment for an order that had already failed records the payment
     intent before Stripe is asked for the refund too, so the refund's
     `charge.refunded` finds it.
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
   - `refund.updated`, `refund.failed`, `charge.refund.updated` →
     `record_refund_status` (see "Refunds made in Stripe"). Our own refund
     call's answer goes through it too, with no Stripe event id or time (the
     webhook's event is the checkout's, not the refund's).
   - A refund call Stripe answers with `charge_already_refunded` (the charge
     was already refunded in full, e.g. in the dashboard) is done, not a 500:
     an oversold order is marked `refunded`, a failed one stays `failed`.
     An automatic refund with no payment intent on record opens a
     `manual_refund_required` exception.
   - Any other event type is acknowledged (200) and ignored.
   - Inventory is only taken here, so an abandoned checkout never holds
     tickets.
   - Seated orders: see "Reserved seating" (holds, `expires_at`, Back from
     the payment page, and releasing seats on expiry or failure).
4. Once an order is paid (free orders included), the buyer is emailed their
   ticket codes over SMTP (`lib/server/email.ts`) through a durable outbox
   (`private.email_outbox`, `lib/server/email-outbox.ts`):
   - `fulfil_order` queues the job in the same transaction that marks the
     order paid, so it can't be lost; a redelivered webhook never reaches
     that point again, and `(order_id, kind)` is unique.
   - The first attempt runs straight after the response (`Deps.defer`, Next's
     `after()`), for that order only. `GET /api/cron/email-outbox` (bearer
     `CRON_SECRET` compared in constant time) sends everything else that's
     due, and records the run in `private.cron_runs`. Two schedulers call it:
     Vercel Cron (`vercel.json`: daily at 17:00 UTC, the Hobby plan's limit;
     every 5 minutes once on Pro, which needs `vercel.json` edited and
     redeployed: the plan change alone does nothing) and, on Hobby, Supabase
     Cron with `pg_net` every 5 minutes, with the secret in Supabase Vault,
     set up by the owner (`docs/supabase-setup.md` §3; no migration schedules
     it). Calling it every 5 minutes, or from both at once, is safe: a run
     takes at most 100 jobs, stops claiming after 30 seconds (so the last
     one claimed can still be sent within the route's 60-second
     `maxDuration`), and with nothing due is two indexed claims and one
     upsert. There's no in-request retry: a second SMTP attempt inside
     `after()` would share the route's `maxDuration` with the first (each can
     take about 20 seconds of timeouts), a failure after the server accepted
     the message would mean a duplicate email, and the 5-minute runner
     already retries within minutes.
   - Workers lease one job at a time (`claim_email_jobs`, `for update skip
     locked`, 2-minute lease), so concurrent workers never take the same job;
     only the lease holder can record the outcome (`finish_email_job`). A
     worker that dies leaves a lease that expires and is retried.
   - Retries after 1 min, 5 min, 30 min, 2 h and 6 h (±20% jitter); the 6th
     failed attempt is final (`failed`, the dead letter an admin resends). An
     order that's no longer paid, or has no address, fails at once. A delay
     is the earliest the next attempt can run; it runs on the next call of
     the cron route. Retry timeline after a failed first send:

     | Runner | 2nd attempt | 3rd attempt | 6th (last) attempt |
     | --- | --- | --- | --- |
     | every 5 minutes | within about 6 min | within about 17 min | 7 to 11 hours later |
     | daily Vercel Cron only | up to about 24 hours | at the next day's run | 4 to 5 days later |
   - `GET /api/admin/emails/health` (admin) shows whether it's working:
     per kind and in total, due, overdue (more than 15 minutes), the oldest
     overdue age, waiting, sending, expired leases and failed jobs, when the
     cron route last finished a run, and whether `CRON_SECRET` is set. Counts
     only. Overdue or failed jobs don't raise an ops alert (alerts are tied
     to payment exceptions); check the endpoint after go-live and when
     buyers report a missing email.
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
     PNG (black on opaque white, 212×48 shown at 106×24, theme-white-dark.md
     §5.12, about 3 KB) rendered from `public/brand/sheltuh-wordmark.svg`
     (`scripts/render-email-wordmark.ts`: `public/brand/sheltuh-wordmark-email.png`,
     embedded as base64 in `lib/server/email-wordmark.ts`) and attached
     inline (`cid:`) like the QR codes, so it shows where Outlook blocks
     remote images; alt text "SHELTÜH". The banner
     (`EMAIL_FOOTER_IMAGE_URL`, https://sheltuh.com.au/sheltuh_email_signature_logo.png) is the only
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
     white page, white card with a black hairline, black text, Signal Orange only on the one
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
   This page only reads. While the order is still pending after a couple of
   polls, it can ask `GET …/payment` once to tell a payment Stripe already
   has (`processing`: keep waiting, and the tickets follow by email if it's
   slow to clear) from a redirect-based payment that was cancelled or
   failed (`open`: nothing charged, with a way back to the payment page) or
   a checkout that's over (`closed`, `sold_out`).

### Accepted risks (embedded checkout)

- **The payment iframe sits on our page (PCI).** With Stripe's hosted page,
  nothing of ours ran beside the card form. Now `/checkout/pay` hosts
  Stripe's iframe, so a script injected into that page could, for example,
  overlay or replace the form. The card fields themselves are still
  Stripe's, in Stripe's iframe. The SAQ A eligibility criteria in PCI DSS
  v4.0.1 ask the merchant to confirm its site isn't susceptible to attacks
  from scripts that could affect the e-commerce system; check the current
  SAQ and Stripe's guidance before going live. **Follow-up: a strict
  Content Security Policy (nonces) on `/checkout/pay`.** It's being added
  as `Content-Security-Policy-Report-Only` on `/checkout/pay` first (the
  frontend's change), to be enforced once its reports are clean; any later
  site-wide CSP has to allow Stripe's hosts (Stripe publishes the list; it
  wasn't verified here).
- **The client secret goes to whoever has the order id.** The same model as
  the other `/orders/by-session` routes: the id is `ord_` + 32 hex, a
  UUIDv4, so 122 random bits (6 of its 128 are fixed by the format), sent
  only to the client that made the order (and in Stripe's `return_url`),
  never a `Referer` (`no-referrer`), never cached (`no-store`). With the
  secret, someone can mount the form and pay for that order; they can't
  change its amount. They can read what the form shows, until the session
  expires (an hour for general admission, 31 minutes seated): the order's
  line items and total (what our summary shows anyway) and, when the buyer
  typed one at checkout, the prefilled email address (`customer_email`).
  That is personal information, so the id stays a credential: never logged
  in full (short references only), and the expiry is kept short.
- **Order ids in request logs.** The id is in the path of
  `/api/orders/by-session/{orderId}/…` and in the query of
  `/checkout/pay?order=` and `/checkout/success?session_id=`, so Vercel's
  request logs hold it (see `docs/REMEDIATION_PLAN.md`). Before adding a
  log drain or sharing logs, redact `ord_[0-9a-f]{32}` in them (replace
  with the short reference, or `ord_[redacted]`).
- **`GET …/payment` and paid checkout are rate-limited per client and per
  order, not globally.** A client with many addresses (a botnet, rotating
  IPv6 /64s) gets 30 payment reads and 10 paid GA checkouts a minute per
  address; the per-order limit still caps Stripe retrieves at 20 a minute
  per order, and trying ids is futile at 122 bits. A shared address with
  many real buyers (a phone network's CGNAT during a big on-sale) could
  meet a 429; the page then says to wait a minute. Raise
  `CHECKOUT_RATE_LIMITS` if it bites.
- **`closed` for an event that can't be booked isn't binding.** The
  session stays payable until Stripe expires it (an hour for general
  admission, 31 minutes seated) for a form already on screen. Such a
  payment is refunded automatically if the event is unpublished, and
  fulfilled if the event has only ended (`fulfil_order` is unchanged).
- **`no-referrer` on `/checkout/pay`.** Whether Apple Pay, Google Pay and
  Link work with it is unverified (sandbox checklist below). If the wallets
  don't appear on a domain whose methods are all `active`, the fallback is
  `strict-origin` on `/checkout/pay` only: it sends the origin, never the
  path or `?order=`. That changes `next.config.ts` (the `/checkout/*`
  headers), the page's own referrer meta in `app/checkout/pay/page.tsx` and
  the header assertion in `e2e/checkout-pay.spec.ts`; don't make it without
  a sandbox run showing it's needed.
- **Wallets and Link need a registered domain.** Per-deployment
  `*.vercel.app` preview URLs can't be registered ahead of time, so they
  show cards only. Test wallets on a stable preview domain (e.g.
  `preview.sheltuh.com.au`, registered in test mode) and on
  `sheltuh.com.au`.
- **In-app browsers.** Most discovery happens on Instagram, and whether
  Apple Pay or Google Pay appear inside its in-app browser (or the installed
  iOS app's standalone window) is unverified. Link and card entry still work
  there. An "open in your browser" hint would be a product decision.
- **Wallet iframes and the CSP.** Wallets and Link run inside Stripe's
  iframe, which our Report-Only policy doesn't govern; no CSP change is
  expected (unverified: the sandbox run must show no violations). There's
  no `Permissions-Policy` header today; any future one must allow
  `payment`.
- **Stripe.js on the payment page only.** Better for privacy, but Stripe's
  fraud checks (Radar) get fewer signals than with Stripe.js on every page.
- **Redirect-based payment methods** (if enabled in the Dashboard) can
  return outside the installed iOS app's standalone window.
- **Preview deploys.** The `return_url` uses `NEXT_PUBLIC_SITE_URL`, so a
  preview needs its own value or buyers return to production.
- **A session without a client secret** is left to expire in Stripe rather
  than expired straight away; its order is already failed (or its seats
  released), so a payment on it would be refunded as for any failed order.
- **Hosted sessions from before the deploy** still use `success_url` and
  `cancel_url` for up to 24 hours, so `/checkout/cancelled` stays (see "Not
  built yet").

### Owner sandbox checklist (embedded checkout)

Nothing below has been run against Stripe: the automated tests use a fake
Stripe. Run it in **test mode** before going live, with the Stripe CLI and
a local server (`npm run dev`, port 3000).

1. **Setup.** In `.env.local`: `STRIPE_SECRET_KEY` (`sk_test_…`) and
   `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` (`pk_test_…`) from the **same**
   Stripe account (Developers → API keys). Run
   `stripe listen --forward-to localhost:3000/api/stripe/webhook`, put the
   `whsec_…` it prints in `STRIPE_WEBHOOK_SECRET`, then restart `next dev`
   (the publishable key is read at build/start). An organiser with payouts
   set up and a published event with a paid ticket type are needed.
2. **Success.** Pay with `4242 4242 4242 4242` (any future date, any CVC).
   Expect: the return page shows the tickets; `stripe listen` shows
   `checkout.session.completed` answered 200; in Stripe the payment has the
   application fee and the transfer to the connected account. This also
   proves Stripe accepts a `return_url` without `{CHECKOUT_SESSION_ID}`.
3. **Decline.** Pay with `4000 0000 0000 0002`. Expect: the form shows the
   decline, nothing redirects, the order stays `pending`
   (`select status from orders where id = '<order id>'`). Then pay with
   `4242…` in the same form: it succeeds as in 2.
4. **3D Secure.** Pay with `4000 0025 0000 3155`. "Complete" on the
   challenge succeeds as in 2; "Fail" shows an error and the order stays
   `pending`.
5. **Duplicate delivery.** Find the `checkout.session.completed` event id
   (`evt_…`) in `stripe listen`'s output or Developers → Events, then
   `stripe events resend evt_…`. Expect a 200, no new tickets, no second
   ticket email, `quantity_sold` unchanged. If the resend doesn't reach
   `stripe listen`, use the Dashboard's Resend on a deployed test endpoint.
6. **Sold out.** Set a ticket type's quantity to 1. Open its checkout in
   two browsers (or a normal and a private window) and pay in both. Expect:
   one gets the ticket; the other's order is refunded in full (refund,
   transfer reversed, application fee refunded) and its return page says
   so. Pressing Checkout once it's sold out gives the 409.
7. **Seated expiry.** Start a seated checkout, then
   `stripe checkout sessions expire cs_…` (the session id is the order's
   `stripe_checkout_session_id`). Expect: `checkout.session.expired` is
   answered 200, the seats are free again on the seat page, and reloading
   `/checkout/pay?order=…` shows the checkout has closed. Also: Back from
   the payment page releases the seats straight away.
8. **Reload.** Reload `/checkout/pay?order=…` on an open checkout. Expect
   the form to mount again: this proves `sessions.retrieve` returns the
   session's `client_secret`, which `GET …/payment` depends on.
9. `stripe trigger checkout.session.completed` (a session the app doesn't
   know) is answered 200 and changes nothing.
10. If a redirect-based method is enabled (Dashboard → Settings → Payment
    methods), cancel it at the provider: the return page offers to go back
    to the payment page, and nothing was charged.
11. **Wallets.** First `npm run payment-domains -- <domain>` with the test
    key: Apple Pay, Google Pay and Link all `active` (exit 0). Then, over
    HTTPS on that domain (not localhost, not a `*.vercel.app` URL): Apple Pay
    in iPhone Safari and in the installed iOS app; Google Pay in Android
    Chrome and desktop Chrome; and note what Instagram's in-app browser shows
    on iOS and Android. For each payment: the tickets are issued, Stripe
    shows the application fee and the transfer, and DevTools shows no
    Report-Only CSP violations on `/checkout/pay`. If the wallets don't
    appear although the domain's methods are active, see the `no-referrer`
    accepted risk above before changing anything.
12. **Link.** Signed out: pay with a test card, choosing to save it with
    Link; then start another checkout with the same email and pay with Link
    (one-time code, then one tap). Signed in: the email arrives prefilled.
    Both: tickets issued, fee and transfer as in 2, no CSP violations.
13. **Adaptive Pricing.** The form shows only A$ amounts, the total matches
    our summary to the cent, and Stripe → the payment shows AUD with no
    currency conversion (unverified for a buyer abroad: try a VPN if one is
    to hand).
14. `/checkout/pay` responses carry `Referrer-Policy: no-referrer` and
    `X-Robots-Tag: noindex, nofollow`; no other page requests
    `js.stripe.com`.

## Booking fee

6% of the ticket's face value, rounded to the nearest cent (half a cent
up), plus A$0.50, per paid ticket; free tickets carry none, and a paid
ticket costs at least A$1.00 (`MIN_PAID_TICKET_CENTS`, whose fee, 56 cents,
stays below it). It's defined only in `lib/fees.ts` (`BOOKING_FEE_RATE`,
`BOOKING_FEE_FLAT_CENTS`); the UI's prices and the checkout API's order
totals both come from it, and buyer-facing copy uses `describeBookingFee()`
so it can't drift. The database holds no rate: an order records the amounts
the API computed (`buyer_fee_cents`, `application_fee_cents`, `total_cents`)
and nothing recomputes them later. Owner decision, October 2026: 6% +
A$0.50, up from September 2026's 4% + A$0.50 (`docs/PROJECT_CONTEXT.md`).

**Changing the booking fee** (edit `lib/fees.ts`, then the tests that pin
amounts):

- **Existing orders keep their recorded fee.** Paid, refunded and pending
  orders aren't repriced; refunds, payment exceptions and analytics read
  the stored amounts, so they stay consistent with what Stripe charged.
- **Checkouts already open keep their Stripe amount.** A Checkout Session
  created before the change was priced from its order and isn't changed by
  a deploy. The webhook fulfils only when the session's `amount_total`
  equals the order's stored `total_cents` (`sessionMoneyMismatch`,
  `lib/server/handlers/orders.ts`), so an old session paid after the
  change matches its old order and is fulfilled as normal.
- **A kept order isn't sent at the new fee.** The session's booking fee
  lines are priced by `lib/fees.ts` when the session is made, while the
  order's total was fixed when the order was. They can only differ for an
  order made before a change and reused by a retry after it (Stripe didn't
  answer; within `CHECKOUT_ATTEMPT.gaReuseWithin` or `seatedReuseWithin`).
  `runPaidCheckout` checks the session's line total against the stored
  `total_cents` before calling Stripe; on a difference it ends the attempt
  (the order failed, any seats released) with 409 `checkout_expired`, and
  the buyer's next press makes a new order at the current fee. Without the
  check, that session would charge more than the order and the webhook
  would refund it in full as an `amount_mismatch`.
- **Organisers who absorb the fee see a larger deduction** from each new
  sale (an A$30 ticket: A$2.30 instead of A$1.70), and buyer-pays prices
  rise by the same amount; the change applies only to sales after the
  deploy.

## Publishing events

Approved organisers publish their own events straight away (owner
decision, 27 Oct 2026; `supabase/migrations/20261111000000_event_publish_now.sql`,
`lib/server/handlers/event-publish.ts`). The person check is on the
organiser: every organiser is checked by an admin before they can publish
(the application review, see "Organiser profiles"). Their events are checked
after the fact, and a few kinds go to the review queue first.

- **The status flow.**
  - An organiser's draft (or rejected) event: `POST /events/{id}/publish`
    → `published`, or → `pending_review` when an exception below applies
    (the response's `status` says which). It needs a confirmed venue
    location first (409 `location_required`; see "Venue location").
  - `POST /events/{id}/submit` (always → `pending_review`) is kept for the
    previous editor and the deploy window, unchanged apart from
    `location_required` (see "Not built yet").
  - Admins: `pending_review` → `published` (approve) or `rejected`;
    `published` → draft (unpublish, with an optional reason); an admin's
    create or edit can publish directly ("Admin authoring"); a takedown
    unpublishes the organiser's published events and rejects those waiting
    ("Organiser profiles").
- **Logged as `approved`, by the organiser.** A publish that goes live is
  `transition_event` → `published` with action `approved` and the
  organiser's own account as the actor: not a new action. So everything that
  reads "approved before" treats it as an admin's approval: the ticketing
  freeze (`edit_event_draft`, `admin_edit_event`), the seat-map freeze,
  `ticketingLocked` (and the dashboard's "Unpublished" state), trending's
  6-hour rule and "just announced", and analytics' `everPublished`. The
  organiser's view of the log shows the entry as theirs (it's their
  account), not "Sheltüh team". Admin reads tell the two apart by comparing
  the latest approval's actor with the organiser's owner:
  `AdminEventRecord.publishedAt` and `publishedBy` (`"organiser"` or
  `"sheltuh"`), on published events only.
- **What sends it to review instead** (→ `pending_review`, logged
  `submitted`; the review email's trigger queues the admins' email, as for a
  submit). Any one of these, the caps checked last, after the checks that
  write nothing
  (`not_found` → 404; `already_published` → the API's idempotent 200;
  `in_review`, `ended`, `payouts_required`, `location_required` and `stale`
  → 409):
  1. the organiser's events are reviewed (`organisers.event_review_required`,
     an admin's switch, below);
  2. it's rejected now, or an admin's latest decision about it (the latest
     `approved` / `rejected` / `unpublished` entry) is `rejected` or
     `unpublished`: a republish after an admin removed it is an admin's call;
  3. it has a seat map (seated on-sales stay a human decision until hold
     protection exists: "Not built yet");
  4. its ticket link is on a site that isn't a known ticketing site
     (`p_force_review`, set by the API when `ticketProviderName` is null:
     anything not in `KNOWN_TICKETING_HOSTS`; see "External ticketing");
  5. **the organiser's first paid event sold on Sheltüh** (owner decision,
     27 Oct 2026; `20261111000200_first_paid_event_review.sql`): the event
     has a Sheltüh ticket type priced above 0 (`ticketing_mode` `sheltuh`),
     and the organiser has no event that is paid on Sheltüh whose latest
     admin decision (its newest `approved` / `rejected` / `unpublished`
     entry) is an `approved` logged by someone other than the organiser's
     owner. In words: "has had a paid Sheltüh event approved by Sheltüh
     before, and not since taken down". An admin's approval or publish
     counts; the organiser's own publishes never do; an approved event that
     has since ended still counts; one Sheltüh later unpublished, rejected
     or took down doesn't. Free events and events whose tickets are sold
     elsewhere always publish at once (Sheltüh takes no money for them).
     Read with the organiser's events (`events_organiser_created_idx`), their
     ticket types (primary key) and each one's latest decision
     (`event_moderation_log_event_idx`); no lock is needed: a concurrent
     admin approval not yet seen only sends this one to review;
  6. the caps: 10 self-publishes per account per 24 hours (`event_publishes`
     in `private.rate_limits`), then 100 per 24 hours platform-wide
     (`event_self_publishes_daily` in `private.platform_rate_limits`).
     Taken last, the account's first, so an event that goes to review
     anyway takes no slot and an account's refusal takes no platform slot.
     Over either, the event goes to review: a publish is never refused for
     the caps.

  Events with a clip are **not** sent to review (owner decision B-D1).
- **Why it went to review** (`PublishEventResponse.reviewReason`, only when
  this call sent it there): the first rule above that applied, as
  `publish_event` returns it (`submitted:<reason>`): `review_required` (1),
  `removed_before` (2), `seated` (3), `unknown_ticket_site` (4),
  `first_paid_event` (5), `daily_limit` (6). Absent when it went live or was
  already published; an unknown value from a newer database is dropped
  (`parsePublishResult`), so clients show a general message.
- **The review switch**
  (`POST /admin/organisers/{id}/event-review {required, reason}`,
  `private.set_event_review_required`): an admin turns
  review of one organiser's events on or off, with a reason (1–500
  characters), any organiser status. Logged on the organiser's log as a
  `profile_edit` by the admin (`changed_fields.event_review_required`, `"on"`
  / `"off"`); setting what's already set changes and logs nothing.
  `eventReviewRequired` is on `AdminOrganiserRecord` and on the organiser's
  own `OrganiserRecord` (`GET /organisers/me`), so the editor can say a
  publish will go to review.
- **Unpublishing** (`POST /admin/events/{id}/unpublish {reason?,
  reviewFuture?}`): back to draft, nothing deleted. The optional reason
  (1–500 characters, cleaned like a message; absent, null or blank: none)
  is logged with the `unpublished` entry and stored as the event's
  `rejectionReason`, which the organiser sees. Publishing it again goes to
  review (rule 2). `reviewFuture: true` also turns on the organiser's review
  switch (below), so the same content posted as a new event goes to review
  too: `private.admin_unpublish_event` locks the organiser, then unpublishes
  the event and calls `set_event_review_required` (logged as the admin's
  `profile_edit`, reason `Event unpublished: <reason>` or a fixed one), in
  one transaction; an event no longer published is a 409 with neither
  done. No email to the organiser yet ("Not built yet").
- **Checking after the fact.** Admins get an `event_published` email per
  self-published event ("Admin review emails");
  `GET /admin/events?status=published&recent=1` lists events that went live (their
  latest approval, by an admin or the organiser) in the last 14 days, newest
  first, ended ones included unless `upcoming=1` (the email links to the
  admin UI's "Recently published" view, `/admin/events?status=published&view=recent`);
  and `GET /admin/summary`'s `eventsPublishedByOrganisers {count,
  windowHours: 72}` counts events still published whose latest approval in
  the last 72 hours was the organiser's own. Both are served by the partial
  index `event_moderation_log_approved_idx`.
- **After the response** (`Deps.defer`, the route's `maxDuration` 60 s):
  live, the followers' emails (`notify_followers`, first publish only, as
  any publish) then the admins' `event_published` email, sharing one 30-second
  budget (`sendSelfPublishEmailsSoon`); to review, the review email
  (`sendReviewEmailsSoon`). Whatever doesn't fit waits for the outbox cron.
- **Locks.** `publish_event` share-locks the organiser, then locks the event
  (for no key update), as `submit_event`, an admin's approval and
  `suspend_organiser` (organiser, then events) do, so none of them can
  deadlock with it, and a takedown, a payouts change or the review switch
  either waits for the publish or is seen by it. Then the rate-limit rows,
  then (`queue_review_email`) the per-event advisory lock and the email
  limits. The API passes the ticket link it judged; a different stored link
  is `stale` (409 `event_changed`), closing the gap between the API's check
  and the write.
- **The route's module stays light**: `event-publish.ts` doesn't import
  `lib/server/event-input.ts` or `handlers/events.ts` (the 290 kB suburb
  table); `tests/server/event-publish.test.ts` checks the import graph.

### Accepted risks (publishing)

- **Anything an approved organiser publishes is live until an admin acts.**
  Misleading or offensive content, a wrong date or a bad ticket link on a
  known ticketing site goes live at once; the controls are the organiser
  check before they can publish, the admins' email, the "Recently
  published" view and count, unpublishing (with a reason, and optionally
  review of the organiser's next events), the per-organiser review switch
  and the takedown.
- **Paid events go live without a check once Sheltüh has approved one.**
  An organiser's first paid Sheltüh event is reviewed (rule 5), so a fake
  paid listing from a new organiser can't take money unchecked. After that,
  their paid events go live at once and destination charges pay the
  organiser at payment time, before any admin has looked; refunds with
  `reverse_transfer` can't recover money already paid out, and disputes are
  manual. Delaying payouts until after the event isn't built. The rule
  reads the current ticket prices, so an event that was free when Sheltüh
  approved it and was later made paid (by an admin's edit) counts as an
  approved paid event.
- **Recreating an unpublished event** gets around rule 2 (it's per event)
  unless the admin ticks "review their next events" (`reviewFuture`) or
  turns on the review switch. Trending waits 6 hours after the latest
  approval, so a self-published event isn't on the Trending rail before
  admins have had a chance to look.
- **Followers are emailed at once** (owner decision B-D4), before any admin
  has looked; an email sent can't be recalled. One per follower per
  organiser per 24 hours, as for any publish ("Following organisers").
- **After an unpublish, CDN windows still apply**: up to about 3 minutes
  for the feed, about a minute for the event's page, up to an hour for its
  image ("CDN windows").
- **The platform cap is shared.** Ten accounts at their own cap could use
  up the day's 100, after which everyone's publishes go to review (nothing
  is refused or lost; admins see them in the queue).
- **Admin emails are throttled** (10 a day per account, 100 a day
  platform-wide, at most one waiting per event); past that no email is
  queued, but the "Recently published" view and the summary count still show
  every event. One email per event will get noisy at scale; a daily digest
  is the next step.
- **Organisers still can't edit a published event** (owner decision B-D5):
  an admin edits it, or unpublishes it so the organiser can, and it then goes
  through review. The one exception: raising a general admission ticket
  type's total (owner-approved; "Releasing more tickets").
- **Concurrency** (the caps, a publish racing a takedown, the review switch
  or a payouts change) is enforced by row locks and rate-limit rows, but
  PGlite runs on one connection: run `tests/server` on a real Postgres
  (`TEST_DATABASE_URL`) before relying on it.

## Payouts before paid events

An organiser has to set up payouts (Stripe Connect, `organisers.payouts_enabled`) before an event with a paid Sheltüh ticket type can be submitted for review or published. Migration `20261109000000_paid_events_need_payouts.sql` enforces this in the database, whatever the code does:

- `events_paid_tickets_need_payouts` refuses a move to `pending_review` or `published` for a Sheltüh-ticketed event with a ticket type priced above 0 while its organiser's payouts are off. This covers the organiser's submit and resubmit, the organiser's publish (`publish_event`, either outcome), an admin's approval, and an admin's publish through `admin_create_event` or `admin_edit_event`. A move back to draft or rejected (unpublish, reject, takedown) is never refused.
- `ticket_types_paid_need_payouts` refuses a new paid ticket type, or a free one made paid, while the event is `pending_review` or `published` and the organiser has an owner and no payouts. Existing paid types stay editable; if payouts are turned off later, checkout's own guard refuses sales (`orders.ts`).
- `private.submit_event` is the organiser's submit, and `private.publish_event` the organiser's publish (see "Publishing events"). Each share-locks the organiser, then locks the event, so a concurrent Stripe re-sync either waits for it or is seen by it. Each returns `payouts_required` rather than raising (the publish route's message is `PAYOUTS_REQUIRED_TO_PUBLISH`).

The API answers 409 with `code: "payouts_required"` (`lib/api/events.ts`: `isPayoutsRequiredError`); admin create and edit responses also carry `fieldErrors.ticketTypes`. Drafts, free events and external ticketing never need payouts. Platform-managed organisers can't have payouts or paid ticket types at all (`organisers_platform_no_payouts`, `ticket_types_platform_free_only`), so the rule changes nothing for them. The editor warns up front using `OrganiserRecord.payoutsEnabled` from `GET /api/organisers/me`.

## Refund policy

Each event has a refund policy (`lib/refund-policy.ts`, migration `20261109000100_event_refund_policy.sql`): "No refunds for change of mind" (`no_change_of_mind`, the default, which every earlier event has and which matches `/refunds`) or refunds up to N days before the event (`days_before`, N from 1 to 30; `events.refund_days`, check constraints `events_refund_policy_check` and `events_refund_days_check`). Buyers are told a `days_before` policy against the event's start (`refundTermsLine`): "Refunds available until Sat 21 Nov, 7:00 pm (7 days before the event)." until the deadline (the start minus N × 24 hours, shown in the event's zone), then "The refund window for this event has closed. No refunds for change of mind." Buyers see it, with the standing Australian Consumer Law line (`REFUND_ACL_STATEMENT`), on the event page (`PublicEvent`), the payment page (`OrderPaymentSummary`) and the ticket page (`CustomerOrder`, paid and listed only); the ticket email says it too, for an order that cost something, of a listed event (`ticketEmailRefundPolicy` in `lib/server/ticket-email.ts`). The organiser sets it in the event editor (`components/dashboard/RefundPolicyField.tsx`). It applies to Sheltüh-ticketed events; for an external event the ticketing site's terms apply, so the UI doesn't show it.

Organisers set it while the event is a draft or rejected; once it's submitted only an admin can change it. Buyers keep what they bought under: a change that makes the policy less generous for an event with paid orders, or pending ones that can still be paid (`private.event_has_payable_orders`: a card order whose Checkout Session is recorded, or a guest's free order waiting on its emailed link; a card order still being set up, or kept after Stripe didn't answer, has no session and doesn't count, so one unanswered Stripe call can't block an edit for the 2 days until the purge fails it) (`private.refund_policy_tightens`: `days_before` → `no_change_of_mind`, or more days' notice; mirrored by `tightensRefundPolicy`, and a test checks they agree) is refused with 409 `code: "refund_policy_tightened"`, for an admin's edit of any event and for an organiser's edit of an unpublished draft that has orders. The check runs under the event row lock, and every order insert, and recording a card order's session (`finish_checkout_attempt`), share-locks that row, so no order becomes payable in between. Loosening is always allowed. Admin changes are logged in the `edited` entry (`changes.refundPolicy`, `changes.refundDays`). Refunds themselves stay manual (see "Refunds made in Stripe"); nothing enforces the deadline automatically.

## Support Sheltüh

An optional amount a buyer adds to a paid checkout, which goes entirely to
Sheltüh, the platform (`lib/support.ts`, migration
`20261110000100_order_support.sql`). It's never called a donation: Sheltüh
is a sole trader, not a charity, and nothing says or implies it's tax
deductible. It isn't a fee: `lib/fees.ts` doesn't know about it, and no
booking fee is charged on it.

- **Paused by default** (owner decision, 27 Oct 2026). `isSupportSheltuhEnabled()`
  in `lib/support.ts` is true only when `NEXT_PUBLIC_SUPPORT_SHELTUH` is
  exactly `1` (unset: off). The same helper drives the checkout UI (no
  choice shown) and the API: while off, any `supportCents` other than
  omitted, null or 0 is **400** `fieldErrors.supportCents` ("Support
  Sheltüh isn't available right now", `SUPPORT_PAUSED`), checked before its
  other rules, with nothing written (no order, attempt or Stripe call).
  Next.js inlines `NEXT_PUBLIC_` variables at build time, in the server's
  bundle too, so turning it on or off takes a new deployment. Orders that
  already carry support are fulfilled, shown and refunded as below.
- **Input.** `POST /api/events/{eventId}/checkout` (general admission and
  seated) takes an optional `supportCents` (when it's on): omitted, null or 0 is none;
  otherwise a whole number of cents from A$1 to A$500
  (`SUPPORT_MIN_CENTS`, `SUPPORT_MAX_CENTS`), else **400**
  `fieldErrors.supportCents`. Only an order with a paid ticket may carry it
  (a free order never goes through Stripe): **400**
  `fieldErrors.supportCents` for a wholly free one. The UI's one-tap amounts
  (A$2, A$5, A$10, `SUPPORT_PRESETS_CENTS`) and Other are a client matter:
  nothing is pre-selected. No other money field from the client is read.
- **Idempotency.** The amount is part of the attempt's fingerprint (only
  when above 0, so a basket without it hashes as before): the same key and
  amount replays (200), another amount is **422** `idempotency_key_reused`
  ("Checkout idempotency").
- **Storage.** `orders.support_cents`, written with the pending order in the
  same statement (general admission: the API's insert; seated:
  `private.hold_seats`), before Stripe is called. `total_cents` includes it
  (what the buyer pays); `subtotal_cents`, `buyer_fee_cents` and
  `application_fee_cents` (the booking fee) never do. Database checks:
  0 to 50000, only with a paid ticket, and in the total.
- **Stripe.** The session is built from the stored order only
  (`lib/server/checkout-attempts.ts`): one more line after the tickets and
  their booking fees, "Support Sheltüh", `unit_amount` the amount, quantity
  1; and `application_fee_amount` = booking fee + support, so Sheltüh keeps
  all of it and the organiser's transfer (total − application fee) is
  exactly what it is without support. An order without support gets the
  very same parameters as before, and a retry for the same order the same
  ones.
- **Example.** Two A$30 buyer-pays tickets (booking fee A$2.30 each) and
  A$5 support: subtotal A$60, buyer fee A$4.60, support A$5, total A$69.60;
  application fee A$4.60 + A$5 = A$9.60; the organiser's transfer A$60,
  the same as without support (A$64.60 − A$4.60). Stripe's processing fee
  comes out of the platform's share, as ever.
- **Buyers see it** as its own line: `OrderPaymentSummary.supportCents` (the
  payment page) and `CustomerOrder.supportCents` (the ticket page), each
  only when above 0, with `totalCents` including it; and in the ticket
  email's order summary (HTML and text), above the total, which says
  "incl. booking fees and Support Sheltüh".
- **The checkout UI** (`components/checkout/SupportSheltuh.tsx`, state and
  the Other amount's parsing in `lib/support-choice.ts`): right above
  Checkout in the ticket selector and the seat page (in its phone sheet),
  only while the order has a paid ticket (the choice is dropped when the
  last one goes) and never in an organiser's seat-map preview. A native
  radio group drawn as chips, nothing pre-selected; tapping the chosen chip
  again, Space on it, or Remove clears it. Other takes A$1 to A$500 in whole
  cents, with its error by the field (an invalid amount stops Checkout).
  The legend says "(optional)", and who gets it ("It goes to Sheltüh, not
  the event organiser.") is said with the blurb, before the chips; only
  Remove is under them. Other's hint and error share one slot two lines
  tall (whichever shows is the field's description), so the error that
  appears when the field is left, which pressing Checkout does, moves
  nothing below it: Checkout stays under the press. Below A$1: "The
  smallest amount is A$1."; above A$500: "The most you can add is A$500.".
  Other chosen but left empty is none: Checkout clears it (nothing shown as
  chosen) and sends nothing. Adding an amount is announced with "Choose it
  again or press Remove to take it off." The chips go to one column in a
  narrow container (below 10rem, e.g. large text on a phone) and their
  labels wrap rather than overflow. The amount is its own summary line and
  in the total; the API's 400 `fieldErrors.supportCents` is shown by the
  chips. The payment page shows the line outside the phone fold ("Show n
  tickets"), and the ticket page shows it with a thank-you.
- **Refund terms.** Wherever the buyer sees the event's refund policy on an
  order with support (the payment page, the ticket page, the ticket email
  in HTML and text), one more sentence follows it: "Support Sheltüh is
  refunded only if your whole order is refunded." (`SUPPORT_REFUND_NOTE`).
- **Organisers' figures in Sheltüh exclude it.** Analytics gross, fees and
  net, and tracking links' gross, use `total_cents − support_cents`
  ("Organiser analytics"); per-ticket figures come from the line items,
  which never include it. Their transfer and payouts don't include it
  either.
- **Known limit: the organiser's Stripe dashboard.** With destination
  charges, support travels in `application_fee_amount`, so an organiser's
  Stripe Express dashboard may show it inside the charge's "fee" (the
  platform's application fee is shown as one amount). Sheltüh's own pages
  never show it to them, but Stripe's can. The planned move to separate
  charges and transfers (organisers paid 2 days after the event, a transfer
  of their own amount only) removes this; until then it's accepted.
- **Refunds.** See "Refunds made in Stripe": a full refund returns it; a
  refund of everything but the support voids the tickets and keeps it
  (`20261110000200_support_ticket_refund.sql`); other partial refunds stay
  manual (the runbook in `docs/supabase-setup.md`,
  "Refunding a paid order", has the dashboard recipes). Payment exceptions
  and their ops alerts carry the order's `supportCents`.

## Checkout idempotency

Payment audit item 4 (`supabase/migrations/20261109000400_checkout_attempts.sql`,
`lib/server/checkout-attempts.ts`, `lib/api/checkout-attempt.ts`). Before it,
every paid checkout request made a new pending order and a new Stripe Checkout
Session, so a double click or a retry after a lost response made two of each
(and, seated, a second hold attempt).

- **The key.** Every checkout request may send an `Idempotency-Key` header: a
  random (version 4) UUID the client keeps for one attempt at one basket
  (lowercased; anything else, the nil UUID or another version or variant
  included, is a 400 `invalid_idempotency_key`). It's **optional for now** (owner
  decision D8): without it, the server makes one up, so the request behaves
  exactly as before (a new order every time). Our own client always sends
  one. Free checkouts ignore it. Plan for the next release: require it on
  paid checkouts (a 400 without it) once the current client has been live
  long enough that no cached old page still posts without it.
- **The attempt** (`private.checkout_attempts`, one row per key; the key is
  unique on its own, so a key reused for another event is caught). Its
  fingerprint is a SHA-256 of the event, kind, the canonical basket (ticket
  type ids and quantities, map version and seat ids, sorted), the
  normalised buyer email (trimmed, lowercased), the tracking code and, only
  when there is one, the Support Sheltüh amount (so a basket without it
  hashes as it always did, and a replay with another amount is a 422).
  Prices aren't in it: they come from the database, and a replay returns
  the order as it was made.
- **Answers for a key already used:**
  - the same basket while its session is open (order pending, session and
    any hold unexpired): **200** with the same `{url, orderId}` (`url` is
    our payment page, `/checkout/pay?order=…`, which reads the embedded
    session's client secret itself; seated also `holdExpiresAt`),
    `Idempotent-Replayed: true`, `private, no-store`;
  - still being made by another request (a live lease): **409**
    `checkout_in_progress`, `Retry-After` and `retryAfterSeconds` (2);
  - a different basket, buyer, tracking code or event: **422**
    `idempotency_key_reused`;
  - its checkout ended (the order was cancelled, Back from the payment page,
    or failed, or the session or hold expired): **409** `checkout_expired`,
    "start a new checkout" (the client then uses a new key);
  - its order is paid, or was paid and then refunded or is being refunded:
    **409** `checkout_completed`, worded for what happened (only a `paid`
    order says "check your email for your tickets"; `oversold_refund_required`
    says it's being refunded in full, `refunded` that it was, with no
    tickets);
  - the key belongs to another client: **409** `checkout_other_client`
    (below), with no URL or order id;
  - its last try failed: tried again (below).
  The first look is a plain read, before the request's own checks, so a
  replay isn't refused for seats its own order holds or tickets sold since.
  A seated request refused for taken seats looks again, so a double click
  racing its twin gets the twin's answer rather than "taken".
  `begin_checkout_attempt` then decides again under the row lock.
- **Bound to the requester.** The attempt stores the requester's client key
  (the same keyed IP hash as the per-client limits). A request with the
  same key from a different client key gets 409 `checkout_other_client`
  ("started from another connection; start a new checkout"): it can't read
  the order id (the confirmation page's credential) or the payment page's
  URL, retry the attempt or take over its lease, and the attempt is
  unchanged.
  A key leaked from one buyer's page is therefore useless elsewhere. A
  buyer whose address changes mid-attempt (wifi to mobile) gets the 409,
  and the client starts a new attempt. With no usable IP header (never on
  Vercel) or no `STRIPE_WEBHOOK_SECRET`, the client key is null and null
  matches only null: the binding then fails open for those requests (they
  can replay each other's attempts, as before this change), logged as for
  the limits.
- **Concurrency.** Two requests with one new key both insert; the second's
  `on conflict` waits for the first to commit and then sees its live lease
  (409). The lease is 90 seconds, above the route's `maxDuration` (60), so
  it only lapses once its request is gone; a later request then takes over.
  Lock order: the attempt row, the limit counters, then (releasing an old
  order) the seat lock and the order. Nothing that holds a seat lock or an
  order row goes on to lock an attempt. Finishing locks the attempt, then
  the order.
- **Stripe.** `checkout.sessions.create` gets `idempotencyKey:
  checkout-session-<orderId>`, a 15-second timeout and one network retry.
  The session is the embedded one described in "Payment flow" (`ui_mode`
  `embedded_page`, `return_url`, Adaptive Pricing off, nothing saved),
  built from the order as stored (lines, fee, email, title; seated: the
  seats), with `expires_at` fixed by the order: its creation + 60 minutes
  (general admission, `GA_CHECKOUT_SESSION_MINUTES`) or + 31 (seated), so a
  call repeated for the same order sends the same parameters. Failures:
  - **No answer** (connection error or timeout, Stripe's 429, or a 409
    because the same key is still running there): the outcome is unknown;
    the attempt is marked failed: **503** `payment_provider_unavailable`.
    General admission keeps the order (it holds nothing): a retry with the
    same key reuses it and repeats the call with the same Stripe key, so if
    the first call did make a session, Stripe returns that one. A seated
    order is released at once, seats freed: the client never got its id, so
    nothing else could release its holds before they lapse (35 minutes); a
    retry with the same key holds the seats again under a new order. (If
    Stripe did make a session for the released order, nobody is shown it,
    and a payment for a failed order is refunded in full.) Reuse needs the
    order still pending, with no session recorded, and younger than 10
    minutes (general admission: its `expires_at` is then still at least 50
    minutes ahead, and it bounds reusing an old price snapshot) or 15
    seconds (seated, which only keeps an order when the request that made
    it died: Stripe refuses an `expires_at` less than 30 minutes ahead,
    it's fixed at creation + 31, and a retry starting within 15 seconds
    reaches Stripe in time even through its own call's 15-second timeout
    and one network retry; 15 seconds was chosen over 32-minute sessions,
    which would change the hold timings buyers are told). Otherwise the old
    order is released (seats freed) and a new one made, with a new Stripe
    key.
  - **Anything else** (an API error, which Stripe replays for the same key,
    or an invalid request), or a session without a client secret: the order
    is released (failed, seats freed), **500**; a retry with the same key
    makes a new order.
  A session Stripe made for an order we then released is an orphan whose
  client secret nobody gets (the payment page reads only the session
  recorded on a pending order); it expires on its own (60 minutes, seated
  31). A duplicate session isn't a duplicate charge in itself: a buyer pays
  only in the form our payment page mounts for the order's recorded
  session, and a payment for a failed order is refunded automatically
  ("Payment flow" step 3).
- **Limits** (owner decision D7), general admission paid checkouts only:
  the per-minute limit from the embedded checkout (10 a minute per client,
  `CHECKOUT_RATE_LIMITS.paidCheckout`, bucket `paid_checkouts`; "Payment
  flow", **429** "…in the last minute") and the per-10-minute ones, all
  taken by `begin_checkout_attempt` only when a new order is about to be
  made (never for replays,
  in-progress answers, reused orders or refusals decided earlier: sold out,
  bad input, payouts not set up), in the same subtransaction as a new
  attempt's row, so a refusal writes nothing: per client (its keyed IP hash,
  as for seat holds, `lib/server/client-key.ts`; an IPv6 address by its
  /56) 20 per event and 60 across events, each per 10 minutes: **429**
  `client_rate_limited` ("You've started a lot of checkouts…"). Per event,
  across clients, 600 per 10 minutes (`CHECKOUT_LIMITS.perEventAlert`) is an
  **alert-only circuit breaker** (a manager decision after the security
  review: as a refusal, about 30 addresses could use it up and lock real
  buyers out of an on-sale). Crossing it refuses nobody; it queues an
  `ops_alert` about the event (title and id only), at most one per event per
  window and 10 a day platform-wide, emailed to `OPS_ALERT_EMAIL` straight
  after the response, and logs a warning with the event id. Per client
  fails open, with a log line and no request detail, when there's no IP
  header or `STRIPE_WEBHOOK_SECRET` isn't set; the circuit breaker still
  counts.
  Seated checkouts keep their own limits (`SEAT_HOLD_LIMITS`: per client in
  `begin_checkout_attempt`, per event in `hold_seats`): nothing is counted
  twice.
- **Client** (`lib/api/checkout-attempt.ts`, used by `createCheckoutSession`
  and `createSeatedCheckout`; components unchanged): one key per event and
  basket (`crypto.randomUUID()`), at most 30 minutes old; a request in
  flight is shared, so a double click sends one request; a network failure
  or 503 is retried once, and an in-progress 409 after its Retry-After (each
  wait at most 5 seconds) up to 20 times and 35 seconds of waiting in all,
  which covers the server's worst case for the first request (a 15-second
  Stripe call and its one network retry), all with the same key. The key is dropped
  after a success and after any other 4xx; a 5xx or network failure keeps
  it, so the next press resumes the same attempt. `checkoutErrorCode(err)`
  reads the code (`CheckoutErrorCode`, `lib/api/types.ts`).
- **Retention** (D11): attempts are deleted 2 days after creation
  (`purge_operational_data`); first, an order a failed attempt kept pending
  with no session recorded is marked failed.
- **Tests**: `tests/server/checkout-attempts.test.ts` (replay, double click,
  mismatch, another client, in progress, expired, completed and its
  wording, Stripe failures and retries with the Stripe key checked and
  Stripe's messages kept out of the logs, limits and the surge alert, no
  key, seated double click and
  retries, purge; its concurrency cases need `TEST_DATABASE_URL`), and
  `tests/api-orders.test.ts` (the client's key lifecycle).

### Accepted limits (checkout idempotency)

- **The header is optional.** Until it's required, a client that sends no
  key (an old cached page, a script) still makes a new order per request;
  the per-client limits bound it.
- **A distributed attacker can create unpaid sessions, but can't block
  buyers.** The only event-wide bound on general admission checkouts is the
  alert-only circuit breaker, so many addresses (each within its 20 per
  event) can make many pending orders and unpaid Checkout Sessions. They
  hold no general admission tickets (inventory is only taken at payment)
  and expire on their own (60 minutes; the daily purge fails the orders,
  and Stripe's `checkout.session.expired` fails them sooner); the cost is
  Stripe API calls and rows, and the ops alert says it
  is happening. Blocking it is a firewall or bot-check job (Turnstile, "Not
  built yet"). Shared addresses share the per-client 20 (as for seat holds),
  and an IPv6 /56 shared by a few customers of one ISP counts as one client.
- **No IP header, no binding.** Off Vercel (or with
  `STRIPE_WEBHOOK_SECRET` unset), requests have no client key: the
  per-client limits are skipped and attempts aren't bound to a requester
  (null matches null), each logged. On Vercel the header is always set.
- **A kept order can sit pending.** After a 503, if the buyer never retries,
  a general admission order stays `pending` (holding nothing, with no
  session, so it doesn't block a refund-policy edit: "Refund policy") until
  the daily purge fails it after 2 days. A seated one is released at once.
- **A reload loses the key.** Keys live in page memory, so a reload starts a
  new attempt; a seated buyer may then see their own earlier hold as
  "taken" until it's released (Back from the payment page) or lapses.

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
- **Only a full refund voids** (`20261111000300_refund_no_inference.sql`,
  an owner decision with Support Sheltüh paused): Stripe's `refunded`, or a
  cumulative `amount_refunded` of at least `total_cents`. No refund's
  purpose is inferred from its amount: a refund of the tickets only (every
  cent but an order's Support Sheltüh), of the support only, or of anything
  else short of the total is partial. (`20261110000200_support_ticket_refund.sql`
  voided an order with support once `total_cents − support_cents` was
  refunded; an amount can't tell that from a support-only refund, and the
  early path didn't follow it, so it was removed. Orders it voided stay
  voided.) Voiding tickets without a full refund is a manual step: there's
  no admin "void tickets" action yet (the runbook, `docs/supabase-setup.md`).
- **Partial refund**: `amount_refunded_cents` is recorded and the order stays
  `paid` with valid tickets. It's logged (`console.error`, by short order
  reference) and opens a `partial_refund` payment exception (with an ops
  alert) for someone to decide what to do, e.g. refund the rest; a later full
  refund closes it.
- **Before the payment is recorded.** `fulfil_order` stores the payment
  intent, so a `charge.refunded` processed before the order's payment webhook
  (only possible if that webhook failed and is awaiting Stripe's retry) finds
  no order. If the charge's `transfer_data.destination` is one of our
  organisers' accounts, it's kept (`early_charge_refunds`, `deferred`) and
  applied when the payment arrives, by the same rule as after fulfilment:
  in full (Stripe's `refunded`, or at least `total_cents`), the order
  becomes `refunded` with no inventory taken and no tickets or email (owner
  decision D1; the buyer's page says `refundReason: "refunded"`); in part
  (anything less, a tickets-only or support-only refund included), the
  tickets are issued, the amount recorded and a `partial_refund` exception
  opened (D2), exactly as a partial refund after fulfilment leaves the
  order. So the outcome doesn't depend on which of Stripe's events arrives
  first.
  Both take the payment intent's advisory lock first, so a refund racing its
  own fulfilment waits for it and then sees the paid order.
- **Payment exceptions** (`private.payment_exceptions`, `GET
  /api/admin/payment-exceptions`): a refund Stripe reports `failed`,
  `canceled` or `requires_action` (from any of the three refund events, for
  our automatic refunds and dashboard ones alike) opens a
  `refund_not_completed` exception for that refund, `urgent` when its order
  was already voided. A later `succeeded` for the same refund closes it; a
  failure after that reopens it (a card refund can go from succeeded to
  failed). Nothing restores tickets or refunds again automatically (D4): an
  admin re-refunds in the Stripe dashboard and resolves the exception with a
  note. One reported before the payment had an order (an early refund) is
  matched to the order at fulfilment.
- **Out of order, and confirmed.** Stripe doesn't promise delivery order.
  Each refund's newest applied event is kept (`refund_status_marks`), and an
  older one delivered later is `stale`: it changes nothing (no exception,
  no alert, no order change). Before reporting a refund as `failed`,
  `canceled` or `requires_action` (an event, or our own refund call's
  answer, which may be Stripe's stored replay of an older state), the app
  asks Stripe for the refund's current status (`refunds.retrieve`) and acts
  on that; if Stripe can't be reached, the reported status stands and the
  mark is what protects. Logged by Stripe's error type and code only.
- **Whose refund.** A refund's `metadata.orderId` (our automatic refunds
  set it) is trusted only when that order's payment intent is the refund's
  own; otherwise the refund is matched by payment intent, as a dashboard
  refund is.
- **Ops alerts**: each exception opened (or reopened) queues an `ops_alert`
  outbox job, at most 20 per 24 hours, emailed to `OPS_ALERT_EMAIL` (the
  order's short reference, amounts, statuses and Stripe's event id: never the
  buyer, the order id or the payment intent). Unset: logged with
  `console.error` and skipped; the exception is still listed. Sent straight
  after the response and by the outbox cron.
- **Idempotent.** Stripe redelivers: a delivery for an order already
  `refunded`, or a partial one that doesn't raise the recorded amount, is
  `unchanged`. Two deliveries at once serialise on the order row, so
  inventory is released exactly once.
- **Not ours.** A payment intent no order has (another integration's
  payment, or a malformed event) is acknowledged with 200 and logged by
  Stripe's event id, never a 500, so Stripe doesn't retry it for days.
- **Refund status events for dashboard refunds** (`refund.updated` /
  `refund.failed` / `charge.refund.updated` without `metadata.orderId`; only
  our automatic refunds carry one) never change the order: `charge.refunded`
  records the refund. They raise or resolve payment exceptions (above). They're logged
  by Stripe's event id and, when the refund's payment intent is one of our
  orders', that order's short reference, so a dashboard refund that failed
  is visible: `failed`, `canceled` and `requires_action` with
  `console.error`, any other status with `console.info`
  (`recordRefundStatus`, `lib/server/handlers/orders.ts`).
- **Support Sheltüh in refunds.** A full refund (dashboard or ours) returns
  everything the buyer paid, support included: `charge.refunded` records
  the charge's whole `amount_refunded`, which includes it. Our automatic
  refunds (an oversold order, a payment for a failed order) refund the
  whole payment with `reverse_transfer` and `refund_application_fee`: the
  organiser's transfer (which never held support) is reversed, and the
  application fee (the booking fee plus support) is returned, so Sheltüh
  gives the support back. A full refund in the dashboard should choose
  both options too, as ours do: reversing the transfer without refunding
  the application fee makes the organiser's side pay back Sheltüh's booking
  fee and support. Partial refunds are split by hand, as before: Stripe
  reverses the transfer and the application fee in proportion to the amount
  refunded, so to refund only the tickets (and keep the support), or only
  the support, work out the split in Stripe (the runbook). The order
  records the amount refunded to the buyer; anything short of the whole
  `total_cents` (a tickets-only refund included) leaves it `paid`, its
  tickets valid, with a `partial_refund` exception.
  With destination charges Stripe transfers the whole charge to the
  organiser and collects the application fee back, so the transfer object
  shows `total_cents` while the organiser's net is `total_cents −
  application_fee_cents − support_cents`.
- Logs name an order only by its short reference (`#7C1F2E0A`): never its id,
  the buyer, or the payment intent.

### Accepted limits (refunds)

- **Disputes (chargebacks) aren't handled.** `charge.dispute.*` is ignored: a
  disputed order stays `paid`. Handle disputes in the Stripe dashboard; if
  one is lost, refund-and-void isn't automatic.
- **Partial refunds don't void anything.** No ticket is cancelled and no
  inventory released for a partial refund, since we can't know which tickets
  (or whether the tickets at all, rather than Support Sheltüh) it was for.
  Refunding the remainder (so the charge is fully refunded) voids the whole
  order. A tickets-only refund that keeps the support leaves the tickets
  valid until an admin voids them, and the app has no action for that yet
  (the runbook). Before or after fulfilment alike.
- **Who's Going opt-ins survive a refund.** An opt-in isn't revisited when
  its order stops being `paid` (as for a changed email; see "Not built yet").
  The member can't opt in again to an event they hold no paid order for.
- **Early refund edge cases.** A refund failure reported before both the
  payment and its `charge.refunded` (out of order) finds nothing to attach to
  and writes nothing; the early refund then still voids the order at
  fulfilment (D3). An early refund row is purged after 35 days, so a payment
  recorded later than that (no Checkout Session lives that long) isn't voided.
  Stripe's refund event semantics (which events report a refund failing, and
  when) are from the SDK types and Stripe's docs, not yet confirmed in test
  mode (card `4000 0000 0000 5126`, `docs/DEPLOYMENT.md`).
  Out-of-order refund events: a `succeeded` delivered before an older
  `requires_action` or `failed` for the same refund leaves a resolved
  tombstone (`refund_status_marks`, with the event's `created` time), so the
  late one is `stale` and raises no exception or alert; and a reported
  failure is confirmed with `stripe.refunds.retrieve` first. Two events of
  the same second go through (fail safe: a person checks), as does a late
  failure when the mark was purged (35 days) and Stripe can't be reached.
  An early partial refund whose order then sells out isn't flagged: the
  automatic refund repays the rest (the early row is marked applied). An
  early refund for an order that had already failed is never applied: the
  failed order's automatic refund repays the rest, or finds the charge
  already refunded, and the row is purged after 35 days.
- **A manual refund of an `oversold_refund_required` order** (its automatic
  refund failed) doesn't change it: `charge.refunded` only acts on `paid`
  orders, and a dashboard refund carries no order id for `refund.updated`.
  After refunding it in Stripe, set it `refunded` in SQL
  (`docs/supabase-setup.md`).
- **A dashboard refund that fails after it voided the order isn't undone**
  (D3, D4). `charge.refunded` can arrive (and void the order, release its
  inventory) before the refund settles; if it then fails or is canceled, the
  order stays `refunded` with void tickets, though the buyer got nothing
  back. Nothing reverses that automatically: an urgent `refund_not_completed`
  exception and an ops alert are the signal; refund again in Stripe and
  resolve it (restoring the order is a reviewed SQL runbook, never automatic).
- **Disputes stay manual** (D12): see the first bullet.
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
  colours (black on white, Signal Orange only as the button, with
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
  seconds wait for the cron, which is daily on Vercel's Hobby plan unless
  the Supabase 5-minute runner is set up (every 5 minutes on Pro). A burst
  of 100 is normally sent in that time.
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
orders' own snapshots: gross is `total_cents` less `support_cents` (what
buyers paid for the event: Support Sheltüh is the platform's), fees is
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

Booking fee: 6% of face value + A$0.50 per paid ticket (`lib/fees.ts`,
which the API and the UI both use; see "Booking fee"). It's either
buyer-paid or absorbed by the organiser, set per ticket type. Either way the
platform keeps it. The Fees figure sums each order's recorded
`application_fee_cents`, so a range spanning a fee change mixes both rates.

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
a re-approved event waits again; an organiser's own publish is an approval
too, so a self-published event waits 6 hours: see "Publishing events"); not excluded by an admin; and at least 3
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
- **Pricing.** Sheltüh sets no price for an external event. The organiser (or
  an admin) may enter an optional **"price from"**, `external_price_from_cents`
  (`20261114000000_external_price.sql`; API `externalPriceFromCents`): whole
  AUD cents, 1 to 1,000,000 (A$0.01 to A$10,000), only on a paid external
  event (the check constraint `events_external_price_from`; "free" stays
  `external_free`, so there is no 0 price). `parseTicketing` rejects it with
  `fieldErrors.externalPriceFromCents` for a Sheltüh-ticketed or free event,
  or out of range; `create_event_draft`, `edit_event_draft` and
  `admin_edit_event` store it only for a paid external event, so switching to
  Sheltüh ticketing or marking the event free clears it. An edit that sends
  `ticketingMode` is the whole state (a missing or null price clears it); one
  that leaves it out keeps the stored price. The organiser can change it on a
  draft even after approval (only the mode and link freeze); an admin's change
  goes through `admin_set_event_ticketing` (new seven-argument form; the old
  one delegates to it) and is logged in `ticketing_changed`
  `details.externalPriceFromCents`. It is public (`toPublicEvent`) on external
  events only. The UI shows it as "From A$89" (`externalPriceFromLabel`,
  `lib/pricing.ts`): on the card (with "Tickets on {provider}"), in the event
  page's ticket panel with the line "Price set by the organiser." and in the
  phone buy bar. It is the organiser's number, so it never says "incl. booking
  fee" and nothing here reads it for money. For the feed's filters, `external_free` counts as free (`is_free` follows it) and
  an external event is never `paid` (a price from doesn't change that). The browser-side "under A$X" filters
  (`lib/scene-map-filters.ts`, the home's low-cost rail) see no ticket types,
  so no external event matches them, free ones included (price unknown;
  revisit in F1/F3 if free external events should count as "under").
- **Review, then frozen.** The admin review queue (`GET /admin/events`)
  shows the link, the provider name and `ticketingLocked`. An organiser's
  publish of an event whose link isn't on a known ticketing site
  (`ticketProviderName` null) always goes to that queue first; a link on a
  known site goes live with the event and is checked after the fact (see
  "Publishing events"). Once an event has
  been approved (an `approved` moderation log entry), the organiser can no
  longer change its mode or link, even after it's unpublished
  (`edit_event_draft` → `ticketing_frozen`, 409 with fieldErrors);
  everything else, `externalFree` included, stays editable on a draft and is
  reviewed again on resubmission. An edit that leaves `ticketingMode` out
  keeps the stored ticketing (mode, and link, free flag and price unless sent), so
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
  detected. Admins should check the link at review (or, for a known
  ticketing site, after the organiser published it); a bad one is fixed with
  the admin PATCH, or the event unpublished.
- **The shortener list is only a speed bump.** Any domain an organiser
  controls (their own site, a page on a link-in-bio service not on the list)
  can be re-pointed after approval just as a shortener can, and new
  shorteners appear all the time. Admin review, and unpublishing when a link
  goes bad, are the real control.
- **Any public site is allowed.** Not just the known ticketing sites:
  organisers often sell on their own site. Phishing is mitigated by admin
  review (always before such an event goes live: see "Publishing events"),
  punycode display and the freeze, not prevented. The UI should open
  the link with `rel="noopener"` (and say where it goes: "Get tickets on
  {provider}" / "the organiser's site").
- **`externalFree` is the organiser's word.** It isn't verified, and it puts
  the event under `pricing=free`. Checked at review, or after the fact for
  an organiser's own publish; editable afterwards on a draft, which is
  reviewed again before it's republished (a republish after an admin's
  unpublish always goes to review).
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

## Photo focus

An organiser (or an admin) can say where the subject of an event's photo is,
so cropped renderings (map pins, cards, rails, the event page's strip) keep
it in view instead of cropping to the middle.

- **Data.** `event_images.focus_x` / `focus_y` (smallint, percent from the
  left / top, 0..100; both null or both set). On the image row, not on
  `events`: the photo is written by its own routes, not the draft write
  functions (none of which changes), and replacing the photo without a focus
  resets it while deleting it drops it. Every change bumps the event's
  `updated_at` (`event_images_touch_event`); a focus-only change leaves the
  photo's own version (`?v=`) alone, so its bytes stay cached.
- **Writes.** `PUT /events/{id}/image?fx=&fy=` (and the admin's) sets the
  photo and its focus together (no params: no focus, the crop centres; one
  without the other, or a value that isn't an integer 0..100, is a 400 with
  `fieldErrors.imageFocus`). `PATCH /events/{id}/image` with
  `{"focus": {"x", "y"} | null}` changes only the focus of the saved photo
  (the organiser: own draft or rejected event, as the photo; 409 while it's
  pending or published, or when there is no photo; the admin's
  `PATCH /admin/events/{id}/image`: any status, 404 unknown event, 409 no
  photo, logged `edited`, nothing logged when unchanged). The organiser's
  writes lock the event row before the image row, as every photo writer does.
- **Reads.** `imageFocus: {x, y}` is on the event (absent without one),
  including the public shape: it says nothing private.
- **Rendering.** `components/EventArt.tsx` takes `imageFocus` and sets
  `object-position: x% y%` on the cover image (and on the blurred backdrop
  of a contained image, whose foreground stays whole); every caller that
  shows an event's photo passes the event's. The editor's Photo card
  (`components/dashboard/EventFocusControl.tsx`) places the marker by
  pointer or keyboard (arrow keys move 5%, Home centres) with live pin and
  card previews; the focus is saved with the photo.

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
- **Photo focus** (`PATCH /admin/events/{id}/image`, `PUT …/image?fx=&fy=`):
  see "Photo focus"; logged `edited` with `changes.imageFocus` (`{x, y}` or
  null, each side).
- **Audit.** `created`, `edited` and `ticketing_changed` entries carry the
  admin's user id, which admin routes show; the event's organiser sees the
  entries in their event's `moderationLog` with `by: "Sheltüh team"` instead
  (an admin's account id isn't theirs to know; the public never sees the
  log). `curated` entries (trending
  curation, see "Trending") are the exception: only admins see them.
- **Responses** are `AdminEventRecord`: an `EventRecord` plus
  `organiserPlatformManaged` and `curation: { boost, excluded }` (the
  event's trending curation from `private.event_curation`, by a primary-key
  join; boost 1 and not excluded when an admin never curated it), and, for
  a published event, `publishedAt` and `publishedBy` (its latest approval:
  `"organiser"` for the organiser's own publish, `"sheltuh"` for an admin's;
  see "Publishing events").
- **Venue location.** The event body's optional `location`, as the
  organiser's (see "Venue location"): a new Google place is checked with
  Google, a change is logged as `changes.location`. An admin's create,
  approval or publish doesn't need one.

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
- **Logo** (`lib/server/handlers/organiser-logos.ts`, `lib/server/organiser-logo.ts`,
  `supabase/migrations/20261105000000_organiser_logos.sql`). An approved
  organiser uploads one (`PUT /organisers/me/logo`, the raw bytes; 403 for
  anyone else, before the body is read), with no review, like the bio: the
  change is logged with old and new version (never the image) and shows on
  the admin queue. The rules are the member photo's (see "Member profiles"):
  JPEG, PNG or WebP sniffed from the bytes (400 on `logo` otherwise,
  polyglots included), at most 2 MB (the event photo's limit, which the
  browser's downsizer aims under; 413), 24 megapixels, first frame, decoded
  once in the same per-instance slots (503 when full), 20 uploads a day per
  account (429, bucket `organiser_logo_uploads`). A logo isn't cropped: the
  whole image is fitted into a 512 px square on white, transparency
  flattened onto white, plus a 96 px thumbnail, with no metadata. The
  organiser row is locked and re-checked in the write, so a takedown during
  the upload is a 409 and nothing is written.
  **Serving**: `GET /organisers/{id}/logo[?size=thumb]` is public while the
  organiser is approved. URLs carry `?v={version}`: at the current version
  the logo is shared at the CDN, `public, max-age=3600, s-maxage=3600` (not
  `immutable`, so a takedown stops being served within about an hour); any
  other `v`, or none, still gets the current logo but `private,
  max-age=3600`, never shared. ETag `"<version>-<f|t>"` and 304, with the
  same cache header as the 200. Otherwise only an
  admin or the owner with a bearer token, `private, no-store`; anyone else
  (no token included) gets the same 404 as an unknown organiser, and a
  non-uuid id is a 404 without a query. The image is only read from the
  database when the client doesn't already have that version.
  **In payloads**: `logoUrl` on the organiser's own record (and the admin
  queue) and the public profile; `organiserLogoThumbUrl` on every event
  (public shapes included) while the organiser is approved. Absent with no
  logo.
  **Moderation**: admins remove it with a reason
  (`POST /admin/organisers/{id}/remove-logo`), logged as the Sheltüh team's
  edit; a takedown hides it (the route needs approved). The organiser can
  delete it at any time, also when suspended (`DELETE /organisers/me/logo`,
  idempotent). **Privacy**: a logo is business content, public once
  approved; the Organiser Agreement should say uploads are public and kept
  until removed (deleted with the organiser).
  **UI**: the organiser picks it on Dashboard → Public profile
  (`components/dashboard/OrganiserLogoField.tsx`, approved only; shrunk in
  the browser by `lib/image.ts` first, saved at once); the event page shows
  the thumbnail in the organiser's avatar square and the profile shows the
  logo beside the name (`components/organisers/OrganiserLogo.tsx`: initials,
  or nothing on the profile, when there's none or it fails to load); the
  admin queue shows it with "Remove logo…". The demo has no logos.
- **Public profile** (`GET /organisers/{id}/profile`): only approved
  organisers. Only `organiserId`, `displayName`, `description`,
  `categories`, `websiteUrl`, `socialLinks`, `memberSince` (Melbourne
  `YYYY-MM` of the application), `featuredVideo` (`{provider, id}` or null),
  `logoUrl` (only with a logo),
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
  published for the first time (an approval, an organiser's own publish, an
  admin's create or edit, any path: a deferred constraint trigger,
  `notify_followers`), each follower
  with emails on gets one `organiser_new_events` outbox job, at most one per
  organiser per 24 hours: a follower with an email already waiting gets the
  new event in it, and one emailed in the last 24 hours gets the next 24
  hours after it. The email ("New from {organiser}", Brand Direction One) is
  built when it's sent, listing every event announced since their last that's
  still published and upcoming (at most 6, then "and N more"); none left, it's
  skipped. Publishing an event again (after an unpublish) emails nobody.
  At most 500 queued a day platform-wide (shared SMTP quota). Sent straight
  after the publishing response (`sendPublishEmailsSoon`, sharing the 30-second
  budget with the waitlist's; after an organiser's own publish,
  `sendSelfPublishEmailsSoon`, sharing it with the admins' `event_published`
  email) and by the outbox cron.
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

## Admin review emails

Admins get an email when something is waiting for their review, and when
an approved organiser's event went live without one
(`supabase/migrations/20261107000000_admin_review_emails.sql`,
`20261111000000_event_publish_now.sql`,
`lib/server/admin-review-email.ts`, `lib/server/email-outbox.ts`):

- **When.** An organiser's event goes to review (draft or rejected →
  `pending_review`: a submit, a publish sent to review, a resubmission):
  "Event submitted for review" (or "Event resubmitted for review" after a
  rejection or an unpublish), with the title, the
  organiser's name, when it starts (in the event's zone) and a link to
  `/admin/events?status=pending_review`. Someone applies to be an organiser,
  or resubmits a rejected application (→ `pending`): "Organiser application
  to review", with the name and a link to `/admin/organisers`. Subjects and
  inbox previews are fixed text: the organiser's title and name appear only
  in the body, under "As submitted by the organiser:", so they can't be used
  to phish admins from our own signed address. Nothing else: no
  description, contact details, venue address or buyer data; no images, no
  tracking. An approved organiser's event goes live on their own publish
  (`event_published`, queued by `private.publish_event`; see "Publishing
  events"): "Event published by an organiser", "It went live without review.
  Check it, and unpublish it if it shouldn't be on Sheltüh.", the same
  fields plus where its tickets are ("on Sheltüh", or "sold on {host}" for
  an external link: the host as the browser shows it, never the organiser's
  wording), and a link to the "Recently published" view
  (`/admin/events?status=published&view=recent`). An organiser link
  that makes (or approves) an organiser queues `organiser_joined`
  ("Organiser joined with a link", the name and a link to
  `/admin/organisers?status=approved`; see "Organiser links"). Saving a draft, an
  approved organiser's profile edit, and
  anything an admin creates (admin-authored events are published directly,
  platform-managed organisers are approved, and so is an organiser created by
  an accepted invite, see "Account invites") send nothing.
- **Reliable.** Deferred constraint triggers on `events` and `organisers`
  queue an `event_review` / `organiser_review` outbox job in the same
  transaction as the status change, whichever path made it, and only if it
  commits; `publish_event` queues `event_published` in its own transaction.
  The submit, publish, apply and resubmit routes then send it straight after
  the response (`Deps.defer`); the outbox cron retries it like any other job.
  As for every kind, the job holds no address or content: both are read when
  it's sent.
- **Recipients.** `ADMIN_NOTIFY_EMAILS` (optional, server-only,
  comma-separated plain addresses, at most 20; invalid entries are ignored
  and counted in one log line, never named) when it has any valid address;
  otherwise every admin account (`app_metadata.role = 'admin'`) with a
  confirmed email that isn't banned or deleted, read from `auth.users` at
  send time. `ADMIN_NOTIFY_EMAILS` should be an inbox only admins read, and
  offboarding an admin includes taking their address out of it. One email per
  recipient. `private.email_job_recipients` records (by the address's
  SHA-256, never the address) who already has a job's email, so a retry after
  a partial failure only reaches the ones it missed. All of a job's sends
  share one 2-minute lease, so before each send the worker stops (to retry
  later) once less than a minute of it is left: a slow SMTP server can't
  outlive the lease and have another worker send it again. With no recipient at
  all, the job is skipped (recorded `failed`) and the server logs it once,
  without addresses.
- **Throttle.** At most one review email waiting per event and per
  application (unique partial indexes; another submission while one waits
  adds nothing); the next one no sooner than an hour after the last was sent
  (queued for then, not dropped: on the Hobby plan's daily cron it may wait
  for the next run); at most 10 a day per account (the organiser's owner or
  the applicant; `review_emails` in `private.rate_limits`, taken first, so a
  refusal there takes no platform slot) and at most 100 a day platform-wide
  (`admin_review_emails_daily`). `event_published` emails follow the same
  rules in buckets of their own (`published_emails`,
  `admin_published_emails_daily`), so publishes never use up the review
  emails an event sent to review by the caps needs, and share the
  one-waiting-per-event index with `event_review`. Beyond either nothing is
  queued, and the queue, the "Recently published" view and the admin home's
  counts still show everything. The
  per-account limit stops one organiser creating and submitting draft after
  draft from using up the platform's day. An organiser
  can only resubmit after an admin rejects, so a submit/reject loop is paced
  by the admins anyway.
- **Stale.** A job still waiting when its event or application leaves review
  (an admin got there first) is deleted in that transaction; one a worker is
  already sending checks the status and sends nothing if it has been
  reviewed. Likewise a waiting `event_published` job is deleted when its
  event leaves `published` (trigger `events_published_email_drop`: an admin
  unpublished it first, or a takedown), and one being sent is skipped.
- **Deploy order.** The worker leases with `private.lease_outbox_jobs`
  (from the migration above). If the code deploys before the migration is
  applied, it falls back to `private.claim_email_outbox` on
  `undefined_function`, so the other kinds keep sending and review jobs wait
  (`docs/DEPLOYMENT.md`).
- **Leasing `event_published`.** Since `20261111000000_event_publish_now.sql`,
  `lease_outbox_jobs` without a kind leaves `event_published` jobs alone, as
  it does ops alerts, and `claim_email_outbox` never takes them. This app's
  drain (`drainEmailOutbox`, the cron's and the routes') asks for them by
  kind, last: ops alerts, then every other kind, then `event_published`. So
  during the deploy window the previous release's cron can't lease one and
  fail it as an unknown job; it waits for this release. `organiser_joined`
  (`20261111000500_organiser_invite_links.sql`) works the same way, drained
  after `event_published`.
- **Not in `/admin/emails`.** That list and the home page's failed and
  retrying counts are ticket emails only (jobs with an order); review emails
  are internal and never resent by hand.

## Onboarding emails

Three account emails, built in
`lib/server/onboarding-email.ts`: a **member welcome** (once the account's email
is confirmed), an **organiser welcome** (when an organiser is created: the
"application received" wording while it's pending, the "you're approved"
wording once approved) and an organiser's **next steps** (one hour after
approval). Each is sent at most once per account, ever.

- **Queueing** (`20261111000700_onboarding_emails.sql`). Member welcomes are
  queued by the cron route, which calls `private.queue_member_welcomes(50)`
  before it drains (a confirmed account is a state in Supabase Auth, not an
  event we see): confirmed, not banned or deleted, with an address, no
  `member_welcome` record, oldest first, at most 300 a day platform-wide.
  Organiser emails are queued by deferred constraint triggers on
  `public.organisers` (like the review emails', so they fire only if the
  transaction commits): an insert with an owner (an application, an invite or
  an organiser link) queues `organiser_welcome` now, and `organiser_next_steps`
  an hour later when it is inserted approved; an update of `status` to
  `approved` queues `organiser_next_steps` an hour later. The trigger catches
  its own errors (a warning with the organiser id and SQLSTATE), so it never
  fails the organiser's change. An organiser with no owner is never emailed.
- **Once ever.** `private.onboarding_emails (user_id, kind)` is unique and the
  outbox job hangs off it (`email_outbox.onboarding_id`, unique): a
  resubmitted application, a second approval, a rejected-then-reinstated
  organiser, repeated or concurrent cron runs and a purge of sent jobs can't
  produce a second one. It is keyed on its own column, not `organiser_id` or
  `event_id`, whose unique indexes the review emails share and whose
  `drop_review_email` trigger deletes jobs by.
- **Backfill.** The migration inserts records (no jobs) for every account with
  a confirmed email and every organiser with an owner (and `organiser_next_steps`
  for approved ones), so deploying sends nothing about existing accounts.
- **Sending** (`deliverOnboardingEmail`, `lib/server/email-outbox.ts`). Decided
  at send time: the account must still be confirmed, not banned or deleted,
  with a plain address, else the job is skipped (recorded as failed, never
  retried, not logged as an error). An organiser's welcome is skipped if the
  organiser was rejected meanwhile, and picks its variant from the status then
  (approved before the welcome went out: the approved wording only); the next
  steps are skipped unless the organiser is still approved. The recipient is
  always the account's own address from Supabase Auth, never the organiser's
  public `contact_email`. Logs carry the job id only. After a response that
  queued one (apply, invite accept, admin approval, organiser link join) the
  app drains due `onboarding` jobs (`sendOnboardingEmailsSoon`); the next steps
  and member welcomes go out with the cron route. The organiser emails also
  share a platform allowance of 200 a day (see the limits below).
- **Draining.** `lease_outbox_jobs` without a kind leases only an allowlist of
  the original kinds, so an `onboarding` job is leased only when asked for by
  name; the app's drain asks last, after tickets, waitlist, follower and admin
  emails, so a burst of welcomes never delays a ticket. During a deploy window
  the cron tolerates `undefined_function` from `queue_member_welcomes` (it
  warns once and carries on). Any other error from it (a timeout, an account
  deleted while it ran) is logged as a fixed message with the SQLSTATE only
  and the run goes on to drain the outbox: a failure to queue welcomes never
  stops a ticket email.
- **Spam Act 2003 (Cth).** These are account emails: they confirm something the
  recipient just did (created an account, applied to be an organiser, was
  approved) and tell them how to use the service. They carry no promotion and
  no offer, so they aren't commercial electronic messages needing consent and
  an unsubscribe link; the footer says why they were sent
  (`emailFooterText`). Anything promotional added later (a re-engagement
  nudge, a newsletter) must not go through this path without consent and an
  unsubscribe.

### Accepted limits (onboarding emails)

- The member candidate query is a scan of `auth.users` against the records'
  unique index once per cron run (Supabase's table can't be indexed by us): fine
  at MVP size; watch it as accounts grow into the hundreds of thousands.
- A person who is both a member and an organiser gets both welcomes (a member
  welcome when they confirm, an organiser welcome when they apply).
- Two platform caps, both from `take_platform_rate_limit`: member welcomes are
  limited when they're queued (300 a day, bucket `onboarding_emails_daily`;
  past it the rest wait, oldest first, for the next window), and organiser
  emails (welcome and next steps) when they're sent (200 a day, bucket
  `onboarding_organiser_emails_daily`, taken just before the send). A job over
  the organiser cap isn't dropped: it's put back an hour without using one of
  its six attempts, and tries again. Each attempt that reaches the send takes a
  hit, so a send that fails and is retried takes two.
- An organiser welcome queued for an account whose email isn't confirmed when it
  is sent is skipped, not held (applying doesn't itself require a verified email; with Supabase's "Confirm email" setting on, as `docs/supabase-setup.md` asks, an account can't sign in before confirming).
- A job being sent when the process dies is sent again (at-least-once, as
  elsewhere), so a very rare second copy is possible.

## Account invites

(For a link an admin forwards to an organiser without an email address or
details, see "Organiser links" below.)

Admins invite people who asked to join, as an organiser or as a member
(owner decisions, 25 Oct 2026; `supabase/migrations/20261108000000_account_invites.sql`,
`lib/server/handlers/invites.ts`, `lib/server/auth-admin.ts`,
`lib/server/invite-email.ts`, `lib/api/invites.ts` and the invite functions in
`lib/api/admin.ts`). The pages: `/admin/invites` (`components/admin/InvitesAdmin.tsx`:
`InviteForm.tsx` to invite someone, `InviteQueue.tsx` to list, resend and
revoke by status) and `/invite`, where the emailed link lands
(`components/invites/*`: `InviteFlow.tsx` reads the invite and picks the
step, `InviteCreateAccount.tsx` is "Create account" with a password,
`InviteJoin.tsx` the accept step, `invite-problems.ts` the error copy).

- **Creating** (`POST /admin/invites {kind, email, consent: true, organiser?}`,
  admin only). `consent` must be true: the admin confirms the person asked to
  be invited (Spam Act 2003). There are no automatic reminders: an email goes
  out only when an admin creates or resends an invite. An organiser invite
  carries the organiser, with the application's fields and rules (the same
  parser as `POST /organisers/apply`, so the bio is required; errors are
  `fieldErrors["organiser.<field>"]`); a member invite carries nothing else.
  One pending invite per address, ignoring case (409); an organiser invite for
  an address whose account already has an organiser is a 409 (only admins
  learn that). The invite is saved first, then emailed through our own SMTP
  (`deps.sendEmail`), in the request: a failed send is recorded
  (`lastSendFailedAt`) and answered `emailSent: false`, and the admin resends.
  Nothing about the address goes to Supabase at this point.
- **The link** is `/invite#token=…` (32 random bytes, base64url, in the
  fragment, so it isn't in server logs or Referers; only its SHA-256 is
  stored) and works for 14 days. A resend (`…/resend`, a pending or expired
  invite) emails a new link, so the old one is a 404, and restarts the 14
  days; revoking (`…/revoke`, a pending invite) stops it at once. One
  conditional update, so a revoke and an acceptance can't both succeed.
- **An invite lives only as long as its inviter is an admin.** Once the
  admin who sent it is demoted (`promote-admin --revoke`) or deleted, the
  invite counts as revoked (`private.account_invite_inviter_is_admin`):
  `view` answers 410 `revoked` and `GET /invites/me` shows nothing (both
  read-only), and the link step, acceptance and a resend (by any admin)
  mark it revoked (`revoked_by` null) and refuse it (410, or 409 for the
  resend). The admin list still shows it as pending until one of those
  touches it.
- **Opening it changes nothing.** `POST /invites/view {token}` is a read
  (kind, masked address, organiser name, expiry, `account`, whether password
  setup is available), so a mail scanner following the link is harmless.
  `account` is `existing` (a confirmed account: sign in), `unconfirmed`
  (only an account that was never confirmed, perhaps registered by someone
  else: "Create account" replaces it, or reuses an earlier press's, and
  without password setup, or if that fails, the page sends them to the
  password reset, never the ordinary sign-up) or `new`. 410 with `code` `expired`, `revoked` or `used`.
- **"Create account": a sign-up token minted just in time.** We never use
  Supabase's own invites (`inviteUserByEmail`, the dashboard's "Invite user"
  and its template): auth-js doesn't support PKCE for them, and their link
  goes to Supabase's verify endpoint, which nothing in this app picks up (the
  browser client is `flowType: "pkce"`, `detectSessionInUrl: false`). Instead
  `POST /invites/account-link {token}` asks Supabase Auth's admin
  `generate_link` (type `invite`, no `data`) for the invite's address at that
  moment, which sends no email, and returns only its `hashed_token`; the
  browser verifies it (`verifyOtp({token_hash, type: "invite"})`), sets a
  password (the sign-up rules) and signs out other sessions. No Supabase
  account exists until the person acts. Revoking the invite stops new
  tokens, but one already handed out can still be verified: it finishes an
  ordinary account, nothing more, since acceptance refuses a revoked invite.
  An address with a confirmed account is a 409 `code: "has_account"` (they
  sign in instead).
  **An unconfirmed account someone registered with the address is deleted
  first.** Supabase's `generate_link` reuses an unconfirmed account as it
  is, and verifying the token confirms it while keeping its password (it
  only generates one when there's none), so someone who registered the
  invitee's address first could sign in to the confirmed account and
  accept. So, before minting, each account with the address is re-read just
  before it's deleted through the admin API (`DELETE
  /auth/v1/admin/users/{id}`): a confirmed one is never deleted (409
  `has_account`), and an unconfirmed one that has signed in is left alone
  (503); one that was never confirmed and never signed in can't have been
  used. A **fresh invite account** is kept: never confirmed or signed in, no
  password, `invited_at` set (by `generate_link`), and no identity but
  `email` (no Google or Apple). That's what an earlier press made, perhaps
  one still in progress in another tab or device, and `generate_link`
  reuses it, so two presses never delete each other's account (or one the
  other has just verified). Then `generate_link` mints for that account or
  a new passwordless one, and the server checks the account is the
  address's only one and a fresh invite account; if the address was
  registered again in between (Supabase would reuse that account), the
  token is withheld (503). A failed deletion mints nothing (503). Each
  press mints a new token for the same account; if Supabase keeps only the
  newest (unverified, below), in two tabs the one pressed last finishes and
  the other's verify fails, and pressing again there works.
  At most 10 tokens per link and 20 requests an hour per client
  (`take_client_rate_limit`, bucket `invite_account_links`; fails open,
  logged, without a client IP or `STRIPE_WEBHOOK_SECRET`, like checkout's),
  429 beyond. Only a request whose token matches an invite takes the
  client's hit (one indexed lookup first), so made-up tokens from a shared
  address can't use up real invitees' allowance.
- **Accepting** (`GET /invites/me`, then `POST /invites/accept {inviteId}`):
  a signed-in caller whose **verified** email equals the invite's, ignoring
  case (anyone else: 404, revealing nothing). Because only the verified email
  counts, a password set from the invite, Google or Apple sign-in, an existing
  account, or the ordinary sign-up all accept the same way. An organiser
  invite creates the organiser, **approved** (reviewed by the inviting admin),
  owned by the caller, and logs `invite_accepted` on its log, in one step
  (`accept_account_invite`); being approved from the start, it queues no
  "organiser to review" email. One organiser per account: one that already
  has one (any status, or an application committed at the same moment) gets a
  409 and nothing is written. Idempotent for the same account.
- **The key.** `SUPABASE_ADMIN_INVITE_KEY` (server-only, Production only),
  read only by `lib/server/auth-admin.ts`, which sends it to Supabase Auth
  and nowhere else (redirects refused; in production only to an https
  project URL, or there's no client) and never puts it, the address or a
  token in an error or log. Without it, creating and resending are a 503 (nothing written),
  `account-link` is a 503 `code: "unavailable"` and `view` says
  `passwordSetup: false`, so the page sends the person to the ordinary
  sign-up (`/signup?next=/invite`), or to the password reset
  (`/forgot-password`) when `account` is `unconfirmed`, and acceptance still
  works. A Supabase failure is the same 503.
- **Allowances.** 20 invites (created or resent) per admin an hour and 100 a
  day platform-wide (the Workspace SMTP quota is shared), taken only when the
  invite is written; a resend no sooner than a minute after the last send.
  429 beyond.
- **Privacy and retention.** Admins see the address as typed; the invitee's
  page shows it masked. Neither the address nor the token is ever logged.
  Invites are deleted 90 days after they were accepted, revoked or expired.
  The Privacy Policy should say admins can set up an invite for someone who
  asks, what it holds and for how long.

### Accepted risks (account invites)

- **Whoever holds the link can set up the account.** Inherent to emailed
  links; bounded by the 14 days, the one address it's for, the per-link cap
  and revoking.
- **Apple's Hide My Email** addresses never match the invite: the person uses
  the invited address (password or Google), or the admin invites again.
- **Abandoned setups** leave unconfirmed Supabase accounts behind (cleaned up
  by hand in Authentication → Users, or reused by the next "Create account"
  for that address).
- **"Confirm email" must stay on** (`supabase-setup.md`). Acceptance trusts
  only a verified email; with confirmation off, anyone could sign up with an
  invited address, be "verified" at once, and accept.
- **The key is a full Supabase secret key** (Supabase can't scope them), used
  from a public, token-gated route. `DATABASE_URL` already gives
  database-owner access, `auth.users` included; this one is separately
  revocable.
- **An account someone pre-registered with the invitee's address** but never
  confirmed: "Create account" deletes it first (above), so the token is
  always for a new, passwordless account. What remains: the fallbacks.
  Without the key, or when the deletion fails, the page sends an
  `unconfirmed` address to the password reset, which confirms the email and
  replaces the password, but between verifying the reset code and saving
  the new password the pre-registered password still works, so its holder
  could sign in in that window (setting the password signs out other
  sessions). Google or Apple sign-in clears the password when Supabase
  links an unconfirmed account.
- **Admin typos** in an organiser's details: revoke before acceptance, or SQL
  after (organisers can't change their name, contact email or categories, and
  there's no admin edit tool).
- **Unverified Supabase behaviour** (not in `node_modules`; smoke-test on the
  test project, `supabase-setup.md`): the admin API accepting an `sb_secret_`
  key as Bearer; `generate_link` type `invite` answering 422 `email_exists`
  for a confirmed user, reusing an unconfirmed one and sending nothing, and
  returning the user's `id` at the top level; the admin `DELETE
  /admin/users/{id}` hard-deleting (404 when gone) and freeing the address;
  `verifyOtp` type `invite` confirming the email and returning a session; the
  `hashed_token` format (validated loosely); whether `auth.users` emails are
  lower-cased (compared with `lower()` on both sides); `generate_link`
  setting `invited_at` on the account it mints for (new or reused), giving a
  new one an `auth.identities` row with provider `email` and nothing else,
  and a newer token replacing an earlier one for the same account; and, for
  the password-reset fallback (no key, or setup failed, with an
  `unconfirmed` account), `/recover` sending a reset code to an unconfirmed
  user and verifying that code confirming the email. The "has an account"
  checks scan `auth.users`; fine at current scale.

### Organiser links

An admin sends an organiser a link that makes them an approved organiser,
with no email or details to fill in (owner request and decision, 27 Oct
2026: "forward a link to organisers without having to fill in details";
one link per organiser; `supabase/migrations/20261111000500_organiser_invite_links.sql`,
`lib/server/handlers/organiser-links.ts`, `components/admin/OrganiserLinksAdmin.tsx`,
`components/organisers/OrganiserJoinFlow.tsx`). Separate from the emailed
invites above: their table and every step are keyed on the invited address,
and a link has none.

- **Creating** (`/admin/invites`, "Organiser links": Create organiser link;
  `POST /admin/organiser-links`, admin only, no body). The link is
  `${NEXT_PUBLIC_SITE_URL}/organisers/join#token=…`: 32 random bytes
  (base64url, 43 characters) in the fragment, so it's never in a server log
  or a Referer; only its SHA-256 is stored, so the URL is shown once, in the
  create response, with Copy and (where the device has a share sheet:
  `navigator.share`) Share, for WhatsApp, Messages or email. Nothing is
  emailed. 20 links per admin an hour and 50 a day platform-wide (each one
  can make an approved organiser), taken only when a link is written.
- **One link, one organiser**: it works once, for 7 days, and an admin can
  cancel it until it's used (one conditional update, so a cancel and a join
  can't both succeed). The admin list shows every link, newest first: when
  it was made and by whom, until when it works, the organiser it made and
  when, or when it was cancelled. As with invites, **a link lives only as
  long as its creator is an admin**: once they're demoted or deleted, the
  link reads as unavailable and a join marks it cancelled.
- **Opening it changes nothing.** `/organisers/join` reads the token from the
  fragment, takes it out of the address bar, and asks
  `POST /organiser-links/view {token}` (read-only) whether it can be used. A
  link that can't (malformed, unknown, used, expired or cancelled) gets one
  answer, a 404 "This link has expired or was already used — ask Sheltüh for
  a new one.", so its holder learns nothing about its history.
- **Signing up or in is the ordinary flow**: Create account (`/signup`) or
  Sign in (`/login`), with any address, confirmed with the usual code (or
  Google / Apple), and `?next=/organisers/join` brings them back. `next`
  carries no token: the page keeps it in this tab's `sessionStorage` for the
  round trip (never a cookie, query string or `localStorage`) and forgets it
  once it's used or turns out unusable. So it needs **no
  `SUPABASE_ADMIN_INVITE_KEY`**: nothing here calls Supabase Auth's admin
  API. Opened in another browser after signing up there, the link just needs
  opening again.
- **Joining** (`POST /organiser-links/join`, a signed-in caller with a
  verified email: 403 otherwise). One transaction
  (`join_with_organiser_invite_link`): locks the link, then the caller's
  organiser row. No organiser: they type the **organiser name** (the
  application's rule: 1 to 120 characters) and tick **what they put on**
  (at least one category: `organisers.categories` can't be empty, it's shown
  on their public profile, and approved organisers can't change it, so it
  can't be defaulted); the organiser is created **approved**, reviewed by
  the link's creator, with their verified email as the contact email and an
  empty bio, which they add on their profile (`/dashboard/profile` asks for
  one on the first save) along with links and a logo. A **pending**
  application is approved as it was submitted (its waiting review email is
  dropped), **unless an admin ever took that organiser down**: a takedown
  sets the status to `rejected`, which the owner can resubmit to `pending`,
  so the join also refuses a pending organiser with a `suspended` entry on
  its append-only log (`organiser_profile_edits`); only an admin's review
  puts it back. **Approved**, **rejected or taken down**: refused (409
  `already_organiser` / `rejected`), and the link stays unused for an admin
  to decide. Each join logs `invite_accepted` (status null or pending →
  approved) on the organiser's log. The same account joining again (a
  retry, a second tab) gets the same 200; anyone else, the 404.
- **The name and categories** follow the application's rules (a name of 1
  to 120 characters, known categories), plus, as nobody reviews them: no
  control, invisible-format (zero-width, bidi), line or paragraph separator
  characters in the name (`\p{Cc}`, `\p{Cf}`, `\p{Zl}`, `\p{Zp}`: 400
  "Use letters, numbers, spaces and punctuation only."), at most 5
  categories as sent (one of each: all the picker offers; 400 "Choose up to
  5 categories."), repeats dropped. Only on this path: the application's
  own contract is unchanged.
- **The admins are told**: each join queues an `organiser_joined` email to
  every admin (as the review emails: `ADMIN_NOTIFY_EMAILS` or every admin
  account), "An organiser joined with a link", with the organiser's name
  (labelled as theirs) and a link to the approved organisers, sent straight
  after the response and retried by the cron. Not sent if the organiser
  isn't approved any more by then (taken down first). A repeat join by the
  same account queues nothing. No throttle of its own: it's bounded by the
  links admins make (50 a day platform-wide, each used once).
- **Then the usual rules**: the dashboard says welcome
  (`/dashboard?welcome=organiser`, taken out of the address bar), and they
  are an ordinary approved organiser: payouts before any paid event, their
  first paid event reviewed by a person, the per-organiser review switch and
  the publishing caps (see "Publishing events").
- **Allowances.** Join: 10 attempts an hour per account
  (`take_rate_limit` `organiser_link_joins`) and 30 per client
  (`take_client_rate_limit` `organiser_link_joins`); view: 60 an hour per
  client (`organiser_link_views`). Every attempt counts, whatever the
  outcome (guessing a 256-bit token isn't feasible anyway; this bounds
  load). The per-client limits fail open (logged) without a client IP or
  `STRIPE_WEBHOOK_SECRET`, like the invites'.
- **Privacy and retention.** The token is never logged and is in no response
  but the admin's create; responses are `private, no-store`; the page is
  `noindex` and `no-referrer` (`next.config.ts`). Links are deleted 90 days
  after they were used or cancelled, or expired; the organiser's log entry
  stays with the organiser.

### Accepted risks (organiser links)

- **Anyone holding an unused link can claim it**, and becomes an approved
  organiser with whatever account they use: a forwarded or leaked link (a
  group chat, a screenshot, a shared phone) works for whoever opens it
  first. There's no address to match, by design. Mitigations: one use, 7
  days, cancel from `/admin/invites` (at once), the link shown to the admin
  only once, and the usual approved-organiser controls afterwards (payouts
  before paid events, the first paid event reviewed, takedown). Admins
  should send each link only to the organiser, and cancel one sent to the
  wrong person.
- **A wrong account can use it**: someone signed in as another account
  (theirs at work, a partner's) who joins turns that account into the
  organiser. The page shows which account is signed in, with Sign out,
  before Join. Fixing it afterwards is an admin takedown (or SQL) and a new
  link.
- **Typo'd organiser names** can't be fixed by the organiser (approved
  organisers can't change their name, contact email or categories); the
  form says so, and an admin changes it by SQL, as for invites.
- **The contact email is the sign-in address** (verified), which
  organisers can't change either; Stripe onboarding uses it.
- **A plainly rejected applicant can be approved by a link.** An admin's
  rejection of an application (not a takedown) leaves no durable record:
  `rejection_reason` and the reviewer are cleared when the applicant
  resubmits (`PATCH /organisers/me`), and nothing else logs it. So an
  applicant who was rejected, resubmitted (back to pending) and then gets
  hold of a link is approved by it, exactly as if they'd joined with a
  fresh account (which a rejection never prevented). A takedown, which is
  logged (`suspended`), is refused, pending or not. Admins who don't want
  a rejected applicant on Sheltüh shouldn't send them a link; if one is
  approved this way, the `organiser_joined` email says so and a takedown
  removes them.
- **The joined email can be lost in one narrow race**: if a worker is
  sending a pending application's review email at the moment a link
  approves it, the join's `organiser_joined` job is skipped (one active job
  per organiser) and the review email's worker skips its own (no longer
  pending). The organiser still shows in the approved list with its
  `invite_accepted` log entry.

## Releasing more tickets

A published event can't be edited by its organiser (only an admin's
`admin_edit_event` changes it), but a sell-out is the moment an organiser most
wants to add capacity, so they have one narrow edit: raise the total of a
general admission ticket type
(`lib/server/handlers/ticket-release.ts`, `private.release_tickets`,
`supabase/migrations/20261113000000_release_tickets.sql`,
`components/dashboard/ReleaseTicketsPanel.tsx`, shown in the locked view of a
published event at `/dashboard/{eventId}`).

- **Rules** (the function rechecks all of them under locks; the handler only
  authenticates, checks the organiser is approved and validates the number):
  the caller's own event (another organiser's, an unknown event or ticket type:
  404); the organiser approved (a taken-down organiser: 403, and its events
  are unpublished anyway); the event `published`, not ended, ticketed on
  Sheltüh (409 otherwise); the ticket type not seated (409: a seated tier's
  capacity is its seats, set by the seat map); the new total strictly above the
  current one (never lower, never equal: 400 `fieldErrors.quantityAvailable`)
  and at most `MAX_TICKETS_PER_TYPE` (100,000). Creating a ticket type has no
  upper bound beyond a whole number of 1 or more, so this cap is new, for
  releases only. Nothing else changes: not the price, fee policy, name,
  description or `quantity_sold`.
- **Concurrency.** Locks in a fixed order: organiser (share), event (no key
  update), ticket type (update). `fulfil_order` and seat holds share-lock the
  event and then lock ticket types, so a purchase and a release serialise
  either way and `quantity_sold <= quantity_available` still holds
  (`ticket_types_not_oversold`). Two releases of the same number at once: one
  lands, the other is `not_increase`. An unpublish in flight wins
  (`not_published`). Tests on real Postgres cover each.
- **Waitlist.** Nothing new: raising `quantity_available` leaves more tickets
  left than before, which fires `ticket_types_waitlist_release_update`
  (deferred to commit), and `private.notify_waitlist` queues the "Tickets are
  available again" emails (see "Waitlist": up to 3 people per ticket left,
  each person at most once per 12 hours, so a second release inside the window
  tells nobody twice). The handler calls `sendWaitlistEmailsSoon` after a
  successful release, as an admin's capacity edit does.
- **Audit.** An `edited` entry in `event_moderation_log` (the action an
  admin's edit uses; no new enum value, no new table) by the organiser's own
  account, with `changes.ticketTypes {old, new}`: only the changed tier
  (`[{id, name, quantityAvailable}]`), because every event read aggregates the
  event's whole log, so an entry must stay small (an admin's edit logs the
  whole list; ticket types are capped at 20 per event and descriptions at 300
  characters, `requireTicketTypes`, so even that is bounded). It appears in the organiser's and admins' `moderationLog`; the
  organiser's own entries show their account id, not "Sheltüh team".
  The event's `updated_at` moves, so an admin's edit made from an earlier
  version is stale (409) and can't silently lower the number again.
- **Rate limit.** 30 releases an hour per organiser account
  (`take_rate_limit`, bucket `ticket_releases`) and 10 per 24 hours per event
  (`take_event_rate_limit`, same bucket name), so one event's log can't be
  grown without bound; 429 (no `Retry-After`: the windows are fixed, and the
  other rate limits don't send one).
- **Record.** `EventRecord.ticketsSold` (ticket type id → sold, the
  organiser's and admins' shapes only; `toPublicEvent` doesn't carry it) feeds
  the "sold / total" in the UI.
- **Not built.** No notification to admins (the log entry is visible in the
  admin event view). No decrease, no seated tiers (change the seat map), no
  new ticket types, no price changes on a published event.

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
- **Ready-made layouts.** The editor's "Start from a layout" builds a whole
  map in the browser (`lib/seating/layouts.ts`, pure): rows facing a stage,
  a centre aisle, stalls with angled side sections, curved rows, or a small
  room, scaled to about the number of seats asked for (each within its own
  range and the generator's 50 rows of 80), every seat on one chosen tier,
  with two wheelchair spaces and their companion seats in the front row.
  It's an ordinary template: saved through the same `PUT …/seat-map` and
  validator, so it adds no contract. No tables (the model has no table
  shape). Shown only while the organiser can change the map.
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
  once on a Stripe error at checkout (or no client secret from Stripe), the
  buyer going Back from the payment page (see "Back from the payment page"
  below; `POST /orders/by-session/{id}/cancel` expires the session first, so
  it can't be paid afterwards), `checkout.session.expired` and
  `async_payment_failed`. Hosted sessions created before embedded checkout
  have a `cancel_url` of `/checkout/cancelled?order={orderId}`, whose page
  calls the same route. Anti-hoarding (decision 5), per event: 120 holds
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
  checkout that makes a new order takes one attempt from its client's
  allowance (`take_seat_hold_attempt`, inside `begin_checkout_attempt`: a
  replay or a reused order takes none; see "Checkout idempotency"): 20 per
  event and 60 across all events per 10 minutes (fixed windows). Over either is a 429 `client_rate_limited` with
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
  address counts by its /56 (many ISPs delegate a /56 to one customer, so
  anything narrower would let one client rotate through 256 keys), an
  IPv4-mapped one as IPv4. Only a keyed
  SHA-256 is stored (`client_rate_limits`), never the address; the salt is
  derived (HMAC, labelled `sheltuh/client-key/v1`) from
  `STRIPE_WEBHOOK_SECRET`, which paid checkout needs anyway, so there's no
  new environment variable, and rotating that secret only restarts the
  counters. It fails open, with a log line that carries no request detail,
  when there's no usable IP header (never on Vercel) or the secret isn't set.
- **Back from the payment page.** A paid checkout's 201 (seated `{url,
  holdExpiresAt, orderId}`, general admission `{url, orderId}`, both
  `private, no-store`; `url` is `/checkout/pay?order={orderId}`) carries the
  pending order's id. The seat page keeps it for the tab
  (`lib/seating/pending-checkout.ts`, sessionStorage) and calls
  `POST /orders/by-session/{orderId}/cancel` when the buyer comes back
  without paying, by the payment page's Back link or the browser's Back
  button (on mount and on `pageshow`). A buyer who closes the tab instead
  is covered by Stripe's `expires_at` (31 minutes: `checkout.session.expired`
  releases the seats), and the hold lapses at 35 minutes anyway. That adds
  no exposure: the id goes only to the client that made the order, which
  already has it in the payment page's URL and Stripe's `return_url`, and
  the cancel route's model is unchanged: the id (`ord_` + 32 hex, a UUIDv4: 122 random bits) is the credential
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
  addresses (a botnet, or IPv6 addresses across many /56s) isn't bounded beyond that. A
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
| `GET /events?q&category&pricing&onOrAfter&upcoming&cursor&limit` | public (published only), soonest first. `onOrAfter` (`YYYY-MM-DD`, 400 otherwise): events starting on or after that date in each event's own zone (`(starts_at at time zone time_zone)::date`, with a coarse `starts_at` bound a day earlier for `events_status_starts_idx`). `upcoming=1` (or `true`): only events that haven't ended (`ends_at > now()`, in progress included); the home page and /events always send it. `recent` (`1`/`true`, `only`, `0`/`false`; additive, needs `upcoming=1` else 400; any other value 400): also lists events that ended within the last 14 days (`RECENT_EVENT_DAYS`, `lib/recent-events.ts`), after every upcoming one and most recently ended first (`only`: just those, the home's "Recently on"; /events sends `1`, except in near-a-suburb mode). They stay openable by slug but can't be bought (`orders_not_ended`); their cards say "Ended". The map stays upcoming-only. `pricing=free`: has ticket types, all free, or is external with `externalFree`; `paid`: has a paid ticket type (an event with no ticket types is neither, and so is an external event that isn't free: its price isn't known). 400 for an unknown `category`, `pricing` or `upcoming` value. Every item carries `ticketingMode`, `externalFree`, `externalProvider` and, for external events only, `externalTicketUrl` (see "External ticketing"). 200: `public, max-age=0, s-maxage=60, stale-while-revalidate=120` (shared at the CDN: "CDN windows"), except with a non-empty `q`: `private, no-store` (a search is never shared). With `upcoming`, the page's ids are selected first (`lib/server/upcoming-page.ts`) |
| `GET /events/slug/{slug}` | public (published only); same shape as a list item. 200: `public, max-age=0, s-maxage=15, stale-while-revalidate=45` ("CDN windows"). Query parameters are ignored (the seat page's `?seatMapVersion=` only makes a new cache key). Every public event (list, slug, favourites, organiser profile, trending) carries `soldOut`, and per ticket type `soldOut` and `remaining` (only when 10 or fewer are left): see "Waitlist" |
| `GET /events/{slug}/calendar.ics` (a page route, not under `/api`: `app/events/[slug]/calendar.ics/route.ts`) | public (published only; demo mode: the sample events). The event as an iCalendar file (`lib/calendar.ts` `buildIcs`, its URL from `NEXT_PUBLIC_SITE_URL`), `text/calendar; charset=utf-8`, `Content-Disposition: inline`, `public, max-age=300, s-maxage=300`. 404 (JSON, `private, no-store`) otherwise. No personal data |
| `POST /events/{eventId}/waitlist` `{email?}` · `DELETE /events/{eventId}/waitlist` | POST: public (a member's token is read, optionally). 201/200 `{status: "joined", maskedEmail, alreadyJoined}` for a member's own verified email; 202 `{status: "confirmation_sent", expiresInHours}` for anyone else, whatever the address's history; 400 email; 404 not published; 409 external, ended or not sold out; 503 busy (the platform caps; the link is emailed after the response, so a failed send isn't reported). DELETE: signed in, leaves (204, idempotent) |
| `GET /events/{eventId}/waitlist/status` | signed in: `{joined, maskedEmail?}`; 404 not published |
| `POST /waitlist/confirm` `{token}` · `POST /waitlist/leave` `{token}` | public (the emailed token is the credential). Confirm: 200 `{status: "joined", eventTitle, eventSlug, ticketsAvailable}` (also when already on the list); 400; 404; 410 expired or used; 409 closed. Leave: 200 `{status: "left", eventTitle?}` (the title only while the event is published; idempotent); 400; 404 |
| `POST /events/{eventId}/checkout` | public (a member's token is read, optionally, for free orders). Optional `Idempotency-Key` header (a random v4 UUID; see "Checkout idempotency"). 409 for an external event, before anything else is read; 409 for a paid order from a platform-managed organiser. 201 `{url}` (a paid order: `{url, orderId}`, `private, no-store`, `url` being the payment page `/checkout/pay?order={orderId}`; see "Payment flow" and "Reserved seating", "Back from the payment page"); a paid order's key again: 200 the same `{url, orderId}` while its session is open, 409 `checkout_in_progress` (Retry-After) / `checkout_expired` / `checkout_completed` (worded for a paid, refunded or being-refunded order) / `checkout_other_client` (the key is another client's: no URL or order id), 422 `idempotency_key_reused`; 400 `invalid_idempotency_key`; 503 `payment_provider_unavailable` (Stripe didn't answer: retry with the same key); 202 free order waiting on its emailed link; 400 (incl. over 4 free tickets in any order, paid or free); 404; 409 sold out or the person's free allowance for the event; 429 member's daily free allowance, or this client's paid checkouts used up (10 a minute, and 20 per event and 60 in all per 10 minutes; `code: "client_rate_limited"`, nothing written; past 600 per event per 10 minutes only an ops alert is queued, nobody is refused); 503 free bookings busy (the guest's link is emailed after the response), or card payments not configured (a paid order, before anything is written: the publishable key is missing or isn't the secret key's mode). Optional `supportCents` (see "Support Sheltüh"): 400 `fieldErrors.supportCents` while it's paused (the default) for anything but none. 409 for too many of a ticket type names the number left only when it's 10 or fewer |
| `POST /events/{eventId}/checkout` with `seats: {mapVersion, seatIds}` | public: a seated checkout (see "Reserved seating"). Paid: 201 `{url, holdExpiresAt, orderId}` (private, no-store; `url` as above), or 503 when card payments aren't configured (before any hold or hold attempt). Free: as above (201 member, 202 guest). 400 (bad seats, over 10, a seated tier in `lineItems`, no map); 404; 409 `seats` taken (body `code`, `seatIds`) or `seatMapVersion` changed; 429 too many seats held or hold attempts for the event, or this client's hold attempts used up (`code: "client_rate_limited"`; body `seatIds`); the `Idempotency-Key` answers as above (200 replay with `holdExpiresAt`) |
| `GET /events/{eventId}/seat-map?v=` | public once published (`public, max-age=31536000, s-maxage=3600, immutable`, only at the current `v`; any other `v` or none is a `307` to `?v={current}`, `no-store`, no body); before that the owning organiser or an admin (bearer), private. `SeatMapRecord`. 404 no map or not visible |
| `GET /events/{eventId}/seat-availability` | as above: `SeatAvailability` (the bitmap), `public, max-age=0, s-maxage=5` once published |
| `PUT /events/{eventId}/seat-map` `{template}` · `DELETE …` | organiser (own event, draft or rejected, never approved). Up to 1 MB. 200 `SeatMapRecord` / 204; 400 `fieldErrors["template.…"]`; 404; 409 not editable, locked, external or has orders |
| `PUT /admin/events/{eventId}/seat-map` `{template, reason}` · `DELETE …` `{reason}` | admin, any status, no orders. 200 `SeatMapRecord` / 204; 400; 404; 409 has orders (`fieldErrors.template`) or external |
| `POST /orders/by-session/{orderId}/cancel` | public (the order id is the credential; only the client that made the order gets it: the checkout's 201, the payment page's URL and Stripe's `return_url`, or a pre-embedded hosted session's cancel URL): expires the Stripe session, then cancels the order and releases its seats; a paid order is never changed. 200 `{status: "released" \| "paid" \| "processing", eventTitle, eventSlug?}`; 404; 409 still being set up |
| `POST /orders/confirm` `{token}` | public (the emailed token is the credential). 200 `{url}` (also when already confirmed, within 24 hours); 400 malformed; 404 unknown; 410 expired (confirmed or not); 409 sold out, allowance used, or a ticket type no longer free |
| `GET /orders/by-session/{orderId}` | public (id is the credential). `CustomerOrder` only (see "Payment flow"), `private, no-store`; `wallet: {google, apple}` when the tickets can be added to a wallet (see "Wallet passes") |
| `GET /orders/by-session/{orderId}/wallet/google?ticket={n}` · `…/wallet/apple?ticket={n}` | public (id is the credential, as the ticket page; see "Wallet passes"). Google: 302 to `https://pay.google.com/gp/v/save/{jwt}`; Apple: 200 `application/vnd.apple.pkpass`. `private, no-store`. 404 malformed (no query), the wallet not configured (no query), unknown, not paid, the event not published, or no ticket `n`; 400 `fieldErrors.ticket`; 429 over 30 a minute from this client, or 60 a minute for this order |
| `GET /orders/by-session/{orderId}/payment` | public (id is the credential), read-only. `OrderPaymentLookup` (see "Payment flow", step 2), `private, no-store`: `{status: "open", clientSecret, expiresAt, …summary}`, `{status: "processing", delayed}`, `{status: "done"}`, or `{status: "closed" \| "sold_out", eventTitle, eventSlug?, seated}` (`closed` also when the event is no longer published or has ended while the session is open); 404 malformed (no query), unknown or a guest's free booking; 409 still being set up; 429 over 30 reads a minute from this client, or 20 Stripe reads a minute for this order; 500 an open session without a client secret |
| `GET /cron/email-outbox` | Vercel Cron, and on Hobby Supabase Cron + `pg_net` (`Authorization: Bearer $CRON_SECRET`, 401 otherwise): sends due outbox jobs (ops alerts first, then tickets, waitlist, followers, admin review emails, then the admins' `event_published` and `organiser_joined` emails, then the welcome emails), first queueing member welcomes (`queue_member_welcomes`), records the run, returns counts `{claimed, sent, retrying, failed}` |
| `GET /cron/trending` | Vercel Cron (same secret, 401 otherwise): rebuilds the trending snapshot, returns `{eligible, ranked}` |
| `GET /events/trending` | public: `{items: [{event, label, goingCount?}]}` (see "Trending"), at most 24, best first; `items: []` with fewer than 3. `cache-control: public, max-age=0, s-maxage=300, stale-while-revalidate=600` |
| `GET /admin/emails?status&cursor` · `POST /admin/emails/{jobId}/resend` | admin. Status `failed` (default), `pending`, `sending`, `sent`. Resend: 404 unknown, 409 being sent, 429 resent in the last 5 minutes or over 20 an hour |
| `GET /admin/emails/health` | admin. `EmailOutboxHealth`: counts per kind and in total (due, overdue after 15 minutes, `oldestOverdueSeconds`, waiting, sending, expired leases, failed, failed in 7 days), `lastCronRun` (time and counts), `cronSecretConfigured`. No addresses, orders or tokens. `private, no-store`. No UI yet |
| `POST /stripe/webhook` | Stripe (signature-verified) |
| `GET /admin/payment-exceptions?status&cursor&limit` · `POST /admin/payment-exceptions/{exceptionId}/resolve` `{note}` | admin. `AdminPaymentException` (see "Refunds made in Stripe"): status `open` (default, oldest first) or `resolved` (newest resolution first); order by short reference only, no buyer data; `urgent` for a refund that didn't complete after its order was voided. Resolve: note 1–500 characters (400), 404 unknown, 409 already resolved. No UI yet |
| `POST /organisers/apply` · `GET /organisers/me` · `PATCH /organisers/me` | signed in. GET: `private, no-store`; the record carries `eventReviewRequired` (an admin's review switch: "Publishing events"). PATCH: a rejected application is resubmitted in full (back to pending); an approved organiser edits their profile (see "Organiser profiles"); pending is a 409 |
| `GET /organisers/{organiserId}/profile` | public (approved organisers only; anything else, or a non-uuid id, is a 404). 200: `public, max-age=0, s-maxage=60, stale-while-revalidate=120` ("CDN windows") |
| `POST /organisers/me/connect/onboard` · `…/connect/refresh` | organiser |
| `POST /events` · `PATCH /events/{id}` · `POST /events/{id}/submit` | organiser (own events). Body adds optional `state` and `timeZone`, together or neither (see "Events: state and time zone"). Body adds `ticketingMode` (absent: `sheltuh` on POST; on PATCH, the stored ticketing is kept), `externalTicketUrl`, `externalFree`, `externalPriceFromCents` (see "External ticketing"). Body adds optional `location` (`{source: "places", placeId, pin?}`, `{source: "manual_pin", pin}` or `null`; absent: none on POST, kept on PATCH; see "Venue location"): 400 `fieldErrors.location` (shape, bounds, too far from the suburb, unknown or non-Australian Google place, or a kept Google place in another state after the suburb or state changed) or `fieldErrors.suburb` (a new Google place is in another state); 503 `fieldErrors.location`, `code: "places_unavailable"` (a new Google place couldn't be checked). PATCH: 409 unless draft or rejected; 409 (fieldErrors on the field) changing the mode or link of an event that has been approved before. Submit (always to review; the publish route below is the editor's): 409 `payouts_required` or `location_required` (`fieldErrors.location`) |
| `POST /events/{id}/publish` | organiser (own events; see "Publishing events"). No body. 200 `PublishEventResponse` (`EventRecord`, `private, no-store`): `status` `published` (live now) or `pending_review` (sent to review, with `reviewReason`: `review_required`, `removed_before`, `seated`, `unknown_ticket_site`, `first_paid_event` or `daily_limit`); an event already published is a 200 too, unchanged. 403 not an approved organiser; 404 not theirs; 409 with `code`: `payouts_required`, `location_required` (`fieldErrors.location`), `event_ended`, `in_review` (already waiting), `event_changed` (its ticket link changed meanwhile: reload and retry). Emails after the response (`maxDuration` 60) |
| `POST /events/{eventId}/ticket-types/{ticketTypeId}/release` `{quantityAvailable}` | organiser (own event; see "Releasing more tickets"). 200 `{eventId, ticketTypeId, quantityAvailable, quantitySold}` (`private, no-store`). 400 `fieldErrors.quantityAvailable` (not a whole number, not above the current total, over 100,000); 403 not an approved organiser; 404 not theirs or no such ticket type; 409 not published, ended, external or a seated tier; 429 over 30 releases an hour. The waitlist's emails are sent after the response (`maxDuration` 60) |
| `POST /places/autocomplete` `{input, sessionToken}` · `POST /places/details` `{placeId, sessionToken}` | approved organiser or admin (401, 403); `private, no-store` (see "Venue location"). Autocomplete: `input` 2–120 characters after control characters are removed; `sessionToken` `^[A-Za-z0-9_-]{8,36}$`, one per search. 200 `{suggestions: [{placeId, primaryText, secondaryText}]}` (at most 5, in Australia and its external territories). Details (ends the search's session): 200 `{placeId, formattedAddress, streetAddress, locality, state, postcode, googleMapsUrl}`, never a position. 400 fieldErrors (`input`, `sessionToken`, `placeId`: malformed, unknown to Google, or not in Australia); 429 per account (autocomplete 100 an hour and 400 a day; details, shared with event saves' place checks, 30 an hour and 120 a day); 503 `code: "places_unavailable"` (no key, Google unreachable, over quota, a bad key or disabled API, over 5 s, or the platform's cap for Google's day used: autocomplete 1,800, details 450). Bodies at most 4 KB. Nothing about the search is logged |
| `GET /organisers/me/events` · `GET /organisers/me/events/{id}` | organiser (own events), `private, no-store` |
| `PUT /events/{id}/image[?fx=&fy=]` · `PATCH /events/{id}/image` (`{focus}`) · `DELETE /events/{id}/image` | organiser (own events, while draft or rejected). Admins: `…/admin/events/{id}/image`. See "Photo focus" |
| `GET /events/{id}/image?v=` | public once published: at the current `v` (as `imageUrl` gives it) `public, max-age=3600, s-maxage=3600`, with any other `v` or none the same image but `private, max-age=3600` (never shared: a guessed future version can't be cached ahead of a replacement); before that, the owning organiser or an admin, `private, no-store`. ETag `"<version>"` and Last-Modified; a matching `If-None-Match` is a 304 with the same headers (after the same access check, and without reading the bytes) |
| `GET /events/{id}/going` | public (published only): `{count, closed, countHidden}`. No cache header (not CDN-cached, so the count keeps up with the names list) |
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
| `PUT /organisers/me/logo` (raw JPEG/PNG/WebP) · `DELETE /organisers/me/logo` | PUT: an approved organiser (403 otherwise, before the body is read); 200 the organiser record (`logoUrl`), `private, no-store`; 400 `fieldErrors.logo` (not a supported image, or over 24 megapixels); 409 no longer approved by the time it's written; 413 over 2 MB; 429 over 20 a day; 503 too many images being decoded on the instance. DELETE: signed in, any status; 200 the record without `logoUrl` (idempotent); 404 no organiser |
| `GET /organisers/{organiserId}/logo[?size=thumb][&v=…]` | public while the organiser is approved: at the current `v` `public, max-age=3600, s-maxage=3600`, otherwise `private, max-age=3600` (the current logo whatever `v` says); otherwise an admin or the owner with a bearer token (`private, no-store`). WebP 512 px (96 px thumbnail), `x-content-type-options: nosniff`, ETag (304). 404 for anything else: unknown, no logo, not approved without the right token, not a uuid |
| `POST /admin/organisers/{organiserId}/remove-logo` `{reason}` | admin. 200 `AdminOrganiserRecord` (unchanged, nothing logged, without a logo); 400 `fieldErrors.reason` (1–500 characters, cleaned like a message); 403; 404 |
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
| `GET /admin/organisers?status&q&limit&cursor` · `POST /admin/organisers/{id}/approve` · `…/reject` | admin. Items (and the decision responses) are `AdminOrganiserRecord`: the full record plus `recentEdits` (newest 20 log entries), most recently updated first. `q` (optional, at most 100 characters used): name, contact email or social handle containing it, ignoring case and accents (NFKD, combining marks removed; a leading `@` is ignored for handles; LIKE wildcards match literally); no index (a substring of a folded expression), it scans one status's organisers. Control characters in `q` are dropped. `limit` 20 by default, at most 50. The admin event editor's organiser picker searches with it. Approve/reject: 409 unless pending |
| `POST /admin/organisers/{id}/event-review` `{required, reason}` | admin (see "Publishing events"). Turns review of the organiser's events on or off, any status; logged as a `profile_edit` with the reason. 200 `AdminOrganiserRecord` (`eventReviewRequired`; unchanged and nothing logged if it already was so); 400 `fieldErrors.required` (not a boolean) or `fieldErrors.reason` (1–500 characters, cleaned like a message); 404 |
| `POST /admin/organisers/{id}/suspend` `{reason}` | admin. Takedown of an approved organiser (see "Organiser profiles"). 200 `{organiser, eventsUnpublished, submissionsRejected}`; 400 reason missing, over 500 characters or with control/invisible characters; 404 unknown; 409 not approved |
| `GET /admin/events?status&q&upcoming&platformManaged&recent&limit&cursor` · `POST /admin/events/{id}/approve` · `…/reject` · `…/unpublish` `{reason?, reviewFuture?}` | admin. Soonest first (with `recent`, newest publish first). `q` (optional, control characters dropped, at most 100 characters used): title or organiser name containing it, ignoring case and accents, LIKE wildcards literal; no index (it scans one status's events). `upcoming` (`1`/`true`, `0`/`false`): only events that haven't ended (`ends_at > now()`, in progress included), or all; absent means `1` for `status=published` and `0` for every other status. `platformManaged` (`1`/`0`): only platform-managed organisers' events, or only the others; absent, both. `recent` (`1`/`true`, only with `status=published`, else 400 `fieldErrors.recent`): events whose latest approval (an admin's or the organiser's own publish) was in the last 14 days, newest first, ended ones included unless `upcoming=1` (`event_moderation_log_approved_idx`). 400 (fieldErrors on the parameter) for any other boolean value. Approve: 409 if the event's organiser isn't approved. Unpublish: optional `reason` (1–500 characters, cleaned like a message; absent, null or blank: none), logged and stored as the event's `rejectionReason`, which the organiser sees; optional `reviewFuture` (boolean; true: also turns on review of the organiser's events in the same transaction, `private.admin_unpublish_event`); 400 `fieldErrors.reason` / `fieldErrors.reviewFuture`; 409 not published (nothing changed). Items are `AdminEventRecord`s (`EventRecord` plus `organiserPlatformManaged`, `curation: { boost, excluded }`, default boost 1 / not excluded, and for published events `publishedAt` and `publishedBy`, `"organiser"` or `"sheltuh"`), so the review queue shows `ticketingMode`, `externalTicketUrl`, `externalProvider`, `ticketingLocked` and the trending curation without a request per row |
| `GET /admin/summary` | admin. `AdminSummary`, counts only (no names, titles or addresses): `reportsOpen {count, oldestAt}`, `eventsPending {count, soonestStartsAt, startingSoon, startingSoonHours: 72}` (the last three over events not ended), `organisersPending {count, oldestAt}` (oldest last update), `emailsFailed {count}` and `emailsRetrying {count}` (ticket emails: failed, or pending after a failed attempt), `doorEvents {count, windowHours: 24}` (published, Sheltüh-ticketed, platform-managed, not ended, starting within 24 hours), `eventsPublishedByOrganisers {count, windowHours: 72}` (events still published whose latest approval in the last 72 hours was the organiser's own publish; optional in the type, so a client tolerates an older server). One query; each part is served by an index |
| `POST /admin/organisers` | admin. A platform-managed organiser (see "Admin authoring"): the application's fields and rules. 201 `AdminOrganiserRecord`; 400 fieldErrors |
| `GET /admin/invites?status&cursor&limit` · `POST /admin/invites` `{kind, email, consent, organiser?}` · `POST /admin/invites/{inviteId}/resend` · `POST …/revoke` | admin (see "Account invites"). List: `Paginated<AdminInviteRecord>`, status `pending` (default), `accepted`, `revoked` or `expired` (400 otherwise), newest first. Create: 201 `{invite, emailSent}`; 400 fieldErrors (`kind`, `email`, `consent`, `organiser`, `organiser.<field>`); 409 a pending invite for the address, or its account already has an organiser; 429; 503 without `SUPABASE_ADMIN_INVITE_KEY` (nothing written). Resend: 200 `{invite, emailSent}`; 404; 409 accepted or revoked (or its inviter is no longer an admin); 429 within a minute or over the allowance; 503. Revoke: 200 the invite; 404; 409 not pending |
| `POST /invites/view` `{token}` · `POST /invites/account-link` `{token}` | public (the emailed token is the credential), private, no-store. View: `InviteView` (`account` `new` / `existing` / `unconfirmed`), read-only; 400; 404; 410 `code` `expired` / `revoked` / `used`. Account link: deletes unconfirmed accounts someone registered with the address (keeping a fresh invite account from an earlier press), then `{tokenHash}`; 400; 404; 410; 409 `code: "has_account"`; 429 (10 per link, 20 an hour per client, counting only tokens that match an invite); 503 `code: "unavailable"` (no key, Supabase Auth failed, or the address's account couldn't be made safe) |
| `GET /invites/me` · `POST /invites/accept` `{inviteId}` | verified email. Me: the pending invite for the caller's address (`MyInvite`); 404 none. Accept: 200 `{kind, organiserId?}` (idempotent); 404 unknown or another address's; 409 the account already has an organiser; 410 `code` |
| `GET /admin/organiser-links?cursor&limit` · `POST /admin/organiser-links` · `POST /admin/organiser-links/{linkId}/cancel` | admin (see "Organiser links"). List: `Paginated<AdminOrganiserLinkRecord>`, every link newest first (`status` `active`, `used`, `cancelled` or `expired`, the creator's email, the organiser's current name), never a token or its hash. Create: no body; 201 `{link, url}` (`url` = `${NEXT_PUBLIC_SITE_URL}/organisers/join#token=…`, the only response that ever carries the token); 429 over 20 an hour (this admin) or 50 a day (everyone). Cancel: 200 the link; 404; 409 not active (used, cancelled or expired) |
| `POST /organiser-links/view` `{token}` | public (the token is the credential), private, no-store; read-only. 200 `{expiresAt}`; 404 `code: "unavailable"` for a malformed, unknown, used, expired or cancelled link, or one whose creator is no longer an admin (one message for all: "This link has expired or was already used — ask Sheltüh for a new one."); 429 over 60 an hour per client (every request counts) |
| `POST /organiser-links/join` `{token, displayName?, categories?}` | verified email (any address). 200 `{organiserId, displayName}` (idempotent for the account that used the link); 400 fieldErrors `displayName` / `categories` (the application's rules, plus no control or invisible characters in the name and at most 5 categories as sent, repeats dropped; required when the account has no organiser, ignored for a pending application); 401; 403 unverified; 404 `code: "unavailable"` (as view); 409 `code` `already_organiser` / `rejected` (rejected, taken down, or pending again after a takedown; the link stays unused) or `conflict` (an application arrived at the same moment); 429 over 10 an hour per account or 30 per client (every attempt counts) |
| `GET /admin/events/{id}` · `POST /admin/events` · `PATCH /admin/events/{id}` | admin (see "Admin authoring"). `AdminEventRecord`. The event body's `state` and `timeZone` as the organiser's (see "Events: state and time zone"; PATCH without them keeps the stored place). The body's optional `location` as the organiser's (400 / 503 as there; an admin's publish needs none). POST: the event body plus `organiserId`, `publish?`; 201; 400 fieldErrors (`organiserId` unknown; `ticketTypes` paid for a platform-managed organiser); 409 organiser not approved. PATCH: the event body with `ticketingMode` required, `expectedUpdatedAt`, `publish?`, `reason?` (≤500); 200 (unchanged if nothing changes); 400 fieldErrors (incl. `reason` to change an approved event's mode or link); 404; 409 stale version (`fieldErrors.expectedUpdatedAt`), orders on a switch to external, sold ticket types, or organiser not approved when publishing |
| `PUT /admin/events/{id}/image` · `DELETE /admin/events/{id}/image` | admin, any status. As the organiser's (413, 400), logged `edited`; 404 |
| `GET /admin/events/{id}/curation` · `PUT …/curation` `{boost, excluded, reason}` | admin, any status (see "Trending"). `{eventId, boost, excluded, updatedAt, log}` (newest 20 changes). PUT: 200 (unchanged, nothing logged, if nothing changes; logged `curated` otherwise); 400 fieldErrors (`boost` a number from 0.5 to 2, rounded to 2 places; `excluded` a boolean; `reason` 1–500 characters); 404 |
| `PATCH /admin/events/{id}/ticketing` `{ticketingMode, externalTicketUrl?, externalFree?, externalPriceFromCents?, reason}` | admin. Any status. 200 with the event (logged as `ticketing_changed`; unchanged, and nothing logged, if nothing would change); 400 fields (`ticketingMode` is required) or reason (1–500 characters); 404; 409 switching to external an event with orders |

Lists are paginated with an opaque `cursor` (`nextCursor` in the
response). It's currently a row offset, fine at this scale.

JSON request bodies over 256 KB are refused with 413. Every error response
is `cache-control: private, no-store`, and so is every admin response
(`admin.ts`, `admin-authoring.ts`, `email-outbox.ts`, `invites.ts`, `organiser-links.ts`, `reports.ts`,
`trending.ts`) and every response about the signed-in caller.
`tests/server/private-gets.test.ts` checks every authenticated GET answers
`private`, and that every GET route is listed there, as public on purpose,
or as tested elsewhere.

### Hosting: region, database connection, CDN

- **Region.** `vercel.json` pins functions to Sydney (`"regions":
  ["syd1"]`), next to the Supabase database (ap-southeast-2): a database
  round trip is then a few milliseconds, where a US region would add a
  trans-Pacific one to each of checkout's sequential queries and to every
  Supabase Auth check. Stripe's API is in the US either way.
- **Database connection.** `DATABASE_URL` is Supabase's transaction pooler
  (port 6543): `prepare: false`, 5 connections per instance (one pool per
  process, shared by every route and page), fail-fast connect
  (`lib/server/db.ts`). **TLS:** for any host that isn't this machine, TLS
  is always required. postgres.js connects in plain text unless told
  otherwise, so `connectPostgres` (used by the app and by
  `scripts/seed-dev-data.ts`) reads how postgres.js itself resolved the
  connection (`postgres(url).options`: its host list, unix socket path and
  TLS setting, with the `PGHOST` and `PGSSL` fallbacks; creating a client
  doesn't connect) and decides with `forcedDatabaseTls`, unit-tested in
  `tests/server/db-tls.test.ts`:
  - every host local (`localhost`, `127.0.0.1`, `::1`) or a unix socket:
    left alone (local test clusters, `TEST_DATABASE_URL` on 127.0.0.1);
  - otherwise a setting that allows plain text (none, `disable`, `false`,
    an empty value, `allow`, `prefer`) is overridden to `require`, whatever
    the URL says: there is no plain-text escape hatch for a remote host. A
    stronger setting already in force (`require`, `verify-full`, from the
    URL or `PGSSL`) is kept;
  - with `DATABASE_CA_CERT` set (optional, PEM), any remote host gets full
    verification instead: `ssl: { ca, rejectUnauthorized: true }`, so the
    certificate must chain to that CA and name the host. A value that isn't
    a PEM certificate stops the app with an error naming the variable
    (never its value).
  `require` encrypts without checking the certificate (as libpq's
  `sslmode=require`): it stops eavesdropping, not an active attacker in the
  middle; `DATABASE_CA_CERT` closes that (`docs/DEPLOYMENT.md`). The owner
  also turns on Supabase's "Enforce SSL" (`docs/DEPLOYMENT.md`).
- **CDN.** A function's response is shared at Vercel's CDN through
  `s-maxage` (`max-age` is for the browser); that Vercel keeps them, and
  never anything `private`, is checked on the first deploy
  (`docs/DEPLOYMENT.md`, "CDN headers": `x-vercel-cache`). What is
  shared, and for how long, is the "CDN windows" table below. Errors are
  never shared, so there's no negative caching: a newly approved event
  shows as soon as the window of the page it appears on allows (its own
  page at once). Nothing purges the CDN on demand; changes show when a
  window runs out.

#### CDN windows (accepted risks)

Shared responses are the same for every caller: no shared response depends
on a token. The feed, event and profile handlers never read one; the image,
logo, seat map and availability handlers read one only for an unpublished
(or unapproved) resource, and that answer is always `private, no-store`
(`tests/server/public-events.test.ts` checks a signed-in caller gets the
same body and header). A feed search (`GET /events?q=…`) is never shared
(`private, no-store`): a CDN hit under `?q=` would tell anyone asking for
the same URL that someone ran that search moments ago.

| Response | Header | Stale for at most |
|---|---|---|
| Feed `GET /events` (home, /events, map; not a search with `q`, which is `private, no-store`) | `public, max-age=0, s-maxage=60, stale-while-revalidate=120` | about 3 minutes |
| Organiser profile `GET /organisers/{id}/profile` | the same | about 3 minutes |
| Event `GET /events/slug/{slug}` (event and seat pages) | `public, max-age=0, s-maxage=15, stale-while-revalidate=45` | about 1 minute (the seat page's reload after a map change adds `?seatMapVersion={v}`, a new cache key, so it never gets a copy from before the change) |
| Trending | `public, max-age=0, s-maxage=300, stale-while-revalidate=600` | 15 minutes (plus the snapshot's own age; see "Trending") |
| Seat availability | `public, max-age=0, s-maxage=5` | 5 seconds |
| Event image, organiser logo (current `v` only) | `public, max-age=3600, s-maxage=3600`, ETag (304) | about an hour (two at most, if the CDN dropped `Age`) |
| Seat map (current `v` only) | `public, max-age=31536000, s-maxage=3600, immutable` | about an hour at the CDN; a year in a browser that already has it (a new map is a new URL) |
| Calendar `.ics` | `public, max-age=300, s-maxage=300` | 5 minutes (plus a browser's 5) |

What that means:

- **Availability.** A card's "Sold out", an event page's "Only N left" and
  its quantity cap can lag sales by the windows above. Checkout and
  fulfilment always read the database: a buyer who picks more than is left
  gets a 409 naming what's left (10 or fewer), and overselling is
  impossible (the `ticket_types` check). An event that looks sold out after
  a refund may send someone to the waitlist, which answers 409 "not sold
  out". Seated selection uses the 5-second availability bitmap.
- **Takedowns.** An unpublished event, a suspended organiser's events and
  profile, or an admin's edit can still be served from the CDN for up to
  about 3 minutes in the feed and on a profile, about 1 minute on the event
  page (checkout refuses at once), and about an hour for an image, a logo
  or a seat map at the CDN. `max-age` equals `s-maxage` for images and
  logos on purpose: a browser counts the CDN copy's `Age` against `max-age`
  (RFC 9111), so a copy is never stale on arrival and the whole chain still
  ends an hour after the function answered. A browser that already loaded
  a seat map keeps it for a year (it was public, and the URL never changes).
  For a takedown that can't wait, purge the CDN cache from Vercel's
  dashboard (not wired into the app).
- **Organisers' own edits** show on their public profile and event pages
  within the same windows (their dashboard reads `private` routes, so it's
  current).
- **Offset cursors and snapshots.** Pages of the feed cached at different
  times can skip or repeat an event that moved between pages; repeats are
  de-duplicated by id in the browser (as before caching, when events ending
  between page loads shifted rows the same way).

## Code map

- `lib/server/handlers/*`: one function per route. Each takes
  `(request, params, deps)`, so tests can pass a real test database and a
  fake Stripe.
- `lib/server/records.ts`: the SQL that reads each record, and the
  row → API-shape mappers.
- `lib/server/deps.ts`: the production wiring (postgres.js, Supabase Auth,
  Stripe, SMTP), read from env.
- `lib/api/*`: the browser-side client for the same routes.
- Support Sheltüh: `lib/support.ts` (amounts, label and copy, client-safe),
  `parseSupportCents` in `lib/server/order-input.ts`, the session line in
  `lib/server/checkout-attempts.ts`; tests
  `tests/server/support-sheltuh.test.ts`.
- Embedded checkout: `lib/server/handlers/orders.ts` (`createCheckout` and
  its seated branch create the embedded sessions; `getOrderPayment` serves
  `GET /api/orders/by-session/{orderId}/payment`, route
  `app/api/orders/by-session/[sessionId]/payment/route.ts`);
  `lib/server/stripe-keys.ts` (the publishable key must match the secret
  key's mode), wired as `Deps.stripePublishableKey` in `lib/server/deps.ts`;
  `lib/api/orders.ts` `getOrderPayment`; the payment page
  `app/checkout/pay/page.tsx` with its client components and the Stripe.js
  loader (`components/checkout/*`, `lib/stripe/*`); tests
  `tests/server/order-payment.test.ts` and `tests/server/stripe-keys.test.ts`.
- Account invites: `lib/server/handlers/invites.ts`; `lib/server/auth-admin.ts`
  (the only reader of `SUPABASE_ADMIN_INVITE_KEY`), wired as `Deps.authAdmin`;
  `lib/server/invite-email.ts`; `lib/api/invites.ts` and the invite functions
  in `lib/api/admin.ts`; the pages `app/admin/invites/page.tsx` →
  `components/admin/InvitesAdmin.tsx` (`InviteForm.tsx`, `InviteQueue.tsx`)
  and `app/invite/page.tsx` → `components/invites/*` (`InviteFlow.tsx`,
  `InviteCreateAccount.tsx`, `InviteJoin.tsx`, `invite-problems.ts`); tests
  `tests/server/invites.test.ts`, `tests/server/auth-admin.test.ts`,
  `tests/server/invite-email.test.ts`, `tests/InviteFlow.test.tsx`,
  `tests/InvitesAdmin.test.tsx`, `e2e/invite.spec.ts`.
- Organiser links: `supabase/migrations/20261111000500_organiser_invite_links.sql`;
  `lib/server/handlers/organiser-links.ts`; `lib/api/organiser-links.ts` and
  the link functions in `lib/api/admin.ts`; `lib/invites.ts` (the 7 days,
  the join path, the unavailable copy); `components/admin/OrganiserLinksAdmin.tsx`
  (on `/admin/invites`); `app/organisers/join/page.tsx` with
  `components/organisers/OrganiserJoinFlow.tsx`; the welcome in
  `components/dashboard/DashboardContent.tsx`; tests
  `tests/server/organiser-links.test.ts`, `tests/OrganiserLinksAdmin.test.tsx`,
  `tests/OrganiserJoinFlow.test.tsx`, `e2e/organiser-links.spec.ts`.
- `lib/auth/AuthContext.tsx`: Supabase Auth in the browser.
- Sign in with Google and Apple (see that section): `lib/supabase/browser.ts`
  (`flowType: "pkce"`, `detectSessionInUrl: false`); `lib/auth/oauth.ts`
  (the provider flag, the callback URL and safe `next`, callback parsing,
  the error copy); `lib/auth/AuthContext.tsx` `signInWithProvider` and
  `completeOAuthSignIn`; `components/auth/OAuthButtons.tsx` on `/login` and
  `/signup`, with `lib/auth/in-app-browser.ts`; `app/auth/callback/page.tsx`
  → `components/auth/OAuthCallback.tsx`; the `/auth/:path*` headers in
  `next.config.ts`; `scripts/apple-client-secret.ts` (run as
  `npm run apple-client-secret`); design `docs/design/social-sign-in.md`;
  tests `tests/oauth.test.ts`, `tests/AuthContextOAuth.test.tsx`,
  `tests/OAuthCallback.test.tsx`, `tests/supabase-pkce.test.ts`,
  `tests/apple-client-secret.test.ts`.
- Publishing events (see that section): `lib/server/handlers/event-publish.ts`
  (route `app/api/events/[eventId]/publish/route.ts`; kept free of the suburb
  table), `lib/server/payouts-refusal.ts` and `lib/server/location-refusal.ts`
  (the 409s), the review switch, unpublish reason, `recent` list and summary
  count in `lib/server/handlers/admin.ts`, `buildEventPublishedEmail` in
  `lib/server/admin-review-email.ts`, `sendSelfPublishEmailsSoon` in
  `lib/server/email-outbox.ts`; clients `publishEvent` / `publishConflictCode`
  in `lib/api/events.ts` and `adminSetEventReviewRequired` /
  `adminUnpublishEvent` in `lib/api/admin.ts`; tests
  `tests/server/event-publish.test.ts` (fixture `selfPublishedEvent`).
- Venue location (see that section): `lib/server/places.ts` (the Google
  Places client, wired as `Deps.places`), `lib/server/handlers/places.ts`
  (routes `app/api/places/{autocomplete,details}/route.ts`, and
  `verifyVenuePlace` for event saves), `parseLocation` in
  `lib/server/event-input.ts`, `isPinNearLocality` in `lib/location.ts`,
  `lib/maps.ts` (the Google and Apple links), `lib/api/places.ts`,
  `components/dashboard/VenuePinMap.tsx`, `components/events/EventLocation.tsx`;
  tests `tests/server/places.test.ts`, `tests/server/event-location.test.ts`
  (`FakePlaces` in `tests/server/helpers/api.ts`), `tests/maps.test.ts`,
  `tests/VenuePinMap.test.tsx`, `tests/EventLocation.test.tsx`.
- `tests/server/*`: API tests against a real Postgres. By default that's
  PGlite in-process. With `TEST_DATABASE_URL=postgres://…` set, they run
  against a real server through the production driver.
- `journey/`: the opt-in journey harness (`npm run test:journey`): the real
  route modules over HTTP with local stand-ins for Supabase Auth, SMTP and
  Stripe. What each test layer covers: `docs/testing.md`.
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
- Wallet passes (see that section): `lib/server/handlers/wallet.ts` (routes
  `app/api/orders/by-session/[sessionId]/wallet/{google,apple}/route.ts`);
  `lib/server/wallet/` (`config.ts`, the only reader of the wallet variables,
  wired as `Deps.googleWallet` / `Deps.appleWallet`; `pass-content.ts`;
  `google.ts`; `apple.ts`; `brand.ts`; `images.ts`, generated);
  `lookupCustomerOrder` and `walletEligible` in `lib/server/handlers/orders.ts`;
  `lib/api/orders.ts` `walletPassUrl`; `components/tickets/WalletButtons.tsx`;
  `scripts/render-wallet-images.ts` → `public/wallet/`; tests
  `tests/server/wallet-passes.test.ts`, `wallet-google.test.ts`,
  `wallet-apple.test.ts` (helpers `tests/server/helpers/wallet.ts`) and
  `tests/WalletButtons.test.tsx`.
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
  the Host header. An event's `og:image` is its cover photo at
  `/api/events/{id}/image?v=…` (public for published events), or the site's
  `app/opengraph-image.tsx` (inherited from the parent segment, since a
  page's `openGraph` replaces the parent's whole object).

## Event clips

One optional silent H.264 MP4 per event (at most 15 s, 10 MB and 1080p, no
audio track), in the private Supabase Storage bucket `event-clips`. The
bucket has no `storage.objects` policies, so only the API reaches it, using
`SUPABASE_CLIP_STORAGE_KEY`, read only by `lib/server/clip-storage.ts`.
That key is a **full Supabase secret key** (Supabase can't scope them):
service-role powers over the whole project (the Data API without RLS,
Supabase Auth admin including setting the admin role, every bucket). It's
separate only so it can be revoked alone; set it in Vercel's Production
environment only, unless Preview uses a separate Supabase project. Check
`select policyname from pg_policies where schemaname = 'storage'` returns
0 rows and the bucket is private (`docs/supabase-setup.md`).
Design: `docs/design/event-clips.md`.

- Upload: `POST /events/{id}/clip/uploads` returns a signed upload URL for
  `uploads/{event}/{account}/{upload}.mp4` (20 a day per account) and
  records the upload id with its event and account in
  `private.event_clip_uploads`. The browser PUTs the file there (the
  second exception in "Design principles"). `PUT /events/{id}/clip
  {uploadId, description, rightsConfirmed: true}` claims the upload id
  (one `update … where consumed_at is null … returning`: an upload is
  attached at most once, a second claim is a 410; ids over a day old are
  410 too; 20 claims a day per account, `take_rate_limit`
  `event_clip_attaches`), checks the size, downloads with a cap, checks
  and neutralises metadata with `lib/server/mp4.ts` (location, device and
  XMP boxes, capture times, handler names), writes
  `clips/{event}/{upload}.mp4` itself, and records it with
  `private.put_event_clip` under the event row lock. A Storage failure
  (503) gives the claim back so the same upload can be retried. A replay
  of the attached clip's upload id is a description-only change.
  `rightsConfirmed: true` is required only with an `uploadId`;
  `rights_confirmed_at` records the attach and isn't changed by
  description-only edits or replays (`PUT … {description}` without an
  `uploadId` ignores `rightsConfirmed`).
- Uploads are off unless `NEXT_PUBLIC_EVENT_CLIPS=1`, and the server
  enforces it (`clipUploadsEnabled`): upload URLs and attaching an upload
  are a 503 (`fieldErrors.clip`). Description changes, removal, preview and
  playback keep working.
- Organisers can do this on their own draft or rejected events; admins on
  any event (`/admin/events/{id}/clip…`), logged `edited` with `clip` /
  `clipDescription`. The staged object and any replaced clip are deleted
  after the response. A final object is never deleted on a refusal or an
  error (only the staged one is). The trending cron's after-response sweep
  deletes staged uploads, unreferenced final clips and issued upload ids
  older than a day.
- Playback: `GET /events/{id}/clip?v=` returns a 302 to a 1-hour signed URL,
  for published events only, cached 5 minutes, at the clip's current
  version only. Any other `v` (or none) is a 307 to `?v={current}`
  (`no-store`), as for seat maps, so made-up versions can't each mint a
  signed URL past the CDN. `GET …/clip/preview` gives the owner or an
  admin a 10-minute URL. Payloads carry
  `clip?: {url, durationMs, width, height, description}`, absent without a
  clip.
- Accepted limits: after a takedown, new plays stop within 5 minutes and
  URLs already handed out work for up to an hour; Storage isn't
  transactional with the database (deferred deletes and the sweep cover
  the gap); no `expectedUpdatedAt` on clip writes, as for photos.
- UI: a Play button on the image of any card or event page whose event has
  a clip (`components/events/ClipPlayButton.tsx`), opening the page's one
  viewer (`components/events/ClipViewer.tsx`, mounted in `app/layout.tsx`;
  SeatDialog with a muted inline `<video>` mounted only while open, no
  autoplay under reduced motion; the home rails hold still while it's
  open). Uploads are behind `NEXT_PUBLIC_EVENT_CLIPS=1`: the editor's
  `EventClipField` (browser pre-checks in `lib/clip-precheck.ts`, upload
  after the event save, `useEventClip`) and the admin queue's clip row.
  Playback needs no flag.
- Not built: captions/WebVTT, transcoding (HEVC is refused), faststart,
  WebM.

## Events: state and time zone

Events can be anywhere in Australia (owner plan, steps S3 and S4;
`supabase/migrations/20261110000000_event_place_time_zone.sql`,
`lib/server/event-input.ts` `parsePlace`, `lib/time-zones.ts`).

- **Stored**: `events.state` (one of `STATE_CODES`: NSW, VIC, QLD, SA, WA,
  TAS, NT, ACT, and OT for the other territories) and `events.time_zone`,
  defaults VIC and Australia/Melbourne (what every earlier event meant).
  `events_place_check` mirrors `ZONES_BY_STATE` exactly (a state's zones,
  e.g. NSW: Sydney, Broken Hill, Lord Howe; WA: Perth, Eucla);
  `tests/server/event-place.test.ts` compares the two. Change both together.
- **Written** (`POST`/`PATCH /events`, `POST`/`PATCH /admin/events`):
  optional `state` and `timeZone`, both or neither (one alone is a 400 on the
  missing one). Neither: `start`/`end` are Melbourne wall-clock on create
  (stored VIC/Melbourne), and on edit the stored place is kept and the times
  read in the stored zone, so an older client re-saving a Perth event
  changes nothing. Both: `state` must be a code (400 `fieldErrors.state`),
  `timeZone` one of `ZONES_BY_STATE[state]` (400 `fieldErrors.timeZone`), and
  `suburb` a locality in that state (`findLocality("{suburb} {state}")`, or
  the suburb alone when it already names the state: "Richmond NSW"), stored
  as the locality's display name (`Locality.name`: "Fitzroy", "Richmond
  NSW", "Brisbane City"); otherwise 400 `fieldErrors.suburb`, with "Did you
  mean …?" for a near spelling in the state. Times are converted in the
  zone: a time the clocks skip is 400 `fieldErrors.start`/`end`
  (`DST_GAP_MESSAGE`); a time they repeat is the earlier instant. The
  database functions keep the stored value of either field when it's
  absent; `admin_edit_event` logs a change of either (`changes.state`,
  `changes.timeZone`). The suburb table (`lib/location.ts`, about 290 kB)
  is imported statically on the server only by `lib/server/event-input.ts`,
  so it loads with the two handler modules that parse event bodies
  (`handlers/events.ts`, `handlers/admin-authoring.ts`) and with exactly
  the API routes whose route file imports either: `/api/events` (GET, POST),
  `/api/events/[eventId]` (PATCH), `/api/events/[eventId]/submit`,
  `/api/organisers/me/events` and `/api/organisers/me/events/[eventId]`,
  `/api/admin/events` (GET, POST), `/api/admin/events/[eventId]` (GET,
  PATCH), `/api/admin/events/[eventId]/image` and `/api/admin/organisers`
  (GET, POST). Of the pages, only `/search` loads it in its server render;
  client components load it on demand (`lib/location-loader.ts`).
  Accepted. Submit, the organiser's two event reads, the admin's event
  image and the organisers list only load it because their route file
  shares a handler module with a write; moving them out means splitting
  those modules and their route imports. Ticketing input
  (`lib/server/ticketing-input.ts`) and the payouts errors
  (`lib/server/payouts-refusal.ts`) are kept apart from `event-input.ts`
  and `handlers/events.ts` so that `handlers/admin.ts`, and through it
  seating, clips and trending, don't load it.
- **Read**: `EventRecord` and `PublicEvent` carry `state` and `timeZone`
  (every route that returns an event); `CustomerOrder` and
  `OrderPaymentSummary` carry `eventTimeZone` and `eventState` whenever they
  carry the event's times; `CheckInSummary.event`, `AnalyticsEventSummary`
  and `AnalyticsOverviewEvent` carry `timeZone` and `state`. The ticket,
  free-confirmation, waitlist, follower and admin review emails, the wallet
  passes and the link preview show event times in the event's zone. The
  emails name a zone other than Melbourne in full ("8:00 pm – 11:30 pm
  Perth time (AWST)", "Canberra time (AEDT)": `zoneLabel`); Melbourne's
  stays "AEDT"/"AEST", byte for byte as before. Whether an event crosses
  midnight is judged in its zone.
- **Shown** (S5): `SheltuhEvent` carries `state` and `timeZone` (mapped in
  `lib/live/adapt.ts`; absent is VIC / Melbourne, every demo sample). Every
  screen formats an event's own times in its zone (`lib/format.ts`
  `eventZone`). The event page names the zone under the time
  (`formatTimeZoneLabel`: "Perth time (AWST)", "Melbourne time (AEDT)").
  Compact lines (cards, map, list rows, orders and tickets, the checkout
  summary, the admin queue, the organiser's dashboard, link previews) add
  the zone's city after the time only outside Melbourne's zone
  (`zoneSuffix`, `formatEventWhen`, `lib/event-card.ts` `startLabel`: "Sat
  21 Nov, 8:00 pm Perth time"; the ACT's "Canberra time"), so a Melbourne
  event's line is unchanged. The seat hold's end reads "8:31 pm Perth
  time"; the refund deadline and the door's check-in times are in the
  event's zone. The editors fill the date and time inputs in the event's
  zone (legend "Starts (Perth time)").
- **Entered** (S8, `components/dashboard/VenueSuburbField.tsx`): the
  organiser's and admin's editor has one "Suburb or town" field, suggested
  and resolved with the suburb table (`lib/location.ts`, loaded on demand):
  suggestions read "Richmond, VIC" / "Richmond, NSW", a bare shared name is
  the Victorian one (owner decision D7), and a polite line under the field
  names the place and zone ("Richmond, Victoria · Melbourne time (AEDT)")
  and where else a bare name is ("Also in NSW, QLD, SA, TAS. Add the
  state…", `sameNameElsewhere`). A capital's "CBD" or "City" is that
  capital ("Sydney CBD", "CBD, NSW"); "CBD" or "City" alone asks which city
  (`isBareCityCentre`) rather than becoming Melbourne's. A saved event's
  suburb, unchanged, is looked up with its saved state (`placeQuery`) and
  saves without the table. The state's default zone
  (`defaultTimeZone(state, suburb)`) is used, with a "Time zone" choice
  ("Sydney time", "Broken Hill time"; a row of its own, with why) only
  where a state has more than one (NSW, WA, OT). The date legends name the
  zone's city, or "local time" until the suburb is known; changing the
  suburb or zone keeps the typed wall-clock times, and a polite line says
  so ("Times are now Melbourne time (were Perth time)."). Every save sends
  `suburb` (the locality's `name`), `state` and `timeZone` together. A
  suburb the table doesn't know is an error by the field ("Did you mean
  Fremantle, WA?", with a "Use Fremantle, WA" button that fills it in) and
  nothing is sent; if the table can't load, the field says so as it's used
  (with Try again), and saving a new suburb says so and sends nothing. The
  suburb's, state's and zone's errors go when the suburb (or zone) is
  changed. The API's `fieldErrors.suburb` / `.state` show by the field,
  `.timeZone` by the zone choice (else the field), `.start` / `.end` (the
  daylight-saving gap) by the times, and focus goes to the first of them.
- **Place display** (owner decision D4): a suburb is shown as "Suburb,
  STATE" (`lib/place.ts` `placeName`: "Fitzroy, VIC", "Richmond, NSW",
  never "Richmond NSW, NSW"): cards, map rows and spots, the dashboard row,
  the admin queue, the organiser profile, the checkout summary and
  confirmation, link previews, the waitlist and follower emails' place
  line and the ticket email's address when there's no street address. Wallet passes and
  the other emails still show the suburb as stored.
- **Grouped** (S6): Tonight, This weekend and a date on /map, and the demo
  feed's date, use each event's own calendar (`lib/scene-map-filters.ts`).
  The home's This weekend is the platform's weekend (its heading and
  whether it's on), but each event is matched against Friday 17:00 to
  Sunday 23:59:59.999 on its own zone's clock (`weekendWindow(now, zone)`,
  one per zone), so a Perth gig at 11 pm on Sunday counts; the live home
  loads pages until the latest zone's weekend has ended
  (`latestWeekendEnd`: the Cocos Islands').
- **Home order** (S10, owner decision D5): Australia-wide, soonest first.
  With a saved "near" suburb (browser-only), `HomeEventsProvider` reads its
  state from storage (`readStoredNearState`: the state saved with the
  suburb, or for an entry saved before that, the state code its name ends
  with, "Richmond NSW") and `selectHomeSections(…, preferredState)` lists
  that state's events first in each section (a stable reorder, before each
  takes its six). The home never loads the suburb table, so nothing waits on
  it; a bare name saved without a state leaves the order Australia-wide. The
  state never reaches the API.
- **Platform zone** (owner decision D1): analytics day buckets, trending,
  rate-limit days, retention, and admin and message times stay in
  Australia/Melbourne.

## Location (near you)

Search can order results by how close they are to a suburb (owner round,
24 Oct 2026). Phase 1 is **browser-only**: no table, route, handler,
`lib/api` or migration change, and the API never receives a location.

- `components/search/LocationPicker.tsx` (the search bar's location
  segment): "Use my current location" calls `navigator.geolocation` only
  on that click, never on load (coarse, 10 s timeout, 10 min cache). The
  position is matched to a suburb anywhere in Australia (`lib/location.ts`
  `nearestLocality`: of the localities whose boundary could reach it, the
  one with the nearest centre; "outside" overseas or out at sea) and
  dropped. Or the visitor types a suburb (suggestions start at two letters).
  The table has one centre per locality, not boundaries, so near a border
  the position can be named for the neighbouring suburb (about 1 in 5
  random points inside localities, checked against the ABS polygons).
- Only the suburb's name (and its state) leaves that function: localStorage
  `sheltuh:near:v1` = `{"suburb": …, "state": …}` (`lib/near-storage.ts`;
  the state is for the home's order, above), and the
  `/search?near=` parameter (≤ 60 characters). Coordinates never reach
  storage, the URL, the API or logs. An empty `near` is dropped on submit
  and forgets the stored suburb (and `/search` redirects `near=` away for a
  search sent before hydration or without JS). `/search` with no `near` at
  all prefills the bar's location from storage without changing the results,
  and shows "Press Search to update results." until the visitor searches.
- `/search` sends `Referrer-Policy: strict-origin` (`next.config.ts`) and
  `apiFetch` sets `referrerPolicy: "strict-origin"`, so the suburb in the
  page address doesn't reach the API in the Referer header.
- `/search` resolves `near` against the suburb table (`lib/localities.ts`)
  on the server and passes the `Locality` down; `EventFeed` →
  `EventBrowser` (demo) / `LiveEventFeed` (live) → `NearbyResults` order the
  results with `orderByNearness`: bands (In {Suburb, STATE}, Within 5 km,
  5–15 km, 15–100 km, Over 100 km (owner decision D8),
  Location not on file), soonest first within each. Each event's suburb is
  looked up with its state (`lib/place.ts` `placeQuery`: "Perth WA",
  "Richmond NSW", never doubled; the suburb alone for an event without one).
  Live near mode reads at most 4 pages of 50 (the 200 soonest matches) and
  says so when more matched. Distances are suburb centre to suburb centre,
  labelled approximate.
- The suburb table: every ABS Suburb and Locality (ASGS Edition 4 (2026),
  CC BY 4.0, credited on `/about` as modified), 15,351 rows, without the
  ABS's water localities (Coral Sea and other seas and gulfs, which reach
  hundreds of km offshore) and with Melbourne's centre moved from Kings
  Domain to the Hoddle grid (`CENTRE_OVERRIDES` in the script), generated by
  `scripts/generate-localities.py` into `lib/localities.ts` (centre, state,
  and how far the boundary reaches). It's about 290 kB (155 kB gzipped), so
  client components only import `lib/location.ts` types and load the module
  with `lib/location-loader.ts` (the picker when it opens, `NearbyResults`
  when it shows, `/map`); `app/search/page.tsx` imports it on the server.
- Names shared across states ("Richmond"): the typed name alone is the
  Victorian one (Melbourne-first; with none in Victoria, the more compact,
  then the one nearest Melbourne), "Richmond NSW" / "Richmond, NSW" /
  "Richmond (NSW)" pick a state, and a suburb's `name` carries the state
  whenever the name alone would find another ("Richmond NSW"), so the stored
  and submitted `near` finds it again.
- City names the ABS doesn't use for one locality are mapped
  (`CITY_NAMES`): Brisbane → Brisbane City, Darwin → Darwin City,
  Canberra → City ACT, Gold Coast → Surfers Paradise, Ballarat → Ballarat
  Central, and a few more.
- `/map` (owner plan S9) is Australia-wide: it places an event without
  venue coordinates at its suburb's centre from the same table
  (`resolveMapCoordinates(event, findLocality)`, looking up `placeQuery`'s
  "{suburb} {state}", through `components/search/useLocationModule.ts`);
  the map waits for the table when some event has no coordinates (or a
  suburb is saved), and if it can't load says so, offers Try again, and
  falls back to the 20 hand-entered inner-Melbourne centres in `lib/geo.ts`
  (Victorian events only). Anything inside `AUSTRALIA_BOUNDS` (-45..-8,
  95..170: Norfolk, Christmas and the Cocos Islands included) is pinned,
  and the map can't be panned past it; an unknown suburb (a typo) or a
  position overseas is listed and counted as unplaced. It opens on every
  marker; with a saved "near" suburb, on the markers within 50 km of it
  (`lib/map-layout.ts` `framingTargets`; all of them if none are), and with
  none, on the mainland and Tasmania (`AUSTRALIA_VIEW`, minimum zoom 3, so
  it fits a 375px phone). Live, it reads up to 4 pages of 50 at a time (and
  Load more the next 4). The location filter lists the events' suburbs
  under "All of Australia", grouped by state (`<optgroup>`,
  `suburbsByState`). Markers cluster by pixel distance at any zoom.
- Disclosed at `/privacy#location` (draft) and in the popover.
- Venue pins now exist for events with a confirmed location (the
  organiser's own pin, never Google's coordinates; see "Venue location"):
  `/map` and the event page's map place those exactly. Nearness ordering
  here still goes suburb centre to suburb centre.
- Phase 2 (not built): a server-side `GET /api/events?near=<suburb>`
  checked against the same table (and, later, the venue pin where there is
  one).

## Venue location

An event's venue has a confirmed location: a Google place the organiser
picked plus their own pin, or their pin alone (owner decisions A-D1 to A-D6,
27 Oct 2026; `supabase/migrations/20261111000100_event_venue_location.sql`,
`lib/server/places.ts`, `lib/server/handlers/places.ts`, `lib/maps.ts`).

- **Google's terms shape all of it.** Google Maps Platform's terms forbid
  showing Places content on a non-Google map and caching Places
  coordinates for more than 30 days, and they let a place id be stored
  indefinitely. Our maps are Leaflet with Esri tiles. So:
  - **Google's coordinates are never requested, stored or used.** The field
    masks (`PLACES_FIELD_MASKS`) ask for no `location`, `viewport` or other
    position, and the parsers copy only the named address fields
    (`tests/server/places.test.ts` checks).
  - **The only Google Places data stored is the place id**
    (`events.venue_place_id`).
  - **The coordinates we store and show are the organiser's own pin**
    (`events.venue_lat` / `venue_lng`), confirmed on our own map.
  - The venue's name, address and suburb are what the organiser confirmed:
    prefilled from Google, editable, saved as their own text (A-D2,
    accepted by the owner: Places has no explicit carve-out for this).
- **Finding the venue** (the server-side Places proxy; see "Design
  principles"). Both routes are POST (what's typed stays out of URLs and
  access logs), `private, no-store`, approved organisers and admins only
  (401, 403), rate-limited per account and capped platform-wide (below),
  with a 5-second timeout:
  - `POST /api/places/autocomplete {input, sessionToken}`: at most 5
    suggestions `{placeId, primaryText, secondaryText}` in Australia,
    Christmas Island, the Cocos (Keeling) Islands and Norfolk Island
    (`includedRegionCodes`), in `en-AU`.
  - `POST /api/places/details {placeId, sessionToken}`: the picked place's
    address parts to prefill (`formattedAddress`, `streetAddress`,
    `locality`, `state`, `postcode`, and `googleMapsUrl`, a Google Maps
    search link to the place to check it), never a position. Ends the search's billing session (one
    `sessionToken` per search, made by the browser). 400 when the place
    isn't in Australia or its external territories (Christmas Island, the
    Cocos (Keeling) Islands, Norfolk Island and Jervis Bay are state `OT`).
    Unknown place: only Google's `NOT_FOUND` (404), or a 400
    `INVALID_ARGUMENT` about the place id itself; any other 400 or 403 (a bad
    key, the API not enabled, billing) is "unavailable" below, so a
    misconfigured key never reads as "we couldn't find that place".
  - **Allowances and caps** (`PLACES_RATE_LIMITS`,
    `PLACES_PLATFORM_DAILY_CAPS` in `lib/server/handlers/places.ts`), taken
    in one statement before every Google request, in this order, stopping
    at the first refusal:
    - per account, `private.take_rate_limit`: autocomplete 100 an hour and
      400 a day (`places_autocomplete`, `places_autocomplete_daily`); Place
      Details and an event save's check (`verifyVenuePlace`, the same Google
      request) share 30 an hour and 120 a day (`places_details`,
      `places_details_daily`). Past either: 429 (with
      `fieldErrors.location` on an event save).
    - platform-wide, `private.take_platform_rate_limit`, per Google day
      (Google's quotas reset at midnight Pacific Time, so the bucket is
      `places_autocomplete_day:<date>` / `places_details_day:<date>`, that
      day's date in `America/Los_Angeles`): autocomplete 1,800, details plus
      checks 450, below the Google Cloud quotas `docs/DEPLOYMENT.md` asks
      for (2,000 and 500). Past either: 503 `places_unavailable` (logged
      `daily_cap`), so organisers drop a pin before Google itself refuses.
    - An account's day is at most a third of the platform's, so one
      account (or a stolen session) can't use up everyone's day; it takes
      four. A refused account takes no platform slot; a request refused by
      the platform's cap has already used one of the account's.
  - Google unreachable, slow, over quota, misconfigured, not configured
    (`GOOGLE_MAPS_API_KEY` unset) or the platform's cap used: 503 `code:
    "places_unavailable"`, and the organiser drops a pin instead. Google
    Cloud's own daily quotas stay the backstop. Never logged: what was
    typed, the place id, the key, Google's answers; a failure logs a fixed
    reason only.
  - The editor must show Google Maps attribution beside the suggestions
    (`lib/api/places.ts`).
  - `GOOGLE_MAPS_API_KEY`: server-only, Production only (`.env.example`).
- **Checking the pin.** `components/dashboard/VenuePinMap.tsx` ("Check the
  pin"): a fixed pin over our pannable Leaflet/Esri map, seeded at the
  suburb's ABS centre (never at Google's position), arrow keys to pan and
  +/- to zoom, a live line naming the nearest suburb, kept inside
  `AUSTRALIA_BOUNDS`; inline from the `sm` breakpoint, a full-screen dialog
  on phones. Confirming it is required: after picking a Google place, and
  for "Can't find it on Google Maps?" (a manual pin). The editor's venue
  section (A-F2, `components/dashboard/VenueLocationField.tsx`) uses it.
  **The pin is public** (the event page, `/map`, the Apple Maps link, to 6
  decimal places): organisers are told the pin is public on the pin step.
- **Saving** (`POST` / `PATCH /events`, `POST` / `PATCH /admin/events`), an
  optional `location` (`VenueLocationInput`, `parseLocation` in
  `lib/server/event-input.ts`):
  - `{source: "places", placeId, pin?}`, `{source: "manual_pin", pin: {lat,
    lng}}`, or `null` (clear it: `legacy`). Absent: create saves none
    (`legacy`); an edit keeps the stored one, so an older client changes
    nothing.
  - The pin must be inside `AUSTRALIA_BOUNDS` and within the named suburb's
    reach plus 10 km (`isPinNearLocality`, `PIN_REACH_MARGIN_KM`); it's
    rounded to 6 decimal places (about 10 cm). 400 `fieldErrors.location`.
  - A **new or changed** place id is checked with Google before saving
    (`verifyVenuePlace`: one Place Details call for `id,addressComponents`,
    no session): unknown, or not in Australia, is 400
    `fieldErrors.location`; in another state than the event's is 400
    `fieldErrors.suburb`; Google unavailable is 503 `fieldErrors.location`.
    A **kept** place id is checked again when the edit changes the suburb
    or state (compared as `refuseStaleVenueLocation` does): otherwise an
    organiser could confirm a new pin elsewhere while the old place id
    stayed, and Google directions (`destination_place_id`) would lead to the
    old place. In another state than the event's new one it's 400
    `fieldErrors.location` ("The Google Maps place is in a different state;
    find the venue again or drop a pin", `PLACE_IN_OTHER_STATE`), nothing
    saved. Sending `{source: "manual_pin", pin}` drops the place id
    instead (no Google call). The re-check takes the same allowances as any
    check.
    "Verify, don't store": nothing Google says is written; the suburb,
    state and time zone stay the organiser's, checked against the suburb
    table as before. The organiser's edit checks only while the event is a
    draft or rejected. Each check takes the caller's details allowance and
    the platform's cap first (above): 429 / 503 `fieldErrors.location`.
  - **A new suburb or state needs the pin checked again.** An edit that
    changes the suburb or state without sending `location`, while a pin or
    a Google place is stored, is 400 `fieldErrors.location` ("Check the pin
    again for the new suburb", `refuseStaleVenueLocation`), nothing saved:
    the stored pin and place were checked against the old suburb and state.
    The editor always resends the location when the suburb changes (the pin
    belongs to the suburb it was confirmed for), so only a hand-made request
    sees this. Legacy events (no pin, no place) move freely.
  - Stored as `location_source` (`legacy`, `places`, `manual_pin`),
    `venue_place_id` and `venue_lat` / `venue_lng`, with checks (see
    "Tables"); `admin_edit_event` logs a change as `changes.location` (old
    and new `{source, placeId, pin}`).
  - Read back as `location?: {source, placeId?, pin?}` on `EventRecord`,
    `AdminEventRecord` and `PublicEvent`, absent for `legacy`, so those
    payloads are unchanged.
- **Required to publish or submit.** Publishing and submitting refuse an
  event without the organiser's pin (409 `code: "location_required"`,
  `fieldErrors.location`; checked after the payouts rule): a Google place
  with its pin, or a manual pin. `publish_event` checks it in the database.
  For submit the handler checks it (`refuseSubmitWithoutPin` in
  `lib/server/handlers/events.ts`, one primary-key read, in the function's
  own order: not draft or rejected, then payouts, then the pin) before it
  calls `submit_event`, which doesn't check it any more
  (`20261111000400_submit_event_location_in_app.sql`), so the previous app
  version's submit, which doesn't know `location_required`, keeps working
  while migrations are applied ahead of a deploy. The check and the submit
  aren't one transaction: an organiser clearing the pin from another tab in
  between still submits, and an admin reviews it. A Google place alone
  (a draft not yet pinned) isn't enough. An admin's approval, create or
  publish doesn't require it: admins can list an event with its address
  alone.
- **Links** (`lib/maps.ts`; the event page shows both, always, with no
  user-agent sniffing, `components/events/EventLocation.tsx`):
  - Google Maps (`directionsHref`, also the ticket email's "Get
    directions"): with a place id,
    `https://www.google.com/maps/dir/?api=1&destination=<name, address>&destination_place_id=<id>`
    (the text alongside, so it still finds the address if the id goes
    stale); else with the pin, `destination=<lat>,<lng>`; else the name and
    address, as before.
  - Apple Maps (`appleMapsHref`): with the pin,
    `https://maps.apple.com/?ll=<lat>,<lng>&q=<name>`; otherwise
    `?daddr=<address as written>`. It never uses the Google place id.
  - `googlePlaceHref`: the place itself (`search/?api=1&query=…&query_place_id=…`),
    for the editor's "Check on Google Maps".
- **Our maps.** The live adapter (`lib/live/adapt.ts`) maps `location` to
  `venuePlaceId`, `venuePinned` and `coordinates` (the pin), so a pinned
  event is exact on its event page's map and on `/map`; one without a pin
  stays at its suburb's centre, labelled approximate, as before.
- **Legacy events** (everything saved before the migration, or by a client
  that sends no location) stay `legacy`: published ones stay published,
  link by their text and sit at their suburb's centre. A legacy draft needs
  a location before it can be published or submitted. No backfill.

### Accepted risks (venue location)

- **Place ids can go stale.** Google can retire one; every link carries the
  venue's text too, so it still opens at the address. Nothing refreshes
  stored ids.
- **The organiser's text came from Google.** Prefilling the address and
  storing what the organiser confirms is standard address-form practice;
  Places has no explicit carve-out for it (owner accepted, A-D2).
- **Unverified until checked on devices and in Google's docs** (the docs
  weren't reachable when this was built): the SKU tiers and prices (the
  expected cost is about A$0: Autocomplete free within a session that ends
  in Details, about 10,000 Details Essentials free a month), the
  attribution format Google requires beside the suggestions, and how the
  Google (`destination_place_id`, `query_place_id`) and Apple (`ll`, `q`,
  `daddr`) link parameters behave in each app.
- **The key has no application restriction** (server-side, and Vercel has
  no fixed egress IPs by default); it's restricted to Places API (New),
  with daily quotas and a budget alert, server-only and never in a URL.
  Our own caps (above) sit below those quotas; four accounts at their daily
  allowance could still use up the platform's day, after which everyone
  drops a pin until Google's day ends (nothing is refused or lost).
- **The pin is public.** Organisers are told so on the pin step; a house
  show's or "secret location" event's organiser can confirm the pin at the
  suburb's centre (it starts there). Rounding the public pin for events
  whose address goes only to ticket holders isn't built.
- **Esri tiles are used without a key**, as on `/map`; their terms haven't
  been checked for this use.
- **Run the location tests on a real Postgres** too (the checks and
  `admin_edit_event`'s log are database-side).

## Sign in with Google and Apple

People can create an account or sign in with Google or Apple as well as
with an email and password. It's Supabase Auth's own hosted OAuth, and it's
**browser-only**: no route, handler, `lib/server`, migration, RLS or grant
changed. The API already accepts any Supabase access token
(`lib/server/deps.ts` `verifyAccessToken` → `getUser`). A Google or Apple
user whose provider email is verified (the normal case) arrives with
`email_confirmed_at` already set, so `requireVerifiedCaller`, Who's Going,
the waitlist and follows work for them at once. An unverified provider email
gets Supabase's confirmation email and the callback's "Verify your email
first" copy (`provider_email_needs_verification`) instead of a session.

**Off by default.** The buttons render only when Supabase is configured
**and** `NEXT_PUBLIC_AUTH_PROVIDERS` lists the provider (`google`,
`apple`, or `google,apple`; `lib/auth/oauth.ts` `enabledOAuthProviders`).
Demo mode, previews and providers not yet set up show none. The flag must
list only providers enabled in the Supabase project, or Supabase answers the
redirect with a raw JSON error page. It's baked in at build time: set it for
**Production only**, then redeploy.

### The flow (redirect + PKCE)

1. `/login` or `/signup` → "Continue with Google" / "Continue with Apple"
   (`components/auth/OAuthButtons.tsx`) → `AuthContext.signInWithProvider`
   → `supabase.auth.signInWithOAuth`. The browser client uses
   `flowType: "pkce"` (`lib/supabase/browser.ts`): auth-js keeps a code
   verifier in **this origin's** localStorage and sends only its S256
   challenge. `redirectTo` is `${window.location.origin}/auth/callback?next=…`
   (`oauthCallbackUrl`), from the tab's own origin, not
   `NEXT_PUBLIC_SITE_URL`, because that's where the verifier is. Google also
   gets `prompt=select_account`: signing out of Sheltüh doesn't sign anyone
   out of Google, so on a shared device the next person would otherwise get
   the last person's account without being asked.
2. Full-page redirects: Supabase's `/auth/v1/authorize` → Google or Apple →
   Supabase's `/auth/v1/callback` (the only return URL registered with
   Google and Apple) → our `redirectTo` with `?code=…`, or with an error in
   the query or the fragment.
3. `/auth/callback` (`app/auth/callback/page.tsx` →
   `components/auth/OAuthCallback.tsx`, a client page) reads the URL once
   (in an effect behind a ref, because React Strict Mode runs effects twice
   in development and a code works once), strips it from the address bar
   (`history.replaceState`), calls `exchangeCodeForSession` once, then
   `router.replace`s to `next`, or `/dashboard` (as LoginForm and
   VerifyForm). `detectSessionInUrl` stays off, so no other page ever
   exchanges a code.
4. A failure shows only our own copy (`OAUTH_ERROR_COPY`), per Supabase
   `error_code` (cancelled, banned, sign-ups disabled, unverified provider
   email, started in another browser, expired or used, network). The URL's
   `error_description` is never rendered: anyone can put any text in a link.
   There's no retry button (auth-js deletes the verifier after a failed
   exchange): "Back to sign in" (carrying `next`) and "Use email instead".

Why a client page and not a `route.ts`: the verifier and the session live
in localStorage, which a server route can't read or write without moving
sessions to cookies (`@supabase/ssr`), a rewrite of working auth the
bearer-token API doesn't need. Popups and the providers' own JavaScript
(Sign in with Apple JS, Google Identity Services with `signInWithIdToken`)
were rejected for v1: popups fail on phones and in the iOS home-screen app,
and the scripts would run third-party code on the auth pages. The ID-token
flow stays the fallback if the Apple secret's rotation becomes a burden.

**The email flows changed too.** With PKCE, `signUp`, `resend` and
`resetPasswordForEmail` also send a code challenge (leaving an unused
verifier). The typed codes are still checked with `verifyOtp`, which PKCE
doesn't affect (`tests/supabase-pkce.test.ts`), but smoke-test email
sign-up and password reset on the real project after deploying.

### `next`: no open redirect

- `next` is checked with `safeNextPath` (`lib/safe-next-path.ts`) both when
  the sign-in starts and again on the callback, because anyone can craft a
  callback URL. `/auth/*` is refused too (`oauthReturnPath`). Unsafe means
  dropped, so the person lands on `/events` (DEFAULT_AFTER_SIGN_IN).
- Supabase accepts a `redirect_to` on the **Site URL**'s host without a
  Redirect URLs entry (path and query aren't checked); anything else must
  match an entry, or Supabase **silently falls back to the Site URL**.
  **Exactly what it compares is unverified**: it may be the hostname only
  (not scheme or port), in which case `http://` or another port on our host
  would be accepted too. The guidance doesn't depend on it: production needs
  no Redirect URLs entries; add exact entries only for HTTPS hosts we own
  (e.g. `https://staging.sheltuh.com.au/auth/callback**`), and **never** a
  `*.vercel.app` wildcard (see "Accepted risks" below).
  **Owner check** on the test project (`DEPLOYMENT.md`, smoke tests): start
  a sign-in with `redirect_to` set to `http://<site host>/auth/callback` and
  to `https://<site host>:8443/auth/callback`, note whether Supabase sends
  the code there or falls back to the Site URL, and update this bullet. If
  they're accepted, the exposure is small: we control the host, nothing of
  ours listens on other ports, and the code is useless without the verifier
  in the starting tab's storage. HSTS covers the `http://` case for anyone
  who has visited before: the app sends
  `Strict-Transport-Security: max-age=63072000` (two years;
  `next.config.ts`). `includeSubDomains` and `preload` are a later option,
  once every `sheltuh.com.au` subdomain (the landing page included) is
  confirmed HTTPS-only; preload is slow to undo.
- PKCE also stops login CSRF and code injection: a code from a flow someone
  else started can't be exchanged in the victim's browser, which doesn't
  hold that flow's verifier.
- `/auth/:path*` sends `Referrer-Policy: no-referrer` and
  `X-Robots-Tag: noindex, nofollow` (`next.config.ts`), and the page sets
  the same in its metadata, so the code never leaves in a Referer header.

### Accounts and automatic linking (the trust model)

- **Linking is automatic, by verified email.** When a Google or Apple
  identity's verified email matches an existing account, Supabase adds the
  identity to that account: the password keeps working, nothing is emailed,
  and the provider's details are merged into `user_metadata`. If the
  existing account was never confirmed, Supabase links it but clears its
  password and removes its other identities, so someone who pre-registered
  a victim's address loses it. An unverified provider email is never linked,
  **as long as "Confirm email" stays on** (with auto-confirm on, Supabase
  treats every email as verified): another reason that setting is a
  security setting.
- **Manual linking stays off** (`linkIdentity` isn't used; it needs a
  security-sensitive Supabase setting). Someone who uses Apple's Hide My
  Email gets a separate account; there's no merge tool.
- **First sign-in creates no profile row.** Nothing triggers on
  `auth.users`; a Who's Going profile is still made only by
  `PUT /api/profiles/me` with the 18+ confirmation. The display name isn't
  prefilled from the provider: it's public on Who's Going.
- **`user_metadata` is never used for authorisation.** Google, Apple and the
  user themselves (`updateUser`) can all write it. Admin is
  `app_metadata.role` only (which survives linking), ownership comes from the
  user id, and `app_metadata.providers` is a display hint (the
  `providers` field in AuthContext). The app reads no `user_metadata` today;
  keep it that way.
- Organisers are unaffected: their contact email is typed into the
  application, and Stripe Connect uses `contact_email`. `promote-admin`
  matches the account email, which for an Apple user hiding their email is
  the relay address.

### Accepted risks (Google and Apple sign-in)

- **Stale Google accounts on custom domains.** Whoever controls a Google
  account for an address gets into the Sheltüh account with that address.
  For Gmail and live Workspace addresses that's the owner. For a custom
  domain (an ex-employee's still-open Google account, a lapsed domain
  re-registered by someone else) it's a takeover path, and Supabase doesn't
  check Google's `hd` (hosted-domain) claim. Accepted. Admins use
  `@sheltuh.com.au` Workspace accounts with 2-Step Verification.
- **Apple relay duplicates.** With Hide My Email the account's email is
  `…@privaterelay.appleid.com`, which never matches an existing account, so
  the person gets a second account; Who's Going needs tickets booked with the
  relay address (the existing "booked with {email}" copy says so); our
  emails reach it only if our senders are registered as Apple email sources
  (`supabase-setup.md`); Stripe's own receipts probably won't (unverified).
  Apple's user IDs and relay addresses are **per developer team**: moving to
  a different Apple team later (e.g. the Pty Ltd's) breaks matching for
  hidden-email users (`PROJECT_CONTEXT.md`, action items).
- **Apple secret expiry.** Supabase's Apple provider needs a client secret
  JWT that Apple caps at 15,777,000 seconds (about 6 months). When it
  expires, Apple sign-in fails for everyone (Google and email keep working).
  Rotate it about every 5 months with `npm run apple-client-secret`
  (`supabase-setup.md`).
- **Off on previews.** Vercel previews share the production Supabase
  project, and their URLs can't be registered ahead of time, so the flag is
  Production only. **Never add a `*.vercel.app` wildcard (e.g.
  `https://*-<team>.vercel.app/**`) to Supabase's Redirect URLs**: anyone
  can create a Vercel project whose URL matches it, and a crafted link would
  then send a victim's code to their site (PKCE doesn't help: the attacker
  started that flow). Add exact entries only for hosts we own, e.g.
  `https://staging.sheltuh.com.au/auth/callback**`.
- **In-app browsers and the iOS home-screen app.** Google refuses sign-in in
  embedded webviews (Instagram, Facebook): OAuthButtons shows an "open in
  your browser, or use Apple or email" notice instead
  (`lib/auth/in-app-browser.ts`). Apple in webviews, and whether the iOS
  home-screen app keeps the verifier across the round trip, are unverified:
  real-device smoke tests are a launch gate (`DEPLOYMENT.md`).
- **The provider's access token** (Google's) sits in the localStorage
  session until its first refresh. Low value; accepted.
- **The consent screens show `<ref>.supabase.co`** until there's a Supabase
  custom domain or Google brand verification.
- Two tabs signing in at once: the second wins, the first gets "try again".
- **Signing back in from an expired-session message with Google or Apple**
  (`components/auth/InlineReauth.tsx`). Those accounts have no password, so
  the message links to `/login` in a new tab, and the session that tab
  creates reaches this one (Supabase shares one session per origin across
  tabs). Intended behaviour: the recovery only completes after the person
  has opened that link from this message (a sign-in in some other tab
  doesn't silently complete it), and only a new session for the expected
  account counts. It **never signs anyone out**: if the new tab signed into
  a different account, this tab says so and saves nothing, rather than
  signing that account out (with the shared session, that would sign the
  other tab out too). Accepted: someone who switches accounts in the new
  tab stays signed in as that account and has to sign back in as the
  expected one to save; and in the iOS home-screen app the new tab opens in
  Safari, whose storage is separate, so the link can't complete the
  recovery there (the password form still works for password accounts).
- **A draft stays on screen after its session ends by itself**
  (`lib/auth/useKeptWhileSignedOut.ts`). When a session expires, its
  refresh token is revoked (a sign-out on another device, a password
  reset), or a recovery refuses a wrong-account sign-in, the event editor,
  organiser application and public profile form stay on screen, signed out,
  with what was typed, so the person can sign in again in place and finish.
  Accepted: until they do (or leave the page), anyone at that device can
  read their own unsaved draft there. It's never sent as anyone else: every
  request those forms (and the message, request and report forms) make uses
  a token getter bound to the draft's owner, which reads the session when
  it's called and refuses anyone else's (`useAccountOwner`'s
  `getOwnerToken`, over AuthContext's `getAccessTokenFor`), and once another
  account's data has loaded (or failed to) the page shows that account its
  own, with a new form (keyed by account), so the draft is gone. The admin
  pages and the messages pages are keyed by account the same way, so a
  direct switch to another account remounts them. The person's **own Sign
  out** isn't an expiry: before signing out it records, for every tab here,
  that it was deliberate (`lib/auth/sign-out-signal.ts`: localStorage, read
  when Supabase's sign-out reaches a tab, and a BroadcastChannel for a tab
  that heard Supabase first; the `storage` event where there's no
  BroadcastChannel), AuthContext reports `signedOutBy: "user"`, and every
  tab drops the kept form for the ordinary signed-out page. Not covered: a
  Sign out on another device (this browser only sees its refresh token
  revoked, as for an expiry), and a tab where storage is blocked and there's
  no BroadcastChannel. Requests outside those forms (admin actions, Who's
  Going, the organiser logo) use the session's token when they're made; an
  admin action already in flight at the moment another admin signs in
  could go as them (the admin pages remount as soon as React hears of it).

## Wallet passes

"Add to Google Wallet" and "Add to Apple Wallet" put one ticket in the
buyer's phone wallet (`lib/server/wallet/*`, `lib/server/handlers/wallet.ts`,
`components/tickets/WalletButtons.tsx`; owner setup `docs/wallet-setup.md`).

**On by configuration, nothing else.** Each wallet is on only when all of its
server-only variables are set and valid (`lib/server/wallet/config.ts`, the
only reader, wired as `Deps.googleWallet` / `Deps.appleWallet`, read once per
instance, as `Deps.clipStorage`):

- Google: `GOOGLE_WALLET_ISSUER_ID` (digits), `GOOGLE_WALLET_SERVICE_ACCOUNT_EMAIL`
  (`…gserviceaccount.com`), `GOOGLE_WALLET_PRIVATE_KEY` (the JSON key file's
  `private_key`: an RSA PEM of 2048 bits or more; literal `\n` escapes and
  surrounding quotes accepted, as Vercel holds a pasted value). One option
  only: no whole-JSON variable.
- Apple: `APPLE_WALLET_PASS_TYPE_ID` (`pass.…`), `APPLE_WALLET_TEAM_ID` (10
  characters), `APPLE_WALLET_CERT_PEM`, `APPLE_WALLET_KEY_PEM`,
  `APPLE_WALLET_WWDR_PEM` (base64-encoded PEMs, or raw PEMs), and
  `APPLE_WALLET_KEY_PASSPHRASE` only for an encrypted key. Checked: the
  certificate is current, the key is its key, the WWDR certificate issued it,
  and its subject's `UID` and `OU` (when present, as on Apple's) are this
  Pass Type ID and team. Then, once per instance and before Apple is
  offered, node-forge parses the certificates and key and signs a test
  manifest (`appleSignerProblem`): a value node:crypto accepts but forge
  can't use (forge reads RSA only, so an EC certificate such as WWDR G6, or
  an EC key) turns Apple off, logged naming the variable. `Deps.appleWallet`
  is async and imports the pass builder, and with it node-forge, only when
  an `APPLE_WALLET_*` variable is set. Off from the moment the first of the
  two certificates (the Pass Type ID one or WWDR) expires, logged once
  naming it (`appleWalletGetter`).

All of a wallet's variables unset is quietly off; anything set but missing
or invalid is off and logged once, naming the variables and what's wrong
with them, never a value. No `NEXT_PUBLIC_` flag: the ticket page learns
what's on from the order response (`CustomerOrder.wallet: {google, apple}`,
computed by `getOrderBySession` from `Deps`), so a button can't drift from
the server's configuration. `wallet` is present only when the order's
tickets could be added (`walletEligible`: `paid`, `eventListed`, at least one
ticket), with `false` for a wallet that's off.

**Where it's offered.** The ticket page (`components/CheckoutConfirmation.tsx`)
shows `WalletButtons` for each ticket, under the ticket stubs, when
`order.wallet` has a wallet on (and the event is listed); each button links
the route with the ticket's number, kept from the API's order even where
seated tickets are listed by seat. The ticket email
(`lib/server/ticket-email.ts`) puts "Add to Apple Wallet" / "Add to Google
Wallet" text links in each ticket's panel, under its code, and after its
entry code in the plain text (`ticketWalletLinks`, `walletPassLink`): only
for a paid order of a published event (the routes' own rule) and only for
the wallets that are on, which the outbox reads on every attempt
(`{ google: !!deps.googleWallet(), apple: !!(await deps.appleWallet()) }`),
so a resend follows the configuration and the event as they stand then.
Tests: `tests/CheckoutConfirmation.test.tsx`, `tests/server/ticket-email.test.ts`,
and `tests/server/wallet-passes.test.ts` ("the ticket email's wallet links"),
which follows each emailed link into the route and checks the pass is the
ticket the email shows under that number.

**The capability and the rules are the ticket page's.**
`GET /api/orders/by-session/{orderId}/wallet/google?ticket={n}` and
`…/wallet/apple?ticket={n}` read the order with the page's own lookup
(`lookupCustomerOrder`, shared with `getOrderBySession`), so a pass is only
ever a ticket the page shows. In order, every answer `private, no-store`:

1. an id not shaped like an order id: 404, no query;
2. the wallet is off: 404 (`"Google Wallet passes aren't available."` /
   `"Apple Wallet passes aren't available."`), no query. A 404 rather than a
   503: the route simply isn't there until it's configured, and the page never
   links to it;
3. `ticket` missing or not 1–9999 (no leading zero): 400 `fieldErrors.ticket`;
4. one hit on the client's allowance (`WALLET_RATE_LIMITS.perClient`: 30 a
   minute, bucket `wallet_pass` on `take_client_rate_limit`, keyed and failing
   open as the payment page's limit: see "Payment flow"; no migration), for
   every well-formed request, unknown orders included; over it, 429;
5. unknown, not `paid` (pending, failed, refunded, refund pending: a refunded
   order's tickets are void), or the event not published (unpublished, in
   review, rejected, removed: the page's "no longer listed"): 404 `"Order not
   found."`. Free orders are the same: a member's is `paid` at once, a
   guest's once its emailed link is confirmed (`pending`, so 404, until
   then);
6. one hit on the order's allowance (`WALLET_RATE_LIMITS.perOrder`: 60 a
   minute however many clients ask, bucket `wallet_pass:order`, keyed on an
   HMAC of the order id as the payment page's `paymentPerOrder`), only for an
   order that's found; over it, 429. It bounds the passes signed for one
   order id spread across many addresses;
7. a `ticket` past the order's last: 404 `"Ticket not found."` (the holder
   of the order id already knows how many tickets it has). `n` is the
   ticket's number on the page and in the email (ticket type, then code,
   1-based), never its code, so the code isn't in these routes' URLs. It
   *is* in the URL the Google route redirects to: the save link's JWT
   carries the object, barcode included, signed but not encrypted. That URL
   goes from our 302 to the browser and Google only (`no-referrer`). Inserting
   objects with Google's REST API first and sending a "skinny" JWT of ids
   would remove it (not built: it needs an OAuth token exchange);
8. then one read of the ticket's `wallet_serial` and the event's id,
   current title and street address (the page's response leaves the address
   out; the email shows it), again only while it's published.

Writes nothing but the counters; logs nothing about the order. The order id
is in the path, as for every `/orders/by-session` route (the page's own
URL); the routes are linked from `/checkout/*` pages (`no-referrer`), and
the Google redirect sets `Referrer-Policy: no-referrer` itself, so Google
never gets the URL as a Referer.

**What a pass shows** (`lib/server/wallet/pass-content.ts`, built once per
request so the two can't disagree): the event's current title (as the
email; Google's class is shared by every ticket for the event, so it can't
be one order's snapshot, and the passes are only made while the event is
published), date and time in the event's zone (`passTimeZone`: the
ticket page's `eventTimeZone`, Melbourne when absent), venue name and address, ticket type, "Ticket n of N", the seat, the
QR carrying exactly the existing payload (`ticketQrPayload`: `SH1:` + code;
none for a code that isn't canonical, as the email) with the code as its
alternate text, and the order's short reference. Nothing about the buyer:
no email, name or order id. Both wallets draw their own QR from the
payload, so the symbol may differ from the email's (level Q) but scans to
the same text, which check-in already accepts. Ivory background, black
text, Signal Orange only as a fill (`lib/server/wallet/brand.ts`); images in
`public/wallet/` (`scripts/render-wallet-images.ts`).

**Google** (`lib/server/wallet/google.ts`, no dependency): a "Save to Google
Wallet" JWT, RS256 over node:crypto with the service account's key, `iss`
the service account, `aud` `google`, `typ` `savetowallet`, `origins`
`[NEXT_PUBLIC_SITE_URL's origin]`, and the payload's `eventTicketClasses` and
`eventTicketObjects` inline: class `{issuerId}.sheltuh-event-{eventId}`
(`reviewStatus` `UNDER_REVIEW`, event name, venue, `dateTime` as the venue's
local time with its offset, logo and hero image URLs on the site), object
`{issuerId}.sheltuh-ticket-{serial}` (`serial`: the ticket's
`wallet_serial`, a random uuid stored with it, as 32 hex characters, so the
same ticket is always the same object and the id says nothing about the
code: a serial hashed from the code could be reversed by trying all 2^40
codes, and a pass's id can never change once saved; ids keep to
`[A-Za-z0-9._-]`), barcode `QR_CODE`. The route answers 302 to
`https://pay.google.com/gp/v/save/{jwt}`. **One ticket per JWT**, not the
order: the JWT travels in a URL, a typical ticket's is about 2.5 KB (a test
holds it under 5 KB at the longest field lengths), and a whole order's (10
seats, or more general admission tickets) could pass what browsers and
Google's front end reliably accept (the exact limit is unverified); it also
matches Apple's one pass per ticket.

**Apple** (`lib/server/wallet/apple.ts`): a `.pkpass` per ticket, built
here: `pass.json` (`formatVersion` 1, the Pass Type ID and team, the serial
above as `serialNumber`, `organizationName` "Sheltüh", `description`,
`groupingIdentifier` per event, `sharingProhibited`, the colours,
`relevantDate` and `relevantDates`, an `eventTicket` with header (date),
primary (event), secondary (time, venue), auxiliary (ticket, seat) and back
fields, and `barcodes` with the QR payload and `altText`); the images;
`manifest.json` (SHA-1 of each file); and `signature`, a detached PKCS #7
SignedData over the manifest (SHA-256, with contentType, messageDigest and
signingTime attributes) by the Pass Type ID certificate, carrying it and the
WWDR intermediate. The zip is written by `zipStore` (stored entries, a fixed
1980 timestamp). 200 `application/vnd.apple.pkpass`, `Content-Disposition:
attachment; filename="sheltuh-ticket-{n}.pkpass"`, `nosniff`.

**The dependency: `node-forge`** (runtime, pinned exactly to `1.4.0`) and
`@types/node-forge` (dev).
Node can't make PKCS #7, so forge makes the signature, and nothing else of
it is used; only `lib/server/wallet/apple.ts` imports it (the configuration
is read with node:crypto). The two wallet routes import that module; every
other route reaches it only through `Deps.appleWallet`'s dynamic import, so
forge is loaded there only when an `APPLE_WALLET_*` variable is set. Chosen over `passkit-generator`, which wraps forge and adds `joi`
(five more packages), `tslib` and a zip library. forge has no dependencies,
is pure JavaScript (fine in Vercel's Node runtime), BSD-3-Clause (or GPL-2.0,
our choice), Digital Bazaar's, 1.4.0 released March 2026. `npm audit` lists
one high advisory against every forge version (GHSA-86w9-cpqp-85rv: RSA
PKCS #1 v1.5 signature *verification* accepts extra nested DigestAlgorithm
elements, no fix yet). It concerns verifying signatures, which this code
never asks forge to do (the tests verify with node:crypto). Guardrails: the
version is pinned exactly, and an ESLint `no-restricted-imports` rule
(`eslint.config.mjs`) refuses `node-forge` anywhere but
`lib/server/wallet/apple.ts` and `tests/server/helpers/wallet.ts`. **Revisit**
when a forge release fixes the advisory (update the pin and re-run the
wallet tests), when another advisory names forge's PKCS #7, ASN.1 or RSA
signing code, or if anything ever needs to verify a signature (use
node:crypto, never forge).

### Accepted limits (wallet passes)

- **No updates in v1.** No Apple web service (no `webServiceURL` or
  `authenticationToken`) and no Google REST API: a saved pass never changes.
  If the event's time or venue changes, or the order is refunded, the pass in
  the wallet still shows what it showed. Google keeps a class as it was
  first saved: an event's later edits (an organiser's or a moderation edit
  by an admin, its title included) reach neither saved passes nor new saves
  of the same event's tickets (the class id is per event). The
  door is the authority: check-in refuses a refunded order's code
  (`not_admissible`) whatever a wallet shows. A later option: Apple's pass
  web service (`webServiceURL`, push updates through APNs) and Google's REST
  API (`eventTicketClass.patch`, `eventTicketObject.patch`, voiding objects
  on refund).
- **Google's save page before publishing access**: only accounts listed in
  the Pay & Wallet Console can save passes, as test passes, until Google
  approves publishing access (`docs/wallet-setup.md`).
- **Unverified against the real services** (no credentials here): that
  Google accepts the inline class and object as built (field names from
  Google's REST reference, from memory) and renders the logo and hero; that
  iOS Wallet accepts the pass (the signature is checked against a test chain
  with node:crypto and `openssl cms -verify`, not against Apple's WWDR); the
  look of both. `docs/wallet-setup.md` has the checks to run.
- **Text buttons** until the official badges are added
  (`docs/wallet-setup.md`, "Official badges").

## Not built yet

- Account invites, later: inviting someone to take over a platform-managed
  organiser (the owner decided against it for the first version: it's a
  one-way ownership transfer, moving door check-in to the new owner), and
  any reminder emails (deliberately none: Spam Act).
- Organiser logos, later: the logo as the organiser page's `og:image`, logos
  on event cards and the Following list, and logos for platform-managed
  organisers (an admin upload; today only the organiser's own account can
  upload, and a platform-managed organiser has none).
- Reserved seating, later (plan): live block/unblock (SQL runbook for now,
  `docs/supabase-setup.md`), a move-seat tool (likewise), standing areas on
  the map, venue templates, Realtime, the Companion Card flow, and
  per-visitor protection on holds (Turnstile or a Vercel WAF rule; until
  then, admins don't approve seated events for real on-sales: an
  organiser's publish of a seated event always goes to review, so it stays
  an admin's call). There's no seating on/off switch.
- Add to calendar on `/checkout/success` (the event page has it;
  `CustomerOrder` carries no event start, end or venue; `docs/FEATURE_PLAN.md`).
- Drop `private.user_reports.reported_avatar` (inline photo copies, superseded
  by `private.report_photos` in `20261102000100_social_hardening.sql`) once
  no report has one (reports made before it are deleted 2 years after
  resolution), with its `user_reports_one_avatar_copy` check, and the
  `coalesce` in `adminGetReportAvatar`.
- Retire `/checkout/cancelled` (and the hosted-checkout wording in the
  cancel route's comments) once hosted Checkout Sessions created before
  embedded checkout have all expired (24 hours after that deploy). The
  cancel route itself stays: the seat page uses it.
- A strict Content Security Policy on `/checkout/pay` (see "Accepted risks
  (embedded checkout)").
- Drop `private.claim_outbox_jobs` (superseded by `claim_email_outbox` in
  `20261024000200_organiser_follows.sql`) once the deploy window is over.
- Drop `private.claim_email_outbox` (superseded by `lease_outbox_jobs` in
  `20261107000000_admin_review_emails.sql`) once that deploy window is over.
- Drop the 3-argument `private.record_payment_refund` (superseded by the
  6-argument form in `20261109000200_payment_reconciliation.sql`) once the
  deploy window is over.
- An admin page for payment exceptions (the API exists:
  `GET /api/admin/payment-exceptions`).

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
- Venue location, the editor's side (A-F2): the venue search (an APG
  combobox over `lib/api/places.ts`, with Google Maps attribution), prefill,
  "Can't find it on Google Maps?" and the pin step (`VenuePinMap`), and the
  admin queue's "Linked to Google Maps / Pinned / Address only" line. Until
  it ships, organisers can't add a location, so `publish` and `submit`
  answer 409 `location_required` for every event.
- Venue location, later: legacy events have no pin (no backfill; the maps
  place them at their suburb's centre); wallet passes and the calendar file
  don't carry the pin or the directions link yet.
- Retire `POST /events/{id}/submit` (and `submit_event`) once no deployed
  editor calls it: the publish route sends to review whatever needs it.
  Until then its pin check is the handler's (`refuseSubmitWithoutPin`), not
  the database's (`20261111000400_submit_event_location_in_app.sql`).
- An admin "void tickets" action for a paid order refunded in part (e.g.
  the tickets refunded in Stripe and Support Sheltüh kept): today only a
  full refund voids tickets (`20261111000300_refund_no_inference.sql`), and
  the runbook (`docs/supabase-setup.md`, "Refunding a paid order") says
  what to do meanwhile.
- Publishing, later: an email to the organiser when an admin unpublishes
  their event (B-D7; they see the reason on the draft meanwhile); a daily
  digest instead of one admin email per self-published event, at scale;
  organisers editing a published event (B-D5: not planned for now).
- Who's Going beyond increment 2: no admin UI for suspensions or the
  per-event switch (SQL only, `docs/supabase-setup.md`), and an opt-in isn't
  revisited if the member later changes their email or the order stops being
  `paid`.
- Messages: no realtime delivery or email notifications (clients poll), no
  attachments, and a declined pair can't start over (one conversation per
  pair, ever).
