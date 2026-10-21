import { describe, expect, it } from "vitest";
import { quickBuyLabel } from "@/lib/quick-buy";
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

describe("quickBuyLabel (brand-direction-one.md §6.6)", () => {
  it.each([
    ["paid", event(), "Get tickets"],
    ["all free", event({ ticketTypes: [ticket(0), ticket(0)] }), "Get free tickets"],
    ["free and paid tiers", event({ ticketTypes: [ticket(0), ticket(1500)] }), "Get tickets"],
    ["external, paid", external(false), "Get tickets"],
    ["external, free", external(true), "Get tickets"],
  ])("live, %s: %s", (_label, e, expected) => {
    expect(quickBuyLabel(e, "live")).toBe(expected);
  });

  it("demo: 'See tickets' (nothing is bookable)", () => {
    expect(quickBuyLabel(event(), "demo")).toBe("See tickets");
    expect(quickBuyLabel(event({ ticketTypes: [ticket(0)] }), "demo")).toBe("See tickets");
    expect(quickBuyLabel(external(false), "demo")).toBe("See tickets");
  });

  it("no link when there are no ticket types yet (the card says 'Tickets coming soon')", () => {
    expect(quickBuyLabel(event({ ticketTypes: [] }), "live")).toBeNull();
    expect(quickBuyLabel(event({ ticketTypes: [] }), "demo")).toBeNull();
  });

  it("no link once the event has ended", () => {
    expect(quickBuyLabel(event(), "live", new Date("2026-11-01T11:00:00.000Z"))).toBeNull();
    expect(quickBuyLabel(event(), "live", new Date("2026-11-01T10:59:59.000Z"))).toBe("Get tickets");
  });
});
