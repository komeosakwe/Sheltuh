# Load tests (k6)

Five k6 scenarios that measure what Sheltüh can take, and check that its rate
limits refuse cleanly. They run against a **staging** deployment: a Vercel
Preview wired to a separate staging Supabase project and Stripe **test** keys.
Never production.

```
tests/load/
  scenarios/browse.js     1. browsing, ramping to 200 visitors
  scenarios/onsale.js     2. on-sale spike, with free claims and (optional) test-mode card checkouts
  scenarios/checkin.js    3. door check-in burst
  scenarios/soak.js       4. 30-minute moderate browse
  scenarios/ratelimit.js  5. rate-limit verification (429s)
  lib/                    shared code: target guard, HTTP client, journeys, thresholds
  seed/                   staging seed (npm run load:seed)
  k6-scripts.test.ts      what can be checked without k6 (npm run load:check)
```

## Safety

- `BASE_URL` defaults to `http://localhost:3000`. A production host
  (`sheltuh.com.au`, `findyoursheltuh.com.au`, or any subdomain of them such
  as `www.` or `preview.`) stops the run before any request. The only
  exception is `ALLOW_PRODUCTION=1` with browse or soak, which then run
  read-only: GET only, no view beacons. Add more hosts to refuse with
  `PRODUCTION_HOSTS=host1,host2` (for example production's `*.vercel.app` alias).
- No scenario ever requests `/api/stripe/webhook` or `/api/cron/*`. The HTTP
  client refuses them.
- The on-sale and door scenarios only touch events the seed made: their
  titles start with `[Load test]`. Anything else stops the run. That also
  catches a Preview that still reads production's database.
- Card checkouts run only with `CHECKOUT=1`, are capped at 5 a second (Stripe
  test mode allows about 25 requests a second; each checkout makes 3), and
  nobody pays: each one is cancelled straight away. A live-mode session
  (`cs_live_…`) aborts the run.
- Tokens, passwords and ticket codes are never logged. Seed output files
  (`*.local.json`) and `results/` are git-ignored. Don't commit `.env.load.local`.

**Important:** Preview deployments share production's Supabase project today
(see `.env.example`). Don't load-test a Preview until its environment
variables point at the staging project (step 2 below).

## 1. Install k6

k6 is a separate program (not an npm package).

- Windows: `winget install k6 --source winget` (or `choco install k6`)
- Mac: `brew install k6`

Check with `k6 version`. Any k6 v1.x works.

## 2. Set up staging (once)

1. **Supabase:** create a second project (Sydney), run every migration in
   order (`docs/DEPLOYMENT.md`, "Supabase"). Leave its SMTP settings at
   Supabase's default and don't schedule its cron jobs, so no email goes out.
2. **Vercel:** make a branch for load testing (for example `loadtest`). In
   Project → Settings → Environment Variables, add **Preview** values scoped to
   that branch only:
   - `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`,
     `DATABASE_URL`: the **staging** project's (transaction pooler, port 6543).
   - `STRIPE_SECRET_KEY` (`sk_test_…`), `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`
     (`pk_test_…`), `STRIPE_WEBHOOK_SECRET` (a test webhook's, or any value:
     it also salts the per-IP rate limits, so it must be set).
   - `NEXT_PUBLIC_SITE_URL`: the branch's Preview URL.
   - **No** `SMTP_*`, `CRON_SECRET`, `OPS_ALERT_EMAIL`, PostHog keys.
     Without SMTP, ticket and welcome emails stay queued and are never sent.
   Push the branch and use its `https://…-git-loadtest-….vercel.app` URL as
   `BASE_URL`.
3. **Deployment Protection:** if Vercel Authentication is on for Previews,
   create a "Protection Bypass for Automation" secret (Project → Settings →
   Deployment Protection) and pass it as `VERCEL_BYPASS_SECRET`. The Vercel
   Firewall may also challenge k6: check its tab if you see 403s or 429s that
   don't come from the app (the rate-limit run reports them as
   `rate_limit_foreign_429`).
4. **Paid checkouts (optional):** sign in on the staging site as the
   load-test organiser (step 3 below creates it), open Dashboard → Payouts and
   finish Stripe's **test-mode** onboarding with Stripe's test data. Then run
   the seed again: it adds the paid event.

## 3. Seed the staging database

Put these in `.env.load.local` at the repo root (git ignores `.env*`):

```
LOAD_SEED_DATABASE_URL=postgresql://postgres.<staging-ref>:<password>@aws-0-ap-southeast-2.pooler.supabase.com:5432/postgres
LOAD_SEED_CONFIRM=<staging-ref>
PRODUCTION_SUPABASE_REF=<production-ref>
LOAD_SUPABASE_URL=https://<staging-ref>.supabase.co
LOAD_SUPABASE_SECRET_KEY=<staging secret key>
LOAD_ORGANISER_PASSWORD=<a password for the organiser account>
LOAD_MEMBER_PASSWORD=<a password for the member accounts>
```

