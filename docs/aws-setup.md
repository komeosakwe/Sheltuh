# AWS setup — accounts/organisers/admin milestone

**Status: nothing in this document has been deployed.** This session has no
AWS credentials (verified: `aws sts get-caller-identity` against a real
signed request returned `InvalidClientTokenId`, and the `aws` CLI isn't even
installed here). Everything below is what you need to do, from your own
machine, to actually stand this up — and the review step you should do
*before* running `cdk deploy` for the first time.

## 1. Review before deploying

**Target AWS account:** not yet determined by this session — it will be
whichever account your AWS credentials resolve to when you run `cdk deploy`.
**Before your first deploy, confirm this is a development/sandbox account**,
separate from anything hosting the live Sheltüh landing page. Nothing in
this stack touches DNS, Route 53, or any existing production resource — it
is entirely new, isolated infrastructure — but the account-level blast
radius (IAM, billing) is still worth double-checking.

**Region:** `ap-southeast-2` (Sydney), fixed in `infra/bin/sheltuh.ts`.

**Resources this stack (`SheltuhDevStack`) creates**, all tagged
`project=sheltuh, environment=dev`:

| Resource | Count | Notes |
|---|---|---|
| Cognito User Pool | 1 | Email sign-in, self-signup, email verification required |
| Cognito User Pool Client | 1 | Public SPA client, no secret |
| Cognito User Pool Group | 1 | `admins` — empty until you run `scripts/promote-admin.ts` |
| DynamoDB tables | 3 | `Organisers`, `Events`, `EventSlugs` — on-demand billing |
| DynamoDB GSIs | 2 | one on `Organisers`, one on `Events` |
| Lambda functions | 16 | Node.js 20, ARM64, 256MB, 10s timeout |
| CloudWatch Log Groups | 16 | one per function, 2-week retention |
| API Gateway HTTP API | 1 | ~15 routes, Cognito JWT authorizer on all but 2 public reads |

**Expected charges:** at dev/testing volume (a handful of people clicking
through the app), this is effectively **$0–$1/month**:
- DynamoDB on-demand and Lambda both have per-request/GB-second free tiers
  that comfortably cover manual testing.
