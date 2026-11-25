# Sheltüh — Project Context

Standing context for anyone (human or agent) working in this repo. Loaded into
every Claude Code session via `CLAUDE.md`. Keep it current when facts change.

Business context, legal status, plans and roadmaps live in the owner's
private repo `komeosakwe/Sheltuh-private`; ask the owner for access.

## What Sheltüh is

A curated creative-events discovery and ticketing marketplace, Melbourne-first.

**Naming:** "Sheltüh" in branding; "Sheltuh" anywhere umlauts aren't supported
(domains, legal, code identifiers, package names).

## Booking fee

**6% of the ticket price + A$0.50 per paid ticket**, in `lib/fees.ts` (used
by both the UI and the checkout API). The A$0.50 keeps cheap tickets
profitable, because Stripe's processing fee (roughly 1.7% + A$0.30 on
Australian cards) comes out of the platform's share. Free tickets carry no
fee, and paid tickets cost at least A$1.00. A fee change applies to new
checkouts only: existing orders keep the fee recorded on them (see
`docs/architecture.md`, "Changing the booking fee").

## Organisers see buyers' names and emails

Each event's organiser gets an Orders tab with the name and email of the
people who bought tickets (an export too), for 12 months after the event
ends. Buyers are told at checkout; organisers may use the details only for
the event, and need consent for marketing email (Spam Act). Orders from
before the feature are never shared. No self-serve withdrawal yet: support
clears a buyer's details on request (`docs/supabase-setup.md`). See
`docs/architecture.md`, "Organiser orders".

## Production stack (built, not yet deployed)

| Concern     | Choice                  | Note |
| ----------- | ----------------------- | ---- |
| Frontend + API | Next.js 16 (App Router) | The API is this app's own route handlers (`app/api/`) |
| DB / Auth   | Supabase                | Postgres (Sydney region) + Supabase Auth |
| Payments    | **Stripe Connect** (Express) | Connect specifically, for marketplace split payouts |
| Maps        | Leaflet, Mapbox Streets tiles | Mapbox when `NEXT_PUBLIC_MAPBOX_TOKEN` is set, Esri tiles (free, no key) as the fallback; see `docs/maps.md` |
| Venue search | Google Places API (New) | Server-side only (our own proxy routes, server-only key `GOOGLE_MAPS_API_KEY`). Google's terms: we store only the place id and never use Google's coordinates; pins on our maps are the organiser's own. Quotas and a budget alert in `docs/DEPLOYMENT.md` |
| Hosting     | Vercel                  | Pro plan needed once selling tickets (Hobby is non-commercial) |

Go-live steps: `docs/supabase-setup.md`. Design: `docs/architecture.md`.

## Compliance in code

The product is in scope of the Privacy Act 1988 (Cth) / APPs, Australian
Consumer Law and the Spam Act 2003. In code that means:

- collect only the personal info we need;
- keep privacy/ToS links reachable from any form that collects data;
- show all-inclusive prices (ACL: buyer-payable totals);
- any marketing email needs consent + unsubscribe (Spam Act).

## Working style

- Direct and implementation-oriented: lead with the usable artifact (code,
  docs, structured output); skip preamble.
- Cost-aware: weigh infra/tooling against a small budget before adding
  services. Prefer free tiers and fewer vendors.
- Pragmatic about scope: defer features to shorten time-to-first-organiser.
