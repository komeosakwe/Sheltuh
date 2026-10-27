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
- **Owner's report, not verified here:** the owner ran migrations 20261001
  to 20261004 in the Supabase SQL editor and saw "Success" for each, the
  first five were already present, and a retention cron is scheduled (job
  id 1). Nothing in this repo proves which migrations production has: check
  before deploying (the "Migrations" item in the Go-live checklist).
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

- [ ] **Migrations, in order, up to the newest.**
      **First check what the project has**; don't assume (see Status).
      - If migrations were applied with the Supabase CLI
        (`npx supabase db push`), it recorded them:
        `select version from supabase_migrations.schema_migrations order by version;`
        Compare that list with the files in `supabase/migrations/`.
      - If any were run in the SQL editor (which records nothing, and is how
        the owner reports running them), that table is missing or incomplete.
        Run [`scripts/check-applied-migrations.sql`](../scripts/check-applied-migrations.sql)
        in the SQL editor instead. It's read-only and returns one row per
        migration file with `applied` true or false, judged by an object that
        file creates (`tests/server/applied-migrations-check.test.ts` checks
        each row turns true with its file and not before). The rows should be
        true up to some file and false after it; anything else (a false
        between trues) means a file was skipped, so stop and investigate.

      Then run every file that's missing, in filename order, one SQL Editor
      query per file (or `npx supabase db push`), up to and including the
      newest, currently `20261111000100_event_venue_location.sql`. Never
      skip one or change the order: later files rely on earlier ones
      (`20261023000100_review_hardening.sql` stops with a list of event ids
      if a stored ticket link breaks a newer rule; fix those and re-run it).
      Re-run the check afterwards. The files on this branch that aren't on
      `main` (`git diff --name-only --diff-filter=A origin/main HEAD -- supabase/migrations`;
      PR #12 added none), in order:
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
      15. `20261103000100_refuse_ended_event_orders.sql`
      16. `20261105000000_organiser_logos.sql`
      17. `20261106000000_event_clips.sql`
      18. `20261106000100_event_clip_dimensions.sql`
      19. `20261106000200_event_clip_hardening.sql`
      20. `20261107000000_admin_review_emails.sql`
      21. `20261108000000_account_invites.sql`
      22. `20261109000000_paid_events_need_payouts.sql`
      23. `20261109000100_event_refund_policy.sql` (existing events become
          "No refunds for change of mind"; apply before the app that reads it)
      24. `20261109000200_payment_reconciliation.sql` (**apply it before
          this app deploys**: the app's Stripe webhook calls
          `private.fulfil_order_detailed`, `private.record_refund_status` and
          the 6-argument `private.record_payment_refund`, which this file
          creates, so without it every payment and refund event is a 500 and
          Stripe keeps retrying. The previous app version keeps working
          against it. It needs `20261107000000_admin_review_emails.sql` and
          `20261108000000_account_invites.sql` first: it extends their outbox
          kinds, `private.lease_outbox_jobs` and `purge_operational_data`)
      25. `20261109000300_email_outbox_health.sql` (schedules nothing:
          the admin health endpoint and the cron route's last-run record.
          Run it before deploying the app that uses it, which otherwise
          answers the cron route with a 500 after sending)
      26. `20261109000400_checkout_attempts.sql` (paid checkout
          idempotency and the general admission checkout limits. Run it
          before deploying the app that uses it: that app refuses every paid
          checkout (500) without it. The previous app keeps working against
          it. Retention rides on the existing daily
          `purge_operational_data` job: nothing new to schedule)
      27. `20261109000500_ticket_wallet_serial.sql` (every ticket gets a
          random wallet pass serial; rewrites `public.tickets` once. Apply
          before the app with wallet passes deploys: its wallet routes read
          the column, and answer 500 without it)
      28. `20261110000000_event_place_time_zone.sql` (every event gets a
          state and a time zone: existing events become VIC,
          Australia/Melbourne, which is what they meant; redefines
          `private.create_event_draft`, `edit_event_draft` and
          `admin_edit_event`. **Apply it before this app deploys**: every
          event read (`EVENT_SELECT`) selects the new columns, so without it
          every event page, list and order lookup is a 500. The previous app
          keeps working against it)
      29. `20261110000100_order_support.sql` (Support Sheltüh: the
          `orders.support_cents` column, its checks, and `private.hold_seats`
          taking the amount). **Apply it first, before the app with Support
          Sheltüh deploys.** That app reads `support_cents` everywhere an
          order is read, so shipping it without this file breaks: Stripe
          fulfilment (the webhook's `findOrder` selects `support_cents`, so
          every paid order stays pending and Stripe keeps retrying), the
          ticket emails, the ticket and payment pages, wallet passes,
          analytics, and every paid checkout, general admission and seated
          (all 500s). The previous app keeps working against it: its
          18-argument `hold_seats` call takes the new form's default, and
          its general admission insert the column's.
      30. `20261110000150_support_in_exceptions.sql` (payment exceptions
          carry the order's `supportCents`, and the new `amount_mismatch`
          kind: a paid session whose amount or currency isn't the order's.
          Needs file 29 (it reads `support_cents`). Apply it before the app
          that opens `amount_mismatch` exceptions deploys: without it that
          app's webhook fails (500, Stripe retries) on a mismatched payment,
          since `raise_payment_exception` refuses the unknown kind; matching
          payments are fulfilled as ever. The previous app keeps working against it)
      31. `20261110000200_support_ticket_refund.sql` (`charge.refunded`:
          an order with Support Sheltüh refunded by at least `total_cents −
          support_cents`, the runbook's "tickets only" recipe, is voided as a
          full refund, its tickets void and its stock released, the support
          kept. Redefines `private.record_payment_refund` only; needs file 29.
          Apply it before the app that documents the new runbook deploys; the
          previous app keeps working against it, and without it a
          tickets-only refund leaves the tickets valid, as before)
      32. `20261110000300_amount_mismatch_refund.sql` (creates
          `private.fail_mismatched_order`: a paid session whose amount or
          currency isn't the order's fails the order and the app refunds it.
          Needs files 29 and 30. **Apply it before this app deploys**: this
          app's webhook calls the function on a mismatched payment, and
          without it that call fails (500, Stripe retries, the order stays
          pending); matching payments are fulfilled as ever. The previous app
          keeps working against it: it never calls the function)
      33. `20261111000000_event_publish_now.sql` (approved organisers
          publish their events straight away: `private.publish_event`, the
          per-organiser review switch `organisers.event_review_required` and
          `private.set_event_review_required`, the admins' `event_published`
          outbox kind, and `queue_review_email` and `lease_outbox_jobs`
          redefined. Needs files 20, 22, 24 and 26 first: it redefines the
          outbox kind checks from 24 and 26 and the functions from 20 and
          24. **Apply it before this app deploys**: every organiser read
          (`ORGANISER_SELECT`, so `GET /api/organisers/me` and every
          organiser route) selects `event_review_required`, and the publish
          route calls `private.publish_event`, so without it those are 500s.
          The previous app keeps working against it: its `/submit` route is
          unchanged, and its cron (which leases every kind it's not asked
          for by name) never takes an `event_published` job, which waits for
          this app's drain)
      34. `20261111000100_event_venue_location.sql` (the venue's location:
          `events.location_source`, `venue_place_id` (a Google place id, the
          only Google Places data stored) and `venue_lat` / `venue_lng` (the
          organiser's own pin, never Google's coordinates), with their checks;
          `create_event_draft`, `edit_event_draft` and `admin_edit_event`
          redefined to save it, and `publish_event` and `submit_event` to
          refuse an event without the organiser's pin (`location_required`).
          Needs files 22, 28 and 33 first: it redefines their functions.
          **Apply it before this app deploys**: every event read selects the
          new columns, so without it every event route is a 500. The previous
          app keeps working against it, except that its `/submit` route
          answers 200 without submitting an event that has no pin (it doesn't
          know the new refusal; the event stays a draft). Set
          `GOOGLE_MAPS_API_KEY` for the venue search (`.env.example`); without
          it organisers drop a pin instead)

      **Before merging the Australia-wide events branch, check the Supabase
      project knows every event time zone.** The public list's `onOrAfter`
      filter (`lib/server/handlers/public-events.ts`) reads each event's
      start `at time zone` its own zone in SQL, and a zone Postgres doesn't
      know makes that query fail. Run this in the SQL editor (read-only); it must return `13`:

      ```sql
      select count(*) from pg_timezone_names where name = any('{Australia/Melbourne,Australia/Sydney,Australia/Broken_Hill,Australia/Lord_Howe,Australia/Brisbane,Australia/Adelaide,Australia/Perth,Australia/Eucla,Australia/Hobart,Australia/Darwin,Indian/Christmas,Indian/Cocos,Pacific/Norfolk}');
      ```

      Anything less means a zone is missing: stop and report which
      (`select name from pg_timezone_names where name like any('{Australia/%,Indian/%,Pacific/Norfolk}') order by name`).
      The list is `ZONES_BY_STATE` in `lib/time-zones.ts`;
      `tests/server/event-place.test.ts` checks it matches, and runs every
      zone through `at time zone` on PGlite and Postgres 16.

      Files 24 to 26 were written as `20261104000000_payment_reconciliation.sql`,
      `20261104000100_email_outbox_health.sql` and
      `20261104000200_checkout_attempts.sql` on the payments audit branch and
      renamed when it was merged, so they sort after everything production
      may already have. No project has run them under either name yet. If one
      ever ran the old names, it ran them *before* files 20 and 21, which then
      replaced what 24 and 26 had defined: the outbox's kind checks (no
      `ops_alert` any more; file 20 also fails outright if an `ops_alert` job
      exists, so delete those first), `private.lease_outbox_jobs` (which
      file 20 creates without the ops-alert rule) and
      `purge_operational_data` (which file 21 recreates without the payment
      and checkout counts). Don't run 24 to 26 again whole (their
      `create table`s fail): re-run, in this order, 24's `alter table
      private.email_outbox` constraint clauses (not its `add column`), its
      `private.lease_outbox_jobs` and its grants, then 26's `email_outbox_kind_key`
      clauses and its `purge_operational_data` (drop and create) and grants.
      `scripts/check-applied-migrations.sql` checks that substance (the kind
      check allows `ops_alert`, `lease_outbox_jobs` holds alerts back, and
      `purge_operational_data` returns `checkout_attempts_deleted`), so files
      24 and 26 show `false` on such a project until that's done.

      **Apply `20261109000000_paid_events_need_payouts.sql` before the code
      that submits events deploys.** The organiser's submit calls
      `private.submit_event`, which this file creates; without it every
      submit (free events included) fails with a 500.

      **Apply `20261107000000_admin_review_emails.sql` before the code that
      sends admin review emails deploys.** That code leases outbox jobs with
      `private.lease_outbox_jobs`, which this file creates. If the code goes
      out first it falls back to the previous claimer, so ticket, waitlist
      and follower emails keep sending and only review emails wait (the
      server logs "private.lease_outbox_jobs is missing" once). Then apply
      the file and call `/api/cron/email-outbox` once (with the
      `CRON_SECRET` bearer) to send whatever waited.

      The 21 files before these are on `main`. Whether production has them
      all is also unverified: the check above covers every file.
- [ ] **`CRON_SECRET`** in Vercel (Production): a long random string
      (`openssl rand -hex 32`). Without it `/api/cron/email-outbox` and
      `/api/cron/trending` refuse every call: failed ticket emails are never
      retried and Trending stays empty.
- [ ] **Cron schedules.** See [`schedules.md`](schedules.md) for every
      timed job (Vercel and Supabase), its time in Melbourne, and how to run
      it more often. `vercel.json` runs both crons once a day (17:00 and
      17:20 UTC: 4:00 and 4:20 am AEDT, 3:00 and 3:20 am AEST), the Hobby
      plan's limit. Moving to **Vercel Pro** changes nothing by itself: edit
      `vercel.json` (`*/5 * * * *` for `/api/cron/email-outbox`,
      `*/15 * * * *` for `/api/cron/trending`) and redeploy. On Hobby,
      Supabase Cron can run the trending refresh directly or call the outbox
      route through `pg_net` (`schedules.md`, option 2).
      - **On Hobby:** set up the 5-minute email retry runner in Supabase
        (Supabase Cron + `pg_net`, `CRON_SECRET` and the route's URL in
        Supabase Vault: `supabase-setup.md` §3, "The 5-minute runner on
        Hobby", which replaces the shorter sketch in `schedules.md`). Without
        it, a ticket email whose first send failed waits up to about 24 hours
        for its retry. Keep the daily Vercel run as a backstop; two runs at
        once never send an email twice.
      - **On Pro:** edit `vercel.json` as above (full file in
        `supabase-setup.md` §3, "Switching to Vercel Pro"), commit, redeploy,
        confirm in Vercel → Settings → Cron Jobs, then
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
- [ ] **Support Sheltüh refunds** (docs/supabase-setup.md, "Refunding a paid
      order"): before go-live, in Stripe test mode, buy a ticket with A$5
      support and try each recipe: a full refund with both "reverse
      transfer" and "refund application fee" ticked; the support alone with
      neither ticked; and the tickets only (refund `total_cents −
      support_cents` with neither ticked, then reverse the transfer by the
      organiser's net, `total_cents − application_fee_cents −
      support_cents`). Confirm that the transfer object shows the order's
      `total_cents` and the application fee object `application_fee_cents +
      support_cents` (Stripe transfers the whole charge and collects the fee
      back), that the organiser's and Sheltüh's balances end where the
      runbook says (Sheltüh up by `support_cents`), that the support-only
      refund leaves the order `paid` with its `partial_refund` exception and
      alert showing `supportCents`, and that the tickets-only refund makes
      the order `refunded` (no ticket codes on its page, stock back on
      sale). Also note what the organiser's Express dashboard shows
      for the fee (docs/architecture.md, "Support Sheltüh": a known limit
      until separate charges and transfers).
- [ ] **`NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`** (embedded checkout: the
      payment form is on our own page, `/checkout/pay`). In Vercel set it
      per environment, matching that environment's `STRIPE_SECRET_KEY`:
      **Production** the live key (`pk_live_…`), **Preview** the test key
      (`pk_test_…`). Then **redeploy**: it's baked in at build time. If it's
      missing or its mode differs from the secret key's, every paid checkout
      is a 503 ("Card payments aren't available right now.") and nothing is
      written; free tickets still work. A value that isn't `pk_test_…` or
      `pk_live_…` at all (a secret `sk_…` key pasted in the wrong box, say)
      fails the build (`next.config.ts`), naming the variable but not the
      value, so it never reaches the browser bundle. Before going live, run the "Owner
      sandbox checklist (embedded checkout)" in `architecture.md` in test
      mode, switch on the payment methods and register the payment method
      domain(s) for Apple Pay, Google Pay and Link (`npm run payment-domains`),
      and set Stripe's branding (`supabase-setup.md` §2, steps 4–5).
- [ ] **Email footer image.** The ticket and free-ticket confirmation emails
      link `${NEXT_PUBLIC_SITE_URL}/brand/sheltuh-email-footer.png`
      (`public/brand/sheltuh-email-footer.png`, deployed with the app;
      `emailFooterImageUrl` in `lib/server/email-layout.ts`), only when
      `NEXT_PUBLIC_SITE_URL` is `https://`. After deploying, open that URL in
      a private window to check. The old banner,
      `https://sheltuh.com.au/sheltuh_email_signature_logo.png`, is no longer
      used by any email (keep it if the Workspace signature uses it). The
      waitlist, follower, review and invite emails have no images.