- API Gateway HTTP APIs are $1.00 per million requests after the first
  million (free for a new account's first 12 months) — dev testing won't
  get close to a million calls.
- Cognito's free tier covers far more than a handful of test users.
- CloudWatch Logs storage at 2-week retention for low-volume logs is cents,
  not dollars.

This is an estimate, not a guarantee — AWS pricing and free-tier terms can
change, and an account past its 12-month free-tier window pays the
post-free-tier rates above from the start (still negligible at this
volume). Nothing here scales with real user traffic because there is no
real user traffic yet. If you leave the stack deployed indefinitely rather
than tearing it down between test sessions, expect low-single-digit dollars
a month at most, dominated by whichever free tier has expired first.

**If you don't want to proceed:** don't run `cdk deploy`. Everything above
this line is safe — no AWS calls have been made.

## 2. Get temporary AWS credentials (not long-lived access keys)

Don't create an IAM user with a permanent access key for this. Use AWS IAM
Identity Center (SSO) — credentials expire automatically (typically in
hours), nothing to leak in a stray env var or shell history.

**If your AWS account already has IAM Identity Center set up:**

```bash
aws configure sso
# Follow the prompts: SSO start URL, region, then pick the account/role
# to use for this project. Give the profile a name, e.g. sheltuh-dev.

aws sso login --profile sheltuh-dev
export AWS_PROFILE=sheltuh-dev
```

**If it isn't set up yet:** enable IAM Identity Center in the AWS console
(IAM Identity Center → Enable), create/assign yourself a permission set
scoped to what this stack needs (Cognito, DynamoDB, Lambda, API Gateway,
IAM role creation for the Lambda execution roles, CloudFormation, S3 for
the CDK bootstrap bucket, SSM read for the bootstrap version parameter),
then follow the steps above.

**Least-privilege note:** the permission set only needs to cover this
stack's own resources — it does not need account-admin or root access.
Never use root credentials for CDK deploys, ever.

Verify you're using temporary, working credentials before continuing:

```bash
aws sts get-caller-identity --profile sheltuh-dev
```

## 3. Bootstrap and deploy (once you're ready)

```bash
cd infra
npm install
npx cdk bootstrap aws://ACCOUNT_ID/ap-southeast-2   # once per account+region
npx cdk diff                                         # review the change set
npx cdk deploy                                       # only when you're happy with the diff
```

`cdk deploy` prints outputs when it finishes:

```
SheltuhDevStack.ApiUrl = https://xxxxxxxxxx.execute-api.ap-southeast-2.amazonaws.com
SheltuhDevStack.UserPoolId = ap-southeast-2_XXXXXXXXX
SheltuhDevStack.UserPoolClientId = xxxxxxxxxxxxxxxxxxxxxxxxxx
```

## 4. Wire the frontend to it

In the Next.js app root (not `infra/`), set:

```bash
# .env.local (gitignored — never commit this)
NEXT_PUBLIC_API_URL=https://xxxxxxxxxx.execute-api.ap-southeast-2.amazonaws.com
NEXT_PUBLIC_COGNITO_USER_POOL_ID=ap-southeast-2_XXXXXXXXX
NEXT_PUBLIC_COGNITO_CLIENT_ID=xxxxxxxxxxxxxxxxxxxxxxxxxx
```

With these unset (as in every environment this project has run in so far),
the app runs in local demo mode exactly as before — sample data, no
network calls. With all three set, `npm run dev` / `npm run build` talk to
the real backend: real sign-up/sign-in, real organiser applications, a real
(empty, until seeded or organisers start publishing) public feed.

## 5. Provision the first admins (Kome and Dhruv)

Admin access is never self-service — see `scripts/promote-admin.ts` and
`infra/lib/sheltuh-stack.ts`'s comment on the `admins` group. Steps:

1. Kome and Dhruv each sign up through the real app (`/signup` → verify
   their email → `/login`) using **their own real email addresses** — this
   project never invented or hardcoded those.
2. With the temporary credentials from step 2, run for each of them:
   ```bash
   cd scripts
   npm install   # once
   npm run promote-admin -- \
     --user-pool-id ap-southeast-2_XXXXXXXXX \
     --email kome-or-dhruvs-real-email@example.com
   ```
3. They sign out and back in — `/admin` becomes available once their new
   ID token carries `cognito:groups: ["admins"]`.

## 6. Seed sample events into the live feed (optional)

To see the public feed populated without waiting on a real organiser
application → admin approval cycle:

```bash
cd scripts
npm install   # once
npm run seed-dev-data
```

This publishes the same 8 fictional demo events the local prototype uses,
directly into the dev `Events`/`EventSlugs` tables, tagged with a
synthetic `seed-` organiser ID so they're clearly not real organiser
submissions. Re-running it is idempotent per event (same `eventId`/`slug`
each time — it overwrites, doesn't duplicate).

## 7. Tear down

Every resource in this stack has `RemovalPolicy.DESTROY` — a clean, full
teardown:

```bash
cd infra
npx cdk destroy
```

## 8. What this session actually verified vs. didn't

**Verified locally, without AWS:**
- `npx tsc --noEmit` — the whole `infra/` project (stack + all 16 Lambda
  handlers + shared modules) typechecks.
- `npx cdk synth` — the stack synthesises to a valid CloudFormation
  template; every `NodejsFunction` bundles successfully with local esbuild.
- `npm test` in `infra/` — 35 unit tests over the pure logic (Melbourne/UTC
  conversion, validation, state-machine rules, pagination cursors).
- The frontend's demo mode (no env vars set) was browser-tested end to end.

**NOT verified (because there's no AWS access in this environment):**
- The stack has never actually been deployed.
- No Lambda has ever executed against a real DynamoDB table.
- No Cognito sign-up/sign-in flow has ever run against a real user pool.
- The frontend's "live mode" code paths (real API calls) have not been
  exercised against a real backend — only their loading/error/not-found
  states were checked in the absence of one.

Do not take "the code is written and typechecks" as "AWS integration
works" — they are not the same claim, and this document deliberately keeps
them separate.
