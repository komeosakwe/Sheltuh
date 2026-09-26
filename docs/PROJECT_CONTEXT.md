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
| Ticketing fees       | 3–5% per transaction    | From launch |
| Promoted listings    | $50–150 / week          | ~Month 3   |
| Brand partnerships   | $2K–20K / deal          | ~Month 6   |

Booking fee (decided Sept 2026): **4% of the ticket price + A$0.50 per paid
ticket**, in `lib/fees.ts` (used by both the UI and the checkout API). The
A$0.50 keeps cheap tickets profitable, because Stripe's processing fee
(roughly 1.7% + A$0.30 on Australian cards) comes out of the platform's
share. Free tickets carry no fee, and paid tickets cost at least A$1.00.

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
| Maps        | Leaflet + Esri tiles    | Already built and free; Mapbox only if custom styling is needed |
| Hosting     | Vercel                  | Pro plan needed once selling tickets (Hobby is non-commercial) |

A first backend was built on AWS (Cognito/DynamoDB/Lambda/CDK) but never
deployed. It was replaced with Supabase in Sept 2026: a simpler stack for a
solo founder, a relational fit for "Who's Going" and map queries, and no
data to migrate. AWS stays ruled out until well past traction.

Go-live steps: `docs/supabase-setup.md`. Design: `docs/architecture.md`.

## MVP feature scope

1. Curated event feed — built
2. Organiser submission + **manual curation / review queue** — built
3. Stripe Connect checkout with platform-fee logic — built
4. Organiser dashboard — built
5. Map view — built (venue coordinates still to add)
6. "Who's Going" social indicator — not started

## Outstanding action items

1. Replace Formspree `YOUR_FORM_ID` on the landing page
2. Confirm ASIC "Sheltuh" shows "Registered"
3. File trademark with IP Australia (Classes 41, 42, 35)
4. Draft Privacy Policy, ToS, Organiser Agreement, contractor NDAs
5. Go live on the stack above: Supabase project, Stripe Connect (test →
   live), Vercel deploy, promote admins (see `docs/supabase-setup.md`)
6. Plan sole trader → Pty Ltd transition timing

## Working style

- Direct and implementation-oriented: lead with the usable artifact (code,
  docs, structured output); skip preamble.
- Cost-aware: weigh infra/tooling against a solo-founder budget before adding
  services. Prefer free tiers and fewer vendors.
- Validation-first: research/validate before building.
- Pragmatic about scope: defer features to shorten time-to-first-organiser.
- Legal structure: start lean, keep a clear upgrade path.
