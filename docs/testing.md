# Testing

What each test layer proves, how to run it, and what nobody has checked
automatically. The five layers are separate on purpose. A mocked checkout
is **not** a verified Stripe integration, and a captured email is **not** a
delivered one.

| Layer | What's real | What's faked | Command |
| --- | --- | --- | --- |
| **(a) API tests on a real database** (`tests/server`) | Handlers, SQL, every migration, Postgres (PGlite by default, or a real server through postgres.js) | Stripe (`vi.fn`), email (`vi.fn`), auth (a token map), HTTP (handlers called directly) | `npm test` / `TEST_DATABASE_URL=… npx vitest run tests/server` |
| **(b) Journey harness** (`journey/`) | Real HTTP; the real `app/api/**/route.ts` modules, `route()` and `getDeps()` wiring; postgres.js on a real Postgres; supabase-js token checks; nodemailer over SMTP; the Stripe SDK's HTTP client; webhook signatures | Supabase Auth (a local `/auth/v1/user` stub), the SMTP server (a local sink), the Stripe API (a local fake) | `npm run test:journey` (opt-in, below) |
| **(c) Mocked browser e2e** (`e2e/`) | Next dev server, React pages, Chromium (desktop and a 375px touch phone) | Every `/api/*` call (`page.route()`), Supabase (a placeholder URL) | `npm run test:e2e` |
| **(d) External integration checks** | Stripe test mode, Supabase Auth, real mailboxes | Nothing. The owner runs these by hand. | Checklist below |
| **(e) Real-phone checks** | Real devices, cameras, networks | Nothing. Manual. | Checklist below |

Other unit and component tests (`tests/*.test.ts(x)`, jsdom) sit beside (a)
and run with `npm test`.

## (b) The journey harness

### Running it

It skips (and exits 0) unless both opt-ins are set:

```bash
# Linux / macOS / Git Bash
JOURNEY=1 TEST_DATABASE_URL=postgres://postgres@127.0.0.1:5432/postgres npm run test:journey
```

```powershell
# Windows PowerShell
$env:JOURNEY="1"; $env:TEST_DATABASE_URL="postgres://postgres@127.0.0.1:5432/postgres"; npm run test:journey
```

- `TEST_DATABASE_URL` is a **local** Postgres (13 or later, for
  `drop database … with (force)`; ideally the version Supabase runs) that the
  user can create databases on. Each journey file creates
  `sheltuh_test_journey_<random>`, applies `supabase/test/supabase-stubs.sql`
  and every migration, and drops it with `force` when it's done. A crashed
  run can leave one behind, so list them with
  `select datname from pg_database where datname like 'sheltuh_test%'`.
  `tests/server` runs on a real server never drop their `sheltuh_test_<hex>`
  databases, so clear those the same way.
- It refuses a non-local database host unless `JOURNEY_ALLOW_REMOTE_DB=1`
  is set (for a disposable CI service container).
- `STRIPE_SECRET_KEY` can stay unset. If it's set, it must start with
  `sk_test_` (owner decision D9), or the runner refuses to start. The harness
  never contacts Stripe.
- Pass Vitest arguments after `--`, for example
  `npm run test:journey -- journey/social-access.journey.ts`.
- The runner is `scripts/journey.mjs` (plain Node, so it works the same on
  Windows) and the config is `vitest.journey.config.mts`. The default
  `npm test` never picks up `journey/`.

### How it works

`journey/harness/` starts these, all on `127.0.0.1` on ports the OS picks:

