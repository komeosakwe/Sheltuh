# Roadmap

What is built, what is in progress, and what is planned. Update this when the
facts change. Details of each shipped piece live in `docs/architecture.md`.

## Shipped (live on app.sheltuh.com.au)

- Curated event feed, search, map, event pages, organiser submission and
  review queue, Stripe Connect checkout, organiser dashboard.
- Phone home redesign, installable web app (PWA), Sheltüh icon, real photos.
- Who's Going (opt-in per ticket holder), messaging with requests, blocking,
  reporting, and an admin report queue.

## In progress

1. **Favouriting events** (heart, Saved page). Backend and frontend.
2. **Organiser analytics, stages A and B.** Free for organisers at launch.
   - A: ticket sales, gross and net revenue, sales by ticket type, historical
     comparisons, CSV export.
   - B: event page views, conversion, traffic sources, tracking links with
     attributed views and sales.
   - Privacy rules: no cookies, no IP addresses, no visitor identifiers; daily
     aggregate counters only; organisers see only their own events.
3. **Event pictures on the map** (photo markers, photo-led card, clustering).
   Gap: many live events have no coordinates (the organiser form does not
   collect any).
4. **Local load test** (`loadtest/`, `docs/loadtest.md`): finds where the app
   slows down and at what number of simultaneous users. Local only; a
   staging run needs a separate Supabase project and Vercel deployment and
   the owner's explicit authorisation.

## Planned

- **Analytics stage C:** door check-ins and attendance (needs a ticket
  scanner, which pairs with the phone app), attendee registrations with
  geography (privacy review first; at most suburb or postcode), unique
  visitors.
- **Seating plans.** Start decision: sections with capacities, or full
  seat-by-seat maps. Needs seat holds while paying and no double-selling.
- **Social profiles:** profile photo, a limited number of posts, a moodboard,
  Instagram and contact links, with moderation. Needs photo upload,
  moderation tooling and a safety and privacy review. Decide whether to
  launch it before messaging has run for a while.
- **Phone app:** Capacitor wrapper (push notifications, saved tickets, organiser
  scanner) after the PWA has been tried on real devices.
- Mobile pages not yet redone: search results rows, map page on phones,
  content pages.
- Messaging follow-ups: "already talking" state and block or report straight
  from the Who's Going list; a browser test for the messaging journey.

## Needs the owner

Legal sign-off on the consent and privacy wording, photo licences, live-mode
Stripe, the Who's Going and messaging evidence-retention decision, and real
device testing of the PWA. See `docs/DEPLOYMENT.md`.
