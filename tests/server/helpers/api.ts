import Stripe from "stripe";
import { expect, vi } from "vitest";
import type { Caller } from "@/lib/server/auth";
import { AuthAdminError, type AuthAdmin } from "@/lib/server/auth-admin";
import { ClipStorageError, type ClipStorage } from "@/lib/server/clip-storage";
import type { Db } from "@/lib/server/db";
import type { Deps } from "@/lib/server/deps";
import type { EmailMessage } from "@/lib/server/email";
import type { AppleWalletConfig, GoogleWalletConfig } from "@/lib/server/wallet/config";
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

/**
 * The payment options every paid Checkout Session must carry (checkout-attempts.ts
 * SESSION_PAYMENT_OPTIONS): Adaptive Pricing pinned off, so buyers pay exactly
 * the A$ total; no payment method list or wallet options, so the Dashboard's
 * cards, Apple Pay, Google Pay and Link apply; and nothing saved for later.
 */
export function expectSessionPaymentOptions(params: Record<string, unknown>) {
  expect(params.adaptive_pricing).toStrictEqual({ enabled: false });
  for (const key of [
    "payment_method_types",
    "excluded_payment_method_types",
    "payment_method_configuration",
    "payment_method_options",
    "wallet_options",
    "customer",
    "customer_creation",
    "saved_payment_method_options",
  ]) {
    expect(params, key).not.toHaveProperty(key);
  }
  expect(params.payment_intent_data, "payment_intent_data.setup_future_usage").not.toHaveProperty("setup_future_usage");
}
export const OPS_ALERT_EMAIL = "ops@sheltuh.test";

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
    refunds: {
      create: vi.fn().mockResolvedValue({ id: "re_test_1", status: "succeeded" }),
      // Asked before a refund is reported as not completed. By default Stripe "can't be reached", so the
      // reported status stands; a test that needs Stripe's current answer mocks it.
      retrieve: vi.fn().mockRejectedValue(new Stripe.errors.StripeConnectionError({ message: "not mocked" })),
    },
    webhooks: realStripe.webhooks,
  };
}

export type FakeStripe = ReturnType<typeof createFakeStripe>;

/** A signed webhook request exactly as Stripe would send it. */
export function stripeWebhookRequest(
  event: { type: string; data: { object: unknown }; id?: string; created?: number },
  secret = WEBHOOK_SECRET,
) {
  const payload = JSON.stringify({ id: "evt_test", object: "event", ...event });
  const signature = realStripe.webhooks.generateTestHeaderString({ payload, secret });
  return new Request(`${SITE_URL}/api/stripe/webhook`, {
    method: "POST",
    headers: { "stripe-signature": signature, "content-type": "application/json" },
    body: payload,
  });
}

/**
 * What a paid Checkout Session for this order says it charged, as Stripe sends
 * it (`amount_total`, `currency`): the order's stored total in AUD, which is
 * all the webhook fulfils (lib/server/handlers/orders.ts,
 * sessionMoneyMismatch). Nothing for an order that doesn't exist.
 */
export async function sessionAmount(db: Db, orderId: string): Promise<{ amount_total?: number; currency?: string }> {
  const [row] = await db.query<{ total_cents: number }>(`select total_cents from public.orders where id = $1`, [orderId]);
  return row ? { amount_total: Number(row.total_cents), currency: "aud" } : {};
}

/** The fake Storage's origin: its URLs are never fetched. */
export const FAKE_STORAGE_ORIGIN = "https://project.supabase.test";

/**
 * An in-memory stand-in for Supabase Storage's `event-clips` bucket
 * (lib/server/clip-storage.ts). `put` is what the browser's upload to a
 * signed URL would do. `calls` records every call by name; set `failing` to
 * make a call throw as an unreachable Storage would.
 */
export class FakeClipStorage implements ClipStorage {
  readonly objects = new Map<string, { bytes: Uint8Array; contentType: string }>();
  readonly calls: { op: string; paths: string[] }[] = [];
  /** Operations that throw a ClipStorageError (Storage down). */
  readonly failing = new Set<string>();

  /** The browser's PUT to an upload URL. */
  put(path: string, bytes: Uint8Array, contentType = "video/mp4"): void {
    this.objects.set(path, { bytes: bytes.slice(), contentType });
  }

  /** How many times `op` was called. */
  count(op: string): number {
    return this.calls.filter((c) => c.op === op).length;
  }

  private record(op: string, paths: string[]) {
    this.calls.push({ op, paths });
    if (this.failing.has(op)) throw new ClipStorageError(op, 500);
  }

  async createUploadUrl(path: string) {
    this.record("createUploadUrl", [path]);
    return { url: `${FAKE_STORAGE_ORIGIN}/storage/v1/object/upload/sign/event-clips/${path}?token=upload-token` };
  }

  async info(path: string) {
    this.record("info", [path]);
    const object = this.objects.get(path);
    return object ? { size: object.bytes.length } : null;
  }

  async download(path: string, maxBytes: number) {
    this.record("download", [path]);
    const object = this.objects.get(path);
    if (!object) return "missing" as const;
    if (object.bytes.length > maxBytes) return "too_large" as const;
    return object.bytes.slice();
  }

  async upload(path: string, bytes: Uint8Array, contentType: string) {
    this.record("upload", [path]);
    this.objects.set(path, { bytes: bytes.slice(), contentType });
  }

