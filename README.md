# Sheltüh

A Melbourne-first curated creative events discovery and ticketing marketplace.

This repo now spans two milestones:

1. **Local prototype** — three screens (discovery, event details, organiser
   submission) backed by typed sample data. Still fully functional with zero
   configuration — see "Run it locally" below.
2. **Accounts, organiser applications, event submissions, admin approval** —
   a real AWS backend (Cognito + DynamoDB + Lambda + API Gateway) defined as
   CDK infrastructure in `infra/`, plus the frontend screens that use it.
   **Not deployed** — see `docs/aws-setup.md` for exactly what that takes.

Payments and ticket issuance are out of scope for both milestones.

## Project boundaries

This repo has **three independent TypeScript projects**, each with its own
`package.json`, `tsconfig.json` and dependencies — installing one's
dependencies is never required to build or typecheck another:

| Project | Root tsconfig | Install | Typecheck |
|---|---|---|---|
| Frontend (this Next.js app) | `tsconfig.json` (excludes `infra/`, `scripts/`) | `npm install` | `npm run build` |
| Infrastructure | `infra/tsconfig.json` | `cd infra && npm install` | `cd infra && npx tsc --noEmit` |
| Operational scripts | `scripts/tsconfig.json` | `cd scripts && npm install` | `cd scripts && npm run typecheck` |

A fresh `npm install` at the repo root only installs the frontend's
dependencies — it does not need to know `infra/` or `scripts/` exist. Any
CI job for this repo should run all three checks separately, each after its
own `npm install`, rather than one install+typecheck at the root.

## Stack

- Next.js 16 (App Router) + TypeScript, Tailwind CSS v4
- Vitest for unit tests (frontend and `infra/` both)
- AWS CDK (TypeScript) for infrastructure — Cognito, DynamoDB, Lambda,
  API Gateway HTTP API — in `infra/`
- `amazon-cognito-identity-js` for the frontend auth flows

## Run it locally (demo mode — no AWS, no setup)

```bash
npm install
npm run dev
```

Open http://localhost:3000. With no `NEXT_PUBLIC_*` env vars set, the app
runs entirely on local sample data: the public feed, event details and the
`/organisers/submit` demo form all work exactly as in the original
prototype, clearly labelled "Demo — sample events".

Other commands:

```bash
npm run lint    # eslint
npm run build   # typecheck + production build
npm run start   # serve the production build
npm run test    # unit tests (vitest)
```

## Run it against a real backend (live mode)

Requires the AWS stack in `infra/` to actually be deployed first — it isn't,
in this environment. Once it is (see `docs/aws-setup.md`), set:

```bash
NEXT_PUBLIC_API_URL=...
NEXT_PUBLIC_COGNITO_USER_POOL_ID=...
NEXT_PUBLIC_COGNITO_CLIENT_ID=...
```

and the app switches to the real API for sign-up/sign-in, organiser
applications, event drafts/submissions, admin review, and the public feed —
no code changes needed either way.

## Screens

**Public, no account needed:**
- `/` — event discovery, filterable (category, date, free/paid)
- `/events/[slug]` — event details, ticket quantity selection, a booking fee
  preview (5% of face value + A$0.50 per paid ticket; free tickets never
  carry a fee). Checkout is explicitly disabled — no payment info collected.
- `/organisers/submit` — the original demo-only submission form (validates
  locally, nothing sent/saved); kept for reference alongside the real flow.

**Accounts:**
- `/signup`, `/verify`, `/login`, `/forgot-password`

**Organisers (need a signed-in, admin-approved account):**
- `/organisers/apply` — apply, view status, edit-and-resubmit if rejected
- `/dashboard`, `/dashboard/new`, `/dashboard/[eventId]` — create/edit event
  drafts, ticket types with a live fee preview, submit for review

**Admins (need the `admins` Cognito group — see `docs/aws-setup.md`):**
- `/admin/organisers`, `/admin/events` — review queues: approve, reject with
  a reason, unpublish

## Infrastructure (`infra/`)

CDK app targeting `ap-southeast-2` (Sydney), dev-only, not deployed.

```bash
cd infra
npm install
npx tsc --noEmit   # typecheck (this project's own boundary — see "Project boundaries" above)
npm test           # unit tests over the pure backend logic
npx cdk synth       # validate the stack locally, no AWS credentials needed
```

See `docs/architecture.md` for the data model and API surface, and
`docs/aws-setup.md` before ever running `cdk deploy`.

## Operational scripts (`scripts/`)

```bash
cd scripts
npm install
npm run typecheck   # this project's own boundary — see "Project boundaries" above
```

- `promote-admin.ts` — the *only* way an account joins the `admins` Cognito
  group; takes a real email as a required argument, never hardcodes one.
- `seed-dev-data.ts` — publishes the same fictional sample events into a
  deployed dev backend, for demoing the live feed without waiting on a real
  organiser review cycle.

## What's mocked / not built yet

- No real payments, ticket issuance/QR check-in, inventory reservation, or
  "Who's Going" — all explicitly out of scope for this milestone.
- No image uploads yet — both demo and live events use local CSS/SVG poster
  art (live events get one deterministically assigned by slug).
- The AWS backend is fully coded and locally verified (typecheck, `cdk
  synth`, unit tests) but has never been deployed or exercised against real
  AWS — see `docs/aws-setup.md` for exactly what remains and why.

## Decisions needed / made along the way

- Kome and Dhruv's real emails are required to actually grant them admin
  access (`scripts/promote-admin.ts`) — intentionally not invented here.
  See `docs/aws-setup.md`.
- Real image/media handling for event listings is still a later milestone.
- Confirm the 5% + A$0.50 booking-fee structure before wiring up real
  payments.
