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
- Also on the branch since: external ticketing, admin event authoring,
  trending, the brand redesign, waitlist, member profiles and photos,
  organiser follows and featured video, and reserved seating (backend, UI,
  per-visitor seat-hold limits), each with code, security, accessibility
  and visual reviews and their fixes; then the Next.js 16.3.8 and sharp 0.35.5
  security upgrade (a2b46d9). Re-run the gates and check CI on the head
  commit before merging.
- **Seating has no on/off switch.** Until the owner chooses per-visitor
  protection on seat holds (Turnstile or a Vercel WAF rule), keep seating
  off for real on-sales by not approving seated events. The per-visitor
  hold limit needs `STRIPE_WEBHOOK_SECRET` set (it fails open without it).
- The owner ran migrations 20261001 to 20261004 in the Supabase SQL editor
  and saw "Success" for each; the first five were already present. Retention
  cron is scheduled (job id 1).
- **Not done, needs you:** legal sign-off, photo licences (see
  `public/events/README.md`), Supabase/Stripe/Vercel setup below.
- **Known gaps (deliberate):** no per-person "already talking" state on the
  Who's Going list; no browser test for the messaging journey; blocking or
  reporting straight from the Who's Going list; evidence vanishes when a
  member deletes their profile before being reported (product decision).

## Go-live checklist

The items added since the steps below were written (B1 to B4, check-in,
refunds, the brand redesign, waitlist, member profiles, follows, reserved
seating). Tick each one on the test setup first, then on
live. Details are in [`supabase-setup.md`](supabase-setup.md) and
[`architecture.md`](architecture.md).

- [ ] **Migrations, in order, up to the newest.** Run every file in
      `supabase/migrations/` in filename order that the project doesn't have
      yet, one SQL Editor query per file (or `npx supabase db push`), up to
      and including the newest, currently
      `20261104000200_checkout_attempts.sql`. Never skip one or change
      the order: later files rely on earlier ones (`20261023000100_review_hardening.sql`
      stops with a list of event ids if a stored ticket link breaks a newer
      rule; fix those and re-run it). Check with
      `select max(version) from supabase_migrations.schema_migrations;` when
      using the CLI. The files on this branch that aren't on `main` yet, in
      order:
      1. `20261022000000_external_ticketing.sql`
      2. `20261022000100_admin_event_authoring.sql`
      3. `20261022000200_external_ticketing_hardening.sql`
      4. `20261023000000_trending.sql`
      5. `20261023000100_review_hardening.sql`
      6. `20261023000200_trending_distinct.sql`
      7. `20261024000000_waitlist.sql`
      8. `20261024000100_member_profiles.sql`
      9. `20261024000200_organiser_follows.sql`
      10. `20261101000000_reserved_seating.sql`
      11. `20261101000100_seat_holds.sql`
      12. `20261102000000_seating_hardening.sql`
      13. `20261102000100_social_hardening.sql`
      14. `20261103000000_seat_hold_client_limits.sql`
      15. `20261104000000_payment_reconciliation.sql` (deploy the app with
          it: the previous version keeps working against it, but only this
          one sends ops alerts and records refunds that arrive before their
          payment)
      16. `20261104000100_email_outbox_health.sql` (schedules nothing:
          the admin health endpoint and the cron route's last-run record.
          Run it before deploying the app that uses it, which otherwise
          answers the cron route with a 500 after sending)
      17. `20261104000200_checkout_attempts.sql` (paid checkout
          idempotency and the general admission checkout limits. Run it
          before deploying the app that uses it: that app refuses every paid
          checkout (500) without it. The previous app keeps working against
          it. Retention rides on the existing daily
          `purge_operational_data` job: nothing new to schedule)
- [ ] **`CRON_SECRET`** in Vercel (Production): a long random string
      (`openssl rand -hex 32`). Without it `/api/cron/email-outbox` and
      `/api/cron/trending` refuse every call: failed ticket emails are never
      retried and Trending stays empty.