The seed reads only these `LOAD_*` names, never `DATABASE_URL`, so a
production `.env.local` can't be used by mistake. It refuses to run unless
`LOAD_SEED_CONFIRM` names the database it's about to write to, and always
refuses `PRODUCTION_SUPABASE_REF`. Use the staging project's secret key only;
delete it from the file when you're done.

```
npm run load:seed -- --organiser-email loadtest-organiser@example.com --door 1200 --members 25
```

It makes (all titled `[Load test] …`, owned by one approved organiser):

- 60 upcoming events around Melbourne with map pins, half with a photo, every
  8th externally ticketed (`--browse <n>`, `--no-images` for none: cheaper);
- an on-sale event with 50,000 free tickets, and a sell-out event with 20
  (`--scarce <n>`; `--scarce-label <x>` makes a fresh one for another sell-out run);
- a paid A$10 event, once the organiser has test-mode payouts (step 2.4);
- with `--door <n>`: a new door event in progress now with n tickets
  (`--door-label <x>`; a new one each run, so nothing starts checked in);
- with `--members <n>`: n confirmed accounts `loadtest-memberN@example.com`
  (mail to example.com goes nowhere) with `LOAD_MEMBER_PASSWORD`.

It writes `tests/load/seed/seed-output.local.json` (event ids, slugs, door
codes) and `tests/load/seed/members.local.json` (emails only). The scenarios
read both by default. Re-running is safe: events are kept, their dates moved
forward, and the last door event is kept unless you ask for a new one.

The existing `npm run seed-dev-data` loads the demo sample events instead.
They're all in the past now, so the load tests don't use them.

## 4. Run

Start with a smoke run (`-e SMOKE=1`: 2 VUs for under a minute) of each
scenario, then a scaled-down run (`-e LOAD_SCALE=0.25`), then the full one.
Save the summary with `--summary-export`. Commands are the same on Windows
(PowerShell) and Mac; on one line in PowerShell.

```
k6 run -e BASE_URL=https://<preview> -e SMOKE=1 tests/load/scenarios/browse.js

k6 run -e BASE_URL=https://<preview> --summary-export tests/load/results/browse.json tests/load/scenarios/browse.js
k6 run -e BASE_URL=https://<preview> -e CACHE_BUST=1 tests/load/scenarios/browse.js
k6 run -e BASE_URL=https://<preview> -e MEMBER_PASSWORD=… -e SUPABASE_URL=https://<staging-ref>.supabase.co -e SUPABASE_PUBLISHABLE_KEY=sb_publishable_… tests/load/scenarios/onsale.js
k6 run -e BASE_URL=https://<preview> -e ORGANISER_EMAIL=loadtest-organiser@example.com -e ORGANISER_PASSWORD=… -e SUPABASE_URL=… -e SUPABASE_PUBLISHABLE_KEY=… tests/load/scenarios/checkin.js
k6 run -e BASE_URL=https://<preview> tests/load/scenarios/soak.js
k6 run -e BASE_URL=https://<preview> tests/load/scenarios/ratelimit.js
```

Don't run the rate-limit scenario at the same time as the on-sale one: both
use the payment page's per-IP allowance. Pointing at a local `next start`
works for a dry run, except the rate-limit scenario: without Vercel's
`x-forwarded-for` header the per-IP limits are skipped, so nothing is refused.

### Environment variables

