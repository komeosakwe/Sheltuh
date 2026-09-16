import { describe, expect, it } from "vitest";
import { calculateOrderSummary } from "../lib/fees";
import {
  formatFeedPrice,
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

  it("A$30 buyer-pays GA reads 'A$32 incl. booking fee'", () => {
    expect(ga.priceCents).toBe(3000);
    expect(formatTicketHeadline(ga)).toBe("A$32 incl. booking fee");
    expect(formatTicketBreakdown(ga)).toBe("A$30 ticket + A$2 booking fee");
  });

  it("A$55 organiser-absorbed VIP reads 'A$55 incl. booking fee'", () => {
    expect(vip.priceCents).toBe(5500);
    expect(formatTicketHeadline(vip)).toBe("A$55 incl. booking fee");
    expect(formatTicketBreakdown(vip)).toBe("A$55 ticket (booking fee included by organiser)");
  });

  it("feed card shows the cheaper of the two as 'From A$32 incl. booking fee'", () => {
    expect(getMinBuyerTotalCents(event)).toBe(3200);
    expect(formatFeedPrice(event)).toBe("From A$32 incl. booking fee");
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
