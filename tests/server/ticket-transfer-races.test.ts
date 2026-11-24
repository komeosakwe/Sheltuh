import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ORDER_ACCESS_HEADER } from "@/lib/api/types";
import { putMyGoing } from "@/lib/server/handlers/going";
import { stripeWebhook } from "@/lib/server/handlers/orders";
import {
  cancelTicketTransfer,
  declineTicketOffer,
  getReceivedTicket,
  TICKET_TRANSFER_LIMITS,
} from "@/lib/server/handlers/ticket-transfers";
import { stripeWebhookRequest, TestApi } from "./helpers/api";
import { member } from "./helpers/members";
import { createTestDb } from "./helpers/test-db";
import {
  accept,
  backdate,
  checkIn,
  codesOf,
  jobsOf,
  mintToken,
  offer,
  OFFER,
  paidOrder,
  send,
  transferRow,
  transferWorld,
  type TransferWorld,
} from "./helpers/ticket-transfers";

// Ticket transfers under concurrency (supabase/migrations/20261203000000_ticket_transfers.sql): every step locks
// event, order, ticket, then transfer, so racing steps serialise and exactly one wins. Real Postgres only
// (TEST_DATABASE_URL): PGlite is one connection, so nothing there ever runs at once.

let api: TestApi;
let reset: () => Promise<void>;
let world: TransferWorld;

beforeAll(async () => {
  const testDb = await createTestDb();
  reset = testDb.reset;
  api = new TestApi(testDb.db);
});

