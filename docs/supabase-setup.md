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
2. **Create the schema.** Open SQL Editor → New query, and run each file in
   `supabase/migrations/` in filename order, one query per file:
   `20260925000000_init.sql`, `20260926000000_refunds_and_emails.sql`,
   `20260927000000_review_fixes.sql`, `20260929000000_event_images.sql`,
   `20260930000000_event_images_lockdown.sql`,
   `20261001000000_whos_going.sql`,
   `20261002000000_whos_going_hardening.sql`,
   `20261003000000_messages.sql`, then
   `20261004000000_messaging_hardening.sql`.
   (Or use the CLI: `npx supabase link --project-ref <ref>` then
   `npx supabase db push`.) Any later migration file goes in the same way.
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

### Who's Going moderation

There's no admin screen for this yet. Run these in the Supabase SQL editor.

Suspend a member from Who's Going. They disappear from every count and list
straight away, and can't opt in, see names, or change their profile. The
suspension is kept on their account, not their profile, so deleting and
recreating the profile doesn't lift it (only deleting the whole account
removes it). Find them by the email on their account:

```sql
insert into private.social_suspensions (user_id, reason)
select id, 'short note for your own records' from auth.users where email = 'person@example.com'
on conflict (user_id) do nothing;
```

Lift the suspension. Their earlier opt-ins reappear:

```sql
delete from private.social_suspensions
where user_id = (select id from auth.users where email = 'person@example.com');
```

List current suspensions:

```sql
select u.email, s.suspended_at, s.reason
from private.social_suspensions s join auth.users u on u.id = s.user_id
order by s.suspended_at desc;
```

(`profiles.social_suspended_at` is no longer used: setting it does nothing.)

Switch Who's Going off for one event. The count becomes 0, the list empties
and nobody can opt in. Opt-ins are kept, so switching it back on restores
them:

```sql
update events set whos_going_enabled = false where slug = 'the-event-slug';
```

A suspension also stops them sending messages, and hides their conversations
from everyone else. Lifting it brings those conversations back.

To remove one person's opt-in from one event outright:

```sql
delete from event_attendees
where event_id = (select id from events where slug = 'the-event-slug')
  and user_id = (select id from auth.users where email = 'person@example.com');
```

### Message reports and moderation

Members can report a conversation, a message or a name on a Who's Going list.
Reports are stored in `private.user_reports` with copies of the messages, so
they survive the messages being deleted. Work the queue through the admin
API (`GET /api/admin/reports`, `POST /api/admin/reports/{id}/resolve` with
`{"action": "dismiss"}` or `{"action": "suspend"}`), or in the SQL editor:

Open reports, oldest first:

```sql
select r.id, r.created_at, r.reason, r.details, r.reported_display_name, r.message_body, r.context,
       u.email as reported_email
from private.user_reports r left join auth.users u on u.id = r.reported_user_id
where r.status = 'open'
order by r.created_at;
```

Suspend the reported member and close the report in one step (the same
function the admin API uses; replace both ids):

```sql
select private.resolve_report('<report id>', '<your auth user id>', 'suspend', 'short note');
```

Or dismiss it: the same with `'dismiss'`. Either returns `not_open` if
someone already resolved it.

Everything one member has reported, or been reported for:

```sql
select r.created_at, r.reason, r.status, r.message_body
from private.user_reports r
where r.reported_user_id = (select id from auth.users where email = 'person@example.com')
order by r.created_at desc;
```

Remove a block (members can do this themselves; this is for support):

```sql
delete from user_blocks
where blocker_id = (select id from auth.users where email = 'blocker@example.com')
  and blocked_id = (select id from auth.users where email = 'blocked@example.com');
```

Messages are private between the two members. Only read them in response to
a report, through the copies in the report.

### Who's Going and messages retention (daily job)

Opt-ins are deleted 30 days after their event ends, conversations (with
their messages) 12 months after their last message, and resolved reports 2
years after they were resolved, by `private.purge_social_data()`, which also
clears stale rate-limit counters. Open reports are never deleted. Nothing
runs it automatically until you schedule it once:

