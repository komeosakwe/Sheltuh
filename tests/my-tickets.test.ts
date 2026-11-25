import { describe, expect, it } from "vitest";
import type { MyTicketItem, MyTicketOrderItem, MyTicketReceivedItem } from "@/lib/api/types";
import {
  mergeMyTickets,
  myTicketCard,
  myTicketHref,
  myTicketKey,
  myTicketWhen,
  MY_TICKETS_PAGE_SIZE,
  NO_DATE_WHEN,
  showMoreCount,
  showMoreSection,
  splitMyTickets,
  UNLISTED_WHEN,
} from "@/lib/my-tickets";
import { sampleMyTickets } from "@/lib/sample-order";

const NOW = new Date("2027-11-01T00:00:00.000Z");

/** Sat 13 Nov 2027, 5–9 pm in Melbourne (AEDT). */
const EVENT = {
  eventTitle: "Here & Now",
  eventListed: true,
  eventSlug: "here-and-now",
  eventStartsAt: "2027-11-13T06:00:00.000Z",
  eventEndsAt: "2027-11-13T10:00:00.000Z",
  eventTimeZone: "Australia/Melbourne",
  eventState: "VIC",
  venueName: "Interconnect Studio",
  suburb: "Coburg North",
} as const;

function order(overrides: Partial<MyTicketOrderItem> = {}): MyTicketOrderItem {
  return {
    kind: "order",
    section: "upcoming",
    ...EVENT,
    orderId: "11111111-2222-4333-8444-555555555555",
    status: "paid",
    totalCents: 2594,
    ticketCount: 1,
    heldCount: 1,
    pendingCount: 0,
    checkedInCount: 0,
    ticketTypeName: "Second release",
    ...overrides,
  };
}

function received(overrides: Partial<MyTicketReceivedItem> = {}): MyTicketReceivedItem {
  return {
    kind: "received",
    section: "upcoming",
    ...EVENT,
    transferId: "0b5c2f8e-7d6a-4c1b-9e3f-2a1d4c5b6e7f",
    reference: "#0B5C2F8E",
    status: "valid",
    fromName: "Alex Chen",
    holderName: "Sam Lee",
    acceptedAt: "2027-10-30T00:00:00.000Z",
    ticketTypeName: "General admission",
    ...overrides,
  };
}

describe("myTicketWhen", () => {
  it("is the ticket's date and time in the event's zone", () => {
    expect(myTicketWhen(order(), NOW)).toBe("Sat 13 Nov · 5–9 pm");
  });

  it("adds the year when it isn't this year", () => {
    expect(myTicketWhen(order({ eventStartsAt: "2026-11-14T06:00:00.000Z", eventEndsAt: "2026-11-14T10:00:00.000Z" }), NOW)).toBe(
      "Sat 14 Nov 2026 · 5–9 pm",
    );
  });

  it("names the zone when its clock isn't Melbourne's", () => {
    const perth = order({ eventTimeZone: "Australia/Perth", eventState: "WA", eventStartsAt: "2027-11-13T11:00:00.000Z", eventEndsAt: "2027-11-13T14:00:00.000Z" });
    expect(myTicketWhen(perth, NOW)).toBe("Sat 13 Nov · 7–10 pm Perth time");
  });

  it("has a fallback for an unlisted event (no times are sent) and for no start at all", () => {
    expect(myTicketWhen(order({ eventListed: false, eventStartsAt: undefined, eventEndsAt: undefined }), NOW)).toBe(UNLISTED_WHEN);
    expect(myTicketWhen(order({ eventStartsAt: undefined }), NOW)).toBe(NO_DATE_WHEN);
  });
});

