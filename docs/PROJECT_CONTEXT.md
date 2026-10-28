# Sheltüh — Project Context

Standing context for anyone (human or agent) working in this repo. Loaded into
every Claude Code session via `CLAUDE.md`. Keep it current when facts change.

## What Sheltüh is

Curated creative events discovery + ticketing marketplace. Two-sided:
event organisers/venues on one side, attendees on the other. Melbourne-first
launch; national/international expansion planned. Founder: Kome (Australian
sole trader), handling legal/technical/product decisions personally.

**Naming:** "Sheltüh" in branding; "Sheltuh" anywhere umlauts aren't supported
(domains, legal, ASIC, code identifiers, package names).

**Watch item:** a US-based music label operates as "The Sheltuh" /
thesheltuh.com — adjacent space, flagged for trademark monitoring, unresolved.

## Stage and validation

Pre-launch MVP. 15 Melbourne creative interviews done:

- 93% discover events too late (Instagram Stories)
- 87% skipped events from not knowing anyone attending
- 80% said a "Who's Going" signal would change behaviour

## Business model

| Revenue stream       | Price                   | Timing     |
| -------------------- | ----------------------- | ---------- |
| Ticketing fees       | 6% + A$0.50 per paid ticket | From launch |
| Promoted listings    | $50–150 / week          | ~Month 3   |
| Brand partnerships   | $2K–20K / deal          | ~Month 6   |

Booking fee (decided October 2026, replacing September 2026's 4% + A$0.50):
**6% of the ticket price + A$0.50 per paid ticket**, in `lib/fees.ts` (used
by both the UI and the checkout API). The A$0.50 keeps cheap tickets
profitable, because Stripe's processing fee (roughly 1.7% + A$0.30 on
Australian cards) comes out of the platform's share. Free tickets carry no
fee, and paid tickets cost at least A$1.00. The change applies to new
checkouts only: existing orders keep the fee recorded on them (see
`docs/architecture.md`, "Changing the booking fee").

## Legal / registration status

- ABN: obtained
- ASIC business name "Sheltuh": submitted — "Registered" status not yet confirmed
- Copyright: automatic in Australia, no registration needed
- Trademark (IP Australia, Classes 41, 42, 35): not yet filed
- Structure: sole trader now → Pty Ltd later (timing TBD)
- To draft: Privacy Policy, Terms of Service, Organiser Agreement, contractor NDAs
- Compliance in scope: Privacy Act 1988 (Cth) / APPs, Australian Consumer Law,
  Spam Act 2003

Code implications: collect only the personal info we need, keep privacy/ToS
links reachable from any form that collects data, show all-inclusive prices
(ACL — the prototype already shows buyer-payable totals), and any marketing
email needs consent + unsubscribe (Spam Act).

## Infrastructure — live (outside this repo)

- Domains: `sheltuh.com.au`, `findyoursheltuh.com.au` (VentraIP)
- Landing page live at `sheltuh.com.au` on Cloudflare Workers
  (Worker: `sweet-cell-e998`). Its source is **not** in this repo.
- Waitlist form posts to Formspree — the `YOUR_FORM_ID` placeholder still
  needs replacing with the real form ID.
- Google Workspace Business Plus on the custom domain; aliases `support@`,
  `bookings@`, `business@sheltuh.com.au`
- Cloudflare DNS: MX, DKIM, SPF, Google site-verification TXT configured

### Hard-won learnings (don't rediscover)

- Attach a custom domain to a Worker via Workers & Pages → Worker → Domains →
  Add Domain. **Not** Workers Routes (causes 525 SSL errors).
- Delete conflicting A/CNAME records before Add Domain will succeed.
- MX records must be DNS-only (grey cloud) — proxied MX silently breaks mail.
- Exactly one `v=spf1` TXT record per domain — append new senders
  (e.g. a transactional email provider) to it, never add a second.
- WHOIS privacy is unavailable for .au/.com.au (registry rule).
- Holding .com.au gives priority right on bare .au — don't buy .au separately.
- Google Workspace admin tasks live at admin.google.com, not
  myaccount.google.com; paste direct URLs rather than navigating the sidebar.
- Workspace email-footer editor needs images from a public URL; the file
  picker doesn't embed.

