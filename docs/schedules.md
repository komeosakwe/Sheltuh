# Schedules

Everything that runs on a timer, where it's configured, and what to change
to run it more often. Linked from [`DEPLOYMENT.md`](DEPLOYMENT.md).

All cron expressions here are in **UTC**: Vercel Cron and Supabase Cron
(`pg_cron`, whose `cron.timezone` defaults to GMT) both read them that way.
Melbourne is UTC+11 in daylight time (AEDT, early October to early April) and
UTC+10 otherwise (AEST), so each job runs an hour earlier in Melbourne's
winter than in its summer. The conversions below were checked with
`Intl.DateTimeFormat` for `Australia/Melbourne` on a January and a July date.

## What runs today

### Vercel Cron (`vercel.json`)

| Job | Schedule (UTC) | Melbourne, AEDT | Melbourne, AEST | What it does |
| --- | --- | --- | --- | --- |
| `GET /api/cron/email-outbox` | `0 21 * * *` (daily 21:00) | 8:00 am | 7:00 am | Sends due outbox emails: retries of failed ticket emails, waitlist emails and follower emails that weren't sent straight after the request that queued them, follower emails held back by the one-a-day limit, and organisers' messages to ticket holders that weren't sent straight away. First it **queues the day-before event reminders** (`private.queue_event_reminders`): each run queues a reminder for every ticket holder of an event that starts today (3 hours or more away) or tomorrow in its own time zone, once per person per event. |
| `GET /api/cron/payouts` | `30 21 * * *` (daily 21:30) | 8:30 am | 7:30 am | Sends the organisers' shares that are due, for orders made with `DELAYED_PAYOUTS=1`: 2 days after the event ended (`lib/server/order-transfers.ts`, docs/architecture.md "Delayed payouts"). With nothing due, or the switch off, it does nothing. |

The email outbox's run also rebuilds the home page's Trending snapshot
(`private.refresh_trending()`) and sweeps stale event-clip objects, after it
has queued the reminders and sent its emails. So each day, in UTC: **21:00**
the email run (reminders queued, outbox drained, then Trending refreshed),
**21:30** the payouts run. Trending used to be its own cron,
`GET /api/cron/trending` at `20 17 * * *`; the payouts job took the slot (Hobby allows two crons). The
trending route still works when called with the secret, but nothing schedules it.

Both routes (and `/api/cron/trending`, when called) need `CRON_SECRET` in Vercel; Vercel sends it as
`Authorization: Bearer …`, and without it the routes refuse every call
(`lib/server/cron-auth.ts`). Each run's result shows under Vercel → Project →
Settings → Cron Jobs.

Daily is the Hobby plan's limit, not a design choice. What it costs:

- A ticket email still goes out straight after payment, but if that send
  fails, its retries (designed as 1 min, 5 min, 30 min, 2 h, 6 h,
  `EMAIL_RETRY_DELAYS_SECONDS`) all wait for the next 8 am (7 am) run. A
  buyer whose first email failed can wait up to a day.
- Waitlist and follower emails also go straight after the request that
  queued them, up to 100 per run and within the drain's time budget. The
  rest, and any follower email held back by the one-a-day limit, wait for
  the next daily run.
- Trending is up to a day old (a 5-minute email runner from Supabase Cron
  refreshes it every 5 minutes too).
- **Event reminders go out at the daily run.** An event tomorrow gets its
  reminders at that day's 8 am (7 am) Melbourne run, the morning before; an
  event that is already today at the run (and at least 3 hours away) gets
  one that morning ("Today: …"). Anything booked after the run, or an event
  that starts before the next run, is reminded by the next run or not at
  all. With a 5-minute runner the reminders are queued just after the
  event's local midnight; `EVENT_REMINDER_FROM_HOUR`
  (`lib/server/handlers/email-outbox.ts`, 0 now) holds tomorrow's events
  until a morning hour (say 8) once a frequent runner is in place. An email
  at midnight on the 5-minute runner is the owner's call to make.
- A payout that fails (Stripe unreachable, the platform balance too low) is
  retried by the next daily run, not after the designed 1 hour, 6 hours and
  24 hours; an organiser's share can therefore arrive a day or two after it
  was due. The payout schedule is "2 to 3 days after the event ends": the
  shares become due 48 hours after `ends_at` and the job runs once a day.

### Supabase Cron (`pg_cron`, scheduled by hand)

These are in the database, not the repo: `docs/supabase-setup.md` §1 has the
`cron.schedule(...)` commands. Nothing runs until each one is scheduled.
Check what's scheduled with `select jobname, schedule, active from cron.job;`
and recent runs with
`select * from cron.job_run_details order by start_time desc limit 10;`.

