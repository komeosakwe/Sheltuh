import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { IssuedTicket, OrderLineItem } from "@/lib/server/types";

// Ticket codes are 40 random bits, so a clash with an existing ticket is
// rare; this makes the generator repeat itself on demand.
const codes = vi.hoisted(() => ({ queue: [] as string[] }));
vi.mock("@/lib/server/ticket-issuance", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/server/ticket-issuance")>();
  return {
    issueTickets: (lineItems: OrderLineItem[]): IssuedTicket[] =>
      real.issueTickets(lineItems).map((t) => ({ ...t, ticketCode: codes.queue.shift() ?? t.ticketCode })),
  };
});

const { confirmFreeOrder } = await import("@/lib/server/handlers/free-orders");
const { createCheckout } = await import("@/lib/server/handlers/orders");
const { TestApi } = await import("./helpers/api");
const { approvedOrganiser, publishedEvent, signUpAdmin } = await import("./helpers/fixtures");
const { createTestDb } = await import("./helpers/test-db");

let api: InstanceType<typeof TestApi>;
let reset: () => Promise<void>;
let eventId: string;

beforeAll(async () => {
  const testDb = await createTestDb();
  reset = testDb.reset;
  api = new TestApi(testDb.db);
});

beforeEach(async () => {
  await reset();
  api = new TestApi(api.db);
  codes.queue = [];
  const admin = await signUpAdmin(api);
  const organiser = await approvedOrganiser(api, admin);
  const event = await publishedEvent(api, organiser, admin, {
    ticketTypes: [{ id: "rsvp", name: "RSVP", priceCents: 0, feePolicy: "buyer-pays", quantityAvailable: 20 }],
  });
  eventId = event.eventId;
});

async function memberClaim(email: string) {
  const member = await api.signUp({ email });
  return api.call(createCheckout, {
    token: member.token,
    params: { eventId },
    body: { lineItems: [{ ticketTypeId: "rsvp", quantity: 1 }], buyerEmail: email },
  });
}

describe("a ticket code that clashes with an existing ticket", () => {
  it("is retried once with fresh codes (member claim)", async () => {
    codes.queue = ["AAAA-AAAA"];
    expect((await memberClaim("a@example.com")).status).toBe(201);
    codes.queue = ["AAAA-AAAA"]; // the same code again: clashes, then a fresh one
    expect((await memberClaim("b@example.com")).status).toBe(201);
    const rows = await api.db.query<{ n: number }>(`select count(*)::int as n from public.tickets`);
    expect(rows[0].n).toBe(2);
  });

  it("is retried once with fresh codes (guest confirmation)", async () => {
    codes.queue = ["BBBB-BBBB"];
    expect((await memberClaim("a@example.com")).status).toBe(201);
    await api.call(createCheckout, {
      params: { eventId },
      body: { lineItems: [{ ticketTypeId: "rsvp", quantity: 1 }], buyerEmail: "guest@example.com" },
    });
    await api.runDeferred(); // the link is emailed after the response
    const token = api.sendEmail.mock.calls.at(-1)![0].text.match(/#token=([A-Za-z0-9_-]+)/)![1];
    codes.queue = ["BBBB-BBBB"];
    expect((await api.call(confirmFreeOrder, { body: { token } })).status).toBe(200);
  });

  it("fails the request if the retry clashes too (only once), leaving nothing half-done", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    codes.queue = ["CCCC-CCCC"];
    await memberClaim("a@example.com");
    codes.queue = ["CCCC-CCCC", "CCCC-CCCC"];
    expect((await memberClaim("b@example.com")).status).toBe(500);
    const [{ n }] = await api.db.query<{ n: number }>(`select count(*)::int as n from public.orders`);
    expect(n).toBe(1);
    const [{ sold }] = await api.db.query<{ sold: number }>(`select quantity_sold as sold from public.ticket_types`);
    expect(sold).toBe(1);
  });
});