## Production stack (built, not yet deployed)

| Concern     | Choice                  | Note |
| ----------- | ----------------------- | ---- |
| Frontend + API | Next.js 16 (App Router) | The API is this app's own route handlers (`app/api/`) |
| DB / Auth   | Supabase                | Postgres (Sydney region) + Supabase Auth |
| Payments    | **Stripe Connect** (Express) | Connect specifically, for marketplace split payouts |
| Maps        | Leaflet, Mapbox Streets tiles | Mapbox when `NEXT_PUBLIC_MAPBOX_TOKEN` is set, Esri tiles (free, no key) as the fallback; see `docs/maps.md` |
| Venue search | Google Places API (New) | Server-side only (our own proxy routes, server-only key `GOOGLE_MAPS_API_KEY`). Google's terms: we store only the place id and never use Google's coordinates; pins on our maps are the organiser's own. Expected ~A$0 at our volume (unverified); quotas and a budget alert in `docs/DEPLOYMENT.md` |
| Hosting     | Vercel                  | Pro plan needed once selling tickets (Hobby is non-commercial) |

A first backend was built on AWS (Cognito/DynamoDB/Lambda/CDK) but never
deployed. It was replaced with Supabase in Sept 2026: a simpler stack for a
solo founder, a relational fit for "Who's Going" and map queries, and no
data to migrate. AWS stays ruled out until well past traction.

Go-live steps: `docs/supabase-setup.md`. Design: `docs/architecture.md`.

## MVP feature scope

1. Curated event feed — built
2. Organiser approval (every organiser checked by a person) + **self-publish
   with exceptions** — built. Approved organisers publish straight away;
   admins are emailed and check after the fact (unpublish with a reason,
   a per-organiser "review their events" switch). Sent to the review queue
   instead: organisers under that switch, a republish after an admin removed
   or rejected the event, seated events, ticket links on unknown sites, and
   anything over the daily caps (10 per organiser, 100 platform-wide).
   Publishing needs a confirmed venue location (a Google Maps place or a
   dropped pin, with the organiser's pin checked; the editor's venue search
   and pin step are still being wired in).
3. Stripe Connect checkout with platform-fee logic — built
4. Organiser dashboard — built
5. Map view — built (exact venue pins for events with the organiser's
   confirmed location; older events sit at their suburb's centre). Event
   pages link to both Google Maps and Apple Maps
6. "Who's Going" social indicator — built (opt-in per ticket holder), with member messaging, blocking and reporting

## Outstanding action items

1. Replace Formspree `YOUR_FORM_ID` on the landing page
2. Confirm ASIC "Sheltuh" shows "Registered"
3. File trademark with IP Australia (Classes 41, 42, 35)
4. Draft Privacy Policy, ToS, Organiser Agreement, contractor NDAs
   (including the Google Maps lines Google's terms require: see
   `docs/DEPLOYMENT.md`, "Google Places")
5. Go live on the stack above: Supabase project, Stripe Connect (test →
   live), Vercel deploy, promote admins (see `docs/supabase-setup.md`)
6. Plan sole trader → Pty Ltd transition timing
7. Google and Apple sign-in (built, off until set up: `docs/supabase-setup.md`):
   - Decide which entity enrols in the Apple Developer Program (US$99/yr)
     **before** turning Apple on. Apple's user IDs and Hide My Email relay
     addresses are per developer team, so enrolling as the sole trader and
     moving to a Pty Ltd team later breaks sign-in matching for people who
     hid their email. Either enrol now and accept that, or wait for the Pty
     Ltd (launch with Google only meanwhile).
   - Once Apple is on: rotate its client secret about every 5 months
     (`npm run apple-client-secret`; Apple caps it at 6 months, and Apple
     sign-in fails for everyone when it lapses). Keep a recurring reminder.

## Working style

- Direct and implementation-oriented: lead with the usable artifact (code,
  docs, structured output); skip preamble.
- Cost-aware: weigh infra/tooling against a solo-founder budget before adding
  services. Prefer free tiers and fewer vendors.
- Validation-first: research/validate before building.
- Pragmatic about scope: defer features to shorten time-to-first-organiser.
- Legal structure: start lean, keep a clear upgrade path.
