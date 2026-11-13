import { describe, expect, it } from "vitest";
import { calculateOrderSummary } from "../lib/fees";
import {
  EXTERNAL_NO_PRICE_LABEL,
  externalPriceFromLabel,
  externalProviderLabel,
  formatFeedPrice,
  formatFeedPriceParts,
  formatTicketBreakdown,
  formatTicketHeadline,
  fromPriceTicketTypes,
  getMinBuyerTotalCents,
  getTicketBuyerTotalCents,
  isSoldOut,
  NO_TICKETS_LABEL,
  pricedTicketTypes,
  SOLD_OUT_LABEL,
  startingPrice,
} from "../lib/pricing";
import { sampleEvents } from "../lib/sample-events";
import type { SheltuhEvent, TicketType } from "../lib/types";

function findEvent(slug: string): SheltuhEvent {
  const event = sampleEvents.find((e) => e.slug === slug);
  if (!event) throw new Error(`Fixture event not found: ${slug}`);
  return event;
}

describe("Neon Static (buyer-pays GA + organiser-absorbed VIP)", () => {
  const event = findEvent("neon-static");
  const [ga, vip] = event.ticketTypes;

  it("A$30 buyer-pays GA reads 'A$32.30 incl. booking fee'", () => {
    expect(ga.priceCents).toBe(3000);
    expect(formatTicketHeadline(ga)).toBe("A$32.30 incl. booking fee");
    expect(formatTicketBreakdown(ga)).toBe("A$30 ticket + A$2.30 booking fee");
  });

  it("A$55 organiser-absorbed VIP reads 'A$55 incl. booking fee'", () => {
    expect(vip.priceCents).toBe(5500);
    expect(formatTicketHeadline(vip)).toBe("A$55 incl. booking fee");
    expect(formatTicketBreakdown(vip)).toBe("A$55 ticket (booking fee included by organiser)");
  });

  it("feed card shows the cheaper of the two as 'From A$32.30 incl. booking fee'", () => {
    expect(getMinBuyerTotalCents(event)).toBe(3230);
    expect(formatFeedPrice(event)).toBe("From A$32.30 incl. booking fee");
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
      amount: "From A$32.30",
      note: "incl. booking fee",
    });
  });

  it("single buyer-pays price: A$20 face value + A$1.70 fee, no 'From'", () => {
    expect(formatFeedPriceParts(findEvent("fitzroy-poetry-and-noise"))).toEqual({
      amount: "A$21.70",
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

  it("paid with no organiser price: 'Buy tickets', never a price, the site's name or 'Tickets coming soon'", () => {
    expect(formatFeedPrice(base)).toBe("Buy tickets");
    expect(formatFeedPrice(base)).toBe(EXTERNAL_NO_PRICE_LABEL);
    expect(formatFeedPriceParts(base)).toEqual({ amount: "Buy tickets", note: "" });
  });

  it("free entry: just 'Free'", () => {
    const free = { ...base, externalFree: true };
    expect(formatFeedPrice(free)).toBe("Free");
    expect(formatFeedPriceParts(free)).toEqual({ amount: "Free", note: "" });
  });

  it("an unknown site reads the same as a known one", () => {
    const unknown = { ...base, externalTicketUrl: "https://www.example.com.au/rsvp", externalProvider: null };
    expect(formatFeedPrice(unknown)).toBe("Buy tickets");
    expect(formatFeedPrice({ ...unknown, externalFree: true })).toBe("Free");
  });

  it("never names the ticketing site, whatever the provider", () => {
    const variants: SheltuhEvent[] = [
      base,
      { ...base, externalFree: true },
      { ...base, externalPriceFromCents: 8900 },
      { ...base, externalProvider: null, externalTicketUrl: "https://www.example.com.au/rsvp" },
      { ...base, externalProvider: undefined, externalTicketUrl: "https://www.eventbrite.com.au/e/123" },
    ];
    for (const event of variants) {
      const { amount, note } = formatFeedPriceParts(event) ?? { amount: "", note: "" };
      for (const text of [formatFeedPrice(event), amount, note]) {
        expect(text).not.toMatch(/Humanitix|Eventbrite|organiser.s site|Tickets on|Sold by/i);
      }
    }
  });

  it("without the API's provider name, reads it from the link (known sites only)", () => {
    const rest: SheltuhEvent = { ...base, externalProvider: undefined };
    expect(externalProviderLabel({ ...rest, externalTicketUrl: "https://www.eventbrite.com.au/e/123" })).toBe("Eventbrite");
    expect(externalProviderLabel({ ...rest, externalTicketUrl: "https://tickets.example.org/x" })).toBe("the organiser's site");
  });

  it("covers the demo's two external events", () => {
    const external = sampleEvents.filter((e) => e.ticketingMode === "external");
    expect(external.map(formatFeedPrice).sort()).toEqual(["Free", "From A$35"]);
  });

  it("the organiser's price: just 'From A$89', never 'incl. booking fee'", () => {
    const priced = { ...base, externalPriceFromCents: 8900 };
    expect(formatFeedPrice(priced)).toBe("From A$89");
    expect(formatFeedPriceParts(priced)).toEqual({ amount: "From A$89", note: "" });
    expect(formatFeedPrice({ ...base, externalPriceFromCents: 12050 })).toBe("From A$120.50");
    expect(externalPriceFromLabel(priced)).toBe("From A$89");
  });

  it("is ignored for a free event, a missing or zero price, and a Sheltüh-ticketed event", () => {
    expect(formatFeedPrice({ ...base, externalFree: true, externalPriceFromCents: 8900 })).toBe("Free");
    expect(externalPriceFromLabel({ ...base, externalPriceFromCents: 0 })).toBeNull();
    expect(externalPriceFromLabel(base)).toBeNull();
    expect(externalPriceFromLabel({ ...findEvent("neon-static"), externalPriceFromCents: 8900 })).toBeNull();
  });
});

describe("sold-out tiers (waitlist; brand-direction-one.md §6.5, §6.8)", () => {
  const base = findEvent("neon-static"); // GA A$30 buyer-pays (A$32.30), VIP A$55 absorbed
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
    expect(formatFeedPrice(event)).toBe("From A$32.30 incl. booking fee");
  });

  it("a sold-out free tier no longer makes the event 'Free'", () => {
    const free = { ...ga, id: "free", priceCents: 0, soldOut: true };
    const event: SheltuhEvent = { ...base, ticketTypes: [free, ga] };
    expect(formatFeedPrice(event)).toBe("A$32.30 incl. booking fee");
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
    expect(getMinBuyerTotalCents(event)).toBe(3230);
  });

  it("an external event or one with no ticket types is never sold out", () => {
    expect(isSoldOut({ ...base, soldOut: true, ticketTypes: [], ticketingMode: "external" })).toBe(false);
    expect(isSoldOut({ ...base, soldOut: true, ticketTypes: [] })).toBe(false);
  });

  it("a tier still waiting for the one above to sell out never sets 'From' or makes the event 'Free'", () => {
    const waiting = { ...vip, opensAfterPrevious: true, opensAfter: { ticketTypeId: ga.id, name: ga.name } };
    const event: SheltuhEvent = { ...base, ticketTypes: [ga, waiting] };
    expect(pricedTicketTypes(event).map((t) => t.id)).toEqual([ga.id]);
    expect(formatFeedPrice(event)).toBe("A$32.30 incl. booking fee");
    expect(formatFeedPriceParts(event)).toEqual({ amount: "A$32.30", note: "incl. booking fee" });

    // A free tier above a waiting paid one: free, and says nothing of the paid ticket.
    const freeFirst: SheltuhEvent = { ...base, ticketTypes: [{ ...ga, priceCents: 0 }, waiting] };
    expect(formatFeedPrice(freeFirst)).toBe("Free");
    expect(formatFeedPriceParts(freeFirst)).toEqual({ amount: "Free", note: "No booking fee" });

    // Once it opens (the server drops opensAfter) it counts again.
    const open: SheltuhEvent = { ...base, ticketTypes: [{ ...ga, soldOut: true, remaining: 0 }, { ...waiting, opensAfter: undefined }] };
    expect(pricedTicketTypes(open).map((t) => t.id)).toEqual([vip.id]);
  });

  it("the demo has one sold-out event", () => {
    // Dead Letter Office; the seated demo (Off-Kilter) has seats left (lib/sample-seat-maps.ts).
    expect(sampleEvents.filter(isSoldOut).map((e) => e.slug)).toEqual(["dead-letter-office"]);
  });
});