- [ ] **Event images in ticket emails.** The ticket email shows the event's
      own image from `${NEXT_PUBLIC_SITE_URL}/api/events/{id}/image?v=…` (public
      for published events), only when `NEXT_PUBLIC_SITE_URL` is `https://`.
      After deploying, open one such URL for a published event in a private
      window, then send a test order to a real Gmail, Apple Mail and Outlook
      inbox and check the image, QR, button and footer.
- [ ] **Google Workspace "Append footer"** (Admin console → Apps → Google
      Workspace → Gmail → Compliance → Append footer): if it adds the
      signature logo to outgoing mail, every ticket email ends with a second,
      left-aligned logo under the template's own footer. Turn it off for the
      sending account (or exclude automated mail) if that's not wanted.
- **Email wordmark: nothing to host.** The ticket email's header wordmark
  (`lib/server/email-wordmark.ts`, from `public/brand/sheltuh-wordmark-email.png`)
  is attached to each email inline (`cid:`), like the QR codes, so it shows
  even when a mail client blocks remote images.
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
  - Signing in with Google or Apple: drafted on `/privacy#google-apple`
    (what each provider shares, that we use only the email and account ID,
    automatic linking by verified email, Hide My Email), worded as "if we
    offer it" while the flag is off. Still marked draft.
  - Payments: Stripe's script loads on `/checkout/pay` (even for visits
    that don't pay) and collects device and fraud-prevention signals under
    Stripe's policy; drafted in `/privacy`'s Payments section. Still marked
    draft.
  - Account invites (`architecture.md`, "Account invites"): when someone
    asks, a Sheltüh admin can set up an invite (their email address and, for
    an organiser, the organiser details they gave) and email them a link; it
    is deleted 90 days after it was accepted, withdrawn or expired. Review
    the invite email's wording alongside the Privacy Policy and, once
    drafted, link the Organiser Agreement from it.
