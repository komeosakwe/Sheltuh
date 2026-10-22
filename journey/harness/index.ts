import { randomBytes } from "node:crypto";
import postgres from "postgres";
import { setupSql } from "../../tests/server/helpers/test-db";
import { AppServer } from "./app-server";
import { AuthStub } from "./auth-stub";
import { createFakeStripeClient, FakeStripe } from "./fake-stripe";
import { SmtpSink } from "./smtp-sink";

/**
 * The journey harness (docs/testing.md, layer b): a throwaway database with
 * every migration, the auth stub, the SMTP sink and the fake Stripe API, and
 * the app's API served over HTTP by its real route modules (./app-server.ts).
 * Everything listens on 127.0.0.1 on ports the OS picks; nothing leaves the
 * machine.
 */

/** Both opt-ins set: JOURNEY=1 and a Postgres server to make throwaway databases on. */
export const journeyEnabled = process.env.JOURNEY === "1" && Boolean(process.env.TEST_DATABASE_URL);

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

export interface JourneyResponse<T = unknown> {
  status: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- journeys assert on arbitrary response JSON
  body: T | any;
  headers: Headers;
}

export interface RequestOptions {
  token?: string;
  body?: unknown;
  headers?: Record<string, string>;
}

export interface User {
  token: string;
  userId: string;
  email: string;
}

export interface Journey {
  baseUrl: string;
  stripe: FakeStripe;
  smtp: SmtpSink;
  auth: AuthStub;
  /** A connection to the throwaway database, for assertions on what was stored. */
  sql: postgres.Sql;
  webhookSecret: string;
  cronSecret: string;
  request(method: string, path: string, options?: RequestOptions): Promise<JourneyResponse>;
  /** Delivers a Stripe event to /api/stripe/webhook, signed with the webhook secret. */
  webhook(event: unknown): Promise<JourneyResponse>;
  /** A Supabase Auth user (verified email unless `emailVerified: false`) and a bearer token for them. */
  signUp(options?: { admin?: boolean; email?: string; emailVerified?: boolean }): Promise<User>;
  /** Waits for every deferred task (emails sent after a response). */
  idle(): Promise<void>;
  stop(): Promise<void>;
}

function setEnv(values: Record<string, string>) {
  for (const [k, v] of Object.entries(values)) process.env[k] = v;
}

export async function startJourney(): Promise<Journey> {
  const serverUrl = process.env.TEST_DATABASE_URL;
  if (!serverUrl) throw new Error("TEST_DATABASE_URL isn't set.");
  const server = new URL(serverUrl);
  if (!LOCAL_HOSTS.has(server.hostname) && process.env.JOURNEY_ALLOW_REMOTE_DB !== "1") {
    throw new Error(
      `TEST_DATABASE_URL points at ${server.hostname}: the journey harness creates and drops databases, so it only runs against a local server (set JOURNEY_ALLOW_REMOTE_DB=1 for a disposable CI service).`,
    );
  }
  // D9: the fake Stripe API is only ever used with a test-mode key. The harness never needs a real one.
  const stripeKey = process.env.STRIPE_SECRET_KEY ?? `sk_test_journey_${randomBytes(8).toString("hex")}`;
  if (!stripeKey.startsWith("sk_test_")) throw new Error("STRIPE_SECRET_KEY must be a sk_test_ key (or unset) for the journey harness.");

  // A throwaway database with Supabase's auth stubs and every migration, as tests/server builds one.
  const name = `sheltuh_test_journey_${randomBytes(8).toString("hex")}`;
  const admin = postgres(serverUrl, { max: 1, onnotice: () => {} });
  await admin.unsafe(`create database ${name}`);
  const dbUrl = new URL(serverUrl);
  dbUrl.pathname = `/${name}`;
  const setup = postgres(dbUrl.toString(), { max: 1, onnotice: () => {} });
  for (const sqlText of setupSql()) await setup.unsafe(sqlText);
  await setup.end();
  const sql = postgres(dbUrl.toString(), { max: 4, onnotice: () => {} });

  const webhookSecret = `whsec_journey_${randomBytes(12).toString("hex")}`;
  const cronSecret = `cron-journey-${randomBytes(12).toString("hex")}`;
  const publishableKey = "sb_publishable_journey_placeholder";
  const smtpUser = "journey-sender@sheltuh.test";
  const smtpPass = randomBytes(12).toString("hex");

  const stripe = new FakeStripe(stripeKey, webhookSecret);
  const smtp = new SmtpSink(smtpUser, smtpPass);
  const auth = new AuthStub(sql, publishableKey);
  await Promise.all([stripe.start(), smtp.start(), auth.start()]);

  const app = new AppServer(createFakeStripeClient(stripeKey, stripe.port));
  // Exactly the variables production's getDeps() reads, pointed at the local stand-ins.
  setEnv({
    DATABASE_URL: dbUrl.toString(),
    NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${auth.port}`,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: publishableKey,
    STRIPE_SECRET_KEY: stripeKey,
    STRIPE_WEBHOOK_SECRET: webhookSecret,
    SMTP_HOST: "127.0.0.1",
    SMTP_PORT: String(smtp.port),
    SMTP_USER: smtpUser,
    SMTP_PASS: smtpPass,
    EMAIL_FROM: "Sheltüh <tickets@sheltuh.test>",
    CRON_SECRET: cronSecret,
    OPS_ALERT_EMAIL: "ops@sheltuh.test",
  });
  await app.start();
  // Stripe redirect URLs and email links name the app's own origin.
  process.env.NEXT_PUBLIC_SITE_URL = app.baseUrl;

  const request = async (method: string, path: string, options: RequestOptions = {}): Promise<JourneyResponse> => {
    const res = await fetch(`${app.baseUrl}${path}`, {
      method,
      headers: {
        ...(options.body === undefined ? {} : { "content-type": "application/json" }),
        ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
        ...options.headers,
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    const text = await res.text();
    let body: unknown = undefined;
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }
    }
    return { status: res.status, body, headers: res.headers };
  };

  return {
    baseUrl: app.baseUrl,
    stripe,
    smtp,
    auth,
    sql,
    webhookSecret,
    cronSecret,
    request,
    async webhook(event) {
      const { payload, signature } = stripe.sign(event);
      const res = await fetch(`${app.baseUrl}/api/stripe/webhook`, {
        method: "POST",
        headers: { "content-type": "application/json", "stripe-signature": signature },
        body: payload,
      });
      const text = await res.text();
      return { status: res.status, body: text ? JSON.parse(text) : undefined, headers: res.headers };
    },
    async signUp(options = {}) {
      const userId = crypto.randomUUID();
      const email = options.email ?? `${userId.slice(0, 8)}@journey.test`;
      // As Supabase stores it: the database reads the admin role and email_confirmed_at too.
      await sql`insert into auth.users (id, email, raw_app_meta_data, email_confirmed_at)
                values (${userId}, ${email}, ${sql.json(options.admin ? { role: "admin" } : {})},
                        ${options.emailVerified === false ? null : new Date()})`;
      return { token: auth.issue(userId), userId, email };
    },
    idle: () => app.idle(),
    async stop() {
      await app.stop().catch(() => {});
      await Promise.all([stripe.stop(), smtp.stop(), auth.stop()]).catch(() => {});
      await sql.end({ timeout: 5 }).catch(() => {});
      // The app's own pool (getDeps' postgres.js) can't be closed from outside: force its connections off.
      await admin.unsafe(`drop database if exists ${name} with (force)`);
      await admin.end({ timeout: 5 });
    },
  };
}
