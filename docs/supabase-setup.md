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
   `npx supabase db push`.) Every later migration file goes in the same way,
   in filename order, up to the newest: see the "Go-live checklist" in
   [`DEPLOYMENT.md`](DEPLOYMENT.md), which also lists `CRON_SECRET`, the cron
   schedules, the `charge.refunded` webhook, the email footer banner, the
   Privacy Policy wording and the Bootzy font files.
3. **Collect the keys** (Project Settings → API Keys):
   - Publishable key (`sb_publishable_…`) → `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
   - Secret key (`sb_secret_…`) → `SUPABASE_SECRET_KEY`. Keep this on
     your own machine only. The app never needs it.
   - Project URL → `NEXT_PUBLIC_SUPABASE_URL`
4. **Database URL** (Connect button → "Transaction pooler", port 6543) →
   `DATABASE_URL`, with `?sslmode=require` on the end. Use the pooler, not
   the direct connection. Serverless hosting opens many short-lived
   connections, and the pooler exists to absorb them. The app forces TLS
   for any database that isn't on the same machine even without
   `sslmode` (`lib/server/db.ts`), but keep it in the URL so every tool
   that reads it does the same. Then turn on **Enforce SSL** (Project
   Settings → Database → SSL Configuration), so the database refuses a
   plain-text connection from anything.

### Auth settings (Authentication in the dashboard)

The sign-up and password-reset screens ask people to type a code from their
email, rather than click a link. Supabase sends links by default, so:

- **Sign In / Providers → Email:** keep "Confirm email" **on**. Account
  invites depend on it: accepting one needs only a verified email, so with
  confirmation off anyone could sign up with an invited address and accept
  the invite.
- **Emails → Templates → "Confirm signup":** put `{{ .Token }}` in the body,
  e.g. `Your Sheltüh verification code is {{ .Token }}`.
- **Emails → Templates → "Reset password":** the same, with `{{ .Token }}`.
- **Don't use Users → "Invite user"** (or change the "Invite user"
  template). Its link goes to Supabase's own verify page, which this app
  doesn't pick up (sign-in uses PKCE), so the person would land nowhere.
  Invite people from `/admin/invites` instead ("Account invites" below): that
  email is ours, sent through the SMTP settings, and needs no template change.
- **Policies / Passwords:** minimum length 8, and require lowercase,
  uppercase and digits. This matches what the sign-up form already tells
  people.
- **URL Configuration:** set the Site URL to your real domain: the exact
  origin people use, e.g. `https://app.sheltuh.com.au` (Google and Apple
  sign-in rely on it; see the next section).
- **SMTP:** Supabase's built-in email is heavily rate-limited and meant for
  testing only. Before real organisers sign up, set a custom SMTP sender
  (Emails → SMTP Settings). Your Google Workspace works
  (`smtp.gmail.com`, port 587, an app password for e.g. `support@`). A
  transactional provider such as Resend also works; if you use one, **add
  its include to your existing SPF record** rather than creating a second
  `v=spf1` record.

### Sign in with Google and Apple (optional)

