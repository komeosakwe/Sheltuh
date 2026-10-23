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
  at least 6 hours since approval, not excluded, at least 3 different people
  engaging (manager decision below; migration `20261023000200`).
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
- Waitlist for sold-out events: join from the event page and cards.
  **Backend built (B-WL, 21 Oct 2026; migration `20261024000000_waitlist.sql`,
  docs/architecture.md "Waitlist"):** public event payloads carry `soldOut`
  (event and ticket type) and `remaining` (only at 10 or fewer); endpoints to
  join (members with their verified email at once, anyone else by an emailed
  link), check status, leave (signed in, or by each email's leave link) and
  confirm; "tickets are available again" emails through the outbox when
  tickets free up; the organiser's analytics `waitlistCount`.
  **UI built (21 Oct 2026):** sold-out states on cards and the buy bar,
  "From" skipping sold-out tiers, and the `/waitlist/confirm` and
  `/waitlist/leave` pages.
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

### Owner request (21 Oct 2026): clickable Who's Going names and member profiles

Manager design decision: member profiles are opt-in (default off). Only
verified members with a profile can see them (the same gate as Who's Going
names). A profile shows the display name, an optional short bio and Instagram
handle, and the upcoming events the member has opted into, with Message,
Block and Report. No email or user id; the URL uses an opaque profile id.
Members who haven't opted in stay plain text in the list. Blocking hides
profiles both ways. Privacy Policy wording is needed.
Profile pictures (owner request, same day): an optional photo on the member
profile. The server re-encodes it to a small square image and strips all
metadata (camera and GPS location) before storing it. It is shown only to
signed-in members, only for profiles that are visible, and falls back to
initials otherwise. Reporting and blocking cover the photo.
**Backend built (21 Oct 2026; migration `20261024000100_member_profiles.sql`,
docs/architecture.md "Member profiles"):** opt-in visibility, bio and
Instagram handle (`PATCH /profiles/me`), photo upload re-encoded with sharp
to 512 px and 96 px WebP with all metadata stripped, `GET /profiles/{profileId}`
and its photo behind the Who's Going gate (blocks both ways, suspensions,
rate limit), `profileId` and thumbnail on the attendee list only for visible
profiles, message/block/report by `profileId`, admin removal of photo, bio or
handle (logged). **UI built (21 Oct 2026):** the
profile page, settings and photo upload, clickable names with thumbnails,
and the admin report and profile views.
Privacy Policy wording is drafted in docs/architecture.md.

### Owner request (21 Oct 2026): organiser followers, events hosted, video

Manager design decisions:
- Members can follow organisers. The follower count shows publicly once it
  reaches 10 (hidden below that, like Who's Going counts).
- Organiser pages show "Events hosted" (past published events) alongside the
  existing upcoming and past lists.
- Signed-in members get a "From organisers you follow" section on the home
  page, and can choose an email when a followed organiser publishes a new
  event (opt-in at follow time, one-click unsubscribe, at most one a day per
  organiser).
- Organisers can feature one video by pasting a YouTube or Vimeo link. It
  shows as a thumbnail with a play button and loads the privacy-enhanced
  player only when clicked (no third-party cookies before, no autoplay). No
  self-hosted video, to keep hosting costs at zero. Reviewed with the rest of
  the profile; admins can remove it.

**Backend built (21 Oct 2026; migration `20261024000200_organiser_follows.sql`,
docs/architecture.md "Following organisers" and "Organiser profiles"):**
follow and unfollow (`/organisers/{id}/follow`), `/me/following` and
`/me/following/events`, `followerCount` (from 10) and `eventsHosted` on the
public profile, the exact count in analytics, new-event emails through the
outbox (first publish only, at most one a day per organiser, batched, 500 a
day platform-wide, unsubscribe link and `List-Unsubscribe`), and the featured
video (`featuredVideoUrl`, strictly parsed, provider and id stored; logged
edits; admin removal). An approved organiser's video edit isn't reviewed
(logged, like the rest of the profile). **UI built (21 Oct
2026):** Follow button with the email choice, the home rail, the organiser
page's click-to-load video and counts, `/following/unsubscribe`, the video
field in the profile form and the admin "remove video" action.
