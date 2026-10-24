import Stripe from "stripe";
import { vi } from "vitest";
import type { Caller } from "@/lib/server/auth";
import type { Db } from "@/lib/server/db";
import type { Deps } from "@/lib/server/deps";
import type { EmailMessage } from "@/lib/server/email";
import { runHandler, type Handler } from "@/lib/server/route";

export const WEBHOOK_SECRET = "whsec_test_secret";
export const CRON_SECRET = "cron-test-secret";
export const SITE_URL = "https://sheltuh.test";
/** The publishable key a TestApi is configured with (the same mode as the fake secret key below). */
export const PUBLISHABLE_KEY = "pk_test_not_a_real_key";

/** What Stripe returns for an embedded session (ui_mode embedded_page): an id and a client secret, no URL. */
export function embeddedSession(id: string, extra: Record<string, unknown> = {}) {
  return { id, object: "checkout.session", ui_mode: "embedded_page", url: null, client_secret: `${id}_secret_test`, ...extra };
}

/** Stripe's own offline signing/verification, for realistic webhook tests. */
const realStripe = new Stripe("sk_test_not_a_real_key");

export function createFakeStripe() {
  return {
    accounts: {
      create: vi.fn().mockResolvedValue({ id: "acct_test_1" }),
      retrieve: vi.fn().mockResolvedValue({ id: "acct_test_1", charges_enabled: true, payouts_enabled: true }),
    },
    accountLinks: { create: vi.fn().mockResolvedValue({ url: "https://connect.stripe.test/onboard" }) },
    checkout: {
      sessions: {
        create: vi.fn().mockResolvedValue(embeddedSession("cs_test_1")),
        expire: vi.fn().mockResolvedValue({ id: "cs_test_1", status: "expired" }),
        // An open embedded session, an hour from expiring.
        retrieve: vi.fn().mockResolvedValue(
          embeddedSession("cs_test_1", {
            status: "open",
            payment_status: "unpaid",
            expires_at: Math.floor(Date.now() / 1000) + 3600,
          }),
        ),
      },
    },
    refunds: { create: vi.fn().mockResolvedValue({ id: "re_test_1", status: "succeeded" }) },
    webhooks: realStripe.webhooks,
  };
}

export type FakeStripe = ReturnType<typeof createFakeStripe>;

/** A signed webhook request exactly as Stripe would send it. */
export function stripeWebhookRequest(event: { type: string; data: { object: unknown } }, secret = WEBHOOK_SECRET) {
  const payload = JSON.stringify({ id: "evt_test", object: "event", ...event });
  const signature = realStripe.webhooks.generateTestHeaderString({ payload, secret });
  return new Request(`${SITE_URL}/api/stripe/webhook`, {
    method: "POST",
    headers: { "stripe-signature": signature, "content-type": "application/json" },
    body: payload,
  });
}

export class TestApi {
  readonly stripe = createFakeStripe();
  /** Every email the API "sent". Make it throw to simulate an SMTP outage. */
  readonly sendEmail = vi.fn<(message: EmailMessage) => Promise<void>>().mockResolvedValue(undefined);
  /** Work handlers deferred until after the response (Deps.defer). Run with runDeferred(). */
  readonly deferred: (() => Promise<void>)[] = [];
  /** The cron secret this API is configured with; undefined to simulate CRON_SECRET being unset. */
  cronSecret: string | undefined = CRON_SECRET;
  /** The Stripe publishable key as Deps reports it; undefined to simulate it unset or of the wrong mode. */
  stripePublishableKey: string | undefined = PUBLISHABLE_KEY;
  private readonly callers = new Map<string, Caller>();

  constructor(readonly db: Db) {}

  get deps(): Deps {
    return {
      db: this.db,
      verifyAccessToken: async (token) => this.callers.get(token) ?? null,
      stripe: () => this.stripe as unknown as Stripe,
      stripeWebhookSecret: () => WEBHOOK_SECRET,
      stripePublishableKey: () => this.stripePublishableKey,
      siteUrl: () => SITE_URL,
      sendEmail: this.sendEmail,
      defer: (task) => {
        this.deferred.push(task);
      },
      cronSecret: () => this.cronSecret,
    };
  }

  /** Runs everything deferred so far (and anything that defers in turn), as Next's after() would once the response is sent. */
  async runDeferred(): Promise<void> {
    while (this.deferred.length > 0) await this.deferred.shift()!();
  }

  /**
   * Creates an auth user and returns a bearer token for them. Their email
   * counts as verified unless `emailVerified: false`.
   */
  async signUp(
    options: { admin?: boolean; email?: string; emailVerified?: boolean } = {},
  ): Promise<{ token: string; userId: string; email: string }> {
    const userId = crypto.randomUUID();
    const email = options.email ?? `${userId.slice(0, 8)}@example.com`;
    // app_metadata as Supabase stores it: the database reads the admin role too (ticket_check_ins_guard),
    // and email_confirmed_at (private.notify_followers).
    await this.db.query(
      `insert into auth.users (id, email, raw_app_meta_data, email_confirmed_at)
       values ($1, $2, $3::text::jsonb, case when $4 then now() end)`,
      [userId, email, JSON.stringify(options.admin ? { role: "admin" } : {}), options.emailVerified ?? true],
    );
    const token = `token-${userId}`;
    this.callers.set(token, {
      userId,
      email,
      emailVerified: options.emailVerified ?? true,
      isAdmin: Boolean(options.admin),
    });
    return { token, userId, email };
  }

  /** Another bearer token for an existing user, e.g. to act as them once their email is no longer verified. */
  tokenFor(caller: Caller): string {
    const token = `token-${crypto.randomUUID()}`;
    this.callers.set(token, caller);
    return token;
  }

  async call<P extends Record<string, string>>(
    handler: Handler<P>,
    options: {
      params?: P;
      token?: string;
      body?: unknown;
      query?: Record<string, string>;
      method?: string;
      /** Extra request headers, e.g. `x-forwarded-for` (none by default: no client IP). */
      headers?: Record<string, string>;
    } = {},
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- tests assert on arbitrary response JSON
  ): Promise<{ status: number; body: any; headers: Headers }> {
    const url = new URL(`${SITE_URL}/api/test`);
    for (const [k, v] of Object.entries(options.query ?? {})) url.searchParams.set(k, v);
    const req = new Request(url, {
      method: options.method ?? (options.body === undefined ? "GET" : "POST"),
      headers: {
        "content-type": "application/json",
        ...options.headers,
        ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    return this.send(handler, req, options.params);
  }

  async send<P extends Record<string, string>>(handler: Handler<P>, req: Request, params?: P) {
    const res = await runHandler(handler, req, (params ?? {}) as P, this.deps);
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : undefined, headers: res.headers };
  }
}