- [ ] **Google and Apple sign-in** (optional; off until the flag is set;
      `supabase-setup.md` §1, "Sign in with Google and Apple", and
      `architecture.md`, same section). In order:
      - Decide which entity enrols with Apple (Apple's user IDs and relay
        addresses are per developer team; `PROJECT_CONTEXT.md`).
      - Set up the Google client, and the Apple App ID, Services ID, key and
        client secret (`npm run apple-client-secret`), then Supabase's
        providers. Site URL is exactly `https://app.sheltuh.com.au`; **no
        Redirect URLs entries**, and **never a `*.vercel.app` wildcard**.
        "Confirm email" stays **on**; manual linking stays **off**.
      - Register the email senders as Apple email sources, or mail to Hide My
        Email addresses bounces.
      - **Official logo files in `public/auth/`** (Apple's from Apple Design
        Resources, Google's G from its branding kit), as
        `components/auth/OAuthButtons.tsx` expects them: they aren't in the
        repo, and **the build fails without them**. No placeholder logos.
      - `NEXT_PUBLIC_AUTH_PROVIDERS=google,apple` (or `google`) in Vercel for
        **Production only** (previews share the production Supabase project
        and can't be registered), then **redeploy**. List only providers
        enabled in Supabase, or the button leads to a raw error page.
      - Run the "Google and Apple sign-in" smoke tests below.
      - A calendar reminder to rotate the Apple client secret **every
        ~5 months** (it stops working after at most 6; Apple sign-in then
        fails for everyone).
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
6. [ ] Database connection: copy the **Transaction pooler** URL (port
       **6543**, not the direct connection on 5432) and add
       `?sslmode=require` for `DATABASE_URL`. Turn on **Enforce SSL**
       (Project Settings → Database → SSL Configuration), so a plain-text
       connection is refused. The app also requires TLS for any non-local
       host whatever the URL says (`lib/server/db.ts`): a missing,
       `disable`, `allow` or `prefer` `sslmode` still connects encrypted.
       Note the compute tier's pooler client limit (see
       `docs/architecture.md`, "Hosting: region, database connection, CDN").
       **Needs verification:** that Enforce SSL also covers the transaction
       pooler (Supavisor, port 6543), not just direct connections. Check:
       `psql "postgresql://postgres.REF@aws-0-ap-southeast-2.pooler.supabase.com:6543/postgres?sslmode=disable"`
       must be refused (it prompts for the password; type it there, never
       on the command line), and the same URL with `sslmode=require` must
       connect. If the pooler still accepts plain text, the app's own TLS
       rule is what protects it: note it here.
7. [ ] Optional hardening: **`DATABASE_CA_CERT`** (full certificate
       verification). `sslmode=require` encrypts but doesn't check who the
       server is, so it beats eavesdropping, not someone in the middle
       (spoofed DNS, say). Download Supabase's CA certificate (Project
       Settings → Database → SSL Configuration → Download certificate) and
       paste the whole PEM, `-----BEGIN CERTIFICATE-----` to
       `-----END CERTIFICATE-----`, into Vercel as `DATABASE_CA_CERT`
       (Production and Preview; newlines or literal `\n` both work). The app
       then verifies the server's certificate against it and its host name
       for any remote database (`lib/server/db.ts`). Not a secret (it's a
       public certificate), but a wrong value stops the app with an error
       naming the variable, so check it: after redeploying, a page that
       reads the database (the home feed) must load. **Needs
       verification:** that the pooler's certificate chains to that CA and
       names the pooler host; if the feed fails with a certificate error,
       remove the variable, redeploy, and note it here.

