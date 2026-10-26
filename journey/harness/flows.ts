import { request as httpRequest } from "node:http";
import { expect } from "vitest";
import { application, eventInput } from "../../tests/server/helpers/fixtures";
import type { Journey, JourneyResponse, User } from "./index";

/**
 * Steps journeys share, all through the HTTP API (fixture data from
 * tests/server/helpers/fixtures.ts, so the two layers build the same
 * organiser and event).
 */

export type Organiser = User & { organiserId: string; stripeAccountId: string };

/** Applies, is approved by an admin, and finishes Stripe Connect onboarding (on the fake Stripe). */
export async function organiserWithPayouts(j: Journey, admin: User, overrides: Record<string, unknown> = {}): Promise<Organiser> {
  const user = await j.signUp();
  const applied = await j.request("POST", "/api/organisers/apply", { token: user.token, body: { ...application, ...overrides } });
  expect(applied.status).toBe(201);
  const organiserId = applied.body.organiserId as string;
  expect((await j.request("POST", `/api/admin/organisers/${organiserId}/approve`, { token: admin.token })).status).toBe(200);

  const onboard = await j.request("POST", "/api/organisers/me/connect/onboard", { token: user.token });
  expect(onboard.status).toBe(200);
  const stripeAccountId = (onboard.body.url as string).split("/").at(-1)!;
  expect(j.stripe.accounts.has(stripeAccountId)).toBe(true);
  // Not payable until Stripe says so.
  expect((await j.request("POST", "/api/organisers/me/connect/refresh", { token: user.token })).body.payoutsEnabled).toBe(false);
  j.stripe.activateAccount(stripeAccountId);
  expect((await j.request("POST", "/api/organisers/me/connect/refresh", { token: user.token })).body.payoutsEnabled).toBe(true);
  return { ...user, organiserId, stripeAccountId };
}

/** An approved organiser without payouts (for access checks). */
export async function approvedOrganiser(j: Journey, admin: User): Promise<User & { organiserId: string }> {
  const user = await j.signUp();
  const applied = await j.request("POST", "/api/organisers/apply", { token: user.token, body: application });
  expect(applied.status).toBe(201);
  const organiserId = applied.body.organiserId as string;
  expect((await j.request("POST", `/api/admin/organisers/${organiserId}/approve`, { token: admin.token })).status).toBe(200);
  return { ...user, organiserId };
}

/** Drafted, submitted and approved: published. */
export async function publishedEvent(j: Journey, organiser: User, admin: User, overrides: Record<string, unknown> = {}) {
  const draft = await j.request("POST", "/api/events", { token: organiser.token, body: eventInput(overrides) });
  expect(draft.status).toBe(201);
  const eventId = draft.body.eventId as string;
  expect((await j.request("POST", `/api/events/${eventId}/submit`, { token: organiser.token })).status).toBe(200);
  const approved = await j.request("POST", `/api/admin/events/${eventId}/approve`, { token: admin.token });
  expect(approved.status).toBe(200);
  expect(approved.body.status).toBe("published");
  return { eventId, slug: approved.body.slug as string, organiserId: draft.body.organiserId as string };
}

/** POST /api/events/{id}/checkout for general admission, as the checkout page sends it. */
export function checkout(
  j: Journey,
  eventId: string,
  options: { quantity?: number; buyerEmail?: string; key?: string; ip?: string; ticketTypeId?: string } = {},
): Promise<JourneyResponse> {
  return j.request("POST", `/api/events/${eventId}/checkout`, {
    body: {
      lineItems: [{ ticketTypeId: options.ticketTypeId ?? "ga", quantity: options.quantity ?? 1 }],
      ...(options.buyerEmail ? { buyerEmail: options.buyerEmail } : {}),
    },
    headers: {
      ...(options.key ? { "idempotency-key": options.key } : {}),
      // Vercel sets it; the per-client limits key on it.
      "x-forwarded-for": options.ip ?? "203.0.113.10",
    },
  });
}

/** The buyer pays on (fake) Stripe; returns the completed event to deliver and the charge. */
export function pay(j: Journey, orderId: string, email?: string) {
  const session = j.stripe.sessionForOrder(orderId);
  const { charge } = j.stripe.pay(session.id, email);
  return { event: j.stripe.completedEvent(session), charge, session };
}

/** Checkout, payment and the payment webhook, then waits for the ticket email: a paid order and its codes. */
export async function buyTickets(j: Journey, eventId: string, buyerEmail: string, quantity = 1) {
  const res = await checkout(j, eventId, { quantity, buyerEmail, key: crypto.randomUUID() });
  expect(res.status).toBe(201);
  const orderId = res.body.orderId as string;
  const { event, charge } = pay(j, orderId);
  expect((await j.webhook(event)).status).toBe(200);
  await j.idle();
  const order = await j.request("GET", `/api/orders/by-session/${orderId}`);
  expect(order.body.status).toBe("paid");
  const codes = (order.body.tickets as { ticketCode: string }[]).map((t) => t.ticketCode);
  expect(codes).toHaveLength(quantity);
  return { orderId, codes, charge };
}

/** A door scan, as the check-in page sends it (a fresh request id unless one is given). */
export function scan(j: Journey, staff: { token?: string }, eventId: string, code: string, requestId: string = crypto.randomUUID()) {
  return j.request("POST", `/api/organisers/me/events/${eventId}/check-ins`, {
    token: staff.token,
    body: { code, requestId },
  });
}

/**
 * Sends a request and drops the connection as soon as the response starts,
 * never reading its body: the door phone lost the answer. Resolves with the
 * status line the server sent (it had already done the work).
 */
export function sendAndLoseResponse(j: Journey, path: string, token: string, body: unknown): Promise<number> {
  const payload = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      `${j.baseUrl}${path}`,
      {
        method: "POST",
        headers: { "content-type": "application/json", "content-length": Buffer.byteLength(payload), authorization: `Bearer ${token}` },
      },
      (res) => {
        const status = res.statusCode ?? 0;
        res.destroy();
        req.destroy();
        resolve(status);
      },
    );
    req.on("error", (err) => {
      if (!req.destroyed) reject(err);
    });
    req.end(payload);
  });
}