  async createSignedUrl(path: string, expiresInSeconds: number) {
    this.record("createSignedUrl", [path]);
    return `${FAKE_STORAGE_ORIGIN}/storage/v1/object/sign/event-clips/${path}?token=signed-${expiresInSeconds}`;
  }

  async remove(paths: string[]) {
    this.record("remove", paths);
    for (const path of paths) this.objects.delete(path);
  }
}

/**
 * A stand-in for Supabase Auth's admin API (lib/server/auth-admin.ts), on the
 * test database's auth.users and auth.identities, as Supabase Auth behaves
 * (docs/architecture.md, "Account invites"): `generateInviteLink` answers
 * "exists" for an address with a confirmed account (or one in `existing`,
 * lower-cased), reuses an unconfirmed account as it is, or creates an
 * unconfirmed one without a password (with an 'email' identity), sets the
 * account's invited_at, and answers a fresh token hash with that account's
 * id. Calls run one at a time, as Supabase Auth looks up and creates an
 * address's account in one transaction (one account per address).
 * `deleteUser` deletes the account and its identities (resolving if it's
 * already gone). Each
 * throws an AuthAdminError while `failing` / `failingDelete` is set.
 * `beforeGenerate` runs just before an invite link is made (e.g. someone
 * registering the address at that moment). `calls` records the addresses
 * asked for and `deleted` the accounts deleted.
 */
export class FakeAuthAdmin implements AuthAdmin {
  readonly calls: string[] = [];
  readonly deleted: string[] = [];
  readonly existing = new Set<string>();
  failing = false;
  failingDelete = false;
  beforeGenerate: ((email: string) => Promise<void>) | undefined;

  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly db: Db) {}

  generateInviteLink(email: string) {
    const run = this.queue.then(() => this.generate(email));
    this.queue = run.catch(() => {});
    return run;
  }

  private async generate(email: string) {
    this.calls.push(email);
    if (this.failing) throw new AuthAdminError("generate_link", 500);
    await this.beforeGenerate?.(email);
    if (this.existing.has(email.toLowerCase())) return "exists" as const;
    const accounts = await this.db.query<{ id: string; confirmed: boolean }>(
      `select id, email_confirmed_at is not null as confirmed from auth.users where lower(email) = lower($1) order by id`,
      [email],
    );
    if (accounts.some((a) => a.confirmed)) return "exists" as const;
    let userId = accounts[0]?.id;
    if (!userId) {
      userId = crypto.randomUUID();
      await this.db.query(`insert into auth.users (id, email, raw_app_meta_data) values ($1, $2, '{}')`, [userId, email]);
      await this.db.query(`insert into auth.identities (user_id, provider) values ($1, 'email')`, [userId]);
    }
    await this.db.query(`update auth.users set invited_at = now() where id = $1`, [userId]);
    return { tokenHash: `pkce_hash_${crypto.randomUUID().replace(/-/g, "")}`, userId };
  }

  async deleteUser(userId: string) {
    this.deleted.push(userId);
    if (this.failingDelete) throw new AuthAdminError("delete_user", 500);
    await this.db.query(`delete from auth.users where id = $1`, [userId]);
  }
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
  /** Event clips' Storage; undefined to simulate SUPABASE_CLIP_STORAGE_KEY being unset. */
  clipStorage: FakeClipStorage | undefined = new FakeClipStorage();
  /** Supabase Auth's admin API for invites; undefined to simulate SUPABASE_ADMIN_INVITE_KEY being unset. */
  authAdmin: FakeAuthAdmin | undefined;
  /** ADMIN_NOTIFY_EMAILS as Deps reports it (parsed); empty to simulate it unset. */
  adminNotifyEmails: string[] = [];
  /** Where ops alerts go; undefined to simulate OPS_ALERT_EMAIL being unset. */
  opsAlertEmail: string | undefined = OPS_ALERT_EMAIL;
  /** Google Wallet passes; undefined (the default) to simulate the GOOGLE_WALLET_* variables unset. */
  googleWallet: GoogleWalletConfig | undefined;
  /** Apple Wallet passes; undefined (the default) to simulate the APPLE_WALLET_* variables unset. */
  appleWallet: AppleWalletConfig | undefined;
  private readonly callers = new Map<string, Caller>();

  constructor(readonly db: Db) {
    this.authAdmin = new FakeAuthAdmin(db);
  }

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
      clipStorage: () => this.clipStorage,
      authAdmin: () => this.authAdmin,
      adminNotifyEmails: () => this.adminNotifyEmails,
      opsAlertEmail: () => this.opsAlertEmail,
      googleWallet: () => this.googleWallet,
      appleWallet: async () => this.appleWallet,
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

  /** As call(), but the raw Response (a redirect, or a binary body such as a .pkpass). */
  async callRaw<P extends Record<string, string>>(
    handler: Handler<P>,
    options: { params?: P; query?: Record<string, string>; headers?: Record<string, string> } = {},
  ): Promise<Response> {
    const url = new URL(`${SITE_URL}/api/test`);
    for (const [k, v] of Object.entries(options.query ?? {})) url.searchParams.set(k, v);
    return runHandler(handler, new Request(url, { headers: options.headers }), (options.params ?? {}) as P, this.deps);
  }

  /** A request, or one still being built (a webhook fixture that reads the order's amount first). */
  async send<P extends Record<string, string>>(handler: Handler<P>, req: Request | Promise<Request>, params?: P) {
    const res = await runHandler(handler, await req, (params ?? {}) as P, this.deps);
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : undefined, headers: res.headers };
  }
}
