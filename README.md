# Sheltüh

A Melbourne-first curated creative events discovery and ticketing
marketplace.

- **Stack:**
  - Next.js 16 (App Router) + TypeScript + Tailwind CSS v4, hosted on
    Vercel.
  - Supabase: Postgres for data, Auth for accounts.
  - Stripe Connect Express for payments and organiser payouts.
  - Leaflet with Esri tiles for the map.
- **Status:** feature-complete for the MVP flows below and tested against
  real Postgres, but **not deployed yet**. See
  [`docs/supabase-setup.md`](docs/supabase-setup.md) for the go-live steps.
- **More:**
  - [`docs/architecture.md`](docs/architecture.md): data model, API and
    payment flow.
  - [`docs/PROJECT_CONTEXT.md`](docs/PROJECT_CONTEXT.md): business, legal
    and roadmap context.

## What's built

**Public, no account needed:**
- `/`: curated event feed with category, date and free/paid filters.
- `/map`: Scene Map.
- `/events/[slug]`: event details and guest checkout. Free tickets are
  issued instantly; paid tickets go through Stripe Checkout.
- `/checkout/success`: order confirmation with ticket codes.

**Accounts:** `/signup`, `/verify`, `/login`, `/forgot-password`.

**Organisers** (need an admin-approved application):
- `/organisers/apply`: apply, see your status, and edit and resubmit if
  rejected.
- `/dashboard`: event drafts, ticket types with a live fee preview, and
  submitting for review.
- `/dashboard/payouts`: Stripe Connect onboarding.

**Admins:** `/admin/organisers` and `/admin/events` are review queues
(approve, reject with a reason, unpublish).

## Run it locally

**Demo mode** (no setup, sample data only):

```bash
npm install
npm run dev
```

**Live mode:** copy `.env.example` to `.env.local` and fill it in from your
Supabase project and Stripe test account (see `docs/supabase-setup.md`).
With the Supabase variables set, the app uses the real API; without them,
it falls back to demo mode.

## Commands

```bash
npm run dev            # dev server
npm run build          # typecheck + production build
npm run lint           # eslint
npm test               # unit + API tests (API tests run against in-process Postgres)
npm run test:e2e       # Playwright browser tests
npm run promote-admin -- you@example.com   # grant admin (needs SUPABASE_SECRET_KEY)
npm run seed-dev-data  # load sample events into a dev database
```

`TEST_DATABASE_URL=postgres://user@host:port/db npm test` runs the API tests
against a real Postgres server through the production driver instead of
PGlite. Each test file creates its own throwaway database.

## Layout

```
app/                 pages, plus app/api/** route handlers
components/          UI
lib/api/             browser client for the API
lib/auth/            Supabase Auth in the browser
lib/server/          API logic: handlers, validation, SQL, wiring
supabase/migrations/ database schema — apply in filename order
scripts/             admin promotion, dev seed data
tests/, e2e/         vitest (incl. tests/server API tests), Playwright
```

## Not built yet

- Automatic refunds for the rare oversold order (they're flagged for a
  manual refund).
- Ticket emails and QR check-in.
- Event images.
- Venue coordinates.
- "Who's Going".
- Final booking fee: 5% + A$0.50 is modelled, against a 3–5% target.
