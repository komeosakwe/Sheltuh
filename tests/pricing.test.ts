import { describe, expect, it } from "vitest";
import { calculateOrderSummary } from "../lib/fees";
import {
  externalProviderLabel,
  formatFeedPrice,
  formatFeedPriceParts,
  formatTicketBreakdown,
  formatTicketHeadline,
  getMinBuyerTotalCents,
  getTicketBuyerTotalCents,
  isSoldOut,
  NO_TICKETS_LABEL,
  pricedTicketTypes,
  SOLD_OUT_LABEL,
} from "../lib/pricing";
import { sampleEvents } from "../lib/sample-events";
import type { SheltuhEvent } from "../lib/types";

function findEvent(slug: string): SheltuhEvent {
  const event = sampleEvents.find((e) => e.slug === slug);
  if (!event) throw new Error(`Fixture event not found: ${slug}`);
  return event;
}

describe("Neon Static (buyer-pays GA + organiser-absorbed VIP)", () => {
  const event = findEvent("neon-static");
  const [ga, vip] = event.ticketTypes;

  it("A$30 buyer-pays GA reads 'A$31.70 incl. booking fee'", () => {
    expect(ga.priceCents).toBe(3000);
    expect(formatTicketHeadline(ga)).toBe("A$31.70 incl. booking fee");
    expect(formatTicketBreakdown(ga)).toBe("A$30 ticket + A$1.70 booking fee");
  });

  it("A$55 organiser-absorbed VIP reads 'A$55 incl. booking fee'", () => {
    expect(vip.priceCents).toBe(5500);
    expect(formatTicketHeadline(vip)).toBe("A$55 incl. booking fee");
    expect(formatTicketBreakdown(vip)).toBe("A$55 ticket (booking fee included by organiser)");
  });

  it("feed card shows the cheaper of the two as 'From A$31.70 incl. booking fee'", () => {
    expect(getMinBuyerTotalCents(event)).toBe(3170);
    expect(formatFeedPrice(event)).toBe("From A$31.70 incl. booking fee");
  });
});

describe("free events", () => {
  it("a fully free event is labelled 'Free' on the feed", () => {
    const event = findEvent("southbank-sketch-salon");
    expect(getMinBuyerTotalCents(event)).toBe(0);
    expect(formatFeedPrice(event)).toBe("Free");
  });

  it("a free ticket has no breakdown text", () => {
    const event = findEvent("brunswick-zine-fair");
    expect(formatTicketHeadline(event.ticketTypes[0])).toBe("Free");
    expect(formatTicketBreakdown(event.ticketTypes[0])).toBeNull();
  });
});

describe("single-ticket-type events omit the 'From' prefix", () => {
  it("Analog Print Weekend (single organiser-absorbed ticket)", () => {
    const event = findEvent("analog-print-weekend");
    expect(event.ticketTypes).toHaveLength(1);
    expect(formatFeedPrice(event)).toBe(formatTicketHeadline(event.ticketTypes[0]));
    expect(formatFeedPrice(event)).not.toMatch(/^From/);
  });
});

/** Sample events sold on Sheltüh. External ones have no ticket types or price here, by design. */
const sheltuhSampleEvents = sampleEvents.filter((e) => e.ticketingMode !== "external");

describe("feed price stays consistent with the checkout total for every sample event", () => {
  it("covers the Sheltüh-ticketed ones (external events sell elsewhere and have no price here)", () => {
    expect(sheltuhSampleEvents.length).toBeGreaterThan(10);
    for (const e of sampleEvents.filter((x) => x.ticketingMode === "external")) {
      expect(e.ticketTypes).toEqual([]);
      expect(getMinBuyerTotalCents(e)).toBeNull();
    }
  });

  it.each(sheltuhSampleEvents)("$title", (event) => {
    const minTotal = getMinBuyerTotalCents(event);
    // Every sample event has ticket types, so there's a price.
    if (minTotal === null) throw new Error(`${event.slug} has no ticket types`);

    // The feed's minimum must actually be achievable by some ticket type.
    const achievable = event.ticketTypes.some(
      (ticket) => getTicketBuyerTotalCents(ticket) === minTotal,
    );
    expect(achievable).toBe(true);

    // Every ticket's buyer total must match what checking out 1 of that
    // ticket type would actually charge, via the same shared fee logic.
    for (const ticket of event.ticketTypes) {
      const checkoutTotal = calculateOrderSummary(ticket.priceCents, 1, ticket.feePolicy).totalCents;
      expect(getTicketBuyerTotalCents(ticket)).toBe(checkoutTotal);
      expect(getTicketBuyerTotalCents(ticket)).toBeGreaterThanOrEqual(minTotal);
    }
  });
});

