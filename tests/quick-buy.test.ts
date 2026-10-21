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

describe("quickBuyLabel (brand-direction-one.md §6.6; owner wording, 21 Oct 2026)", () => {
  it.each([
    ["paid", event(), "Buy tickets"],
    ["all free", event({ ticketTypes: [ticket(0), ticket(0)] }), "Get free tickets"],
    ["free and paid tiers", event({ ticketTypes: [ticket(0), ticket(1500)] }), "Buy tickets"],
    ["external, paid", external(false), "Buy tickets"],
    ["external, free", external(true), "Buy tickets"],
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

  it("no link once the event has ended", () => {
    expect(quickBuyLabel(event(), new Date("2026-11-01T11:00:00.000Z"))).toBeNull();
    expect(quickBuyLabel(event(), new Date("2026-11-01T10:59:59.000Z"))).toBe("Buy tickets");
  });
});
