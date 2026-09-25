import Stripe from "stripe";
import { vi } from "vitest";
import type { Caller } from "@/lib/server/auth";
import type { Db } from "@/lib/server/db";
import type { Deps } from "@/lib/server/deps";
import { runHandler, type Handler } from "@/lib/server/route";

export const WEBHOOK_SECRET = "whsec_test_secret";
export const SITE_URL = "https://sheltuh.test";

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
        create: vi.fn().mockResolvedValue({ id: "cs_test_1", url: "https://checkout.stripe.test/cs_test_1" }),
      },
    },
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
  private readonly callers = new Map<string, Caller>();

  constructor(readonly db: Db) {}

  get deps(): Deps {
    return {
      db: this.db,
      verifyAccessToken: async (token) => this.callers.get(token) ?? null,
      stripe: () => this.stripe as unknown as Stripe,
      stripeWebhookSecret: () => WEBHOOK_SECRET,
      siteUrl: () => SITE_URL,
    };
  }

  /** Creates an auth user and returns a bearer token for them. */
  async signUp(options: { admin?: boolean; email?: string } = {}): Promise<{ token: string; userId: string }> {
    const userId = crypto.randomUUID();
    const email = options.email ?? `${userId.slice(0, 8)}@example.com`;
    await this.db.query(`insert into auth.users (id, email) values ($1, $2)`, [userId, email]);
    const token = `token-${userId}`;
    this.callers.set(token, { userId, email, isAdmin: Boolean(options.admin) });
    return { token, userId };
  }

  async call<P extends Record<string, string>>(
    handler: Handler<P>,
    options: { params?: P; token?: string; body?: unknown; query?: Record<string, string>; method?: string } = {},
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- tests assert on arbitrary response JSON
  ): Promise<{ status: number; body: any }> {
    const url = new URL(`${SITE_URL}/api/test`);
    for (const [k, v] of Object.entries(options.query ?? {})) url.searchParams.set(k, v);
    const req = new Request(url, {
      method: options.method ?? (options.body === undefined ? "GET" : "POST"),
      headers: {
        "content-type": "application/json",
        ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    return this.send(handler, req, options.params);
  }

  async send<P extends Record<string, string>>(handler: Handler<P>, req: Request, params?: P) {
    const res = await runHandler(handler, req, (params ?? {}) as P, this.deps);
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : undefined };
  }
}