describe("myTicketCard: orders (counts only, so generic words)", () => {
  it("a ticket that's yours: Active, its type and count, Show ticket to the order page", () => {
    const card = myTicketCard(order(), NOW);
    expect(card).toMatchObject({
      state: "active",
      when: "Sat 13 Nov · 5–9 pm",
      eventTitle: "Here & Now",
      venue: "Interconnect Studio",
      holder: "Second release",
      count: "1 ticket",
      href: "/checkout/success?session_id=11111111-2222-4333-8444-555555555555",
      action: { kind: "show" },
    });
    expect(card.status).toBeUndefined();
  });

  it("one on offer: Waiting to be accepted (how many were sent, with several tickets)", () => {
    expect(myTicketCard(order({ pendingCount: 1 }), NOW)).toMatchObject({ state: "transfer_pending", status: "Waiting to be accepted" });
    expect(myTicketCard(order({ ticketCount: 3, heldCount: 3, pendingCount: 1 }), NOW)).toMatchObject({
      state: "transfer_pending",
      status: "1 sent, waiting for them to accept",
      count: "3 tickets",
    });
  });

  it("checked in: ✓ Checked in (with how many of the held tickets, for several)", () => {
    expect(myTicketCard(order({ checkedInCount: 1 }), NOW)).toMatchObject({ state: "checked_in", status: "✓ Checked in" });
    expect(myTicketCard(order({ ticketCount: 2, heldCount: 2, checkedInCount: 1 }), NOW)).toMatchObject({
      state: "checked_in",
      status: "✓ 1 of 2 checked in",
    });
  });

  it("some sent on: still upcoming, the holder row says how many went", () => {
    expect(myTicketCard(order({ ticketCount: 3, heldCount: 1 }), NOW)).toMatchObject({ state: "active", holder: "Second release · 2 sent" });
  });

  it("every ticket sent: Transferred, in Past, with View order (no Show ticket)", () => {
    expect(myTicketCard(order({ section: "past", ticketCount: 2, heldCount: 0 }), NOW)).toMatchObject({
      state: "transferred",
      status: "2 sent. These QR codes no longer work.",
      action: { kind: "status", label: "View order" },
    });
    expect(myTicketCard(order({ section: "past", heldCount: 0 }), NOW).status).toBe("Sent. This QR code no longer works.");
  });

  it("refunded: Refunded with the all-inclusive total; not reserved: the refund on its way", () => {
    expect(myTicketCard(order({ section: "past", status: "refunded", refundReason: "refunded", heldCount: 0 }), NOW)).toMatchObject({
      state: "refunded",
      status: "Refunded A$25.94",
      action: { kind: "status", label: "View order" },
    });
    expect(
      myTicketCard(order({ section: "past", status: "oversold_refund_required", refundReason: "oversold", ticketCount: 0, heldCount: 0, ticketTypeName: undefined }), NOW),
    ).toMatchObject({ state: "refunded", status: "Tickets not reserved. A$25.94 refund on its way.", holder: "No tickets issued", count: undefined });
    expect(myTicketCard(order({ section: "past", status: "refunded", totalCents: 0 }), NOW).status).toBe("Refunded");
  });

  it("ended: Event ended, View order", () => {
    expect(myTicketCard(order({ section: "past" }), NOW)).toMatchObject({ state: "ended", status: "Event ended", action: { kind: "status", label: "View order" } });
  });

  it("several ticket types: says so; an unlisted event: no venue, the no-date line", () => {
    const card = myTicketCard(
      order({ ticketCount: 2, heldCount: 2, ticketTypeName: undefined, eventListed: false, eventSlug: undefined, eventStartsAt: undefined, eventEndsAt: undefined, venueName: undefined, suburb: undefined }),
      NOW,
    );
    expect(card).toMatchObject({ holder: "Several ticket types", when: UNLISTED_WHEN, venue: undefined, state: "active" });
  });
});

