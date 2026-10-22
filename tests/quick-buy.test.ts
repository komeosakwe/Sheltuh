import { describe, expect, it } from "vitest";
import { goesToSeatPage, quickBuyHref, quickBuyLabel } from "@/lib/quick-buy";
import type { SheltuhEvent, TicketType } from "@/lib/types";

const ticket = (priceCents: number): TicketType => ({
  id: `t${priceCents}`,
  name: "GA",
  priceCents,
  feePolicy: "buyer-pays",
  quantityAvailable: 10,
});

const event = (overrides: Partial<SheltuhEvent> = {}): SheltuhEvent => ({
  id: "e",
  slug: "e",
  title: "E",
  description: "d",
  category: "art",
  suburb: "s",
  venueName: "v",
  venueAddress: "a",
  startsAt: "2026-11-01T08:00:00.000Z",
  endsAt: "2026-11-01T11:00:00.000Z",
  organiserName: "o",
  poster: { pattern: "rings", background: "#000000", primary: "#ffffff", secondary: "#ff4800" },
  ticketTypes: [ticket(3000)],
  ...overrides,
});

const external = (externalFree: boolean) =>
  event({ ticketTypes: [], ticketingMode: "external", externalTicketUrl: "https://dice.fm/x", externalFree, externalProvider: "DICE" });

describe("quickBuyLabel (brand-direction-one.md §6.6; owner wording, 21 Oct 2026)", () => {
  it.each([
    ["paid", event(), "Buy tickets"],
    ["all free", event({ ticketTypes: [ticket(0), ticket(0)] }), "Get free tickets"],
    ["free and paid tiers", event({ ticketTypes: [ticket(0), ticket(1500)] }), "Buy tickets"],
    ["external, paid", external(false), "Buy tickets"],
    // mobile-redesign.md §6.2.3 row 2 (manager decision, 22 Oct 2026): the organiser says entry is free.
    ["external, free", external(true), "Get free tickets"],
  ])("%s: %s", (_label, e, expected) => {
    expect(quickBuyLabel(e)).toBe(expected);
  });

  it("never says 'See tickets' or 'Get tickets' any more (demo mode included: the same words)", () => {
    for (const e of [event(), event({ ticketTypes: [ticket(0)] }), external(false), external(true)]) {
      expect(quickBuyLabel(e)).not.toMatch(/^(See|Get) tickets$/);
    }
  });

  it("no link when there are no ticket types yet (the card says 'Tickets coming soon')", () => {
    expect(quickBuyLabel(event({ ticketTypes: [] }))).toBeNull();
  });

  it("no link once the event has ended, an external one included", () => {
    expect(quickBuyLabel(event(), new Date("2026-11-01T11:00:00.000Z"))).toBeNull();
    expect(quickBuyLabel(event(), new Date("2026-11-01T10:59:59.000Z"))).toBe("Buy tickets");
    expect(quickBuyLabel(external(true), new Date("2026-11-01T11:00:00.000Z"))).toBeNull();
  });
});

describe("quickBuyLabel when sold out (§6.5 sold-out variant, §6.11)", () => {
  const soldOut = (overrides: Partial<SheltuhEvent> = {}) =>
    event({ soldOut: true, ticketTypes: [{ ...ticket(3000), soldOut: true, remaining: 0 }], ...overrides });

  it("says Join waitlist (to the same #tickets) while the event hasn't ended", () => {
    expect(quickBuyLabel(soldOut(), new Date("2026-10-21T00:00:00Z"))).toBe("Join waitlist");
  });

  it("offers nothing once it has ended", () => {
    expect(quickBuyLabel(soldOut(), new Date("2026-11-02T00:00:00Z"))).toBeNull();
  });

  it("a sold-out paid tier beside a free one on sale: Get free tickets", () => {
    const e = event({ ticketTypes: [ticket(0), { ...ticket(3000), soldOut: true }] });
    expect(quickBuyLabel(e)).toBe("Get free tickets");
  });

  it("an external event is never sold out", () => {
    expect(quickBuyLabel({ ...external(false), soldOut: true })).toBe("Buy tickets");
  });
});

describe("seated events (reserved seating; docs/design/seating.md §5.1, manager decision)", () => {
  const seated = (overrides: Partial<SheltuhEvent> = {}) =>
    event({ seating: { version: 3 }, ticketTypes: [{ ...ticket(3000), seated: true }], ...overrides });

  it("says Choose seats and goes straight to the seat page while on sale", () => {
    expect(quickBuyLabel(seated())).toBe("Choose seats");
    expect(quickBuyHref(seated())).toBe("/events/e/seats");
    expect(goesToSeatPage(seated())).toBe(true);
  });

  it("sold out: Join waitlist, to the event's tickets section (the waitlist is there)", () => {
    const e = seated({ soldOut: true, ticketTypes: [{ ...ticket(3000), seated: true, soldOut: true, remaining: 0 }] });
    expect(quickBuyLabel(e)).toBe("Join waitlist");
    expect(quickBuyHref(e)).toBe("/events/e#tickets");
  });

  it("general admission events keep #tickets", () => {
    expect(quickBuyHref(event())).toBe("/events/e#tickets");
    expect(goesToSeatPage(event())).toBe(false);
  });
});
