# Deployment checklist

One page to work through before and on launch day. The detailed steps live in
[`supabase-setup.md`](supabase-setup.md); this is the order to do them in and
what to check. Nothing here has run against real Supabase, Stripe or Vercel
yet: treat the first pass as **test mode**, and only then go live.

## Status (as of the last push to the branch)

- Built and reviewed: phone home redesign, photos, Who's Going, messaging
  (backend and screens), moderation queue, security hardening. Code, security
  and accessibility reviews were run and their findings fixed.
- Also built: an installable web app (PWA) with a bounded service worker and
  a kill switch (see `docs/pwa.md`). Merged to `main`: everything through
  PR #7 (it is live on `app.sheltuh.com.au`). The PWA is on the branch until
  its PR is merged.
- Local gates on the PWA commit: types, lint and 1045 unit and API tests
  pass, plus the build and 11 browser tests. CI (production build, server
  tests on Postgres 16, browser tests) was green on that exact commit;
  re-check the run for whatever commit you merge.
- The owner ran migrations 20261001 to 20261004 in the Supabase SQL editor
  and saw "Success" for each; the first five were already present. Retention
  cron is scheduled (job id 1).
- **Not done, needs you:** legal sign-off, photo licences (see
  `public/events/README.md`), Supabase/Stripe/Vercel setup below.
- **Known gaps (deliberate):** no per-person "already talking" state on the
  Who's Going list; no browser test for the messaging journey; blocking or
  reporting straight from the Who's Going list; evidence vanishes when a
  member deletes their profile before being reported (product decision).

## What is ready in the code

- Branch `claude/wizardly-darwin-v2c9n2` holds everything since PR #6:
  redesign follow-ups, phone home, Who's Going, messaging (backend), security
  hardening. CI (types, lint, unit + API tests, Postgres 16 API tests, build,
  browser tests) must be green on the head commit before merging.
- Demo mode (no Supabase env) still works; live mode needs the env below.

## Before you merge

- [ ] Open a pull request from the branch into `main` and check CI is green.
- [ ] Open the Vercel **preview** for that PR and click through: home (phone
      and desktop), `/events`, an event page, search, `/account`, sign-up.
- [ ] Decide the open product questions listed at the bottom.

## Supabase (test project first)

1. [ ] Create the project in **Sydney (ap-southeast-2)**.
2. [ ] Run every file in `supabase/migrations/` **in filename order** (nine
       files, `20260925000000_init.sql` to `20261004000000_messaging_hardening.sql`).
3. [ ] Auth settings: "Confirm email" **on** (Who's Going and messaging trust
       `email_confirmed_at`, so this is a security setting, not a nicety);
       OTP-style email templates; password policy; Site URL set to the real
       domain; custom SMTP (built-in email is test-only). If you enable
       "Secure email change", keep it on.
4. [ ] Schedule the daily cleanup in **Supabase Cron**:
       `select private.purge_social_data();` (deletes attendance 30 days after
       an event, old messages and reports per the retention rules). Steps are
       in `supabase-setup.md`. It does nothing until scheduled.
5. [ ] Promote yourself to admin: `npm run promote-admin -- you@sheltuh.com.au`.

## Stripe

1. [ ] **Test mode:** enable Accounts v1 support (the "Something went wrong"
       at checkout came from this being off), create the webhook endpoint
       `https://YOUR-DOMAIN/api/stripe/webhook`, copy the signing secret.
2. [ ] Run a full test purchase: paid ticket, free ticket, refund.
3. [ ] Only then repeat with **live** keys.

## Vercel

1. [ ] Environment variables (Production and Preview), from `.env.example`:
       `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`,
       `NEXT_PUBLIC_SITE_URL`, `DATABASE_URL` (transaction pooler, port 6543),
       `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `SMTP_*`, `EMAIL_FROM`.
       Optional: `NEXT_PUBLIC_DISABLE_SERVICE_WORKER=1` turns the offline
       service worker off (needs a fresh build; see `docs/pwa.md`).
       **Never** add `SUPABASE_SECRET_KEY` (local script only).
2. [ ] Pro plan once you sell tickets (Hobby is non-commercial).
3. [ ] Domain: attach `sheltuh.com.au` (see PROJECT_CONTEXT for the Cloudflare
       notes). The landing page currently lives on a Cloudflare Worker; decide
       when the app replaces it.

## Smoke test on the deployed site (test mode)

- [ ] Sign up, verify email code, sign in, `/account`.
- [ ] Buy a ticket with your account email, then add yourself to Who's Going
      on that event (opt-in form, 18+ box). Withdraw.
- [ ] With a second account that also went, start a message request, reply,
      block, report; check `/admin/reports` as admin.
- [ ] Organiser flow: apply, approve as admin, submit an event with a photo,
      approve, see it on the home page.
- [ ] Check the phone layout on a real phone.

## Needs your decision or sign-off before launch

- **Legal:** consent wording, the privacy policy sections for Who's Going and
  messaging (still marked draft), Terms, Organiser Agreement. Check whether
  messaging brings Sheltüh under the under-16 social media minimum-age rules
  and the upcoming Children's Online Privacy Code.
- **Evidence gap:** if a member deletes their profile before being reported,
  the other person loses the conversation and cannot report it (documented
  as an accepted risk in `architecture.md`). Choose whether to keep deleted
  members' conversations reportable for a short window.
- **Real Postgres:** CI runs the server tests on Postgres 16; they have not run
  against Supabase itself.
- **Real photos:** no real event photos yet; posters stand in (`public/home/`,
  `public/events/README.md` say how to add them).
- Trademark, ASIC confirmation, and the Formspree form ID on the landing page.
