import { expect } from "vitest";
import { ORDER_ACCESS_HEADER } from "@/lib/api/types";
import { checkInTicket } from "@/lib/server/handlers/check-ins";
import { createCheckout, stripeWebhook } from "@/lib/server/handlers/orders";
import { acceptTicketOffer, sendTicket } from "@/lib/server/handlers/ticket-transfers";
import { hashTransferToken, newTransferToken } from "@/lib/server/ticket-transfers";
import { embeddedSession, sessionAmount, stripeWebhookRequest, type TestApi } from "./api";
import { approvedOrganiser, enablePayouts, publishedEvent, signUpAdmin } from "./fixtures";
import { orderIdFromUrl } from "./seating";

/** What a send's body is unless a test says otherwise. */
export const OFFER = { ticket: 1, name: "Sam Lee", email: "sam@example.com", senderName: "Alex Chen" };

export const BUYER = "alex@example.com";

export interface TransferWorld {
  admin: { token: string; userId: string };
  organiser: { token: string; userId: string; organiserId: string };
  eventId: string;
}

/** A published event with a paid tier (`ga`, A$30) and a free one (`rsvp`), payouts on, and Stripe sessions mocked. */
export async function transferWorld(api: TestApi): Promise<TransferWorld> {
  const admin = await signUpAdmin(api);
  const organiser = await approvedOrganiser(api, admin);
  const event = await publishedEvent(api, organiser, admin, {
    ticketTypes: [
      { id: "ga", name: "GA", priceCents: 3000, feePolicy: "buyer-pays", quantityAvailable: 50 },
      { id: "rsvp", name: "RSVP", priceCents: 0, feePolicy: "buyer-pays", quantityAvailable: 50 },
    ],
  });
  await enablePayouts(api, organiser.organiserId);
  let n = 0;
  api.stripe.checkout.sessions.create.mockImplementation(async () => {
    n += 1;
    return embeddedSession(`cs_test_${n}`);
  });
  return { admin, organiser, eventId: event.eventId };
}

/** A paid card order of `quantity` GA tickets (checkout, then the signed webhook), and the paying browser's token. */
export async function paidOrder(api: TestApi, eventId: string, email = BUYER, quantity = 2, buyerName?: string) {
  const res = await api.call(createCheckout, {
    params: { eventId },
    body: { lineItems: [{ ticketTypeId: "ga", quantity }], buyerEmail: email, ...(buyerName ? { buyerName } : {}) },
  });
  expect(res.status).toBe(201);
  const orderId = res.body.orderId as string;
  const paid = await api.send(
    stripeWebhook,
    stripeWebhookRequest({
      type: "checkout.session.completed",
      data: {
        object: {
          id: `cs_paid_${orderId}`,
          object: "checkout.session",
          client_reference_id: orderId,
          ...(await sessionAmount(api.db, orderId)),
          payment_status: "paid",
          payment_intent: `pi_${orderId}`,
          customer_details: { email },
        },
      },
    }),
  );
  expect(paid.status).toBe(200);
  await api.runDeferred();
  api.sendEmail.mockClear();
  return { orderId, access: res.body.orderAccess as string };
}

/** A free order of one RSVP, booked by a signed-in member with their own email (paid at once). */
export async function freeOrder(api: TestApi, eventId: string, member: { token: string; email: string }) {
  const res = await api.call(createCheckout, {
    params: { eventId },
    token: member.token,
    body: { lineItems: [{ ticketTypeId: "rsvp", quantity: 1 }], buyerEmail: member.email },
  });
  expect(res.status).toBe(201);
  await api.runDeferred();
  api.sendEmail.mockClear();
  return orderIdFromUrl(res.body.url as string);
}

/** POST …/ticket-transfers as the paying browser (`access`) and/or a signed-in account (`token`). */
export function send(
  api: TestApi,
  orderId: string,
  body: unknown = OFFER,
  options: { access?: string; token?: string; ip?: string } = {},
) {
  return api.call(sendTicket, {
    params: { sessionId: orderId },
    body,
    token: options.token,
    headers: {
      ...(options.access ? { [ORDER_ACCESS_HEADER]: options.access } : {}),
      ...(options.ip ? { "x-forwarded-for": options.ip } : {}),
    },
  });
}