"Continue with Google" and "Continue with Apple" on `/login` and `/signup`
(design in `docs/architecture.md`, "Sign in with Google and Apple"). They
stay hidden until both providers are set up here **and**
`NEXT_PUBLIC_AUTH_PROVIDERS` lists them, so do this first and set the flag
last. You can do just Google; Apple costs US$99 a year. Decide first which
entity enrols with Apple: Apple's user IDs and relay addresses belong to the
developer team, so moving to another team later (e.g. a Pty Ltd's) breaks
sign-in matching for people who hid their email (`PROJECT_CONTEXT.md`).

Throughout, `<ref>` is your Supabase project ref, and the **callback URL**
is `https://<ref>.supabase.co/auth/v1/callback` (copy it from Supabase →
Authentication → Sign In / Providers → Google or Apple). Google's console
labels below come from Supabase's Google guide; Google's own docs weren't
checked.

**Google** (console.cloud.google.com → Google Auth Platform)

1. Create or pick the project "Sheltuh".
2. **Branding** (the consent screen): app name "Sheltüh"; support email
   `support@sheltuh.com.au`; home page `https://app.sheltuh.com.au`; privacy
   policy `https://app.sheltuh.com.au/privacy`; terms
   `https://app.sheltuh.com.au/terms`; authorised domain `sheltuh.com.au`
   (add `supabase.co` too if the console insists on the callback's domain);
   developer contact `info@sheltuh.com.au`.
3. **Data Access:** add `openid`; keep `…/auth/userinfo.email` and
   `…/auth/userinfo.profile`; nothing else.
4. **Audience:** External, then **Publish app**. In "Testing" only the test
   users you list can sign in.
5. **Clients → Create client → Web application:**
   - Authorised JavaScript origins: `https://app.sheltuh.com.au`.
   - Authorised redirect URIs: the callback URL.
   - Copy the client ID and secret (the secret is shown once; keep it in
     your password manager).
6. Optional: branding verification (free, a few days). Until it's done (or
   there's a Supabase custom domain), Google's screen shows
   `<ref>.supabase.co`.

**Apple** (developer.apple.com/account; needs the Apple Developer Program)

1. Enrol. Note the **Team ID** (Membership details).
2. **Certificates, Identifiers & Profiles → Identifiers → + → App IDs →
   App:** description "Sheltuh", explicit bundle ID `au.com.sheltuh.app`,
   tick **Sign in with Apple** (as a primary App ID). Leave the
   server-to-server notification endpoint empty: Supabase doesn't use it.
3. **Identifiers → + → Services IDs:** description "Sheltüh" (people see
   it on Apple's screen), identifier `au.com.sheltuh.web`. Open it, tick
   Sign in with Apple → **Configure**: primary App ID the one above; domain
   `<ref>.supabase.co`; return URL the callback URL. Save. Don't register
   `app.sheltuh.com.au`: in this flow Apple only ever returns to Supabase.
   If the portal asks you to verify the domain, follow its prompt
   (Supabase's guide lists no such step).
4. **Keys → +:** name it, tick Sign in with Apple → Configure → the primary
   App ID. Register and **download `AuthKey_<KeyID>.p8`: Apple lets you
   download it once.** Keep it in your password manager, never in the repo
   (`*.p8` is git-ignored as a backstop), Vercel or email. Note the **Key ID**.
5. **Make the client secret** (a JWT Apple accepts for at most 6 months),
   on your own machine:

   ```bash
   npm run apple-client-secret -- --key ~/secure/AuthKey_ABCDE12345.p8 \
     --team-id <TEAM ID> --key-id <KEY ID> --services-id au.com.sheltuh.web
   ```

   It prints the JWT (stdout; e.g. add `| pbcopy` on a Mac to copy it
   without it showing) and its expiry date (stderr), never the key. Default
   180 days; `--days` up to 182, and it refuses more (Apple's limit is
   15,777,000 seconds). The JWT is a secret too: paste it straight into
   Supabase, don't save it in a file or a note. Supabase's Apple guide also
   has an in-browser generator (not in Safari).
6. **Services → Sign in with Apple for Email Communication → Configure:**
   register every address that emails people as an **email source**:
   `EMAIL_FROM` and the Supabase SMTP sender (or the whole domain
   `sheltuh.com.au`). Those messages must pass SPF or DKIM (Workspace DKIM
   is already on). Without this, Apple's relay rejects mail to
   `…@privaterelay.appleid.com` addresses: no tickets, no codes.
7. **Set a reminder to rotate the secret about every 5 months** (step 5
   again, then paste the new JWT into Supabase). If it lapses, Apple sign-in
   fails for everyone; Google and email keep working. The key itself
   doesn't expire; revoke and replace it only if it leaks (then make a new
   secret straight away).

**Supabase** (Authentication)

1. **URL Configuration:** Site URL `https://app.sheltuh.com.au`, exactly
   the origin people use. **Redirect URLs: none for production**: Supabase
   accepts any return path on the Site URL's host (whether it also checks
   the scheme and port is unverified: `architecture.md`, "`next`: no open
   redirect"). Only for an HTTPS host you own
   and control add an exact entry, e.g.
   `https://staging.sheltuh.com.au/auth/callback**`. **Never add a
   `*.vercel.app` wildcard** (such as `https://*-<team>.vercel.app/**`):
   anyone can create a Vercel project with a matching URL and collect
   sign-in codes through it. So Google and Apple stay off on previews.
2. **Sign In / Providers → Google:** enable; Client IDs = the web client ID;
   Client Secret; leave "Skip nonce check" **off**; "Allow users without an
   email" **off** (if shown).
3. **Sign In / Providers → Apple:** enable; Client IDs = `au.com.sheltuh.web`
   (first, if you ever add more); Secret Key (for OAuth) = the JWT from
   step 5; "Allow users without an email" **off** (if shown).
4. Keep **"Confirm email" on** (Email provider). Supabase links a Google or
   Apple sign-in to an existing account with the same email automatically,
   and trusts only verified emails for that while confirmation is on. Keep
   sign-ups on, and **manual linking off** ("Allow manual linking" under
   Sign In / Providers): the app doesn't use it.
5. **Vercel:** `NEXT_PUBLIC_AUTH_PROVIDERS=google,apple` (or just `google`)
   for **Production only**, then redeploy. List only providers enabled in
   steps 2 and 3, or the button leads to Supabase's raw error page. Then the
   smoke tests in `DEPLOYMENT.md`.

### Make yourself an admin

1. Sign up through the app itself and verify your email.
2. From your machine, with `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SECRET_KEY`
   in `.env.local`:

   ```bash
   npm run promote-admin -- you@sheltuh.com.au
   ```

3. Sign out and back in. The Admin link appears in the nav.

`--revoke` removes admin access. This script is the only way anyone becomes
an admin: no API route or form can grant it. When offboarding an admin, also
remove their address from `ADMIN_NOTIFY_EMAILS` if it's there (it gets the
"waiting for your review" emails whatever the account's role). Any invites
they sent that are still pending stop working (the page says the invite was
withdrawn) and can't be resent by another admin; send new ones if those
people should still join. Deleting the account has the same effect.

### Optional: sample data for a dev project

```bash
npm run seed-dev-data   # needs DATABASE_URL in .env.local
```

This loads the fictional sample events as published events, under
platform-managed organisers (no owner account). Those can't sell paid Sheltüh
tickets (`20261022000100_admin_event_authoring.sql`), so the sample events
with a paid ticket type are skipped; the free and external ones are loaded.
Only run it against a dev project, never production.

Paid ticket types seeded before that migration stay as they are, but checkout
refuses them (409) and they can't be saved again with a price.

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

### Organiser takedown and profile edit log

Approved organisers can change their bio, website and social handles without
a new review. Every change is logged with its old and new values in
`private.organiser_profile_edits`, which the admin organiser queue shows
(newest 20 per organiser). If an organiser's profile or events turn out to be
abusive, take them down from the queue (Suspend), through the admin API
(`POST /api/admin/organisers/{id}/suspend` with `{"reason": "…"}`), or in the
SQL editor with the same function the API uses:

```sql
-- Find the organiser.
select id, display_name, status, website_url from public.organisers where display_name ilike '%name%';

-- Take them down (replace both ids; the reason, 1–500 characters, is shown to the organiser).
select * from private.suspend_organiser('<organiser id>', '<your auth user id>', 'short reason');
```

It returns `suspended` with how many events it unpublished
(`events_unpublished`) and how many waiting submissions it rejected
(`submissions_rejected`), or `not_approved` / `not_found` and changes nothing.
In one transaction it sets the organiser `rejected`, unpublishes their
published events (back to draft), rejects events waiting for review, and logs
everything (the event moderation log and the organiser's log). Nothing is
deleted, and paid tickets stay valid: refunding them is a separate decision,
made in the Stripe dashboard. Don't take an organiser down by updating
`organisers.status` by hand: that leaves their events published and bookable.

To reinstate them, they reapply from their dashboard (their application goes
back to pending) and an admin approves it. Their unpublished events stay drafts
until they resubmit them and an admin approves each one.

Recent profile changes across all organisers, newest first:

```sql
select o.display_name, e.kind, e.edited_at, e.changed_fields, e.reason
from private.organiser_profile_edits e join public.organisers o on o.id = e.organiser_id
order by e.id desc
limit 50;
```

One organiser's full history:

```sql
select e.kind, e.edited_at, e.changed_fields, e.reason, u.email as actor_email
from private.organiser_profile_edits e left join auth.users u on u.id = e.actor_id
where e.organiser_id = '<organiser id>'
order by e.id;
```

The log is append-only: the database refuses updates to it.

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

### Analytics retention (daily job)

Organiser page-view counters are deleted 25 months after the day they
counted, per-event view rate-limit counters once idle for a day, and the
door check-in log and tickets' check-in times 25 months after their event
ends, by `private.purge_analytics()`. Nothing about visitors is stored in the first
place (no cookie, IP address or user id), so this only bounds how long the
aggregate numbers are kept. Schedule it alongside the job above:

```sql
select cron.schedule('purge-analytics', '27 3 * * *', $$select private.purge_analytics()$$);
```

It's safe to run by hand at any time and returns how many rows it deleted
(`event_view_counts_deleted`, `event_rate_limits_deleted`; check-in rows
aren't counted in the result, which keeps an existing job working unchanged).
Orders, tickets, and the tracking code recorded on orders, are financial
records and aren't purged.

View counting starts the day `20261006000000_event_analytics.sql` is applied
(`private.analytics_settings.views_tracked_since`); reports show earlier days
as "not counted". Don't change that date by hand: it's what keeps a report
from showing 0 views for days nobody counted.

### Ticket check-in

`20261021000000_ticket_check_in.sql` adds `tickets.checked_in_at`, the
`ticket_check_ins` log and the check-in functions. It's additive (no existing
row changes) and also redefines `private.purge_analytics()` with the same
result columns, so the analytics job above needs no change. Check-in is done
by the event's organiser, signed in on the door device. Events of
platform-managed organisers (no owner account) are checked in by an admin,
signed in as themselves on the same door page (`/dashboard/{event id}/check-in`);
admins can't check in for organisers' own events
(`20261023000100_review_hardening.sql`; docs/architecture.md, "Check-in").
An event's check-ins (no buyer data), with who scanned:

```sql
select c.id, c.result, right(c.ticket_code, 4) as code_last4, c.reason, c.created_at, u.email as scanned_by
from ticket_check_ins c left join auth.users u on u.id = c.actor_user_id
where c.event_id = '<event id>' order by c.id desc limit 50;
```

Mistaken admissions are undone from the app (with a reason, logged), not in
SQL: an `update tickets set checked_in_at = null` would leave no record.

### Platform-managed organisers

When you create one (`/admin/events/new` → new organiser, or
`POST /api/admin/organisers`), give it a Sheltüh alias as its contact email
(one of the Google Workspace aliases, such as `bookings@sheltuh.com.au`, or a
new alias), never a person's own address: the record is kept for as long as
the organiser exists, admins see it, and whoever looks after the alias can
change hands without the record changing.

### A ticket link refused after a rule change

The ticket link's rules (`private.external_ticket_url_ok`, mirrored in
`lib/ticketing.ts`) are only checked when a link is written, so tightening
them (for example adding a shortener) never blocks an unpublish or a
takedown of an event that already holds such a link. A migration that
tightens them should list the events whose stored link no longer passes, as
`20261023000100_review_hardening.sql` does (it stops, naming them):

```sql
select id, title, status, external_ticket_url from public.events
where external_ticket_url is not null and not private.external_ticket_url_ok(external_ticket_url);
```

For each one: replace the link with `PATCH /api/admin/events/{id}/ticketing`
(`{"ticketingMode": "external", "externalTicketUrl": "https://…", "reason": "…"}`,
logged), or, if there's no good link to give it, unpublish it
(`POST /api/admin/events/{id}/unpublish`) and then fix it. Then run the
migration again.

### Reserved seating

Seat maps, holds and sales are described in `docs/architecture.md`
("Reserved seating"). Run these in the Supabase SQL editor. Each takes the
event's seat lock first, as the app does, so it can't interleave with a
checkout, a payment or a refund. Replace the `<…>` values; event ids are
uuids, seat ids are the map's (e.g. `A12`), order ids `ord_…`.

**Release a stuck hold.** Holds end on their own 35 minutes after Checkout,
and the app releases them straight away when Stripe's session expires or the
buyer cancels. To free a hold early, first **expire the order's Checkout
Session in the Stripe dashboard** (Payments → Checkout sessions), or check
it has expired: releasing a hold whose session can still be paid would let
the buyer pay for seats someone else may then take (they'd be refunded
automatically, but it's avoidable). Then:

```sql
select private.release_seat_holds('<order id>');
-- 'released': the order is now failed and its seats are free.
-- Anything else ('paid', 'failed', …) is the order's status: nothing changed.
```

**Block a seat after approval** (a broken seat, a camera position). The
organiser's map is frozen once approved, and an admin can only replace it
while the event has no orders (`PUT /api/admin/events/{id}/seat-map`). With
orders, block an unsold seat in SQL. The seat's tier loses one place of
capacity. The stored layout isn't changed: buyers see the seat as
unavailable (the availability bitmap), and the editor still shows it as
before.

```sql
do $$
declare
  v_event uuid := '<event id>';
  v_seat text := '<seat id>';
begin
  perform private.lock_event_seats(v_event);
  update public.event_seats
     set blocked = true, hold_order_id = null, hold_expires_at = null
   where event_id = v_event and id = v_seat and not blocked and sold_order_id is null
     and (hold_order_id is null or hold_expires_at <= now());
  if not found then
    raise exception 'Seat % is unknown, already blocked, sold or held right now: nothing changed.', v_seat;
  end if;
  -- Recompute the tiers' capacity (the ticket_types_seated_capacity trigger).
  update public.ticket_types set quantity_available = quantity_available where event_id = v_event and seated;
  insert into public.event_moderation_log (event_id, action, actor_id, reason)
  values (v_event, 'edited', '<your admin user id>', 'Seat ' || v_seat || ' blocked: <why>');
end
$$;
```

Unblocking is the same with `blocked = false` (and no hold or sale to check).
A seat that's sold must be moved first (below), or its order refunded.

**Move a buyer's seat** (same ticket type only: a different price is a
refund and a new booking). The new seat must be free (not sold, blocked or
held right now). The ticket keeps its code; the buyer's confirmation page
shows the new seat at once.

```sql
do $$
declare
  v_event uuid := '<event id>';
  v_order text := '<order id>';
  v_from text := '<current seat id>';
  v_to text := '<new seat id>';
  v_tier text;
  v_code text;
begin
  perform private.lock_event_seats(v_event);
  select ticket_type_id into v_tier from public.event_seats
   where event_id = v_event and id = v_from and sold_order_id = v_order for update;
  if not found then
    raise exception 'Seat % isn''t sold to that order.', v_from;
  end if;
  perform 1 from public.event_seats
   where event_id = v_event and id = v_to and ticket_type_id = v_tier and not blocked and sold_order_id is null
     and (hold_order_id is null or hold_expires_at <= now())
     for update;
  if not found then
    raise exception 'Seat % isn''t free in the same ticket type.', v_to;
  end if;
  select code into v_code from public.tickets where event_id = v_event and order_id = v_order and seat_id = v_from;
  -- The ticket lets go of the seat first (its foreign key needs the seat sold to its order).
  update public.tickets set seat_id = null where code = v_code;
  update public.event_seats set sold_order_id = null where event_id = v_event and id = v_from;
  update public.event_seats set sold_order_id = v_order, hold_order_id = null, hold_expires_at = null
   where event_id = v_event and id = v_to;
  update public.tickets set seat_id = v_to where code = v_code;
  update public.orders set seat_ids = array_replace(seat_ids, v_from, v_to) where id = v_order;
end
$$;
```

Then resend the ticket email from `/admin/emails` (it's rebuilt from the
order, so it shows the new seat), and tell the buyer.

### Redacting personal information from the event moderation log

`edited` and `ticketing_changed` entries in `public.event_moderation_log`
keep the old and new value of each changed field (`details`), and every entry
can carry a free-text `reason`. If personal information ends up there (a
phone number or someone's name in an old event description, say) and has to
go, because the person asks for it to be corrected or removed (APP 13) or it
shouldn't be kept (APP 11), redact it in place: keep the entry, so the record
still shows that the field changed, when and by whom.

1. First fix the event itself (the admin editor). That save logs another
   `edited` entry whose `old` value is the text being removed, so redact
   after it.
2. Find every entry holding the text:

   ```sql
   select l.id, l.action, l.created_at, l.reason, l.details
   from public.event_moderation_log l
   where l.event_id = '<event id>' and (l.details::text ilike '%<text>%' or l.reason ilike '%<text>%')
   order by l.id;
   ```

3. Replace each affected value (here a description's `old` value; use the
   field and side that hold it, and `reason` the same way), in one
   transaction, noting who redacted it and when:

   ```sql
   begin;
   update public.event_moderation_log
      set details = jsonb_set(details, '{description,old}', to_jsonb('[redacted <date> by <initials>: personal information]'::text))
    where id = <entry id> and event_id = '<event id>';
   -- check the row, then:
   commit;
   ```

   A ticket type list (`ticketTypes`) is a whole array: replace the
   affected name or description inside it with the same `jsonb_set` path
   (`'{ticketTypes,old,0,description}'`).
4. Record the request and what you redacted outside the database (the
   privacy request log), not in the event log.

The organiser profile edit log (`private.organiser_profile_edits`) refuses
updates by design (trigger `organiser_profile_edits_append_only`); redacting
there means disabling that trigger inside the same transaction, updating the
one row, and enabling it again before `commit`. Do it only for a request you
have recorded.

### Free-ticket and email outbox retention (daily job)

Guest free orders that were never confirmed are deleted a week after their
link expired, along with idle platform counters, free-booking refusal counts
older than 13 months, email jobs (sent ones after 90 days, failed ones
after a year), idle per-client counters, account invites 90 days after they
were accepted, withdrawn or expired, refunds Stripe reported before their
payment was recorded and refund status marks (after 35 days), checkout
attempts (after 2 days) and resolved payment exceptions (2 years after
resolution; open ones are never deleted), by
`private.purge_operational_data()`:

```sql
select cron.schedule('purge-operational-data', '37 3 * * *', $$select private.purge_operational_data()$$);
```

It's safe to run by hand and returns how many rows it deleted. Paid orders
are financial records and are never purged. To see how often free bookings
are refused (no personal data is kept):

```sql
select day, reason, refusals from private.free_order_refusals order by day desc, reason;
```

Any `platform_hourly_limit` or `platform_daily_limit` rows mean guest free
bookings were refused for everyone for a while (the platform-wide caps on
confirmation emails). A few are fine; a steady stream suggests someone is
flooding the free path (docs/architecture.md, "Accepted risks (free
tickets)"). Each count stops at 10,000 a day.

**Malformed addresses from before stricter checking.** Buyer and organiser
emails are now checked as one plain address (no names, comments, quotes or
lists). Once, after applying `20261017000000_free_order_caps.sql`, check for
rows stored earlier that wouldn't pass (mail now always goes to them as a
single address, but they're worth a look):

```sql
select id, status, created_at from public.orders where buyer_email ~ '[,;<>()":\[\]\\[:space:]]';
select id, status, created_at from public.organisers where contact_email ~ '[,;<>()":\[\]\\[:space:]]';
```

**Organiser websites (pre-deploy check).** Before deploying the organiser
profile release, and again after applying
`20261016000000_organiser_public_profile.sql` (whose check constraint would
fail on these rows), this should return no rows:

```sql
select id from public.organisers where website_url !~* '^https?://' or char_length(website_url) > 2048;
```

The API now only takes new `https://` addresses without a username or
password. Older `http://` ones keep working until the organiser changes them.
To review them (optional):

```sql
select id, display_name, website_url from public.organisers
where website_url ~* '^http://' or website_url ~ '^[A-Za-z]+://[^/?#]*@';
```

### Event clips (optional)

Short silent clips on events live in the private Storage bucket
`event-clips`, created by migration `20261106000000_event_clips.sql`
(check Storage → Buckets shows it as **private**, 10 MB limit), with
`20261106000100_event_clip_dimensions.sql` and
`20261106000200_event_clip_hardening.sql` after it. Check that no Storage
policy lets a client at any bucket; this must return **0 rows**:

```sql
select policyname from pg_policies where schemaname = 'storage';
```

Then create a dedicated secret key (Project Settings → API Keys → Create
new secret key, named `event-clips`) and set it in Vercel as
`SUPABASE_CLIP_STORAGE_KEY` (server-only, never `NEXT_PUBLIC_`), for
**Production only** unless Preview deployments use a separate Supabase
project (then that project's own key). Be clear about what it is: Supabase
secret keys can't be scoped, so this is a **full secret key with
service-role powers** over the whole project: the Data API without RLS
(every table), Supabase Auth admin (including setting
`app_metadata.role = "admin"` on any account) and every Storage bucket. The
app only uses it for `event-clips`, through `lib/server/clip-storage.ts`;
being a separate key means it can be revoked alone, nothing more. Revoke it
at once if it may have leaked. Without it, clip uploads and playback answer
503 and everything else works. Clips are served for ~1 hour per signed URL,
so plan on Supabase Pro bandwidth before turning clips on.
Uploads stay off until `NEXT_PUBLIC_EVENT_CLIPS=1` is set in Vercel (and
redeployed): it shows the editor's clip field and the admin queue's clip
row, and the server refuses new uploads (503) without it, whatever a
browser sends. Existing clips still play, and can be re-described or
removed, either way.

### Account invites (optional)

Admins invite people who asked to join, as an organiser or a member, from
`/admin/invites` (`docs/architecture.md`, "Account invites"; migration
`20261108000000_account_invites.sql`). The invite email is ours, sent through
the SMTP settings (§3), so there's **no Supabase template, Site URL or
Redirect URL change**. Don't use the dashboard's **Invite user** button: its
link wouldn't land in this app.

When the invitee presses "Create account", the server asks Supabase Auth for
a sign-up token for the invited address there and then. That needs a
dedicated secret key: Project Settings → API Keys → **Create new secret key**,
named `account-invites`, set in Vercel as `SUPABASE_ADMIN_INVITE_KEY`
(server-only, never `NEXT_PUBLIC_`) for **Production only**, then redeploy.
Be clear about what it is: Supabase secret keys can't be scoped, so this is a
**full secret key with service-role powers** over the whole project: the Data
API without RLS (every table), Supabase Auth admin (including setting
`app_metadata.role = "admin"` on any account) and every Storage bucket. The
app only uses it for that one call, through `lib/server/auth-admin.ts`; being
a separate key means it can be revoked alone, nothing more. Revoke it at once
if it may have leaked. Without it, creating and resending invites answer 503,
and anyone holding an invite already sent signs up the ordinary way (with a
code), or resets the password if their address already has an unconfirmed
account, and accepts it from the same page.

Before minting the sign-up token, the server **deletes any unconfirmed
account** someone registered with the invited address (one that was never
confirmed and has never signed in), so the invitee always gets an account
without a password someone else may know. The passwordless account an
earlier "Create account" made (in another tab, say) is kept and reused, not
deleted. A confirmed account is never deleted.

Smoke-test on the **test** project before relying on it (these Supabase
behaviours aren't covered by the automated tests):

1. Invite a fresh address you can read on a phone, as an organiser. Open the
   email, Create account with a password: you land on the dashboard as an
   approved organiser, and the admin's organiser queue shows it with "Joined
   by invite".
2. Invite an address that already has an account: the page says to sign in;
   after signing in, accept.
3. From the invite page, continue with Google instead: you come back signed
   in and can accept.
4. An expired invite (or set `expires_at` in the past in SQL) and a revoked
   one: the page says so.
5. Sign up through the ordinary form with a fresh address and don't
   confirm it; invite that address and press Create account: the
   unconfirmed account is replaced (a new user id in Authentication →
   Users), and the old password doesn't sign in afterwards.
6. Without the key (a Preview deployment, which doesn't have
   `SUPABASE_ADMIN_INVITE_KEY`, or a local run without it): sign up through
   the ordinary form with a fresh address and don't confirm it; invite that
   address. The invite page sends you to reset the password: reset it with
   the code Supabase emails, sign in with the new password, and accept. The
   account should show as confirmed in Authentication → Users, and the first
   password shouldn't sign in. If no code arrives, or the account stays
   unconfirmed, the fallback doesn't work (`docs/architecture.md`,
   "Unverified Supabase behaviour").
7. Invite a fresh address and open the link in two tabs; press Create
   account in both. Authentication → Users shows one account for the
   address (the same user id both times, none deleted); finish in the tab
   pressed last. If the other tab's code is refused, pressing Create account
   there again works.
8. Note whether Supabase answers "already exists" for a confirmed address,
   reuses an unconfirmed one, and whether the account shows as confirmed
   after the token is verified (`docs/architecture.md`, "Accepted risks
   (account invites)"). Delete any unconfirmed accounts an abandoned test
   left in Authentication → Users.

## 2. Stripe (Connect)

1. In the Stripe dashboard, stay in **test mode** and enable **Connect**. Use
   the platform profile "marketplace", with **Express** accounts, based in
   Australia.
2. Developers → API keys:
   - Secret key (`sk_test_…`) → `STRIPE_SECRET_KEY`.
   - Publishable key (`pk_test_…`) → `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`.
     The payment page (`/checkout/pay`) mounts Stripe's embedded checkout
     form with it. It must come from the **same account and mode** as the
     secret key (`pk_test_` with `sk_test_`, `pk_live_` with `sk_live_`):
     if it's missing or the modes differ, every paid checkout is refused
     with a 503 ("Card payments aren't available right now.") and the
     server log says which variable is wrong (never the key). Free tickets
     still work. It's public by design (it ends up in the browser), but it's
     baked in at build time, so redeploy after changing it.
3. Developers → Webhooks → Add endpoint:
   - URL: `https://<your-domain>/api/stripe/webhook`
   - Events: `checkout.session.completed`,
     `checkout.session.async_payment_succeeded`,
     `checkout.session.async_payment_failed`, `checkout.session.expired`,
     `refund.updated`, `refund.failed`, `charge.refunded`,
     `charge.refund.updated`
   - Its signing secret (`whsec_…`) → `STRIPE_WEBHOOK_SECRET`

   For local testing: `stripe listen --forward-to localhost:3000/api/stripe/webhook`
   prints a temporary signing secret to use instead.
4. **Branding** (Settings → Branding; no code): the embedded form follows
   it. Background `#ffffff`, brand and accent colour `#000000` (a black
   button with a white label), shapes "Rounded" (not Pill), the plainest
   font on offer (Instrument Sans isn't one), and the Sheltüh U mark on
   white as the icon (`docs/design/checkout-pay.md` §2). Test and live mode
   may each need it set; check both.
5. **Payment methods, wallets and Link** (no code: the Checkout Sessions
   never send `payment_method_types`, so these Dashboard settings apply).
   - Settings → Payment methods (the platform's default configuration):
     **on**: Cards, Apple Pay, Google Pay, Link. **Off**: Afterpay/Clearpay,
     Klarna, Zip, PayPal and other buy-now-pay-later or redirect methods
     (`docs/FEATURE_PLAN.md`: not without repricing). Redirect-based ones
     would send the buyer away and back to `/checkout/success`.
   - Settings → Adaptive Pricing: **off**. The code pins it off on every
     session anyway (`adaptive_pricing: { enabled: false }`), so buyers pay
     exactly the A$ total the site shows; keep the Dashboard matching.
   - **Payment method domains** (Settings → Payment methods → Payment method
     domains): register every domain that serves `/checkout/pay`:
     `app.sheltuh.com.au` (live, and test if you test there), a stable
     preview domain such as `preview.sheltuh.com.au` (test), and
     `sheltuh.com.au` if the app moves there. Stripe shows Apple Pay, Google
     Pay and Link in the embedded form only where the domain is registered
     and that method is `active`. Per-deployment `*.vercel.app` URLs can't
     be registered ahead of time, so they show cards only.
   - Or use the script. It reads `STRIPE_DOMAINS_KEY`, else
     `STRIPE_SECRET_KEY` (e.g. from `.env.local`), and never prints the key.
     Best is a **restricted key** (Developers → API keys → Create restricted
     key) with write access to payment method domains only (the
     permission's exact name in the Dashboard is unverified), made for this
     run and deleted afterwards. Keep it out of shell history, e.g.
     `read -rs STRIPE_DOMAINS_KEY && export STRIPE_DOMAINS_KEY`, and never
     add it to Vercel.

     ```sh
     npm run payment-domains -- app.sheltuh.com.au preview.sheltuh.com.au             # check (default; changes nothing)
     npm run payment-domains -- --register app.sheltuh.com.au preview.sheltuh.com.au  # create, re-enable, validate
     ```

     Hostnames only (no `https://`, path or port). `--register` creates a
     missing domain enabled, re-enables a disabled one, and asks Stripe to
     validate it when Apple Pay, Google Pay or Link isn't active. Each run
     prints the key's mode, every domain's `livemode`, whether it's enabled,
     and each method's status with Stripe's error message, and exits
     non-zero unless every domain is enabled with all three `active`. If one
     stays inactive, follow the error message, then run `--register` again.
   - **Unverified** (none of this has been tried against Stripe): whether one
     registration covers both modes (run the script with a test key and
     again with a live key); whether Apple Pay still asks for the
     `/.well-known/apple-developer-merchantid-domain-association` file (if
     its error message does, it goes in `public/.well-known/`); that Connect
     destination charges use the platform's settings here. Check in test
     mode on real devices over HTTPS: `docs/architecture.md`, "Owner sandbox
     checklist", items 11–13.
6. Repeat steps 2–5 in live mode when you're ready to take real money.
   Live mode uses different keys and a different webhook secret, and the
   publishable key changes with the secret key.

**`charge.refunded` is required in both test and live mode.** Test-mode and
live-mode endpoints are configured separately, so check the event list on
each. An endpoint created before this event was handled must have it added
(Developers → Webhooks → the endpoint → Update details → Select events).
Without it, a refund made in the Stripe dashboard leaves the order `paid`
and its tickets valid.

**Payment exceptions.** Anything about a payment that needs a person is
recorded in `private.payment_exceptions` and listed by
`GET /api/admin/payment-exceptions` (admin; `?status=resolved` for closed
ones): a refund Stripe reports `failed`, `canceled` or `requires_action`
(`urgent` when its order was already voided: the buyer has neither tickets
nor their money), a partial refund, an automatic refund the app couldn't
request, or a payment whose amount or currency wasn't the order's
(`amount_mismatch`, below: always `urgent`; its payment is refunded
automatically as it opens). Details include the order's total and its
Support Sheltüh amount (`supportCents`), for splitting a refund. Each new one emails an ops alert to `OPS_ALERT_EMAIL` (at most 20 a
day; unset: logged only). Nothing is restored or refunded again because of
an exception: refund again in the Stripe dashboard if needed, then close it
with `POST /api/admin/payment-exceptions/{exceptionId}/resolve {"note": "…"}`.
A refund that later succeeds closes its exception by itself.

**Refunding a paid order.** Refund it from the Stripe dashboard (Payments →
the payment → Refund). Every Sheltüh payment is a destination charge with an
application fee of `application_fee_cents + support_cents` (the booking fee
plus any Support Sheltüh, which is Sheltüh's alone). Stripe transfers the
**whole** charge (`total_cents`) to the organiser's account (the transfer
object shows `total_cents`), then collects the application fee back from it
(an application fee object of `application_fee_cents + support_cents`). The
organiser's **net** is therefore `total_cents − application_fee_cents −
support_cents` (`organiser_net_cents` below): what they keep, and the most
that's ever theirs to give back. The refund form's two options decide who
pays the buyer back; the app doesn't. Look the order up first (its payment
intent is on the payment's page in Stripe):

```sql
select id, status, total_cents, application_fee_cents, support_cents,
       total_cents - application_fee_cents - support_cents as organiser_net_cents,
       total_cents - support_cents as tickets_refund_cents,
       amount_refunded_cents, stripe_payment_intent_id, created_at
from orders where stripe_payment_intent_id = 'pi_…';
```

- **Full refund** (the whole order, support included): refund the full
  amount and tick **both** "reverse transfer" and "refund application
  fee". The transfer (`total_cents`) is reversed and the application fee
  refunded to the organiser's account, so the organiser gives back their
  net and Sheltüh its booking fee and the support. This is what the app's
  own automatic refunds do. The order becomes `refunded` (tickets void,
  stock back on sale).
- **Support only** (the buyer wants their Support Sheltüh back, tickets
  kept): refund exactly `support_cents` with **neither** box ticked.
  Sheltüh's balance pays it (it collected the support in the application
  fee); the organiser's net is untouched. The order stays `paid` and a
  `partial_refund` exception opens: resolve it with a note. **Exception:**
  when `support_cents ≥ tickets_refund_cents` (the support is at least the
  tickets' price and fees), the app can't tell this refund from a
  tickets-only one by its amount, and voids the tickets (below). For such
  an order, don't refund only the support without the buyer agreeing to
  lose the tickets.
- **Tickets only** (keep the support): the buyer gets
  `tickets_refund_cents` (`total_cents − support_cents`). Stripe reverses
  the transfer and refunds the application fee *in proportion* to the
  amount refunded when the boxes are ticked, which would give part of the
  support back to the organiser's account too, so split it by hand: refund
  `tickets_refund_cents` with **neither** box ticked (Sheltüh's balance pays
  it), then reverse the transfer by exactly `organiser_net_cents` (Connect →
  Transfers → the transfer → Reverse, partial amount; the transfer shows
  `total_cents`, of which the organiser kept only their net). Net: the
  organiser gives back everything they kept, Sheltüh gives back the booking
  fee (`application_fee_cents`) and keeps the support. Don't also refund the
  application fee: that would send the support to the organiser. Check the
  amounts in test mode first. **The app voids the tickets**: once at least
  `tickets_refund_cents` has been refunded on an order with support,
  `charge.refunded` marks the order `refunded` (tickets void, stock back on
  sale, a seated order's seats freed) even though Stripe still shows the
  support unrefunded, and logs `Order #…'s tickets were refunded in Stripe
  (Support Sheltüh kept) …`. No exception opens (an open `partial_refund`
  one is resolved automatically, with `supportKeptCents` in its details).
  The order's `amount_refunded_cents` stays below its `total_cents`: the
  difference is the support kept. Refunding the support later changes
  nothing in the app (the order is already voided, and its
  `amount_refunded_cents` isn't updated).
- **Lost dispute (chargeback)**: Stripe takes the disputed amount (and its
  dispute fee) from Sheltüh's balance, and nothing is automatic (the order
  stays `paid`). To recover the organiser's share, reverse their transfer by
  at most `organiser_net_cents` (`total_cents − application_fee_cents −
  support_cents`): never the whole transfer, since the booking fee and the
  support were collected back as the application fee and were never theirs.

A **full** refund (or, for an order with support, a refund of at least
`total_cents − support_cents`: the tickets-only recipe above) marks the
order `refunded`: its tickets are void (the confirmation page no longer
shows them, and they no longer check in) and they go back on sale. Any
other **partial** refund is only recorded: the order stays `paid` and its
tickets stay valid, the server logs `Order #… was partly refunded in Stripe
… Review it manually.` and a `partial_refund` payment exception is opened
(its details and ops alert include `supportCents`). Refunding the rest (or,
with support, the rest of the tickets' amount) voids the whole order (and
closes the exception). A refund made before the
order's payment webhook was processed (only if that webhook failed and is
waiting for Stripe's retry) is held until the payment arrives: in full, the
order becomes `refunded` with no tickets ever issued; in part, the tickets
are issued and the exception opened. Disputes aren't handled automatically
(docs/architecture.md, "Refunds made in Stripe"). Partly refunded orders:

```sql
select id, total_cents, application_fee_cents, support_cents, amount_refunded_cents, created_at
from orders where status = 'paid' and amount_refunded_cents > 0;
```

Tickets refunded with the support kept (voided by the tickets-only rule):

```sql
select id, total_cents, support_cents, amount_refunded_cents,
       total_cents - amount_refunded_cents as support_kept_cents, created_at
from orders where status = 'refunded' and amount_refunded_cents > 0 and amount_refunded_cents < total_cents;
```

**Payment amount mismatch** (`amount_mismatch` exception, "URGENT: …
Payment amount mismatch" ops alert): Stripe reported a paid session whose
amount or currency isn't the order's total in AUD. The app issues no
tickets, marks the order `failed` (a seated order's held seats are freed;
a general admission order never held stock), records the payment intent on
it, and refunds the payment in full automatically, exactly as for a payment
to a failed order: no amount (the whole charge), "reverse transfer" and
"refund application fee", metadata `reason: amount_mismatch`, idempotency
key `failed-order-refund-<order id>`, so Stripe's redeliveries refund at
most once. A refund call that errors answers 500 and Stripe's redelivery
asks again with the same parameters. The refund's own `charge.refunded`
finds the failed order and changes nothing (it's never held as a refund
"before its payment was recorded"). What's left for a person: check in
Stripe that the refund succeeded (a refund that fails opens its own
`refund_not_completed` exception), work out why the amounts differed (the
session is built from the stored order, so it shouldn't happen: a changed
Stripe setting such as Adaptive Pricing, or a bug), then resolve the
exception with a note. Mismatched orders:

```sql
select o.id, o.status, o.total_cents, o.support_cents, o.stripe_payment_intent_id, o.stripe_refund_id,
       e.status as exception_status, e.details
from private.payment_exceptions e join orders o on o.id = e.order_id
where e.kind = 'amount_mismatch' order by e.created_at desc;
```

An order with no payment intent on the session can't be refunded
automatically: a `manual_refund_required` exception opens beside the
`amount_mismatch` one; refund it in the dashboard (both boxes ticked).

**Testing refunds in test mode.** Buy a ticket with `4242 4242 4242 4242`
and wait for the confirmation page to show the ticket codes. Then:

- Partial: refund part of it in the dashboard (less than
  `total_cents − support_cents`). The order stays `paid`
  (`select status, amount_refunded_cents from orders where id = '<order id>'`)
  and the page still shows the tickets.
- Full: refund the rest (or a fresh order in full). The order becomes
  `refunded`, the page shows no ticket codes, and the ticket type's
  `quantity_sold` goes down by the order's quantity.
- Tickets only: buy with Support Sheltüh (e.g. A$5), then follow the
  tickets-only recipe above. Check in Stripe that the transfer object shows
  the order's `total_cents`, the application fee object
  `application_fee_cents + support_cents`, and after the partial reversal
  the organiser's account is back to zero for this payment while Sheltüh's
  balance is up by `support_cents`. In the app the order becomes `refunded`
  with `amount_refunded_cents = total_cents − support_cents`, and the page
  shows no ticket codes.
- With the Stripe CLI forwarding to a local server, `stripe trigger
  charge.refunded` sends a refund for a payment the app doesn't know: it's
  acknowledged (200) and logged as having no order, and nothing changes.
- Stripe → Developers → Webhooks → the endpoint shows each delivery and our
  response; "Resend" redelivers one, which changes nothing the second time.

**Orders that can't be fulfilled are refunded automatically.** This covers
two buyers paying for the last ticket within seconds of each other (the
database guarantees only one gets it), or an admin unpublishing an event
while a buyer is still on the payment page. The buyer is refunded in
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

Once you've refunded one of these by hand in the Stripe dashboard, mark it
refunded yourself: a dashboard refund can't be matched to the automatic one
(`charge.refunded` only changes `paid` orders), and these orders never took
any tickets, so nothing else needs undoing:

```sql
update orders set status = 'refunded'
where id = '<order id>' and status = 'oversold_refund_required';
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

Workspace allows about 2,000 messages a day, which is plenty for launch (it's
shared with free-ticket confirmation emails, which are capped at 60 an hour
and 400 a day so most of it stays for ticket emails). If SMTP isn't set, paid
orders still work and tickets still show on the confirmation page; each
ticket email is retried on the schedule below and then shows as failed. But
guests can't book free tickets without SMTP: the confirmation link can't be
sent, so every guest free booking is refused with a 503 ("We couldn't send
the confirmation email just now"). Members booking with their own verified
email still get theirs.

**Retries.** Every ticket email goes through an outbox: it's tried straight
after the order is paid, and if that fails, again by whatever calls
`GET /api/cron/email-outbox` (1 min, 5 min, 30 min, 2 h and 6 h after each
failure, ±20%; after the 6th it's marked failed and waits for an admin
resend). Those delays are the *earliest* a retry can run. It actually runs on
the next call of the cron route, so how often something calls it decides how
soon a buyer gets their tickets after a failed send:

| Runner | 2nd attempt | 3rd attempt | 6th (last) attempt |
| --- | --- | --- | --- |
| every 5 minutes (Supabase Cron on Hobby, or Vercel Cron on Pro) | within about 6 min | within about 17 min | 7 to 11 hours after the first failure |
| daily Vercel Cron only (Hobby, nothing else set up) | up to about 24 hours | at the next day's run | 4 to 5 days later |

Set it up once:

1. Generate a secret (`openssl rand -hex 32`) and add it to Vercel as
   `CRON_SECRET` (Production), then redeploy. Without it the cron route
   refuses every request and nothing is retried.
2. `vercel.json` schedules `GET /api/cron/email-outbox` once a day
   (17:00 UTC, early morning in Melbourne), because the project is on the
   Hobby plan, which refuses deployments with more frequent crons. Vercel
   sends the secret as a bearer token. Keep it: it's the backstop.
3. **On Hobby, add the 5-minute runner in Supabase** (below). **On Pro**,
   use Vercel instead (see "Switching to Vercel Pro").
4. Check it: as an admin, `GET /api/admin/emails/health` (counts only, see
   below), and Vercel → Project → Settings → Cron Jobs for the daily run.

#### The 5-minute runner on Hobby (Supabase Cron + pg_net)

Supabase Cron (`pg_cron`) calls the route every 5 minutes through `pg_net`,
with the secret kept in Supabase Vault. Nothing in the migrations schedules
this: it only exists once you run the steps below, and you can pause or
remove it at any time.

> **Check in the Supabase docs at setup:** the exact signatures of
> `vault.create_secret`, `vault.update_secret`, `vault.decrypted_secrets`,
> `net.http_get` (its `timeout_milliseconds` parameter) and
> `net._http_response`, and `cron.alter_job`. They're written here as
> Supabase documents them at the time of writing, but nothing in this repo
> (or its dependencies) can confirm them.

1. **Enable the extensions:** Database → Extensions → `pg_net` on (Cron
   should already be on for the retention jobs; if not, Integrations →
   **Cron**).
2. **Check `pg_net` is closed to clients** before anything is queued
   through it (its request queue briefly holds the bearer token):

   ```sql
   -- Neither client role may read pg_net's request queue or its responses (expect every can_read false):
   select r.rolname, t.tbl, has_table_privilege(r.rolname, t.tbl, 'select') as can_read
     from (values ('anon'), ('authenticated')) r(rolname),
          (values ('net.http_request_queue'), ('net._http_response')) t(tbl);
   -- Nor use the schema at all (expect both false):
   select r.rolname, has_schema_privilege(r.rolname, 'net', 'usage') as can_use
     from (values ('anon'), ('authenticated')) r(rolname);
   ```

   Then Project Settings → **Data API** → *Exposed schemas*: only `public`
   (and Supabase's `graphql_public`), never `net`, `vault` or `cron`. If any
   check fails, stop and close it before step 3 (check the Supabase docs for
   pg_net's grants at setup; for example `revoke usage on schema net from
   anon, authenticated;` and `revoke all on all tables in schema net from
   anon, authenticated;`), then run the checks again. Run them again after
   any Supabase upgrade of `pg_net`.
3. **Store the secret and the URL in Vault.** Prefer the dashboard
   (Integrations → **Vault** → Add new secret), so the value never appears
   in an SQL statement: name `sheltuh_cron_secret`, value the same string as
   Vercel's `CRON_SECRET`; and `sheltuh_email_outbox_url`, value
   `https://YOUR-PRODUCTION-DOMAIN/api/cron/email-outbox` (the production
   domain, never a preview URL: previews are behind Vercel's login). The SQL
   equivalent, if you must (the value then sits in the SQL editor's
   history, so clear that snippet afterwards):

   ```sql
   -- Check in the Supabase docs at setup: vault.create_secret(secret, name, description).
   select vault.create_secret('PASTE-CRON-SECRET', 'sheltuh_cron_secret', 'Bearer for /api/cron/email-outbox');
   select vault.create_secret('https://YOUR-PRODUCTION-DOMAIN/api/cron/email-outbox', 'sheltuh_email_outbox_url',
                              'Email outbox cron route');
   ```

4. **Schedule the job** (SQL editor). The command reads both values from
   Vault each time it runs, so the job's stored text holds no secret:

   ```sql
   -- Check in the Supabase docs at setup: net.http_get(url, params, headers, timeout_milliseconds).
   select cron.schedule(
     'email-outbox-retry',
     '*/5 * * * *',
     $$
     select net.http_get(
       url := (select decrypted_secret from vault.decrypted_secrets where name = 'sheltuh_email_outbox_url'),
       headers := jsonb_build_object(
         'Authorization',
         'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'sheltuh_cron_secret')
       ),
       timeout_milliseconds := 60000
     );
     $$
   );
   ```

   It's a `GET`, like Vercel's own call: the route has no `POST`. The
   60-second timeout matches the route's `maxDuration`; a run stops taking
   new emails after 30 seconds.

5. **Check it's working**, after 5 to 10 minutes:

   ```sql
   -- The job ran (this only shows the request was queued, not its answer):
   select j.jobname, d.status, d.start_time from cron.job_run_details d join cron.job j using (jobid)
    where j.jobname = 'email-outbox-retry' order by d.start_time desc limit 5;
   -- The route's answer (pg_net keeps these for a few hours; check the table name at setup):
   select status_code, timed_out, error_msg, created from net._http_response order by created desc limit 5;
   ```

   `200` with `{"claimed":…}` is right. `401` means the Vault secret doesn't
   match Vercel's `CRON_SECRET`. Then `GET /api/admin/emails/health` as an
   admin: `lastCronRun.finishedAt` should never be more than about 10 minutes
   old, and `totals.overdue` should be 0.

6. **Pause, resume or remove:**

   ```sql
   -- Pause / resume (check cron.alter_job's parameters at setup):
   select cron.alter_job((select jobid from cron.job where jobname = 'email-outbox-retry'), active := false);
   select cron.alter_job((select jobid from cron.job where jobname = 'email-outbox-retry'), active := true);
   -- Remove for good (and then, if nothing else uses them, delete the two Vault secrets in the dashboard):
   select cron.unschedule('email-outbox-retry');
   ```

**Security.**

- The secret lives in Vault (encrypted at rest) and in Vercel's environment,
  nowhere else: not in the job's text, not in a migration, not in the repo.
  Creating it through the dashboard keeps it out of SQL history. While a
  request is queued, `pg_net` holds its headers (the bearer token included)
  in its own request queue table (`net.http_request_queue`) for a moment;
  like Vault, that's readable only by the database's privileged roles, never
  by the Data API, as long as step 2's checks pass.
- The route only sends emails that are already due and returns counts. A
  leaked secret lets someone call it more often, which at worst sends due
  emails sooner; it can't read data or send anything new. Rotate it anyway
  if you suspect a leak.
- **Rotation:** generate a new value; set it as `CRON_SECRET` in Vercel and
  redeploy; then update Vault straight away (dashboard, or
  `select vault.update_secret((select id from vault.secrets where name = 'sheltuh_cron_secret'), 'NEW-VALUE');`,
  checking the signature at setup). Calls between the two steps get a `401`
  and simply retry 5 minutes later; nothing is lost.
- **Two runs at once** (the 5-minute job and the daily Vercel run, or a run
  that overlaps the next) are safe: each email is leased to one run at a
  time (`for update skip locked`, a 2-minute lease), so it's never sent
  twice by two runs. Delivery is still at-least-once: a run killed between
  the mail server accepting an email and recording it sends that one again
  once its lease expires.

#### Switching to Vercel Pro

**Upgrading the Vercel plan does not change the schedule by itself.** Cron
schedules come from `vercel.json`, which stays Hobby-compatible (daily) until
you edit it and redeploy:

1. Edit `vercel.json` (trending as in "Trending" below):

   ```json
   {
     "$schema": "https://openapi.vercel.sh/vercel.json",
     "crons": [
       { "path": "/api/cron/email-outbox", "schedule": "*/5 * * * *" },
       { "path": "/api/cron/trending", "schedule": "*/15 * * * *" }
     ]
   }
   ```

2. Commit, deploy, and check Vercel → Project → Settings → Cron Jobs shows
   every 5 minutes.
3. Then remove the Supabase job (`select cron.unschedule('email-outbox-retry');`)
   and its two Vault secrets, and the `refresh-trending` job if you made one.
   Running both for a while is harmless (see "Two runs at once").

#### Is it working? (`GET /api/admin/emails/health`)

Admins only; counts and times, never an address or an order. Per kind
(`ticket_email`, `waitlist_available`, `organiser_new_events`, `ops_alert`)
and in total: `due`, `overdue` (due for more than 15 minutes, or leased by a
run that died that long ago: no run has picked it up), `oldestOverdueSeconds`,
`waiting` (a retry scheduled for later), `sending`, `expiredLeases`, `failed`
(the dead letters, to resend from `/admin/emails`) and `failedLast7Days`;
plus `lastCronRun` (when the cron route last finished a run, from any
scheduler, and its counts) and `cronSecretConfigured`. With only the daily
Vercel run, every pending retry shows as overdue until that day's run: that's
the gap the 5-minute runner closes. From SQL:

```sql
select * from private.email_outbox_health('15 minutes');
select * from private.cron_runs;
```

**Trending.** `vercel.json` also runs `GET /api/cron/trending` once a day
(17:20 UTC), with the same `CRON_SECRET`: it rebuilds the home page's
Trending list (`private.refresh_trending()`, docs/architecture.md,
"Trending"). Daily is a Hobby-plan limit, not a design choice: **on Pro, set
its schedule to every 15 minutes (`*/15 * * * *`)**. On Hobby you can refresh
more often from Supabase Cron instead (the function needs no secret: it only
reads and rewrites the snapshot):

```sql
select cron.schedule('refresh-trending', '*/15 * * * *', $$select private.refresh_trending()$$);
```

It's safe to run by hand at any time and returns `eligible` and `ranked`
counts. Until it has run once, Trending is empty and the home page hides the
section. To curate (boost or exclude an event), use
`PUT /api/admin/events/{id}/curation` rather than SQL, so the change is logged.

Failed emails are listed at `/admin/emails`, by order reference and masked
address, with a **Resend now** button. Delivery is at-least-once, so a buyer
can occasionally get the same email twice. From SQL:

```sql
select j.id, j.status, j.attempts, j.last_error, j.next_attempt_at, o.event_title
from private.email_outbox j join orders o on o.id = j.order_id
where j.status in ('failed', 'pending') order by j.created_at desc;
```

## 4. Vercel

1. Import the GitHub repo into Vercel. It detects Next.js with no extra
   config.
2. Settings → Environment Variables: add everything in `.env.example`
   **except** `SUPABASE_SECRET_KEY` and `STRIPE_DOMAINS_KEY` (local scripts
   only). Set `NEXT_PUBLIC_SITE_URL` to the
   production domain. `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` goes in each
   environment with the matching secret key: Production the live pair
   (`pk_live_…` with `sk_live_…`), Preview the test pair (`pk_test_…` with
   `sk_test_…`).
3. Settings → Functions → Region: **Sydney (syd1)**, next to the database.
   `vercel.json` pins it (`"regions": ["syd1"]`); check the dashboard shows
   the same after the first deploy. Also check **Fluid compute** is on
   (Settings → Functions): an instance then serves many requests at once
   and shares its 5 database connections between them.
4. Point a domain at it. The live landing page on `sheltuh.com.au` stays on
   Cloudflare Workers until you decide to swap it. A subdomain such as
   `app.sheltuh.com.au` avoids touching it for now.

`SUPABASE_CLIP_STORAGE_KEY` and `SUPABASE_ADMIN_INVITE_KEY` are full
Supabase secret keys: **Production only** (§1, "Event clips" and "Account
invites").

`NEXT_PUBLIC_*` values are baked in at build time, so redeploy after
changing them. `NEXT_PUBLIC_AUTH_PROVIDERS` (Google and Apple sign-in) goes in
**Production only**, once the providers are set up (§1, "Sign in with Google
and Apple").

## 5. Smoke test (test mode)

1. Sign up, then verify with the emailed code.
2. Apply as an organiser. As admin, approve the application at
   `/admin/organisers`.
3. As the organiser, set up payouts at `/dashboard/payouts`. Stripe's test
   onboarding accepts dummy details.
4. Create an event with a free ticket and a paid ticket, and submit it.
   Approve it at `/admin/events`.
5. Signed out, open the event:
   - Get the free ticket (it asks for an email). Signed out, a "confirm your
     free tickets" email arrives; open its link, press Confirm, and the
     tickets are issued and the ticket email arrives. Signed in with the
     same email, the tickets are issued straight away.
   - Buy the paid ticket with card `4242 4242 4242 4242` in the payment
     form on `/checkout/pay`. The confirmation page shows ticket codes once
     Stripe's webhook arrives, usually within seconds. The fuller test-mode
     run (declines, 3D Secure, duplicate webhooks, sold out, seat expiry) is
     the "Owner sandbox checklist (embedded checkout)" in
     `docs/architecture.md`.
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
