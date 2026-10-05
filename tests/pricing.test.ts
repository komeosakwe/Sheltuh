import { describe, expect, it } from "vitest";
import { calculateOrderSummary } from "../lib/fees";
import {
  formatFeedPrice,
  formatFeedPriceParts,
  formatTicketBreakdown,
  formatTicketHeadline,
  getMinBuyerTotalCents,
  getTicketBuyerTotalCents,
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

describe("feed price stays consistent with the checkout total for every sample event", () => {
  it.each(sampleEvents)("$title", (event) => {
    const minTotal = getMinBuyerTotalCents(event);

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

  it.each(sampleEvents)("matches the feed price for $title", (event) => {
    const parts = formatFeedPriceParts(event);
    expect(parts).not.toBeNull();
    const joined = parts?.amount === "Free" ? "Free" : `${parts?.amount} ${parts?.note}`;
    expect(joined).toBe(formatFeedPrice(event));
  });
});