- **The app's API** (`app-server.ts`). Every `app/api/**/route.ts` module
  is loaded unchanged and called the way Next calls it. The production
  `getDeps()` is built from the environment, which the harness points at the
  stand-ins below (`DATABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `SMTP_*`,
  `STRIPE_WEBHOOK_SECRET`, `CRON_SECRET`, …). Exactly two members are
  swapped:
  - `stripe()` becomes the real Stripe SDK with its `host`/`port`/`protocol`
    options aimed at the fake API, and only ever with a `sk_test_` key.
  - `defer()` runs tasks after the response has been written, because
    Next's `after()` only works inside Next. Failures are logged the same
    way.
- **Auth stub** (`auth-stub.ts`): `GET /auth/v1/user`. It checks the
  `apikey` header, and reads the user behind an opaque token from
  `auth.users` on every request. `revoke(token)` simulates a session that
  has expired or been signed out.
- **SMTP sink** (`smtp-sink.ts`): requires AUTH (PLAIN or LOGIN) with the
  configured credentials. It captures the raw MIME, which the harness can
  parse, and can refuse DATA to simulate an outage. `qrModulesFromPng` reads
  a ticket QR's modules back from the PNG's pixels without knowing how the
  image was made.
- **Fake Stripe API** (`fake-stripe.ts`): Connect accounts and links,
  Checkout Sessions (create, retrieve, expire) and refunds. It applies
  Stripe's idempotency rules (the same key replays the response; the same
  key with other parameters is an error) and refuses a destination that
  can't take charges. On the test side it plays the buyer paying, the
  organiser refunding in the dashboard, and the events Stripe would send,
  signed with the webhook secret.

`tests/journey-harness.test.ts` checks these parts on their own under
`npm test` (no database). That way a fake that accepted anything, or a
decoder that read anything as a match, can't make the journeys pass
vacuously.

**Why not `next build` and `next start`?** `lib/server/deps.ts` builds
`new Stripe(STRIPE_SECRET_KEY)` and has no API-base override. A server
started with `next start` can't be pointed at a fake Stripe without changing
production code. The plan's `STRIPE_API_BASE` override (D9, honoured only
for `sk_test_` keys) needs its own change and a security review. With it in
place, the same stubs could serve a `next start` on port 3190–3199 and a
Playwright journey config with no `/api` interception. Until then, the
journeys run at the HTTP level against the real route modules. Pages,
`next.config.ts` headers and Next's own request handling aren't exercised.

### The journeys, and what each adds beyond (a)

| # | Journey (file) | Already covered at the API level in (a) | What the harness adds |
| --- | --- | --- | --- |
| 1 | Purchase → payment webhook → ticket email → QR → door scan → duplicate refused → dashboard refund → entry refused (`payments-door`) | `orders`, `ticket-email`, `check-ins` (each step on its own, with mocks) | The steps chained through HTTP. The organiser onboards through Connect, and the session parameters are checked as the SDK encoded them (database prices, fee, destination, idempotency key). The webhook is signed and verified over the wire, and a forged one is refused. The email goes over authenticated SMTP, and its inline QR PNGs, read back from their pixels, are exactly the issued codes' QRs. A redelivery sends no second email. |
| 2 | Full refund delivered before the payment webhook, then the payment (`payments-door`) | `payment-reconciliation` (D1, redeliveries) | The real charge destination from the session, both orders of redelivery over HTTP, and no ticket email sent |
| 3 | Two ticket holders: Who's Going, messages, report, block (`social-access`) | `going`, `messages`, `message-safety` (with inserted orders) | Eligibility from real paid orders (checkout and webhook) and tokens checked per request. Then: report → admin queue, block → refused both ways. |
| 4 | Another organiser's event, dashboard, analytics, CSV and door → 404; a member → 403; no or expired token → 401 (`social-access`) | `check-ins`, `events`, `analytics` (per handler) | One sweep across the real routes. An expired session comes from the auth stub. The other organiser's own door shows the ticket as an indistinguishable `invalid`, and nothing is checked in by the refusals. |
| 5 | A lost scan response, then the retry; the same scan twice at once (`payments-door`) | `check-ins` "retries" | The connection really drops after the server answered. The concurrent duplicate goes over separate connections. One admission is shown in the summary. |
| 6 | Sold-out race: 5 payments for 2 tickets delivered at once, then redelivered at once (`payments-door`) | `orders` (sequential), `seating-races` (seated, real Postgres) | General admission over concurrent HTTP and a postgres.js pool. Three refunds are sent to Stripe with `reverse_transfer`, `refund_application_fee` and per-order idempotency keys. Exactly two ticket emails go out, and nothing more on redelivery. |
| 7 | Checkout double click (5 identical requests at once), a retry, a reused key, after payment (`payments-door`) | `checkout-attempts` (incl. real-Postgres concurrency) | One session created at the Stripe API (replays counted separately). The `Idempotency-Key` header is read off real requests, and `idempotent-replayed` is set on the reply. |

**Not journeyed yet:** email retries (sink refuses → `GET /api/cron/email-outbox` delivers),
refund-failure alerts (`refund.failed` → ops alert email), seated checkout
and Back from Stripe, free and guest-confirmed orders, the waitlist, and
the browser itself. The parts are all there: `smtp.rejectData`,
`j.cronSecret` and `stripe.event(…)`.

## (c) Mocked browser e2e

Playwright on port 3177 in live mode, with placeholder Supabase settings and
every `/api/*` request answered by the test (`page.route()`). It proves that
pages render and behave on desktop and phone widths for the API answers the
test chooses: the success page's QR (`checkout-success-qr`), the seat
picker through to "goes to Stripe" (`seating`, where Stripe is a fake URL),
the event page and buy bar, discovery, the home page, pagination, the PWA
shell, and member profiles with Message/Block/Report (`social`). It proves
nothing about the API, the database, Stripe, email or auth.

## (d) External integration checks (the owner runs these)

None of these has been run. Do them in **Stripe test mode** and a staging
Supabase project before go-live, never against live keys.

**Stripe (test mode)**
- [ ] Forward webhooks to the deployed or local app: `stripe listen --forward-to <url>/api/stripe/webhook`.
  Use the `whsec_` it prints as `STRIPE_WEBHOOK_SECRET`.
- [ ] Organiser onboarding: Connect Express account link, return, refresh. Payouts are enabled only once Stripe says so.
- [ ] Buy with `4242 4242 4242 4242`. Check the order is paid, the ticket email arrives, the application fee is on the platform and the transfer goes to the connected account.
- [ ] Buy with a 3-D Secure card (`4000 0025 0000 3155`), and with a declined card (`4000 0000 0000 9995`). Check no tickets are issued for the decline.
- [ ] Refund in full from the dashboard: `charge.refunded` arrives, the order is refunded, and the door refuses the tickets. Then refund partially: a `partial_refund` exception and an ops alert.
- [ ] Refund failure with card `4000 0000 0000 5126`. Record **which** events Stripe sends (`refund.failed`, `refund.updated`, `charge.refund.updated`). An exception opens, and the alert email arrives. (Plan risk: unverified.)
- [ ] Event ordering: resend events with `stripe events resend <evt_id>` to check redeliveries are harmless.
- [ ] Double click Checkout and use Back from Stripe on a phone: one order, and the seats are released.

**Supabase Auth**
- [ ] Sign up, confirm email, sign in. Signing out or deleting the user stops their token working on the next API call.
- [ ] `npm run promote-admin` grants admin on the next request. An unconfirmed email can't use Who's Going or messaging.

**Email delivery**
- [ ] A ticket email reaches Gmail, Outlook and iOS Mail, and SPF/DKIM pass (`Show original`).
- [ ] The QR shows inline with images blocked, and scans from the screen at the door.
- [ ] Ops alerts reach `OPS_ALERT_EMAIL`.
- [ ] With SMTP broken, then fixed, the Supabase Cron runner (`docs/supabase-setup.md` §3) delivers the queued email.

## (e) Real-phone checks (manual)

- [ ] **iPhone (Safari) and Android (Chrome)**: the door scanner reads a QR from another phone's screen at low and full brightness, and from a printed ticket. Allowing and denying camera permission both work.
- [ ] Duplicate scan shows "already checked in" with time, and a refunded ticket is refused.
- [ ] Flaky network (airplane mode toggled mid-scan): the retry shows the original result, and the ticket isn't counted twice.
- [ ] The success page QR at full brightness scans first time. The ticket email QR on the phone's mail app scans too.
- [ ] Checkout on a phone through Stripe and back (success and Back), including 3-D Secure.
- [ ] Add to Home Screen (iOS Safari, Android Chrome), launch offline, and the offline page shows (see `docs/pwa.md`).
- [ ] Who's Going, messages, block and report on a 375px-wide phone, in a real thumb reach.

## Coverage matrix

`✓` automated, `–` not covered at that layer, `☐` manual or owner check.

| Check | (a) Real-DB API | (b) Journey harness | (c) Mocked browser | (d) External (owner) | (e) Phone |
| --- | --- | --- | --- | --- | --- |
| Buy, payment webhook, fulfil | ✓ | ✓ (fake Stripe, signed webhooks) | – | ☐ 4242, 3DS, decline | ☐ |
| Ticket email content and QR | ✓ (builder; sender mocked) | ✓ (SMTP sink; QR pixels = issued code) | – | ☐ real inboxes | ☐ mail app |
| QR on the success page | – | – (API codes only) | ✓ | – | ☐ brightness |
| Door scan, duplicate, refund refused | ✓ | ✓ | – | ☐ dashboard refund | ☐ iOS, Android |
| Lost scan response, retry | ✓ | ✓ (dropped connection) | – | – | ☐ flaky network |
| Early refund (before payment) | ✓ | ✓ | – | ☐ ordering via resend | – |
| Refund failure, exception, ops alert | ✓ | – (not journeyed yet) | – | ☐ card 5126 | – |
| Who's Going, messages, block, report | ✓ | ✓ (two accounts) | ✓ (profile UI) | – | ☐ |
| Unauthorised access (404/403/401) | ✓ | ✓ | – | ☐ real Supabase tokens | – |
| Sold-out race | ✓ | ✓ (concurrent webhooks) | – | – | – |
| Checkout idempotency, double click | ✓ | ✓ | – | ☐ double click | ☐ Back from Stripe |
| Seated checkout, holds, Back | ✓ | – | ✓ | ☐ | ☐ |
| Email retries, outbox health | ✓ | – (not journeyed yet) | – | ☐ pg_cron run | – |
| Supabase Auth itself (sign-in, confirm, expiry) | – (token map) | – (stub) | – | ☐ | ☐ |
| Stripe's own behaviour (events sent, refund states) | – | – (our model of it) | – | ☐ | – |
