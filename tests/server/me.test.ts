import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { adminUnpublishEvent } from "@/lib/server/handlers/admin";
import { getMe } from "@/lib/server/handlers/me";
import { deleteMyUsername, putMyUsername } from "@/lib/server/handlers/usernames";
import type { EventRecord } from "@/lib/server/types";
import { TestApi } from "./helpers/api";
import { generateTicketCode } from "@/lib/server/ticket-issuance";
import { approvedOrganiser, draftEvent, insertOrder, publishedEvent, signUpAdmin } from "./helpers/fixtures";
import { createTestDb } from "./helpers/test-db";

/**
 * GET /api/me (lib/server/handlers/me.ts; docs/architecture.md, "API"): a
 * verified member's own account summary. `upcomingCount` counts the
 * published, not yet started events the caller has a paid order for under
 * their verified email (ignoring case), each event once.
 */

let api: TestApi;
let reset: () => Promise<void>;
let admin: { token: string; userId: string };
let organiser: { token: string; userId: string; organiserId: string };
let event: EventRecord;
let member: { token: string; userId: string; email: string };

beforeAll(async () => {
  const testDb = await createTestDb();
  reset = testDb.reset;
  api = new TestApi(testDb.db);
}, 120_000);

beforeEach(async () => {
  await reset();
  api = new TestApi(api.db);
  admin = await signUpAdmin(api);
  organiser = await approvedOrganiser(api, admin);
  event = await publishedEvent(api, organiser, admin);
  member = await api.signUp({ email: "sam@example.com" });
});

const me = (token?: string, query?: Record<string, string>) => api.call(getMe, { token, query });

async function upcomingCount(token = member.token): Promise<number> {
  const res = await me(token);
  expect(res.status).toBe(200);
  return res.body.upcomingCount;
}

/** Another published event of the same organiser (its own slug). */
const anotherEvent = () => publishedEvent(api, organiser, admin, { title: `Another ${crypto.randomUUID().slice(0, 8)}` });