describe("formatFeedPriceParts (the event page's buy bar)", () => {
  it("multi-price event: 'From' the cheapest all-inclusive total", () => {
    expect(formatFeedPriceParts(findEvent("neon-static"))).toEqual({
      amount: "From A$31.70",
      note: "incl. booking fee",
    });
  });

  it("single buyer-pays price: A$20 face value + A$1.30 fee, no 'From'", () => {
    expect(formatFeedPriceParts(findEvent("fitzroy-poetry-and-noise"))).toEqual({
      amount: "A$21.30",
      note: "incl. booking fee",
    });
  });

  it("single organiser-absorbs price: the face value is already the total", () => {
    expect(formatFeedPriceParts(findEvent("analog-print-weekend"))).toEqual({
      amount: "A$120",
      note: "incl. booking fee",
    });
  });

  it("free event: 'Free', with no booking fee", () => {
    expect(formatFeedPriceParts(findEvent("brunswick-zine-fair"))).toEqual({
      amount: "Free",
      note: "No booking fee",
    });
  });

  it("free and paid tickets together: 'Free', noting the paid ones carry a fee", () => {
    const base = findEvent("neon-static");
    const event: SheltuhEvent = {
      ...base,
      ticketTypes: [{ ...base.ticketTypes[0], id: "free", priceCents: 0 }, base.ticketTypes[0]],
    };
    expect(formatFeedPriceParts(event)).toEqual({ amount: "Free", note: "Paid tickets incl. booking fee" });
  });

  it("no ticket types: nothing to show (never 'A$Infinity')", () => {
    expect(formatFeedPriceParts({ ...findEvent("neon-static"), ticketTypes: [] })).toBeNull();
  });
});

describe("an event with no ticket types yet", () => {
  const event: SheltuhEvent = { ...findEvent("neon-static"), ticketTypes: [] };

  it("has no minimum price (null, never Infinity or 0)", () => {
    expect(getMinBuyerTotalCents(event)).toBeNull();
  });

  it("reads 'Tickets coming soon' on feed cards, not 'Free' or a price", () => {
    expect(formatFeedPrice(event)).toBe(NO_TICKETS_LABEL);
    expect(NO_TICKETS_LABEL).toBe("Tickets coming soon");
  });

  it.each(sheltuhSampleEvents)("matches the feed price for $title", (event) => {
    const parts = formatFeedPriceParts(event);
    expect(parts).not.toBeNull();
    // A sold-out event's parts have no note ("Sold out" alone).
    const joined = parts?.amount === "Free" ? "Free" : [parts?.amount, parts?.note].filter(Boolean).join(" ");
    expect(joined).toBe(formatFeedPrice(event));
  });
});