| Variable | Used by | Meaning |
|---|---|---|
| `BASE_URL` | all | The staging Preview's origin. Default `http://localhost:3000` |
| `VERCEL_BYPASS_SECRET` | all | Deployment Protection bypass, sent as `x-vercel-protection-bypass` |
| `SMOKE=1` | all | A tiny run to check the setup |
| `LOAD_SCALE` | all | Multiplies VUs and arrival rates (0.1 to 5, default 1) |
| `LATENCY_SLACK` | all | Multiplies every latency threshold (e.g. 1.5 from overseas) |
| `CACHE_BUST=1` | browse, soak, on-sale | Adds a random `_lt` parameter to CDN-shared responses, so the run measures functions and the database, not Vercel's CDN |
| `READ_ONLY=1`, `VIEW_BEACONS=0` | browse, soak, on-sale | No view beacons (`READ_ONLY` also blocks every non-GET) |
| `ALLOW_PRODUCTION=1`, `PRODUCTION_HOSTS` | browse, soak | See Safety |
| `PEAK_VUS` (200), `THINK_MIN` (3), `THINK_MAX` (12), `DISCOVER_PAGES` (4) | browse | Peak visitors, think time in seconds, feed pages read in setup |
| `SOAK_VUS` (50), `SOAK_DURATION` (30m) | soak | |
| `ONSALE_PEAK_RATE` (40) | on-sale | Event page loads a second at the peak |
| `ONSALE_SLUG`, `ONSALE_VIEW=paid`, `ONSALE_PAID_SLUG` | on-sale | Another seeded event to view or buy |
| `CLAIMS=0`, `CLAIMS_PER_MIN` (12), `CLAIM_TARGET` (`main` or `scarce`), `SCARCE_QUANTITY` | on-sale | Free claims by members |
| `MEMBER_PASSWORD`, `MEMBERS_FILE`, `MEMBERS_MAX` (25), `MEMBER_TOKENS_FILE` | on-sale | Member sign-in (or ready-made `[{email, token}]`) |
| `CHECKOUT=1`, `CHECKOUTS_PER_MIN` (6, at most 300) | on-sale | Test-mode card checkouts |
| `ORGANISER_EMAIL` + `ORGANISER_PASSWORD`, or `ORGANISER_TOKEN` | door | The seeded organiser |
| `DOOR_PEAK_RATE` (5/s), `DOOR_BASE_RATE` (1.5/s), `SCANNERS` (3), `DOOR_RESPECT_LIMIT=1` | door | Scan rates; the last keeps under the allowance |
| `DOOR_EVENT_ID`, `DOOR_CODES_FILE` | door | Instead of the seed's door event |
| `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `PRODUCTION_SUPABASE_REF` | on-sale, door | The **staging** project, for sign-in |
| `RL_BURST` (45), `RL_CYCLES` (2), `RL_POLL_SECONDS` (5), `EXPECT_RETRY_AFTER=1` | rate limit | |
| `SEED_FILE`, `ALLOW_UNSEEDED_EVENTS=1` | on-sale, door | Another seed output; a staging event you made yourself |
| `K6_CLOUD_PROJECT_ID` | all | Grafana Cloud project |

File paths in variables are relative to `tests/load/scenarios/`, or absolute.
Supabase access tokens last an hour: long runs need fresh ones.

### Scenarios and thresholds

| Scenario | Load | What it checks |
|---|---|---|
| 1. browse | ramping VUs: 50 over 2 min, 200 over 3 min, 200 for 5 min, down over 2 min. Each visit: a landing page (home, event, /events, search, map), then 2 to 5 more pages, 3 to 12 s apart | Page and API latency per route group, CDN hit ratio |
| 2. on-sale | page loads: 2/s for 1 min, 40/s within 15 s, held 3 min, 10/s, then 0. Member free claims 12/min and test checkouts 6/min during the peak | Hot event page reads, Who's Going count, claims, sell-out without overselling, checkout path, per-IP checkout limits |
| 3. door | scans: up to 5/s in 30 s, 5/s for 90 s, down to 1.5/s for 2.5 min, plus each scanner's 15-second poll | Check-in latency, outcomes, idempotent retries, the 600-per-5-minutes allowance |
| 4. soak | 50 VUs for 30 min | Drift over time, connection build-up |
| 5. rate limit | 1 VU: 45 fast reads, wait out the window, twice | 429 shape, no 5xx, no more than the limit, recovery |

Every scenario fails if: `http_req_failed` ≥ 1% (expected answers, including
429s, don't count), `checks` ≤ 99%, or a route group's latency is over its
target. More than 20% failures for 30 s aborts the run, to stop spending.
p95 / p99 targets (ms):

| Group | p95 | p99 | | Group | p95 | p99 |
|---|---|---|---|---|---|---|
| page (HTML) | 1500 | 3000 | | beacon | 600 | 1500 |
| feed | 600 | 1500 | | seats | 500 | 1200 |
| search | 900 | 2000 | | claim | 1500 | 3000 |
| event | 500 | 1200 | | checkout | 3000 | 6000 |
| going | 500 | 1200 | | payment | 1500 | 3000 |
| image | 1000 | 2500 | | cancel | 2000 | 4000 |
| logo | 800 | 2000 | | checkin | 800 | 2000 |
| profile | 600 | 1500 | | checkin_summary | 800 | 2000 |
| trending | 500 | 1200 | | ratelimit | 600 | 1500 |
| calendar | 800 | 2000 | | | | |

Scenario extras: no more free tickets issued than the scarce event has
(`CLAIM_TARGET=scarce`); no live Stripe session; a retried scan replays its
answer; the rate-limit target never answers 5xx and lets requests through
again within 75 s.

Custom metrics to read in the summary: `rate_limited_429` and
`server_errors_5xx` (by `rg`), `cdn_cache` (by `cache`: HIT, MISS, STALE),
`free_claims_created` / `free_claims_refused`, `paid_checkout_results`,
`checkin_outcomes`, `rate_limit_*`.

### Rate limits a run meets

One k6 machine is one IP address. These are expected, counted in
`rate_limited_429`, and not failures:

| Limit | Where |
|---|---|
| Paid checkouts: 10 a minute per IP, 20 per event and 60 in all per 10 minutes | on-sale with `CHECKOUT=1`: after 20 on the paid event, the rest are 429 for 10 minutes |
| Payment page reads: 30 a minute per IP | on-sale checkouts, rate-limit scenario |
| Free claims: 4 tickets per person per event, 10 claims per member a day | on-sale claims (409 and 429). Plus-addresses count as one person |
| Check-ins: 600 per account per 5 minutes | door: the default rush goes over it after about 2 minutes, as a real one on one shared login would |
| View beacons: 300 per event a minute | on-sale: over it the beacon still answers 204, uncounted |

Nothing on the public read paths is rate-limited per IP: browse and soak
measure capacity, not limits.

## 5. Grafana Cloud k6 (free tier)

1. Make a Grafana Cloud account, open Testing & synthetics → Performance,
   and copy a token.
2. `k6 cloud login --token <token>`
3. Run in the cloud (Sydney load zone, set in each script):
   `k6 cloud run -e BASE_URL=https://<preview> tests/load/scenarios/browse.js`
   or run here and stream the results:
   `k6 cloud run --local-execution -e BASE_URL=… tests/load/scenarios/browse.js`