## Stripe

1. [ ] **Test mode:** enable Accounts v1 support (the "Something went wrong"
       at checkout came from this being off), create the webhook endpoint
       `https://YOUR-DOMAIN/api/stripe/webhook`, copy the signing secret.
       Copy the publishable key (`pk_test_…`) too, for
       `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`.
2. [ ] Branding (white background, black button): `supabase-setup.md` §2,
       step 4.
3. [ ] Payment methods (`supabase-setup.md` §2, step 5): Cards, Apple Pay,
       Google Pay and Link **on**; Afterpay, Klarna, Zip, PayPal and other
       buy-now-pay-later **off**; Adaptive Pricing **off** (the code pins it
       off too, so buyers pay exactly the A$ total shown).
4. [ ] Payment method domains: `npm run payment-domains -- --register
       app.sheltuh.com.au preview.sheltuh.com.au` with a **test** restricted
       key (`STRIPE_DOMAINS_KEY`), or Stripe → Settings → Payment method
       domains. It must exit 0: every domain enabled, Apple Pay, Google Pay
       and Link `active`. For a stable preview domain: add
       `preview.sheltuh.com.au` in Vercel and assign it to the branch you
       test on, add its CNAME in Cloudflare as **DNS only** (grey cloud), and
       give that branch's Preview environment
       `NEXT_PUBLIC_SITE_URL=https://preview.sheltuh.com.au` and the test
       keys, then redeploy. Per-deployment `*.vercel.app` URLs show cards
       only.
