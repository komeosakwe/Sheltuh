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
  "Who's Going"), add narrow RLS policies for just that.
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
| `events` | `id` | Belongs to an organiser. Globally unique `slug`. `status`: draft → pending_review → published / rejected; unpublish returns it to draft. `is_free` is kept up to date for the feed's free/paid filter. |
| `ticket_types` | `(event_id, id)` | `id` is stable across draft edits. `quantity_sold` only ever changes in `fulfil_order`. |
| `event_moderation_log` | `id` | Append-only: submitted / approved / rejected / unpublished, by whom, and why. |
| `orders` | `id` (`ord_…`) | Priced snapshot of the line items and totals. `status`: pending → paid / failed, or oversold_refund_required → refunded. `tickets_emailed_at` records the ticket email. |
| `tickets` | `code` | One row per admitted person. This is the future home of check-in and "Who's Going". |

Timestamps are `timestamptz`. Organisers enter Australia/Melbourne local
times, which are converted to instants honouring daylight saving
(`lib/server/melbourne-time.ts`).

## Database functions (schema `private`)

| Function | What it guarantees |
|---|---|
| `create_event_draft`, `update_event_draft` | Event row and ticket types saved together. Updates only succeed while the event is draft or rejected and owned by the caller's organiser. |
| `replace_ticket_types` | Upserts by id and removes ticket types that were dropped. Refuses to remove one with sales, or to cut a quantity below what's already sold. |
| `transition_event` | Changes status and writes the moderation log entry in one step. It only moves an event from an expected status, so two admins acting at once can't both succeed; the loser gets a 409. |
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

Booking fee: 4% of face value + A$0.50 per paid ticket (`lib/fees.ts`,
which the API and the UI both use). It's either buyer-paid or absorbed by
the organiser, set per ticket type. Either way the platform keeps it.

## API

All routes are JSON under `/api`. "Organiser" means a signed-in user whose
application is approved.

| Method & path | Who |
|---|---|
| `GET /events?category&pricing&onOrAfter&cursor&limit` | public (published only) |
| `GET /events/slug/{slug}` | public (published only) |
| `POST /events/{eventId}/checkout` | public |
| `GET /orders/by-session/{orderId}` | public (id is the credential) |
| `POST /stripe/webhook` | Stripe (signature-verified) |
| `POST /organisers/apply` · `GET /organisers/me` · `PATCH /organisers/me` | signed in |
| `POST /organisers/me/connect/onboard` · `…/connect/refresh` | organiser |
| `POST /events` · `PATCH /events/{id}` · `POST /events/{id}/submit` | organiser (own events) |
| `GET /organisers/me/events` · `GET /organisers/me/events/{id}` | organiser (own events) |
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
- Event images.
- Venue coordinates (the map falls back to suburb centroids).
- "Who's Going".