- [ ] **Cron schedules.** `vercel.json` runs both crons once a day, the
      Hobby plan's limit, and stays that way. **Upgrading to Vercel Pro does
      not change the schedule by itself**: the schedule only changes when
      `vercel.json` is edited and redeployed.
      - **On Hobby:** set up the 5-minute email retry runner in Supabase
        (Supabase Cron + `pg_net`, `CRON_SECRET` in Supabase Vault:
        `supabase-setup.md` §3, "The 5-minute runner on Hobby"). Without it,
        a ticket email whose first send failed waits up to about 24 hours
        for its retry. Keep the daily Vercel run as a backstop; two runs at
        once never send an email twice. Supabase Cron can also refresh
        Trending every 15 minutes
        (`select cron.schedule('refresh-trending', '*/15 * * * *', $$select private.refresh_trending()$$);`).
      - **On Pro:** change `vercel.json` to
        `{ "path": "/api/cron/email-outbox", "schedule": "*/5 * * * *" }` and
        `{ "path": "/api/cron/trending", "schedule": "*/15 * * * *" }` (full
        file in `supabase-setup.md` §3, "Switching to Vercel Pro"), commit,
        redeploy, confirm in Vercel → Settings → Cron Jobs, then
        `select cron.unschedule('email-outbox-retry');` (and
        `refresh-trending`) in Supabase and delete the two Vault secrets.
      - **Either way, check** `GET /api/admin/emails/health` as an admin:
        `lastCronRun.finishedAt` no more than about 10 minutes old and
        `totals.overdue` 0.
- [ ] **Stripe webhook `charge.refunded`** on the endpoint, in test **and**
      live mode (configured separately), alongside the checkout and refund
      events listed in `supabase-setup.md` §2. Without it a refund made in
      the Stripe dashboard leaves the order paid and its tickets valid at the
      door.
- [ ] **Stripe webhook `charge.refund.updated`** too (with `refund.updated`
      and `refund.failed`): how a dashboard refund that fails after its order
      was voided becomes a payment exception and an ops alert.
- [ ] **`OPS_ALERT_EMAIL`** (optional) in Vercel (Production): where ops
      alerts go (e.g. `support@sheltuh.com.au`). Without it, alerts are only
      logged; check `GET /api/admin/payment-exceptions` instead. Before go-live,
      in Stripe test mode, refund a payment made with card
      `4000 0000 0000 5126` (its refund fails after succeeding) and confirm an
      exception and an alert appear.
- [ ] **Email footer banner** hosted at exactly
      `https://sheltuh.com.au/images/email-footer.png` (the ticket email
      links this fixed URL, `EMAIL_FOOTER_IMAGE_URL` in
      `lib/server/ticket-email.ts`). The file is `public/images/email-footer.png`;
      while `sheltuh.com.au` is still the Cloudflare Worker landing page,
      upload it there too. Open the URL in a private window to check.
- [ ] **Privacy Policy wording** (owner to approve; drafts in
      `architecture.md`, "Trending" and "Check-in"):
  - Trending and favourites: saved events, Who's Going and ticket orders are
    counted together with other members' activity to rank a public
    "Trending" list; it never shows who did what or how many people saved an
    event; page views are counted without cookies or identifiers; the
    organiser's own activity is excluded; staff can boost or remove events.
  - Check-in: when a ticket is scanned at the door, the time (and the
    scanning account: the organiser, or a Sheltüh admin for platform-managed
    organisers' events) is recorded, shown with the ticket (its ticket page),
    and deleted 25 months after the event.
- [ ] **Bootzy font files.** The licensed display face isn't in the repo;
      headlines fall back to Instrument Sans. Add
      `app/fonts/bootzy/Bootzy-Regular.woff2` and its licence file, then
      follow the three steps in `app/fonts.ts` (`brand-direction-one.md`
      §3.4). Check the licence covers web embedding.

## What is ready in the code

- Branch `claude/wizardly-darwin-v2c9n2` holds everything since PR #6:
  redesign follow-ups, phone home, Who's Going, messaging, security
  hardening, and the features listed under Status. CI (types, lint, unit +
  API tests, Postgres 16 API tests, build, browser tests) must be green on the head commit before merging.
- Demo mode (no Supabase env) still works; live mode needs the env below.

## Before you merge

- [ ] Open a pull request from the branch into `main` and check CI is green.
- [ ] Open the Vercel **preview** for that PR and click through: home (phone
      and desktop), `/events`, an event page, search, `/account`, sign-up.
- [ ] Decide the open product questions listed at the bottom.

## Supabase (test project first)

1. [ ] Create the project in **Sydney (ap-southeast-2)**.
2. [ ] Run every file in `supabase/migrations/` **in filename order**, from
       `20260925000000_init.sql` up to the newest (see "Go-live checklist").
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
       service worker off (needs a fresh build; see `docs/pwa.md`);
       `OPS_ALERT_EMAIL` (ops alerts about payment exceptions; unset = logged
       only).
       **Never** add `SUPABASE_SECRET_KEY` (local script only).
2. [ ] Pro plan once you sell tickets (Hobby is non-commercial). The plan
       change alone doesn't touch the cron schedules: edit `vercel.json` and
       redeploy as in "Cron schedules" above.
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