5. [ ] Run a full test purchase: paid ticket, free ticket, refund; then the
       "Owner sandbox checklist (embedded checkout)" in `architecture.md`,
       including the wallet, Link and Adaptive Pricing items (11–13) on real
       devices. Unverified until then: wallets and Link with `no-referrer`,
       in Instagram's in-app browser and the installed iOS app, and whether
       a domain registration covers both modes.
6. [ ] Only then repeat with **live** keys (secret, publishable and webhook
       secret all change together), steps 3–4 included: run
       `npm run payment-domains -- --register app.sheltuh.com.au` again with
       a **live** restricted key, then delete that key.

## Vercel

1. [ ] Environment variables (Production and Preview), from `.env.example`:
       `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`,
       `NEXT_PUBLIC_SITE_URL`, `DATABASE_URL` (transaction pooler, port 6543,
       ending `?sslmode=require`), optionally `DATABASE_CA_CERT` (see
       Supabase step 7),
       `STRIPE_SECRET_KEY`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`,
       `STRIPE_WEBHOOK_SECRET`, `SMTP_*`, `EMAIL_FROM`. The two Stripe keys
       are a pair from one account and mode: Production live
       (`sk_live_…` + `pk_live_…`), Preview test (`sk_test_…` +
       `pk_test_…`). Redeploy after changing any `NEXT_PUBLIC_*` value.
       Optional: `NEXT_PUBLIC_DISABLE_SERVICE_WORKER=1` turns the offline
       service worker off (needs a fresh build; see `docs/pwa.md`).
       Optional: `OPS_ALERT_EMAIL` (server-only), one address for ops alerts
       about payment exceptions and checkout surges (unset = logged only).
       Optional: `ADMIN_NOTIFY_EMAILS` (server-only, never `NEXT_PUBLIC_`),
       a comma-separated list of the addresses that get the "event /
       organiser to review" emails. Use an inbox only admins read, never a
       customer-facing one (`bookings@`, `support@`). When an admin leaves,
       remove their address from it as well as their admin role. Unset =
       every admin account's confirmed email (see `docs/architecture.md`,
       "Admin review emails"); with neither, those emails are skipped and
       logged once. Needs `SMTP_*` like every email.
       **Never** add `SUPABASE_SECRET_KEY` or `STRIPE_DOMAINS_KEY` (local
       scripts only). The one
       exception is `SUPABASE_CLIP_STORAGE_KEY`: a *separate*, separately
       revocable secret key used only by `lib/server/clip-storage.ts` for the
       private `event-clips` bucket (event clips; unset = clip routes 503).
       It is still a **full Supabase secret key** (Supabase can't scope
       them): service-role powers over the whole project, meaning the Data
       API without RLS, Supabase Auth admin (including making any account an
       admin) and every Storage bucket. Set it for **Production only**,
       unless Preview deployments point at a separate Supabase project (then
       give Preview that project's own key, never Production's). Revoke it
       at once if it may have leaked.
       The same goes for `SUPABASE_ADMIN_INVITE_KEY` (account invites; unset =
       creating invites answers 503 and invitees use the ordinary sign-up):
       a *separate* secret key (Supabase → API Keys → Create new secret key,
       `account-invites`) read only by `lib/server/auth-admin.ts`, still a
       **full Supabase secret key** with the same whole-project powers. Set
       it for **Production only**, redeploy, and revoke it at once if it may
       have leaked. No Supabase template change is needed, and **don't use
       the dashboard's "Invite user" button** (its link doesn't land in the
       app); invite from `/admin/invites`.
       Optional: `NEXT_PUBLIC_EVENT_CLIPS=1` turns clip uploads on (the
       editor's clip field, the admin queue's clip row), once that key is set.
       Without it the server also refuses new uploads (503), whatever a
       browser sends; existing clips still play, and can be re-described or
       removed. Before turning it on, check in the SQL editor that
       `select policyname from pg_policies where schemaname = 'storage';`
       returns **0 rows** and that Storage → Buckets shows `event-clips` as
       **private**.
       Optional: wallet passes ("Add to Google Wallet" / "Add to Apple
       Wallet" on the ticket page and in the ticket email), server-only,
       **Production only**. Each wallet turns itself on after a redeploy once
       all of its variables are set and valid; until then it's simply off (no
       button or email link, its route 404s),
       and the function logs name any variable that's wrong, never a value.
       Google: `GOOGLE_WALLET_ISSUER_ID`, `GOOGLE_WALLET_SERVICE_ACCOUNT_EMAIL`,
       `GOOGLE_WALLET_PRIVATE_KEY`. Apple (needs the Apple Developer Program):
       `APPLE_WALLET_PASS_TYPE_ID`, `APPLE_WALLET_TEAM_ID`,
       `APPLE_WALLET_CERT_PEM`, `APPLE_WALLET_KEY_PEM`,
       `APPLE_WALLET_WWDR_PEM` (the three PEMs base64-encoded) and, only for
       an encrypted key, `APPLE_WALLET_KEY_PASSPHRASE`. Step by step:
       `docs/wallet-setup.md`. The private keys are secrets: never commit
       them, and revoke them (Google: delete the service account key; Apple:
       revoke the Pass Type ID certificate) if they may have leaked.
2. [ ] Region: `vercel.json` pins functions to **Sydney (syd1)**
       (`"regions": ["syd1"]`), next to the database (`supabase-setup.md`
       §4). After the first deploy, check Settings → Functions shows syd1
       (and a function's logs show `syd1`). Checkout and the payment page's
       `GET …/payment` each make several sequential database round trips,
       so a US region would add noticeable delay before the form appears.
3. [ ] **Fluid compute** is on (Settings → Functions). One instance then
       serves many requests at once and shares its database pool (5
       connections) between them; without it, every concurrent request is
       its own instance with its own connections to the pooler.
4. [ ] Pro plan once you sell tickets (Hobby is non-commercial). The plan
       change alone doesn't touch the cron schedules: edit `vercel.json` and
       redeploy as in "Cron schedules" above.
5. [ ] Domain: attach `sheltuh.com.au` (see PROJECT_CONTEXT for the Cloudflare
       notes). Keep its Cloudflare record **DNS only** (grey cloud): a
       Cloudflare proxy in front would be a second, unmanaged cache over
       the CDN windows below, and would break client-IP rate limiting. The landing page currently lives on a Cloudflare Worker; decide
       when the app replaces it.

## Smoke test on the deployed site (test mode)

- [ ] **CDN headers** (`docs/architecture.md`, "CDN windows"). With
      `SITE=https://preview.sheltuh.com.au` (or the production domain), a
      published event's slug, id and image version (the `v` in its
      `imageUrl`), run each of these **twice**, a few seconds apart:

      ```sh
      curl -sI "$SITE/api/events?upcoming=1&limit=40" | grep -iE '^(cache-control|x-vercel-cache|age):'
      curl -sI "$SITE/api/events/slug/$SLUG" | grep -iE '^(cache-control|x-vercel-cache|age):'
      curl -sI "$SITE/api/events/$EVENT_ID/image?v=$V" | grep -iE '^(cache-control|x-vercel-cache|age):'
      curl -sI "$SITE/api/organisers/me" | grep -iE '^(cache-control|x-vercel-cache|age):'
      ```

      Expect the second response of each public route to show
      `x-vercel-cache: HIT` (and an `age`), and `/api/organisers/me` (a
      401 without a token: `private, no-store`) **never** `HIT`. Signed in,
      the same holds with the token: copy one from the browser's network
      panel, read it into a variable without echoing it or leaving it in
      your shell history, and use the variable:

      ```sh
      read -rs TOKEN   # paste the token, then Enter
      curl -sI -H "authorization: Bearer $TOKEN" "$SITE/api/organisers/me" | grep -iE '^(cache-control|x-vercel-cache|age):'
      unset TOKEN
      ```

      It must stay `private, no-store` and never `HIT`. Also check an image
      with a wrong `v` (`?v=1`) is `private, max-age=3600` and never `HIT`,
      and a search (`$SITE/api/events?q=test&upcoming=1`) is
      `private, no-store` and never `HIT`. If public routes never `HIT`,
      the CDN isn't keeping them: note it, the site still works, just with
      more database load.