/** Sends ticket `ticket` of the order as the paying browser: the new transfer's id. */
export async function offer(api: TestApi, order: { orderId: string; access: string }, overrides: Record<string, unknown> = {}) {
  const res = await send(api, order.orderId, { ...OFFER, ...overrides }, { access: order.access });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.transferId as string;
}

/** An offer link token for `transferId`, stored as the email worker stores one (its hash). */
export async function mintToken(api: TestApi, transferId: string): Promise<string> {
  const token = newTransferToken();
  await api.db.query(`insert into private.ticket_transfer_tokens (token_hash, transfer_id) values ($1, $2)`, [
    hashTransferToken(token),
    transferId,
  ]);
  return token;
}

export function accept(api: TestApi, token: string, account: { token: string }, holderName = "Sam Lee") {
  return api.call(acceptTicketOffer, { token: account.token, body: { token, holderName } });
}

export function checkIn(api: TestApi, world: TransferWorld, code: string, requestId: string = crypto.randomUUID()) {
  return api.call(checkInTicket, { token: world.organiser.token, params: { eventId: world.eventId }, body: { code, requestId } });
}

export type TransferRow = {
  id: string;
  status: string;
  ticket_code: string;
  sender_kind: string;
  sender_user_id: string | null;
  accepted_user_id: string | null;
  accepted_email: string | null;
  holder_name: string | null;
  holder_notice_at: Date | null;
  issued_code: string | null;
  wallet_serial: string | null;
  created_at: Date;
  expires_at: Date;
  decided_at: Date | null;
  cancelled_by: string | null;
  cancel_reason: string | null;
};

export async function transferRow(api: TestApi, transferId: string): Promise<TransferRow> {
  const [row] = await api.db.query<TransferRow>(
    `select id::text as id, status, ticket_code, sender_kind, sender_user_id::text as sender_user_id,
            accepted_user_id::text as accepted_user_id, accepted_email, holder_name, holder_notice_at, issued_code,
            wallet_serial::text as wallet_serial, created_at, expires_at, decided_at, cancelled_by, cancel_reason
       from private.ticket_transfers where id = $1`,
    [transferId],
  );
  return row;
}

/** The order's ticket codes, in its order (ticket type, then code). */
export async function codesOf(api: TestApi, orderId: string): Promise<string[]> {
  const rows = await api.db.query<{ code: string }>(
    `select code from public.tickets where order_id = $1 order by ticket_type_id, code`,
    [orderId],
  );
  return rows.map((r) => r.code);
}

/** The kinds of outbox job queued for a transfer. */
export async function jobsOf(api: TestApi, transferId: string): Promise<string[]> {
  const rows = await api.db.query<{ kind: string }>(
    `select kind from private.email_outbox where ticket_transfer_id = $1 order by kind`,
    [transferId],
  );
  return rows.map((r) => r.kind);
}

/**
 * Moves a transfer's times back by `by` (created, expiry and decision), as if
 * it had been made that long ago. The guard trigger refuses this (its times
 * never change), so it's lifted for the one update; tests only.
 */
export async function backdate(api: TestApi, transferId: string, by: string): Promise<void> {
  await api.db.query(`alter table private.ticket_transfers disable trigger ticket_transfers_guard`);
  try {
    await api.db.query(
      `update private.ticket_transfers set created_at = created_at - $2::interval, expires_at = expires_at - $2::interval,
              decided_at = decided_at - $2::interval where id = $1`,
      [transferId, by],
    );
  } finally {
    await api.db.query(`alter table private.ticket_transfers enable trigger ticket_transfers_guard`);
  }
}

/** Moves the event to start (and end 3 hours later) at now() plus `fromNow`. */
export async function startEventIn(api: TestApi, eventId: string, fromNow: string): Promise<void> {
  await api.db.query(
    `update public.events set starts_at = now() + $2::interval, ends_at = now() + $2::interval + interval '3 hours' where id = $1`,
    [eventId, fromNow],
  );
}