describe("GET /api/me", () => {
  it("answers the member's own summary, private and never cached", async () => {
    await insertOrder(api, event, member.email);
    const res = await me(member.token);
    expect(res.status).toBe(200);
    // No username set: only the count.
    expect(res.body).toEqual({ upcomingCount: 1 });
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });

  it("is 0 with no tickets", async () => {
    expect(await upcomingCount()).toBe(0);
  });

  it("401 signed out, 403 with an unverified email (both private, no-store)", async () => {
    const signedOut = await me();
    expect(signedOut.status).toBe(401);
    expect(signedOut.headers.get("cache-control")).toBe("private, no-store");

    const unverified = await api.signUp({ email: "new@example.com", emailVerified: false });
    // Even holding a ticket under that address: an unconfirmed email can't be trusted to be theirs.
    await insertOrder(api, event, unverified.email);
    const forbidden = await me(unverified.token);
    expect(forbidden.status).toBe(403);
    expect(forbidden.body).not.toHaveProperty("upcomingCount");
    expect(forbidden.headers.get("cache-control")).toBe("private, no-store");
  });

  describe("counts", () => {
    it("a paid order and a free ticket (an A$0 paid order), one per event", async () => {
      const free = await publishedEvent(api, organiser, admin, {
        title: "Free night",
        ticketTypes: [{ id: "free", name: "Free entry", priceCents: 0, feePolicy: "buyer-pays", quantityAvailable: 50 }],
      });
      expect(free.ticketTypes.every((t) => t.priceCents === 0)).toBe(true);
      const paidId = `ord_${crypto.randomUUID().replace(/-/g, "")}`;
      await api.db.query(
        `insert into public.orders (id, event_id, organiser_id, event_title, buyer_email, line_items,
           subtotal_cents, buyer_fee_cents, total_cents, application_fee_cents, status)
         values ($1, $2, $3, 'Paid', $4, '[]'::jsonb, 3000, 170, 3170, 170, 'paid')`,
        [paidId, event.eventId, event.organiserId, member.email],
      );
      // A paid order has its tickets (a ticket is what's counted: private.member_held_tickets).
      await api.db.query(
        `insert into public.tickets (code, order_id, event_id, ticket_type_id, ticket_type_name) values ($1, $2, $3, 'ga', 'GA')`,
        [generateTicketCode(), paidId, event.eventId],
      );
      await insertOrder(api, free, member.email); // total 0, paid
      expect(await upcomingCount()).toBe(2);
    });

    it("two orders for the same event once", async () => {
      await insertOrder(api, event, member.email);
      await insertOrder(api, event, member.email);
      expect(await upcomingCount()).toBe(1);
    });

    it("a group order (one order admitting several people) once", async () => {
      const groupId = `ord_${crypto.randomUUID().replace(/-/g, "")}`;
      await api.db.query(
        `insert into public.orders (id, event_id, organiser_id, event_title, buyer_email, line_items,
           subtotal_cents, buyer_fee_cents, total_cents, application_fee_cents, status)
         values ($1, $2, $3, 'Group', $4, $5::text::jsonb, 12000, 530, 12530, 530, 'paid')`,
        [
          groupId,
          event.eventId,
          event.organiserId,
          member.email,
          JSON.stringify([
            { ticketTypeId: "group", ticketTypeName: "Group of 4", unitPriceCents: 12000, feePolicy: "buyer-pays", quantity: 1, admits: 4 },
          ]),
        ],
      );
      // One ticket per person.
      for (let i = 0; i < 4; i++) {
        await api.db.query(
          `insert into public.tickets (code, order_id, event_id, ticket_type_id, ticket_type_name, group_size)
           values ($1, $2, $3, 'ga', 'Group of 4', 4)`,
          [generateTicketCode(), groupId, event.eventId],
        );
      }
      expect(await upcomingCount()).toBe(1);
    });

    it("a partly refunded order (still paid)", async () => {
      const orderId = await insertOrder(api, event, member.email);
      await api.db.query(`update public.orders set amount_refunded_cents = 500 where id = $1`, [orderId]);
      expect(await upcomingCount()).toBe(1);
    });

    it("ignoring case, on either side", async () => {
      await insertOrder(api, event, "Sam@Example.COM");
      expect(await upcomingCount()).toBe(1);
      const shouty = await api.signUp({ email: "LEE@EXAMPLE.COM" });
      await insertOrder(api, event, "lee@example.com");
      expect(await upcomingCount(shouty.token)).toBe(1);
    });

    it("each event until it starts (in progress no longer counts)", async () => {
      const second = await anotherEvent();
      await insertOrder(api, event, member.email);
      await insertOrder(api, second, member.email);
      expect(await upcomingCount()).toBe(2);
      // Started (still on, not ended): it no longer counts as upcoming.
      await api.db.query(
        `update public.events set starts_at = now() - interval '1 minute', ends_at = now() + interval '3 hours' where id = $1`,
        [event.eventId],
      );
      expect(await upcomingCount()).toBe(1);
    });
  });

  describe("doesn't count", () => {
    for (const status of ["pending", "failed", "refunded", "oversold_refund_required"] as const) {
      it(`a ${status} order`, async () => {
        await insertOrder(api, event, member.email, status);
        expect(await upcomingCount()).toBe(0);
      });
    }

    it("an order once it's fully refunded", async () => {
      const orderId = await insertOrder(api, event, member.email);
      expect(await upcomingCount()).toBe(1);
      await api.db.query(`update public.orders set status = 'refunded' where id = $1`, [orderId]);
      expect(await upcomingCount()).toBe(0);
    });

    it("an event that isn't published (a draft, or unpublished)", async () => {
      const draft = await draftEvent(api, organiser, { title: "Still a draft" });
      await insertOrder(api, draft, member.email);
      await insertOrder(api, event, member.email);
      expect(await upcomingCount()).toBe(1);
      const unpublished = await api.call(adminUnpublishEvent, { token: admin.token, params: { eventId: event.eventId }, body: { reason: "x" } });
      expect(unpublished.status).toBe(200);
      expect(await upcomingCount()).toBe(0);
    });

    it("an event that has ended", async () => {
      await insertOrder(api, event, member.email);
      await api.db.query(
        `update public.events set starts_at = now() - interval '3 hours', ends_at = now() - interval '1 second' where id = $1`,
        [event.eventId],
      );
      expect(await upcomingCount()).toBe(0);
    });

    it("another member's orders, whatever the request says", async () => {
      const other = await api.signUp({ email: "alex@example.com" });
      await insertOrder(api, event, other.email);
      await insertOrder(api, await anotherEvent(), other.email);
      expect(await upcomingCount()).toBe(0);
      // Nothing in the request picks whose orders are counted: only the token's email.
      const res = await me(member.token, { email: other.email, userId: other.userId });
      expect(res.body).toEqual({ upcomingCount: 0 });
      expect(await upcomingCount(other.token)).toBe(2);
    });

    it("a +tag or otherwise different address (the exact address only, as Who's Going)", async () => {
      await insertOrder(api, event, "sam+gigs@example.com");
      await insertOrder(api, await anotherEvent(), " sam@example.com");
      await insertOrder(api, await anotherEvent(), null);
      expect(await upcomingCount()).toBe(0);
    });
  });

  it("the caller's paid orders are found by an index on the lower-cased email", async () => {
    const [index] = await api.db.query<{ indexdef: string }>(
      `select indexdef from pg_indexes where schemaname = 'public' and indexname = 'orders_paid_email_event_idx'`,
    );
    expect(index?.indexdef).toMatch(/ON public\.orders USING btree \(lower\(buyer_email\), event_id\) WHERE \(status = 'paid'::(public\.)?order_status\)/);
  });

  describe("username fields (docs/architecture.md, \"Usernames\")", () => {
    const setUsername = (token: string, username: string) =>
      api.call(putMyUsername, { token, method: "PUT", body: { username } });

    it("the caller's own username, with no changeable time while a change is allowed", async () => {
      await insertOrder(api, event, member.email);
      expect((await setUsername(member.token, "Sam.T")).status).toBe(200);
      expect((await me(member.token)).body).toEqual({ username: "sam.t", upcomingCount: 1 });
    });

    it("usernameChangeableAt while a change has to wait, also once cleared", async () => {
      await setUsername(member.token, "sam_t");
      await api.db.query(
        `update private.member_username_changes set first_claimed_at = now() - interval '10 days',
                last_claimed_at = now() - interval '10 days' where user_id = $1`,
        [member.userId],
      );
      const body = (await me(member.token)).body;
      expect(body.username).toBe("sam_t");
      expect(Math.abs(new Date(body.usernameChangeableAt).getTime() - (Date.now() + 20 * 86_400_000))).toBeLessThan(60_000);

      await api.call(deleteMyUsername, { token: member.token, method: "DELETE" });
      expect((await me(member.token)).body).toEqual({ usernameChangeableAt: body.usernameChangeableAt, upcomingCount: 0 });
    });

    it("only the token's account: another member's username never shows", async () => {
      const other = await api.signUp({ email: "alex@example.com" });
      await setUsername(other.token, "alex");
      expect((await me(member.token, { userId: other.userId })).body).toEqual({ upcomingCount: 0 });
    });
  });
});