beforeEach(async () => {
  await reset();
  api = new TestApi(api.db);
  vi.stubEnv("NEXT_PUBLIC_TICKET_TRANSFERS", "1");
  vi.spyOn(console, "info").mockImplementation(() => {});
  world = await transferWorld(api);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

let buyers = 0;
/** A fresh paid order with its ticket 1 offered (each buyer and recipient address distinct, so no daily cap is hit). */
async function openOffer(quantity = 1) {
  buyers += 1;
  const order = await paidOrder(api, world.eventId, `buyer${buyers}@example.com`, quantity);
  const transferId = await offer(api, order, { email: `friend${buyers}@example.com` });
  return { order, transferId, token: await mintToken(api, transferId) };
}

function refundWebhook(orderId: string, total: number) {
  return stripeWebhookRequest({
    type: "charge.refunded",
    data: { object: { id: `ch_${orderId}`, object: "charge", payment_intent: `pi_${orderId}`, amount_refunded: total, refunded: true } },
  });
}

describe.skipIf(!process.env.TEST_DATABASE_URL)("ticket transfer races (real Postgres only)", () => {
  it("two accounts accept one link at once: one 200, one 404, one issued code", async () => {
    for (let i = 0; i < 5; i++) {
      const { transferId, token } = await openOffer();
      const [a, b] = [await member(api), await member(api)];
      const results = await Promise.all([accept(api, token, a), accept(api, token, b)]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 404]);
      const row = await transferRow(api, transferId);
      const winner = results[0].status === 200 ? a : b;
      expect(row).toMatchObject({ status: "accepted", accepted_user_id: winner.userId });
      const [issued] = await api.db.query<{ n: number }>(
        `select count(*)::int as n from private.ticket_transfers where ticket_code = $1 and issued_code is not null`,
        [row.ticket_code],
      );
      expect(issued.n).toBe(1);
    }
  });

  it("the same account twice at once: both 200 with the same id (accepted, then already accepted)", async () => {
    for (let i = 0; i < 5; i++) {
      const { transferId, token } = await openOffer();
      const sam = await member(api);
      const results = await Promise.all([accept(api, token, sam), accept(api, token, sam)]);
      expect(results.map((r) => [r.status, r.body.transferId])).toEqual([
        [200, transferId],
        [200, transferId],
      ]);
      expect(await jobsOf(api, transferId)).toEqual(["transfer_accepted", "transfer_offer", "transfer_ticket"]);
    }
  });

  it("accept against the sender's cancel, and against a decline: exactly one wins", async () => {
    for (let i = 0; i < 5; i++) {
      const { order, transferId, token } = await openOffer();
      const [accepted, cancelled] = await Promise.all([
        accept(api, token, await member(api)),
        api.call(cancelTicketTransfer, {
          params: { sessionId: order.orderId, transferId },
          body: {},
          headers: { [ORDER_ACCESS_HEADER]: order.access },
        }),
      ]);
      if (accepted.status === 200) {
        expect([cancelled.status, cancelled.body.code]).toEqual([409, "transfer_not_pending"]);
      } else {
        expect([accepted.status, cancelled.status]).toEqual([404, 200]);
      }
      expect((await transferRow(api, transferId)).status).toBe(accepted.status === 200 ? "accepted" : "cancelled");

      const second = await openOffer();
      const [took, declined] = await Promise.all([
        accept(api, second.token, await member(api)),
        api.call(declineTicketOffer, { body: { token: second.token } }),
      ]);
      expect([took.status, declined.status].sort()).toEqual([200, 404]);
      expect((await transferRow(api, second.transferId)).status).toBe(took.status === 200 ? "accepted" : "declined");
    }
  });

  it("accept against a check-in of the sender's code: never both admitted and accepted", async () => {
    for (let i = 0; i < 8; i++) {
      const { order, transferId, token } = await openOffer();
      const [code] = await codesOf(api, order.orderId);
      const [accepted, scan] = await Promise.all([accept(api, token, await member(api)), checkIn(api, world, code)]);
      const row = await transferRow(api, transferId);
      if (accepted.status === 200) {
        expect(scan.body.outcome).toBe("transferred");
        expect(row.status).toBe("accepted");
      } else {
        expect([accepted.status, accepted.body.code, scan.body.outcome]).toEqual([409, "ticket_unavailable", "admitted"]);
        expect(row.status).toBe("pending");
      }
    }
  });

  it("accept against a full refund (charge.refunded), 20 times: no deadlock, and a consistent outcome", async () => {
    for (let i = 0; i < 20; i++) {
      const { order, transferId, token } = await openOffer();
      const [{ total }] = await api.db.query<{ total: number }>(`select total_cents as total from public.orders where id = $1`, [
        order.orderId,
      ]);
      const sam = await member(api);
      const [accepted, refunded] = await Promise.all([accept(api, token, sam), api.send(stripeWebhook, refundWebhook(order.orderId, total))]);
      expect(refunded.status).toBe(200);
      expect([200, 409]).toContain(accepted.status);
      const [orderRow] = await api.db.query<{ status: string }>(`select status::text as status from public.orders where id = $1`, [
        order.orderId,
      ]);
      expect(orderRow.status).toBe("refunded");
      if (accepted.status === 200) {
        const received = await api.call(getReceivedTicket, { token: sam.token, params: { transferId } });
        expect(received.body.status).toBe("void");
      } else {
        expect(accepted.body.code).toBe("ticket_unavailable");
        expect((await transferRow(api, transferId)).status).toBe("pending");
      }
    }
  });

  it("accept against the buyer opting in to Who's Going: the buyer never ends up going with nothing held", async () => {
    for (let i = 0; i < 10; i++) {
      buyers += 1;
      const email = `buyer${buyers}@example.com`;
      const buyer = await member(api, { email });
      const order = await paidOrder(api, world.eventId, email, 1);
      const transferId = await offer(api, order, { email: `friend${buyers}@example.com` });
      const token = await mintToken(api, transferId);
      const [accepted, going] = await Promise.all([
        accept(api, token, await member(api)),
        api.call(putMyGoing, { token: buyer.token, params: { eventId: world.eventId }, method: "PUT" }),
      ]);
      expect(accepted.status).toBe(200);
      expect([200, 403]).toContain(going.status);
      expect(await api.db.query(`select 1 from public.event_attendees where event_id = $1 and user_id = $2`, [
        world.eventId,
        buyer.userId,
      ])).toEqual([]);
    }
  });

  it("one account at the held cap less one accepts two offers at once: exactly one succeeds", async () => {
    // 3 rounds of 11 single-ticket orders: within the event's 50 GA tickets.
    for (let i = 0; i < 3; i++) {
      const sam = await member(api);
      // Already holding the cap less one received tickets for the event.
      for (let held = 0; held < TICKET_TRANSFER_LIMITS.maxHeldPerAccountPerEvent - 1; held++) {
        const { token } = await openOffer();
        expect((await accept(api, token, sam)).status).toBe(200);
      }
      const [a, b] = [await openOffer(), await openOffer()];
      const results = await Promise.all([accept(api, a.token, sam), accept(api, b.token, sam)]);
      expect(results.map((r) => [r.status, r.body.code ?? null]).sort()).toEqual([
        [200, null],
        [409, "received_cap"],
      ]);
      const [held] = await api.db.query<{ n: number }>(
        `select count(*)::int as n from private.member_held_tickets($1, null) h where h.event_id = $2 and h.transfer_id is not null`,
        [sam.userId, world.eventId],
      );
      expect(held.n).toBe(TICKET_TRANSFER_LIMITS.maxHeldPerAccountPerEvent);
    }
    // 33 checkouts and 30 accepts: more than the default 5 seconds on a busy machine.
  }, 60_000);

  it("two sends of one ticket at once: one 201, one 409 transfer_pending", async () => {
    for (let i = 0; i < 5; i++) {
      buyers += 1;
      const order = await paidOrder(api, world.eventId, `buyer${buyers}@example.com`, 1);
      const results = await Promise.all([
        send(api, order.orderId, { ...OFFER, email: `x${buyers}@example.com` }, { access: order.access }),
        send(api, order.orderId, { ...OFFER, email: `y${buyers}@example.com` }, { access: order.access }),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
      expect(results.find((r) => r.status === 409)?.body.code).toBe("transfer_pending");
    }
  });

  it("the expiry sweep against an accept at the expiry: one outcome, one email", async () => {
    for (let i = 0; i < 8; i++) {
      const { transferId, token } = await openOffer();
      // Due to expire within a few milliseconds of now.
      await backdate(api, transferId, `${72 * 3600 - 0.005 * i} seconds`);
      const [accepted] = await Promise.all([
        accept(api, token, await member(api)),
        api.db.query(`select private.expire_ticket_transfers(200, '2 hours')`),
      ]);
      const row = await transferRow(api, transferId);
      if (accepted.status === 200) {
        expect(row.status).toBe("accepted");
        expect(await jobsOf(api, transferId)).toEqual(["transfer_accepted", "transfer_offer", "transfer_ticket"]);
      } else {
        expect(accepted.status).toBe(404);
        expect(row.status).toBe("expired");
        expect(await jobsOf(api, transferId)).toEqual(["transfer_expired", "transfer_offer"]);
      }
    }
  });
});