| Job | Schedule (UTC) | Melbourne, AEDT | Melbourne, AEST | What it does |
| --- | --- | --- | --- | --- |
| `purge-social-data` | `17 3 * * *` (daily 03:17) | 2:17 pm | 1:17 pm | `private.purge_social_data()`: Who's Going opt-ins 30 days after the event, old conversations and resolved reports, stale rate-limit counters. |
| `purge-analytics` | `27 3 * * *` (daily 03:27) | 2:27 pm | 1:27 pm | `private.purge_analytics()`: view counters after 25 months, idle view rate limits, check-in records 25 months after the event. |
| `purge-operational-data` | `37 3 * * *` (daily 03:37) | 2:37 pm | 1:37 pm | `private.purge_operational_data()`: expired unconfirmed guest free orders, idle platform counters, old refusal counts, old outbox jobs, idle per-client counters, account invites 90 days after they were accepted, revoked or expired, early refunds and refund status marks after 35 days, checkout attempts after 2 days, resolved payment exceptions after 2 years (open ones never). |
| `email-outbox-retry` (Hobby) | `*/5 * * * *` | every 5 min | every 5 min | Calls `GET /api/cron/email-outbox` through `pg_net`, so failed emails are retried within minutes instead of a day: `docs/supabase-setup.md` §3, "The 5-minute runner on Hobby". |
| `refresh-trending` (optional) | `*/15 * * * *` | every 15 min | every 15 min | `private.refresh_trending()`, only if you chose to run it from the database (below). |

The owner reported scheduling one retention job (job id 1); which one, and
whether the other two exist, isn't recorded in this repo. Check with the
query above.

## Running the Vercel jobs more often

### Option 1: Vercel Pro

Pro allows sub-daily crons. **Upgrading the plan alone changes nothing**:
the schedules live in `vercel.json`, so edit it and redeploy, for example:

```json
{ "path": "/api/cron/email-outbox", "schedule": "*/5 * * * *" },
{ "path": "/api/cron/payouts", "schedule": "30 * * * *" }
```

Then check the new schedules under Settings → Cron Jobs after the deploy.
(Don't deploy these schedules on Hobby: the repo's notes record that Hobby
refuses deployments with more frequent crons.)

### Option 2: stay on Hobby, schedule from Supabase

- **Payouts: call the endpoint with `pg_net`**, as for the email outbox
  (below), with the route `/api/cron/payouts` and the same Vault secret, for
  example every hour (`30 * * * *`), so a retry doesn't wait a day. The job is
  safe to call as often as you like: with nothing due it is one indexed claim,
  and two runs at once never send an order twice.
- **Trending: call the function directly.** Already described in
  `docs/supabase-setup.md` §3:
  `select cron.schedule('refresh-trending', '*/15 * * * *', $$select private.refresh_trending()$$);`
  No HTTP and no secret: it only reads and rewrites the snapshot.
  Concurrent refreshes are serialised by an advisory lock, so the daily
  Vercel run overlapping it does no harm.
- **Email outbox: call the endpoint with `pg_net`.** The sending happens in
  the app (SMTP), so the database has to call the route, with the same
  `CRON_SECRET`. The runbook is `docs/supabase-setup.md` §3, "The 5-minute
  runner on Hobby": job `email-outbox-retry` every 5 minutes, the secret and
  the route's URL in Supabase Vault (never in the job's command text, which
  `cron.job` stores in plain text), the checks that `anon` and
  `authenticated` can't read `pg_net`'s tables, how to pause, rotate and
  remove it. `pg_net` is asynchronous: the job only queues the request, and
  the outcome is in `net._http_response` (kept briefly) or Vercel's function
  logs. Whether it's working shows in `GET /api/admin/emails/health`
  (`lastCronRun`, `totals.overdue`; same section, "Is it working?"). The
  SQL hasn't been run against a Supabase project from this repo: try it on
  the test project first.

### Trade-offs

| | Vercel Pro | Supabase Cron + `pg_net` / direct SQL |
| --- | --- | --- |
| Cost | Pro's per-member monthly fee. Needed anyway once tickets are sold (Hobby is non-commercial). | Nothing extra on the existing Supabase plan. |
| Moving parts | One place (`vercel.json`), versioned with the code, deployed with it. | Schedules live in the database, outside the repo: they have to be recreated by hand for every project (test and live) and documented. |
| Secret | Vercel injects `CRON_SECRET`. | A second copy of `CRON_SECRET` in Supabase Vault, to rotate together with Vercel's. |
| Visibility | Vercel's Cron Jobs page and function logs. | `cron.job_run_details` only says the request was queued; the outcome is in `net._http_response` (kept briefly) or Vercel's logs. |
| Failure modes | Vercel's own. | A wrong URL or secret fails quietly (401 in a table nobody reads). A slow drain can hit `pg_net`'s timeout (the route may still finish). |
| Trending direct SQL | n/a | Simplest of all, no HTTP; uses database CPU every 15 minutes (small at launch volumes). |

Running both at once is safe: the outbox hands out jobs under leases, so two
drains never send the same job concurrently (delivery is at-least-once
either way), and trending refreshes are serialised. When moving to Pro,
unschedule the Supabase jobs that duplicate it
(`select cron.unschedule('email-outbox-retry');`,
`select cron.unschedule('refresh-trending');`) so there's one source of
truth.
