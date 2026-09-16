# Sheltüh — local prototype

A Melbourne-first curated creative events discovery and ticketing marketplace.
This is the **first local prototype**: three screens backed by typed sample
data, no backend, no payments, no AWS.

## Stack

- Next.js 16 (App Router) + TypeScript, Tailwind CSS v4
- Vitest for unit tests
- Sample data lives behind a small data-access layer (`lib/data.ts`) so it can
  later be swapped for real API calls without touching the screens.

## Run it locally

```bash
npm install
npm run dev
```

Open http://localhost:3000.

Other commands:

```bash
npm run lint    # eslint
npm run build   # typecheck + production build
npm run start   # serve the production build
npm run test    # fee calculation unit tests (vitest)
```

## Screens

- `/` — event discovery: filterable grid of sample events (category, date,
  free/paid), links to event details and organiser submission.
- `/events/[slug]` — event details: ticket types, quantity selection, and a
  booking fee preview (5% of face value + A$0.50 per paid ticket; free
  tickets never carry a fee). Checkout is explicitly disabled — no payment
  information is collected.
- `/organisers/submit` — organiser submission form with client-side
  validation. Submissions are validated only; nothing is sent or saved.

## What's mocked / not built yet

- All event and ticket data is static, typed sample data in
  `lib/sample-events.ts` — no database, no CMS.
- No accounts, authentication, guest checkout, real payments, inventory
  reservation, ticket issuance/QR check-in, or "Who's Going".
- No AWS integration and no Stripe integration — those are later milestones.
- Organiser submissions are validated in the browser only; there is no
  backend to receive them, and no approval workflow has been decided.

## Decisions needed before the next milestone

- Organiser submission approval policy (auto-publish, manual review, etc.) —
  intentionally left undecided per current scope.
- Real image/media handling for event listings (currently CSS gradient
  placeholders).
- Confirm booking fee structure (5% + A$0.50) before wiring up real payments.