- [ ] **A 304 is never cached as an empty image** (needs verification:
      images and logos answer a matching `If-None-Match` with a 304 that
      carries the same `public` header as the 200). With `$ORG_ID` and the
      `v` in an approved organiser's `logoUrl` (`$LV`), and a URL no one has
      fetched yet (the extra `x` parameter makes a fresh cache key):

      ```sh
      X=$RANDOM
      curl -sI -H "if-none-match: \"$LV-f\"" "$SITE/api/organisers/$ORG_ID/logo?v=$LV&x=$X" | head -1
      curl -s -o /dev/null -w '%{http_code} %{size_download}\n' "$SITE/api/organisers/$ORG_ID/logo?v=$LV&x=$X"
      ```

      The first is a `304`; the second must be `200` with a non-zero size,
      never `304` or `200 0`. Do the same for an event image (a new `X`,
      `-H "if-none-match: \"$V\""` on `/api/events/$EVENT_ID/image?v=$V&x=$X`). If an empty body comes back,
      Vercel stored the 304: purge the CDN cache and report it, since every
      visitor would see a broken image for up to an hour.
- [ ] **Browser reuse of images** (`age`): the image and logo `max-age`
      equals their `s-maxage` (an hour) so a CDN copy with a large `age` is
      still fresh in the browser. On a second `curl -sI` of an image, check
      the response has an `age` header and `cache-control: public,
      max-age=3600, s-maxage=3600` (if Vercel rewrites the header sent to
      the browser, note what it sends).
