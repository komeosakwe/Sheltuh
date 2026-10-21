# Feature plan: website, October 2026

Owner-approved plan (handover 21 Oct 2026). Nothing here is built unless a
status line says so. App/PWA/Capacitor work is dropped for now: the website
comes first. Other payment providers (PayPal, Afterpay) are deferred; Apple Pay
and Google Pay are a Stripe Dashboard setting only, and buy-now-pay-later is
not enabled without repricing.

## Order

Backend B1 → B2 → B3 → B4, one at a time (they share files). The home design
spec is written in parallel. Then frontend F1 (external ticketing UI), F2 (admin
authoring UI), F3 (home), F4 (outbound clicks in analytics), F5 (admin
trending), then security, accessibility, visual and code reviews.

## B1: listing defects

- `GET /api/events?upcoming=1` keeps only events that haven't ended
  (`ends_at > now()`); home and /events use it, so past events no longer crowd
  out upcoming ones.
- Events with no ticket types must not break pricing (`Infinity`, wrong
  `is_free`).
- The booking-fee sentence in `components/EventDetailsView.tsx` is derived from
  `lib/fees.ts`, not hard-coded.

## B2: external ticketing

Migration `20261022000000_external_ticketing.sql`.

- `events.ticketing_mode` (`sheltuh` | `external`), `external_ticket_url`,
  `external_free`.
- URL rules: https only; no credentials, IP addresses, localhost, ports or
  link shorteners.
- Event page shows "Get tickets on <provider>" (Humanitix, Eventbrite, etc.).
  No Sheltüh checkout, booking fee, Who's Going or check-in for these events.
- Cookie-free outbound-click beacon `POST /api/events/{id}/outbound`, counted in
  `event_outbound_clicks` and shown in organiser analytics.
- The URL is reviewed at approval and then frozen: after that only admins can
  change it, and every change is logged.

## B3: admin event authoring

Migration `20261022000100`.

- `POST /api/admin/organisers`: platform-managed organiser (no owner).
- `POST /api/admin/events`: create, optionally publish through
  `transition_event`.
- `PATCH /api/admin/events/{id}` with `expectedUpdatedAt`; image PUT and DELETE.
- Admin UI `/admin/events/new` and `/admin/events/{id}/edit`, reusing
  `EventEditor`.
- Moderation log actions `created`, `edited`, `curated`.
- Platform-managed organisers cannot sell paid Sheltüh tickets. Their events'
  free tickets are checked in by admins (owner decision below; built 21 Oct).

## B4: trending

Migration `20261023000000`.

- Score `S = R · P · B`.
- Daily utility `u = 6·ln(1+V) + 8F + 15G + 25Op + 10Of`: V views (capped at
  300 a day, and zero on flood days), F favourites, G Who's Going opt-ins, Op
  paid orders, Of free orders (each capped at 50 a day). The organiser's own
  activity is excluded.
- Decay: 3-day half-life over 14 days. Bayesian shrinkage with m = 2 towards
  the median.
- Start proximity P: 1 within 7 days, floor 0.3. Admin boost B in [0.5, 2].
- Eligible: published, organiser approved, not ended, starts within 60 days,
  at least 6 hours since approval, not excluded, at least 3 engagement events.
  At most 2 per organiser, top 24.
- Snapshot table refreshed every 15 minutes by Vercel Cron
  `GET /api/cron/trending` (`CRON_SECRET`).
- Public `GET /api/events/trending`: hidden with fewer than 3 events. Labels
  "N going", "Just announced", "Popular this week"; never raw counts.
- Admin curation `PUT /api/admin/events/{id}/curation`.
- Favourites (F) count: approved by the owner on 21 Oct 2026. Only as an
  aggregate input to the score, never shown or exported per event or person.
  docs/architecture.md ("Favourites") is updated to match, and the Privacy
  Policy needs wording before go-live (see the final report).

## Home (design spec `docs/design/home.md` first)

One responsive home, generalising the phone home: rails below `sm`, grids from
`sm`, an "Up next" featured card in the hero from `lg`. Sections: Up next,
Trending, This weekend (Fri 17:00 to Sun 23:59 Melbourne time), Coming up near
you, and the rest. Each event appears once on the page.

## Added 21 Oct 2026 (owner)

### Brand Direction One redesign

The whole site moves to the official brand identity ("Structured Expression"):
black, white, cream `#FFFAE7` and Signal Orange `#FF4800`; Bootzy TM display
(licensed files still needed; temporary fallback until then), Instrument Sans,
IBM Plex Mono; the official wordmark, ü and two-dot logos in `public/brand/`.
Spec: `docs/design/brand-direction-one.md`. It replaces the earlier visual
direction (pink accents) but keeps the home structure in `docs/design/home.md`.
Functionality, API contracts and the door scanner's functional colours are
unchanged.

### Discovery and buying

- Quick buy from event cards: a direct "Get tickets" route from home and
  discovery cards, without breaking the card's main link.
- Share to a friend: Web Share API with a copy-link fallback, on cards and the
  event page.
- Add to calendar (low priority): `.ics` download and a Google Calendar link on
  the event page and the ticket confirmation.
- Waitlist for sold-out events: join from the event page and cards;
  backend design to follow (consent, notification when tickets free up).
  **TODO (not built):** the UI states are specified
  (`docs/design/brand-direction-one.md` §6.11) but nothing renders them yet,
  because there's no data to drive them. The waitlist needs, first, sold-out
  data in the public event payloads (per ticket type `remaining` or
  `soldOut`; today `quantityAvailable` is the organiser's capacity, not
  what's left) and, second, endpoints to join, check status and leave, plus
  the notification email (contract B-WL, §10). The event page, cards and buy
  bar must not show "Sold out" or "Join waitlist" until then.
- Add to calendar on the ticket confirmation (`/checkout/success`): not
  built yet. `CustomerOrder` has no event start, end or venue; it needs
  `eventStartsAt`, `eventEndsAt`, `venueName` and `venueAddress` (additive),
  or the page fetching the event by `eventSlug`. The event page has it.

### Pricing (ACCC)

Advertised prices are the all-inclusive total, including the unavoidable
booking fee, and no partial price is more prominent than the total. This
applies to event cards, the ticket-selection screen and checkout, not only the
payment step. Checkout stays visually quiet, predictable and trustworthy.

### Owner decision (21 Oct 2026): admin check-in for platform-managed events

Events under a platform-managed organiser (no organiser account) can issue
free Sheltüh tickets. Admins may run the door scanner for those events only:
same atomic check-in, rate limit and audit log, with the admin recorded as the
scanner. Admins still cannot check in for organiser-owned events.

### Manager decisions while the owner is away (21 Oct 2026)

- Trending eligibility counts distinct people, not actions: at least 3 different
  members (by account or email) must have engaged, so one person can't make an
  event trend alone.
- Events page opens on the map (Map first, List second); `?view=list` still
  opens the list.
- Card and list quick-buy reads "Buy tickets" (paid) or "Get free tickets".
- Loading states show the two-dot loader with an estimated percentage that
  only reaches 100% when data arrives.
- Curation (boost/exclude) entries are hidden from organisers' moderation log.
- Unpublished events: ticket pages and resent emails drop the venue and time
  and say the event is no longer listed.