1. Integrations → **Cron** → enable it (this installs the `pg_cron`
   extension).
2. Create a job: name `purge-social-data`, schedule `17 3 * * *` (daily at
   03:17 UTC), type "SQL snippet", with the command
   `select private.purge_social_data();`

Or in the SQL editor, once Cron is enabled:

```sql
select cron.schedule('purge-social-data', '17 3 * * *', $$select private.purge_social_data()$$);
```

Check it's running under Integrations → Cron → the job's history (or
`select * from cron.job_run_details order by start_time desc limit 5;`). It's
safe to run by hand at any time; it returns how many rows it deleted
(`event_attendees_deleted`, `rate_limits_deleted`, `conversations_deleted`,
`user_reports_deleted`). If you scheduled it before
`20261003000000_messages.sql`, the existing job keeps working unchanged: the
function keeps its name and still takes no arguments.

## 2. Stripe (Connect)

1. In the Stripe dashboard, stay in **test mode** and enable **Connect**. Use
   the platform profile "marketplace", with **Express** accounts, based in
   Australia.
2. Developers → API keys → secret key → `STRIPE_SECRET_KEY`.
3. Developers → Webhooks → Add endpoint:
   - URL: `https://<your-domain>/api/stripe/webhook`
   - Events: `checkout.session.completed`,
     `checkout.session.async_payment_succeeded`,
     `checkout.session.async_payment_failed`, `checkout.session.expired`,
     `refund.updated`, `refund.failed`
   - Its signing secret (`whsec_…`) → `STRIPE_WEBHOOK_SECRET`

   For local testing: `stripe listen --forward-to localhost:3000/api/stripe/webhook`
   prints a temporary signing secret to use instead.
4. Repeat steps 2–3 in live mode when you're ready to take real money.
   Live mode uses different keys and a different webhook secret.

**Orders that can't be fulfilled are refunded automatically.** This covers
two buyers paying for the last ticket within seconds of each other (the
database guarantees only one gets it), or an admin unpublishing an event
while a buyer is still on Stripe's checkout page. The buyer is refunded in
full: their payment, Sheltüh's fee and the organiser's share. The order is
marked `refunded` once Stripe confirms the refund succeeded; a pending
refund is settled by the `refund.updated` webhook. If the refund call itself
fails, Stripe's webhook retries try again. A refund Stripe reports as failed
leaves the order `oversold_refund_required` for you to handle from the
Stripe dashboard. To check for any that are stuck, run this in the Supabase
SQL editor:

```sql
select id, buyer_email, total_cents, stripe_payment_intent_id, created_at
from orders where status = 'oversold_refund_required';
```

## 3. Ticket emails

After every paid or free order, the buyer gets an email with their ticket
codes and a link back to the order. It's sent over SMTP from your existing
Google Workspace, so there's no new vendor:

1. Sign in to the mailbox you want to send from (e.g. `support@`). Turn on
   2-Step Verification if it isn't already, then create an app password at
   myaccount.google.com → Security → App passwords.
2. Set `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=587`, `SMTP_USER` (the mailbox
   address), `SMTP_PASS` (the app password) and `EMAIL_FROM`, as in
   `.env.example`. Google already sends for your domain under the existing
   SPF record, so no DNS change is needed.

Workspace allows about 2,000 messages a day, which is plenty for launch. If
SMTP isn't set, orders still work and tickets still show on the confirmation
page; the server logs that no email was sent. To find orders whose email
failed:

```sql
select id, buyer_email, created_at from orders
where status = 'paid' and buyer_email is not null and tickets_emailed_at is null;
```

## 4. Vercel

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

## 5. Smoke test (test mode)

1. Sign up, then verify with the emailed code.
2. Apply as an organiser. As admin, approve the application at
   `/admin/organisers`.
3. As the organiser, set up payouts at `/dashboard/payouts`. Stripe's test
   onboarding accepts dummy details.
4. Create an event with a free ticket and a paid ticket, and submit it.
   Approve it at `/admin/events`.
5. Signed out, open the event:
   - Get the free ticket (it asks for an email). It's issued instantly
     and the ticket email arrives.
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
