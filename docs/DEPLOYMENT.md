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
      newest, currently `20261105000000_organiser_logos.sql`. Never
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
- [ ] **Stripe webhook `charge.refunded`** on the endpoint, in test **and**
      live mode (configured separately), alongside the checkout and refund
      events listed in `supabase-setup.md` §2. Without it a refund made in
      the Stripe dashboard leaves the order paid and its tickets valid at the
      door.
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
- [x] **Email footer banner** hosted at exactly
      `https://sheltuh.com.au/sheltuh_email_signature_logo.png` (the ticket
      email links this fixed URL, `EMAIL_FOOTER_IMAGE_URL` in
      `lib/server/ticket-email.ts`; the owner confirmed it loads, 24 Oct 2026).
      The file is `public/sheltuh_email_signature_logo.png`; while
      `sheltuh.com.au` is still the Cloudflare Worker landing page it must stay
      there too. Open the URL in a private window to check. This is
      the only remote image in any email: the free-ticket confirmation,
      waitlist and follower emails have none.
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
       `NEXT_PUBLIC_SITE_URL`, `DATABASE_URL` (transaction pooler, port 6543),
       `STRIPE_SECRET_KEY`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`,
       `STRIPE_WEBHOOK_SECRET`, `SMTP_*`, `EMAIL_FROM`. The two Stripe keys
       are a pair from one account and mode: Production live
       (`sk_live_…` + `pk_live_…`), Preview test (`sk_test_…` +
       `pk_test_…`). Redeploy after changing any `NEXT_PUBLIC_*` value.
       Optional: `NEXT_PUBLIC_DISABLE_SERVICE_WORKER=1` turns the offline
       service worker off (needs a fresh build; see `docs/pwa.md`).
       Optional: `ADMIN_NOTIFY_EMAILS` (server-only, never `NEXT_PUBLIC_`),
       a comma-separated list of the addresses that get the "event /
       organiser to review" emails, e.g. `bookings@sheltuh.com.au`. Unset =
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
       Optional: `NEXT_PUBLIC_EVENT_CLIPS=1` turns clip uploads on (the
       editor's clip field, the admin queue's clip row), once that key is set.
       Without it the server also refuses new uploads (503), whatever a
       browser sends; existing clips still play, and can be re-described or
       removed. Before turning it on, check in the SQL editor that
       `select policyname from pg_policies where schemaname = 'storage';`
       returns **0 rows** and that Storage → Buckets shows `event-clips` as
       **private**.
2. [ ] Settings → Functions → Region is **Sydney (syd1)**, next to the
       database (`supabase-setup.md` §4). `vercel.json` sets no `regions`, so
       this setting decides it; not yet checked. Checkout and the payment
       page's `GET …/payment` each make several sequential database round
       trips, so a US region would add noticeable delay before the form
       appears.
3. [ ] Pro plan once you sell tickets (Hobby is non-commercial).
4. [ ] Domain: attach `sheltuh.com.au` (see PROJECT_CONTEXT for the Cloudflare
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