- [ ] Sign up, verify email code, sign in, `/account`.
- [ ] Buy a ticket with your account email, then add yourself to Who's Going
      on that event (opt-in form, 18+ box). Withdraw.
- [ ] With a second account that also went, start a message request, reply,
      block, report; check `/admin/reports` as admin.
- [ ] Organiser flow: apply, approve as admin, submit an event with a photo,
      approve, see it on the home page.
- [ ] Check the phone layout on a real phone.
- [ ] **Account invites** (once `SUPABASE_ADMIN_INVITE_KEY` is set): the
      smoke tests in `supabase-setup.md` §1, "Account invites": a fresh
      address on a phone ends on the dashboard as an approved organiser; an
      existing account; Google from the invite page; expired and revoked
      invites.
- [ ] **After the PKCE switch (whether or not Google and Apple are on):**
      email sign-up with the emailed code, and password reset with its code,
      both still work; so does signing in with a password.
- [ ] **Google and Apple sign-in** (once the flag is on), each on desktop
      Chrome, iPhone Safari, the **iPhone home-screen app** (the installed
      PWA: unverified whether the sign-in survives the round trip; a launch
      gate) and Android Chrome:
  - [ ] Continue with Google and with Apple from `/login` and `/signup`;
        land back where you started (e.g. an event's Who's Going, via
        `next`), signed in; `/account` shows the email.
  - [ ] Cancel on Google's and Apple's screens: our "Sign-in cancelled"
        page, nothing changed.
  - [ ] An existing email-and-password account, then Google with the same
        email: the same account (its tickets and profile), and the password
        still works.
  - [ ] Apple with Hide My Email: a separate account with the
        `@privaterelay.appleid.com` address; book a free ticket with it and
        check the ticket email arrives through the relay.
  - [ ] **Instagram's in-app browser** (open the site from a DM or bio
        link): Google shows the "open in your browser" notice instead of
        Google's error; check whether Apple works there.
  - [ ] Sign out, then Continue with Google: Google asks which account.
  - [ ] On the **test** project, start a sign-in with `redirect_to` set to
        `http://<site host>/auth/callback`, then to
        `https://<site host>:8443/auth/callback`: note whether Supabase
        sends the code there or falls back to the Site URL, and record the
        result in `architecture.md` ("`next`: no open redirect").

- [ ] **Wallet passes** (once a wallet's variables are set and redeployed):
      the checks in `docs/wallet-setup.md` ("Test a pass"): add a ticket to
      Google Wallet on an Android phone and to Apple Wallet on an iPhone,
      scan the pass's QR at `/dashboard/{event}/check-in`, and check a
      refunded order's ticket page shows no wallet buttons.

## Needs your decision or sign-off before launch

- **Legal:** consent wording, the privacy policy sections for Who's Going,
  messaging and Google/Apple sign-in (still marked draft), Terms, Organiser Agreement. Check whether
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