describe("an event ticketed on another site (external)", () => {
  const base: SheltuhEvent = {
    ...findEvent("neon-static"),
    ticketTypes: [],
    ticketingMode: "external",
    externalTicketUrl: "https://events.humanitix.com/a-night",
    externalFree: false,
    externalProvider: "Humanitix",
  };

  it("says where tickets are sold, never a price or 'Tickets coming soon'", () => {
    expect(formatFeedPrice(base)).toBe("Tickets on Humanitix");
    expect(formatFeedPriceParts(base)).toEqual({ amount: "Tickets on Humanitix", note: "" });
  });

  it("free entry: 'Free · Tickets on {provider}'", () => {
    const free = { ...base, externalFree: true };
    expect(formatFeedPrice(free)).toBe("Free · Tickets on Humanitix");
    expect(formatFeedPriceParts(free)).toEqual({ amount: "Free", note: "Tickets on Humanitix" });
  });

  it("an unknown site is 'the organiser's site', never the bare host", () => {
    const unknown = { ...base, externalTicketUrl: "https://www.example.com.au/rsvp", externalProvider: null };
    expect(formatFeedPrice(unknown)).toBe("Tickets on the organiser's site");
    expect(formatFeedPrice({ ...unknown, externalFree: true })).toBe("Free · Tickets on the organiser's site");
  });

  it("without the API's provider name, reads it from the link (known sites only)", () => {
    const rest: SheltuhEvent = { ...base, externalProvider: undefined };
    expect(externalProviderLabel({ ...rest, externalTicketUrl: "https://www.eventbrite.com.au/e/123" })).toBe("Eventbrite");
    expect(externalProviderLabel({ ...rest, externalTicketUrl: "https://tickets.example.org/x" })).toBe("the organiser's site");
  });

  it("covers the demo's two external events", () => {
    const external = sampleEvents.filter((e) => e.ticketingMode === "external");
    expect(external.map(formatFeedPrice).sort()).toEqual(["Free · Tickets on the organiser's site", "Tickets on Humanitix"]);
  });
});

describe("sold-out tiers (waitlist; brand-direction-one.md §6.5, §6.8)", () => {
  const base = findEvent("neon-static"); // GA A$30 buyer-pays (A$31.70), VIP A$55 absorbed
  const [ga, vip] = base.ticketTypes;

  it("takes 'From' from the cheapest tier still on sale", () => {
    const event: SheltuhEvent = { ...base, ticketTypes: [{ ...ga, soldOut: true, remaining: 0 }, vip] };
    expect(getMinBuyerTotalCents(event)).toBe(5500);
    expect(pricedTicketTypes(event).map((t) => t.id)).toEqual([vip.id]);
    // One tier left on sale: its exact price, without "From".
    expect(formatFeedPrice(event)).toBe("A$55 incl. booking fee");
    expect(formatFeedPriceParts(event)).toEqual({ amount: "A$55", note: "incl. booking fee" });
  });

  it("keeps 'From' while more than one tier is on sale", () => {
    const extra = { ...ga, id: "x", priceCents: 1000, soldOut: true };
    const event: SheltuhEvent = { ...base, ticketTypes: [extra, ga, vip] };
    expect(formatFeedPrice(event)).toBe("From A$31.70 incl. booking fee");
  });

  it("a sold-out free tier no longer makes the event 'Free'", () => {
    const free = { ...ga, id: "free", priceCents: 0, soldOut: true };
    const event: SheltuhEvent = { ...base, ticketTypes: [free, ga] };
    expect(formatFeedPrice(event)).toBe("A$31.70 incl. booking fee");
  });

  it("reads 'Sold out' when the server says every tier is, with no note", () => {
    const event: SheltuhEvent = {
      ...base,
      soldOut: true,
      ticketTypes: base.ticketTypes.map((t) => ({ ...t, soldOut: true, remaining: 0 })),
    };
    expect(isSoldOut(event)).toBe(true);
    expect(formatFeedPrice(event)).toBe(SOLD_OUT_LABEL);
    expect(formatFeedPriceParts(event)).toEqual({ amount: "Sold out", note: "" });
    // The tiers' prices are still advertised (muted on the event page): the cheapest of them.
    expect(getMinBuyerTotalCents(event)).toBe(3170);
  });

  it("an external event or one with no ticket types is never sold out", () => {
    expect(isSoldOut({ ...base, soldOut: true, ticketTypes: [], ticketingMode: "external" })).toBe(false);
    expect(isSoldOut({ ...base, soldOut: true, ticketTypes: [] })).toBe(false);
  });

  it("the demo has one sold-out event", () => {
    // Dead Letter Office; the seated demo (Off-Kilter) has seats left (lib/sample-seat-maps.ts).
    expect(sampleEvents.filter(isSoldOut).map((e) => e.slug)).toEqual(["dead-letter-office"]);
  });
});