describe("group tickets in the 'From' price", () => {
  const single: TicketType = { id: "ga", name: "General admission", priceCents: 3500, feePolicy: "buyer-pays", quantityAvailable: 100 };
  const group: TicketType = { id: "grp", name: "Group of 4", priceCents: 12000, feePolicy: "buyer-pays", quantityAvailable: 40, admits: 4 };
  const groupOf6: TicketType = { id: "g6", name: "Group of 6", priceCents: 15000, feePolicy: "buyer-pays", quantityAvailable: 60, admits: 6 };
  const base: SheltuhEvent = { ...findEvent("neon-static"), ticketTypes: [], soldOut: undefined };
  const event = (ticketTypes: TicketType[]): SheltuhEvent => ({ ...base, ticketTypes });

  it("skips group tickets when a single is on sale: a group's price is not a price per person", () => {
    const e = event([group, single]);
    expect(fromPriceTicketTypes(e).map((t) => t.id)).toEqual(["ga"]);
    expect(getMinBuyerTotalCents(e)).toBe(3760);
    expect(formatFeedPrice(e)).toBe("A$37.60 incl. booking fee");
    expect(formatFeedPriceParts(e)).toEqual({ amount: "A$37.60", note: "incl. booking fee" });
    // "On sale" and "free" are still read from every tier on sale.
    expect(pricedTicketTypes(e).map((t) => t.id)).toEqual(["grp", "ga"]);
  });

  it("says 'for 4' when only group tickets are on sale", () => {
    const e = event([group]);
    expect(formatFeedPrice(e)).toBe("A$127.70 for 4 incl. booking fee");
    expect(formatFeedPriceParts(e)).toEqual({ amount: "A$127.70 for 4", note: "incl. booking fee" });
    // Two groups: 'From' the cheaper, and says its size.
    expect(formatFeedPrice(event([groupOf6, group]))).toBe("From A$127.70 for 4 incl. booking fee");
    expect(formatFeedPriceParts(event([groupOf6, group]))).toEqual({ amount: "From A$127.70 for 4", note: "incl. booking fee" });
  });

  it("a group ticket's headline is the whole group's, said like the feed ('for 4')", () => {
    expect(formatTicketHeadline(group)).toBe("A$127.70 for 4 incl. booking fee");
    expect(formatTicketHeadline({ ...group, feePolicy: "organiser-absorbs" })).toBe("A$120 for 4 incl. booking fee");
    expect(formatTicketHeadline(single)).toBe("A$37.60 incl. booking fee");
  });

  it("a sold-out single leaves the group as the price", () => {
    const e = event([{ ...single, soldOut: true, remaining: 0 }, group]);
    expect(formatFeedPrice(e)).toBe("A$127.70 for 4 incl. booking fee");
  });

  it("an event whose every tier is sold out reads 'Sold out'", () => {
    const e: SheltuhEvent = { ...base, soldOut: true, ticketTypes: [{ ...group, soldOut: true, remaining: 0 }] };
    expect(formatFeedPrice(e)).toBe(SOLD_OUT_LABEL);
  });

  it("a free single beside a group ticket is 'Free', and says the group is paid", () => {
    const e = event([{ ...single, priceCents: 0 }, group]);
    expect(formatFeedPrice(e)).toBe("Free");
    expect(formatFeedPriceParts(e)).toEqual({ amount: "Free", note: "Paid tickets incl. booking fee" });
  });

  it("an event of single tickets reads as before", () => {
    expect(formatFeedPrice(event([single]))).toBe("A$37.60 incl. booking fee");
    expect(formatFeedPrice(event([single, { ...single, id: "vip", priceCents: 5500 }]))).toBe("From A$37.60 incl. booking fee");
  });
});


describe("startingPrice (the event page's buy bar before a choice)", () => {
  it("says From before any amount, even with one ticket type, so a starting price never reads as a total", () => {
    const single: TicketType = { id: "ga", name: "General admission", priceCents: 3500, feePolicy: "buyer-pays", quantityAvailable: 100 };
    const amount = formatFeedPriceParts({ ...findEvent("neon-static"), ticketTypes: [single] })?.amount ?? "";
    expect(amount).toBe("A$37.60");
    expect(startingPrice(amount)).toBe("From A$37.60");
  });

  it("leaves Free, Sold out and an amount that already says From as they are", () => {
    expect(startingPrice("Free")).toBe("Free");
    expect(startingPrice("Sold out")).toBe("Sold out");
    expect(startingPrice("From A$37.60")).toBe("From A$37.60");
  });
});