describe("myTicketCard: received tickets", () => {
  it("valid: the holder and type, who it came from, Show ticket to the received page", () => {
    expect(myTicketCard(received(), NOW)).toMatchObject({
      state: "active",
      holder: "Sam Lee · General admission",
      count: "From Alex",
      href: "/tickets/received/0b5c2f8e-7d6a-4c1b-9e3f-2a1d4c5b6e7f",
      action: { kind: "show" },
    });
  });

  it("checked in: the time, in the event's zone", () => {
    expect(myTicketCard(received({ checkedInAt: "2027-11-13T06:42:00.000Z" }), NOW)).toMatchObject({ state: "checked_in", status: "✓ Checked in 5:42 pm" });
  });

  it("void: no longer valid; ended: Event ended; both View ticket", () => {
    expect(myTicketCard(received({ section: "past", status: "void" }), NOW)).toMatchObject({
      state: "transferred",
      status: "This ticket is no longer valid",
      action: { kind: "status", label: "View ticket" },
    });
    expect(myTicketCard(received({ section: "past" }), NOW)).toMatchObject({ state: "ended", status: "Event ended" });
  });
});

describe("pages", () => {
  const a = order({ orderId: "a" });
  const b = received({ transferId: "b" });
  const c = order({ orderId: "c", section: "past" });

  it("keys keep the kinds apart; hrefs encode the id", () => {
    expect(myTicketKey(order({ orderId: "x" }))).toBe("order:x");
    expect(myTicketKey(received({ transferId: "x" }))).toBe("received:x");
    expect(myTicketHref(order({ orderId: "a b" }))).toBe("/checkout/success?session_id=a%20b");
  });

  it("merges a page without repeating a card (the first stays)", () => {
    const moved = { ...a, section: "past" as const };
    const merged = mergeMyTickets([a, b], [moved, c]);
    expect(merged.map(myTicketKey)).toEqual(["order:a", "received:b", "order:c"]);
    expect(merged[0].section).toBe("upcoming");
  });

  it("splits by the API's section, in its order", () => {
    expect(splitMyTickets([a, c, b])).toEqual({ upcoming: [a, b], past: [c] });
  });

  it("Show more goes under the list of the last card loaded, whatever the counts say", () => {
    expect(showMoreSection([a, b], true)).toBe("upcoming");
    expect(showMoreSection([a, c], true)).toBe("past");
    // The counts drifted (they still say 3 upcoming), but a past card is in: the pages have reached Past.
    expect(showMoreSection([a, b, c], true)).toBe("past");
    expect(showMoreSection([], true)).toBe("upcoming");
    expect(showMoreSection([a, b, c], false)).toBeNull();
  });

  it("Show N more: a page, or what's left by the counts; none left by them (drift): plain Show more", () => {
    expect(showMoreCount({ upcoming: 30, past: 10 }, 20)).toBe(MY_TICKETS_PAGE_SIZE);
    expect(showMoreCount({ upcoming: 3, past: 4 }, 5)).toBe(2);
    expect(showMoreCount({ upcoming: 3, past: 2 }, 5)).toBeNull();
  });
});

describe("sampleMyTickets (the demo)", () => {
  it("is dated from now: upcoming cards are still to come, an ended one is in the past", () => {
    const now = Date.parse("2030-06-01T00:00:00.000Z");
    const page = sampleMyTickets(now);
    expect(page.counts).toEqual({ upcoming: 3, past: 2 });
    const upcoming = page.items.filter((item) => item.section === "upcoming");
    expect(upcoming.every((item) => Date.parse(item.eventStartsAt ?? "") > now)).toBe(true);
    const ended = page.items.find((item): item is MyTicketItem => item.section === "past" && item.kind === "order" && item.status === "paid");
    expect(Date.parse(ended?.eventEndsAt ?? "")).toBeLessThan(now);
    // Each card says a state of its own.
    expect(page.items.map((item) => myTicketCard(item, new Date(now)).state)).toEqual(["active", "transfer_pending", "active", "refunded", "ended"]);
  });

  it("prices with the fee maths (all-inclusive totals) and carries no codes", () => {
    const page = sampleMyTickets(Date.now());
    for (const item of page.items) {
      if (item.kind === "order") expect(item.totalCents).toBeGreaterThan(0);
    }
    expect(JSON.stringify(page)).not.toMatch(/ticketCode|code/i);
  });
});
