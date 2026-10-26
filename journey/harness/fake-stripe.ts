import { randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import Stripe from "stripe";

/**
 * A local stand-in for the parts of Stripe's v1 API the app calls (Connect
 * accounts and links, Checkout Sessions, refunds), plus the "customer" and
 * "dashboard" sides a journey needs: paying a session, refunding a payment,
 * and the webhook events Stripe would send for each.
 *
 * The app talks to it through the real Stripe SDK (its form encoding,
 * headers, idempotency keys, retries and error types), pointed here with the
 * SDK's own host/port/protocol options. That client is only ever made with a
 * `sk_test_` key (owner decision D9): see createFakeStripeClient. This is
 * not Stripe: it proves the app's side of the contract as the SDK sees it,
 * never Stripe's behaviour (docs/testing.md, layer d).
 */

type Params = Record<string, unknown>;

export interface FakeSession {
  id: string;
  object: "checkout.session";
  status: "open" | "complete" | "expired";
  payment_status: "unpaid" | "paid";
  /** `embedded_page` (the app's checkouts: a client secret, no URL) or `hosted` (a URL, no client secret). */
  ui_mode: "embedded_page" | "hosted";
  url: string | null;
  client_secret: string | null;
  expires_at: number;
  client_reference_id: string | null;
  customer_email: string | null;
  customer_details: { email: string | null } | null;
  amount_total: number;
  currency: string;
  metadata: Record<string, string>;
  payment_intent: string | null;
  /** What the app asked for, decoded from Stripe's form encoding (values are strings, as sent). */
  params: Params;
  /** The idempotency key the app sent with the create call. */
  idempotencyKey: string | null;
}

export interface FakeCharge {
  id: string;
  object: "charge";
  amount: number;
  amount_refunded: number;
  refunded: boolean;
  currency: string;
  payment_intent: string;
  transfer_data: { destination: string } | null;
  application_fee_amount: number | null;
}

export interface FakeRefund {
  id: string;
  object: "refund";
  amount: number;
  status: "succeeded";
  charge: string;
  payment_intent: string;
  metadata: Record<string, string>;
  /** Flags the app sent (strings, as encoded). */
  reverse_transfer?: unknown;
  refund_application_fee?: unknown;
  idempotencyKey: string | null;
}

export interface RecordedRequest {
  method: string;
  path: string;
  idempotencyKey: string | null;
  /** True when Stripe would have replayed a stored response for the idempotency key. */
  replayed: boolean;
  status: number;
}

/** Decodes Stripe's form encoding (`a[b][0][c]=v`) into nested objects; all-numeric keys become arrays. */
export function decodeStripeForm(body: string): Params {
  const root: Params = {};
  for (const [rawKey, value] of new URLSearchParams(body)) {
    const path = rawKey.replace(/\]/g, "").split("[");
    let node: Params = root;
    path.forEach((segment, i) => {
      if (i === path.length - 1) node[segment] = value;
      else node = (node[segment] ??= {}) as Params;
    });
  }
  const arrays = (value: unknown): unknown => {
    if (!value || typeof value !== "object") return value;
    const entries = Object.entries(value as Params).map(([k, v]) => [k, arrays(v)] as const);
    const numeric = entries.length > 0 && entries.every(([k], i) => k === String(i));
    return numeric ? entries.map(([, v]) => v) : Object.fromEntries(entries);
  };
  return arrays(root) as Params;
}

function stripeError(res: ServerResponse, status: number, type: string, message: string, code?: string) {
  res.writeHead(status, { "content-type": "application/json", "request-id": "req_fake" });
  res.end(JSON.stringify({ error: { type, message, ...(code ? { code } : {}) } }));
}

export class FakeStripe {
  readonly sessions = new Map<string, FakeSession>();
  readonly charges = new Map<string, FakeCharge>();
  readonly refunds: FakeRefund[] = [];
  readonly accounts = new Map<string, { id: string; object: "account"; charges_enabled: boolean; payouts_enabled: boolean; email?: string }>();
  readonly requests: RecordedRequest[] = [];
  private readonly stored = new Map<string, { body: string; status: number; response: string }>();
  private server?: Server;
  private seq = 0;
  port = 0;

  constructor(
    private readonly secretKey: string,
    private readonly webhookSecret: string,
  ) {}

  private id(prefix: string) {
    this.seq += 1;
    return `${prefix}_fake${String(this.seq).padStart(6, "0")}`;
  }