`-e` values and opened files (seed output, door codes, member emails) are
uploaded with a cloud run. Use cloud runs for browse, soak and the rate-limit
check; run on-sale and door with `--local-execution` (or plain `k6 run`) so
passwords and codes stay on your machine.

The free tier has a monthly allowance of virtual-user hours (VUh; 500 when
this was written, check the current one). Roughly: browse at 200 VUs for 14
min ≈ 45 VUh, soak ≈ 30, on-sale ≈ 10 to 30, door and rate limit under 1.
Each cloud load generator is its own IP, with its own per-IP limits.

## 6. What to watch during a run

- **Vercel → Observability:** function invocations, duration, errors and
  cold starts per route; Edge requests and the cache hit ratio; data
  transfer. **Logs:** `Unhandled API error`, timeouts,
  `Stripe didn't answer`. **Firewall:** blocked or challenged requests.
- **Supabase (staging) → Reports / Database:** CPU and memory; connections,
  especially the pooler's client connections against the plan's limit (each
  Vercel instance holds up to 5); slow queries (Query Performance: the feed,
  search, check-in). **Auth logs:** every signed-in request checks its token
  with Supabase Auth.
- **Stripe (test mode) → Developers → Logs:** request rate, any 429
  `rate_limit` errors, sessions created and expired. Nothing in live mode.
- **k6:** `http_req_failed`, latency per `rg`, `rate_limited_429`,
  `server_errors_5xx`, `cdn_cache`.

## 7. Cost

- **Vercel:** every HTML page and every uncached API call is a function
  invocation; images are served from the database through a function, then
  the CDN for an hour (`CACHE_BUST=1` makes every one a function call).
  Photos are a few hundred KB, so a full browse run can move several GB:
  check `data_received` in the summary against your plan's allowance, seed
  with `--no-images` to cut it, and keep runs short. Hobby plans are for
  non-commercial use and have low monthly allowances.
- **Supabase:** images read from the database count as its egress; the
  staging project's compute tier sets the connection limit.
- **Stripe test mode:** free. **Grafana Cloud:** the VUh above.
- Smoke first, `LOAD_SCALE=0.25` next, the full run once.

## 8. Recording results

Copy into the PR or `docs/` with the summary JSON:

```
### Load test: <scenario>, <date>
- Target: <preview URL>, commit <sha>; Supabase staging <plan/compute>; Vercel <plan>
- Generator: <local / Grafana Cloud Sydney>, k6 <version>
- Profile: <defaults / LOAD_SCALE / other variables>; CACHE_BUST <on/off>
- Result: thresholds <passed / failed: which>
| Group | requests | p95 ms | p99 ms | failed % | 429s |
|---|---|---|---|---|---|
| page | | | | | |
| … | | | | | |
- CDN: HIT <n> / MISS <n> / STALE <n>; data received <GB>
- Supabase: peak CPU <%>, peak connections <n>/<limit>, slowest query <…>
- Vercel: invocations <n>, errors <n>, cold starts <n>
- Stripe (test): sessions <n>, errors <n>
- Notes / follow-ups:
```

## Checking the scripts without k6

`npm run load:check` checks the target guard, the thresholds and that every
script parses (`tests/load/k6-scripts.test.ts`), and runs the seed against
every migration (`tests/server/load-seed.test.ts`).
