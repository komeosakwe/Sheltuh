# Going live: Supabase, Stripe and Vercel

**Status:** none of this has been set up yet. The code has been tested against
a local Postgres 16 and an in-process Postgres (PGlite). It has never run
against a real Supabase project, Stripe account or Vercel deployment. Work
through this list once, in order. Test mode first, then live.

You'll end up with three dashboards: Supabase (database and accounts),
Stripe (payments) and Vercel (hosting).

## 1. Supabase project

1. Create a project at supabase.com. Choose the **Sydney
   (ap-southeast-2)** region, which keeps data in Australia and close to
   Melbourne users. Save the database password somewhere safe.
2. **Create the schema.** Open SQL Editor → New query, paste all of
   `supabase/migrations/20260925000000_init.sql` and run it. (Or use the
   CLI: `npx supabase link --project-ref <ref>` then `npx supabase db push`.)
   Every later migration file goes in the same way, in filename order.
3. **Collect the keys** (Project Settings → API Keys):
   - Publishable key (`sb_publishable_…`) → `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
   - Secret key (`sb_secret_…`) → `SUPABASE_SECRET_KEY`. Keep this on
     your own machine only. The app never needs it.
   - Project URL → `NEXT_PUBLIC_SUPABASE_URL`
4. **Database URL** (Connect button → "Transaction pooler", port 6543) →
   `DATABASE_URL`. Use the pooler, not the direct connection. Serverless
   hosting opens many short-lived connections, and the pooler exists to
   absorb them.

### Auth settings (Authentication in the dashboard)

The sign-up and password-reset screens ask people to type a code from their
email, rather than click a link. Supabase sends links by default, so:

- **Sign In / Providers → Email:** keep "Confirm email" **on**.
- **Emails → Templates → "Confirm signup":** put `{{ .Token }}` in the body,
  e.g. `Your Sheltüh verification code is {{ .Token }}`.
- **Emails → Templates → "Reset password":** the same, with `{{ .Token }}`.
- **Policies / Passwords:** minimum length 8, and require lowercase,
  uppercase and digits. This matches what the sign-up form already tells
  people.
- **URL Configuration:** set the Site URL to your real domain.
- **SMTP:** Supabase's built-in email is heavily rate-limited and meant for
  testing only. Before real organisers sign up, set a custom SMTP sender
  (Emails → SMTP Settings). Your Google Workspace works
  (`smtp.gmail.com`, port 587, an app password for e.g. `support@`). A
  transactional provider such as Resend also works; if you use one, **add
  its include to your existing SPF record** rather than creating a second
  `v=spf1` record.

### Make yourself an admin

1. Sign up through the app itself and verify your email.
2. From your machine, with `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SECRET_KEY`
   in `.env.local`:

   ```bash
   npm run promote-admin -- you@sheltuh.com.au
   ```

3. Sign out and back in. The Admin link appears in the nav.

`--revoke` removes admin access. This script is the only way anyone becomes
an admin: no API route or form can grant it.

### Optional: sample data for a dev project

```bash
npm run seed-dev-data   # needs DATABASE_URL in .env.local
```

This loads the eight fictional sample events as published events. Only run it
against a dev project, never production.

## 2. Stripe (Connect)

1. In the Stripe dashboard, stay in **test mode** and enable **Connect**. Use
   the platform profile "marketplace", with **Express** accounts, based in
   Australia.
2. Developers → API keys → secret key → `STRIPE_SECRET_KEY`.
3. Developers → Webhooks → Add endpoint:
   - URL: `https://<your-domain>/api/stripe/webhook`
   - Events: `checkout.session.completed`,
     `checkout.session.async_payment_succeeded`,
     `checkout.session.async_payment_failed`, `checkout.session.expired`
   - Its signing secret (`whsec_…`) → `STRIPE_WEBHOOK_SECRET`

   For local testing: `stripe listen --forward-to localhost:3000/api/stripe/webhook`
   prints a temporary signing secret to use instead.
4. Repeat steps 2–3 in live mode when you're ready to take real money.
   Live mode uses different keys and a different webhook secret.

**Known gap: refunds are manual.** If two buyers pay for the last ticket
within seconds of each other, the database guarantees only one gets it. The
other is charged, and their order is marked `oversold_refund_required`. You
refund these from the Stripe dashboard. To find them, run this in the
Supabase SQL editor:

```sql
select id, buyer_email, total_cents, stripe_payment_intent_id, created_at
from orders where status = 'oversold_refund_required';
```

## 3. Vercel

1. Import the GitHub repo into Vercel. It detects Next.js with no extra
   config.
2. Settings → Environment Variables: add everything in `.env.example`
   **except** `SUPABASE_SECRET_KEY`. Set `NEXT_PUBLIC_SITE_URL` to the
   production domain.
3. Settings → Functions → Region: **Sydney (syd1)**, next to the database.
4. Point a domain at it. The live landing page on `sheltuh.com.au` stays on
   Cloudflare Workers until you decide to swap it. A subdomain such as
   `app.sheltuh.com.au` avoids touching it for now.

`NEXT_PUBLIC_*` values are baked in at build time, so redeploy after
changing them.

## 4. Smoke test (test mode)

1. Sign up, then verify with the emailed code.
2. Apply as an organiser. As admin, approve the application at
   `/admin/organisers`.
3. As the organiser, set up payouts at `/dashboard/payouts`. Stripe's test
   onboarding accepts dummy details.
4. Create an event with a free ticket and a paid ticket, and submit it.
   Approve it at `/admin/events`.
5. Signed out, open the event:
   - Get the free ticket. It's issued instantly.
   - Buy the paid ticket with card `4242 4242 4242 4242`. The confirmation
     page shows ticket codes once Stripe's webhook arrives, usually within
     seconds.
6. In Stripe, check that the payment shows the application fee, with the
   rest transferred to the organiser's connected account.

## Costs

At pre-launch volume, check current pricing, but roughly:

- **Supabase Free** is fine for building and testing. It pauses a project
  after about a week without traffic, so move to Pro (~US$25/mo) once real
  organisers depend on it.
- **Vercel Hobby** is free but not for commercial use. Selling tickets means
  Pro (~US$20/mo).
- **Stripe** charges per transaction and per Connect payout. There's no
  monthly fee at this scale.