  async start(): Promise<void> {
    this.server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => this.handle(req, res, Buffer.concat(chunks).toString("utf8")));
    });
    await new Promise<void>((resolve) => this.server!.listen(0, "127.0.0.1", resolve));
    this.port = (this.server.address() as AddressInfo).port;
  }

  async stop(): Promise<void> {
    if (!this.server) return;
    this.server.closeAllConnections();
    await new Promise<void>((resolve) => this.server!.close(() => resolve()));
  }

  private handle(req: IncomingMessage, res: ServerResponse, body: string) {
    const method = req.method ?? "GET";
    const path = new URL(req.url ?? "/", "http://fake").pathname;
    const idempotencyKey = (req.headers["idempotency-key"] as string | undefined) ?? null;
    const record = (status: number, replayed = false) =>
      this.requests.push({ method, path, idempotencyKey, replayed, status });

    if (req.headers.authorization !== `Bearer ${this.secretKey}`) {
      record(401);
      return stripeError(res, 401, "invalid_request_error", "Invalid API Key provided.");
    }
    // Stripe's idempotency: the same key and parameters get the stored response; other parameters are an error.
    const storeKey = idempotencyKey && method === "POST" ? `${path}\n${idempotencyKey}` : null;
    if (storeKey) {
      const previous = this.stored.get(storeKey);
      if (previous) {
        if (previous.body !== body) {
          record(400);
          return stripeError(res, 400, "idempotency_error", "Keys for idempotent requests can only be used with the same parameters.");
        }
        record(previous.status, true);
        res.writeHead(previous.status, { "content-type": "application/json", "idempotent-replayed": "true" });
        return res.end(previous.response);
      }
    }
    const reply = (status: number, payload: unknown) => {
      const response = JSON.stringify(payload);
      if (storeKey) this.stored.set(storeKey, { body, status, response });
      record(status);
      res.writeHead(status, { "content-type": "application/json", "request-id": "req_fake" });
      res.end(response);
    };
    const params = decodeStripeForm(body);

    try {
      const route = `${method} ${path}`;
      let m: RegExpMatchArray | null;
      if (route === "POST /v1/accounts") {
        const account = { id: this.id("acct"), object: "account" as const, charges_enabled: false, payouts_enabled: false, email: params.email as string };
        this.accounts.set(account.id, account);
        return reply(200, account);
      }
      if ((m = route.match(/^GET \/v1\/accounts\/([^/]+)$/))) {
        const account = this.accounts.get(m[1]);
        return account ? reply(200, account) : reply(404, { error: { type: "invalid_request_error", message: "No such account" } });
      }
      if (route === "POST /v1/account_links") {
        if (!this.accounts.has(params.account as string)) return reply(400, { error: { type: "invalid_request_error", message: "No such account" } });
        return reply(200, { object: "account_link", url: `https://connect.stripe.invalid/setup/${params.account as string}` });
      }
      if (route === "POST /v1/checkout/sessions") return reply(...this.createSession(params, idempotencyKey));
      if ((m = route.match(/^GET \/v1\/checkout\/sessions\/([^/]+)$/))) {
        const session = this.sessions.get(m[1]);
        return session ? reply(200, this.publicSession(session)) : reply(404, { error: { type: "invalid_request_error", message: "No such checkout.session" } });
      }
      if ((m = route.match(/^POST \/v1\/checkout\/sessions\/([^/]+)\/expire$/))) {
        const session = this.sessions.get(m[1]);
        if (!session) return reply(404, { error: { type: "invalid_request_error", message: "No such checkout.session" } });
        if (session.status !== "open") {
          return reply(400, { error: { type: "invalid_request_error", message: `Only open sessions can be expired; this one is ${session.status}.` } });
        }
        session.status = "expired";
        return reply(200, this.publicSession(session));
      }
      if (route === "POST /v1/refunds") return reply(...this.createRefund(params, idempotencyKey));
      // Asked before the app reports a refund as not completed (its current status).
      if ((m = route.match(/^GET \/v1\/refunds\/([^/]+)$/))) {
        const refundId = m[1];
        const refund = this.refunds.find((r) => r.id === refundId);
        if (!refund) return reply(404, { error: { type: "invalid_request_error", message: "No such refund" } });
        const { id, object, amount, status, charge, payment_intent, metadata } = refund;
        return reply(200, { id, object, amount, status, charge, payment_intent, metadata });
      }
      return reply(404, { error: { type: "invalid_request_error", message: `Unrecognized request URL (${method}: ${path}).` } });
    } catch (err) {
      return reply(500, { error: { type: "api_error", message: err instanceof Error ? err.message : "fake failure" } });
    }
  }

  private createSession(params: Params, idempotencyKey: string | null): [number, unknown] {
    const invalid = (message: string): [number, unknown] => [400, { error: { type: "invalid_request_error", message } }];
    if (params.mode !== "payment") return invalid("mode must be payment");
    const lines = params.line_items;
    if (!Array.isArray(lines) || lines.length === 0) return invalid("line_items is required");
    const pid = params.payment_intent_data as { application_fee_amount?: string; transfer_data?: { destination?: string } } | undefined;
    const destination = pid?.transfer_data?.destination;
    const account = destination ? this.accounts.get(destination) : undefined;
    if (!account || !account.charges_enabled) return invalid("The destination account can't take charges.");
    let amount = 0;
    for (const line of lines as { price_data?: { unit_amount?: string; currency?: string }; quantity?: string }[]) {
      const unit = Number(line.price_data?.unit_amount);
      const qty = Number(line.quantity);
      if (!Number.isInteger(unit) || unit < 0 || !Number.isInteger(qty) || qty < 1) return invalid("Invalid line item");
      if (line.price_data?.currency !== "aud") return invalid("Currency must be aud");
      amount += unit * qty;
    }
    // As Stripe: an embedded session (mounted with its client secret) returns to return_url and has no
    // success or cancel URL; a hosted one is the reverse.
    const embedded = params.ui_mode === "embedded_page";
    if (params.ui_mode !== undefined && !embedded && params.ui_mode !== "hosted") return invalid("Invalid ui_mode");
    if (embedded && (params.success_url !== undefined || params.cancel_url !== undefined)) {
      return invalid("success_url and cancel_url can't be used with ui_mode embedded_page; use return_url");
    }
    if (embedded && typeof params.return_url !== "string") return invalid("return_url is required with ui_mode embedded_page");
    if (!embedded && params.return_url !== undefined) return invalid("return_url can only be used with ui_mode embedded_page");
    const now = Math.floor(Date.now() / 1000);
    const expiresAt = params.expires_at === undefined ? now + 24 * 60 * 60 : Number(params.expires_at);
    // Stripe refuses an expiry under 30 minutes away (the seated checkout relies on it).
    if (expiresAt < now + 30 * 60 - 60) return invalid("expires_at must be at least 30 minutes from now");
    const id = this.id("cs_test");
    const session: FakeSession = {
      id,
      object: "checkout.session",
      status: "open",
      payment_status: "unpaid",
      ui_mode: embedded ? "embedded_page" : "hosted",
      url: embedded ? null : `https://checkout.stripe.invalid/c/pay/${id}`,
      client_secret: embedded ? `${id}_secret_${randomBytes(12).toString("hex")}` : null,
      expires_at: expiresAt,
      client_reference_id: (params.client_reference_id as string) ?? null,
      customer_email: (params.customer_email as string) ?? null,
      customer_details: null,
      amount_total: amount,
      currency: "aud",
      metadata: (params.metadata as Record<string, string>) ?? {},
      payment_intent: null,
      params,
      idempotencyKey,
    };
    this.sessions.set(id, session);
    return [200, this.publicSession(session)];
  }

  private createRefund(params: Params, idempotencyKey: string | null): [number, unknown] {
    const charge = [...this.charges.values()].find((c) => c.payment_intent === params.payment_intent);
    if (!charge) return [400, { error: { type: "invalid_request_error", message: "No such payment_intent" } }];
    const remaining = charge.amount - charge.amount_refunded;
    if (remaining <= 0) {
      return [400, { error: { type: "invalid_request_error", code: "charge_already_refunded", message: "Charge has already been refunded." } }];
    }
    const amount = params.amount === undefined ? remaining : Number(params.amount);
    const refund: FakeRefund = {
      id: this.id("re"),
      object: "refund",
      amount,
      status: "succeeded",
      charge: charge.id,
      payment_intent: charge.payment_intent,
      metadata: (params.metadata as Record<string, string>) ?? {},
      reverse_transfer: params.reverse_transfer,
      refund_application_fee: params.refund_application_fee,
      idempotencyKey,
    };
    charge.amount_refunded += amount;
    charge.refunded = charge.amount_refunded >= charge.amount;
    this.refunds.push(refund);
    const { id, object, status, charge: chargeId, payment_intent, metadata } = refund;
    return [200, { id, object, amount, status, charge: chargeId, payment_intent, metadata }];
  }

  /** The session as the API returns it (without the harness's bookkeeping). */
  publicSession(session: FakeSession) {
    const { id, object, status, payment_status, ui_mode, url, client_secret, expires_at, client_reference_id } = session;
    const { customer_email, customer_details, amount_total, currency, metadata, payment_intent } = session;
    return {
      id,
      object,
      status,
      payment_status,
      ui_mode,
      url,
      client_secret,
      expires_at,
      client_reference_id,
      customer_email,
      customer_details,
      amount_total,
      currency,
      metadata,
      payment_intent,
    };
  }

  // ---------------------------------------------------------------------------
  // The other sides of Stripe: the organiser finishing onboarding, the buyer
  // paying, the organiser refunding in the dashboard, and the events sent.
  // ---------------------------------------------------------------------------

  /** The organiser finished Stripe's onboarding: charges and payouts enabled. */
  activateAccount(accountId: string) {
    const account = this.accounts.get(accountId);
    if (!account) throw new Error(`No fake account ${accountId}`);
    account.charges_enabled = true;
    account.payouts_enabled = true;
  }

  /** The Checkout Session the app made for `orderId` (its client_reference_id). */
  sessionForOrder(orderId: string): FakeSession {
    const found = [...this.sessions.values()].filter((s) => s.client_reference_id === orderId);
    if (found.length !== 1) throw new Error(`Expected one session for ${orderId}, found ${found.length}`);
    return found[0];
  }

  /** The buyer pays on Stripe's page: a payment intent and a charge to the session's destination. */
  pay(sessionId: string, email?: string): { session: FakeSession; charge: FakeCharge } {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`No fake session ${sessionId}`);
    if (session.status !== "open") throw new Error(`Session ${sessionId} is ${session.status}, not open`);
    const pid = session.params.payment_intent_data as { application_fee_amount?: string; transfer_data?: { destination?: string } };
    const paymentIntent = this.id("pi");
    const charge: FakeCharge = {
      id: this.id("ch"),
      object: "charge",
      amount: session.amount_total,
      amount_refunded: 0,
      refunded: false,
      currency: "aud",
      payment_intent: paymentIntent,
      transfer_data: pid.transfer_data?.destination ? { destination: pid.transfer_data.destination } : null,
      application_fee_amount: pid.application_fee_amount === undefined ? null : Number(pid.application_fee_amount),
    };
    this.charges.set(charge.id, charge);
    session.status = "complete";
    session.payment_status = "paid";
    session.payment_intent = paymentIntent;
    session.customer_details = { email: email ?? session.customer_email };
    return { session, charge };
  }

  /** A refund made in the Stripe dashboard (the whole remainder unless `amount`). */
  dashboardRefund(paymentIntentId: string, amount?: number): FakeCharge {
    const charge = [...this.charges.values()].find((c) => c.payment_intent === paymentIntentId);
    if (!charge) throw new Error(`No fake charge for ${paymentIntentId}`);
    const [status] = this.createRefund({ payment_intent: paymentIntentId, ...(amount ? { amount: String(amount) } : {}) }, null);
    if (status !== 200) throw new Error(`Dashboard refund failed (${status})`);
    return charge;
  }

  /** A Stripe event as delivered to the webhook endpoint. */
  event(type: string, object: unknown): { id: string; object: "event"; type: string; created: number; livemode: false; data: { object: unknown } } {
    return {
      id: this.id("evt"),
      object: "event",
      type,
      created: Math.floor(Date.now() / 1000),
      livemode: false,
      data: { object: JSON.parse(JSON.stringify(object)) },
    };
  }

  completedEvent(session: FakeSession) {
    return this.event("checkout.session.completed", this.publicSession(session));
  }

  chargeRefundedEvent(charge: FakeCharge) {
    return this.event("charge.refunded", charge);
  }

  /** The payload and Stripe-Signature header for an event, signed with the webhook secret as Stripe does. */
  sign(event: unknown): { payload: string; signature: string } {
    const payload = JSON.stringify(event);
    const signature = Stripe.webhooks.generateTestHeaderString({ payload, secret: this.webhookSecret });
    return { payload, signature };
  }

  /** Checkout Sessions actually created (not idempotent replays). */
  get sessionsCreated(): number {
    return this.requests.filter((r) => r.method === "POST" && r.path === "/v1/checkout/sessions" && r.status === 200 && !r.replayed).length;
  }
}

/**
 * The app's Stripe client for the harness: the real SDK, pointed at the fake
 * API. Refuses anything but a `sk_test_` key (D9), so a live key can never be
 * used, and nothing here ever reaches api.stripe.com.
 */
export function createFakeStripeClient(secretKey: string, port: number): Stripe {
  if (!secretKey.startsWith("sk_test_")) {
    throw new Error("The journey harness's fake Stripe API only runs with a sk_test_ key (owner decision D9).");
  }
  return new Stripe(secretKey, { host: "127.0.0.1", port, protocol: "http", telemetry: false });
}
