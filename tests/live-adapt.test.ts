import { describe, expect, it } from "vitest";
import type { PublicEvent } from "@/lib/api/public-events";
import { adaptPublicEvent } from "@/lib/live/adapt";

const base: PublicEvent = {
  organiserId: "org-1",
  eventId: "evt-1",
  slug: "neon-static",
  title: "Neon Static",
  description: "Four bands.",
  category: "live-music",
  venueName: "The Tote",
  venueAddress: "71 Johnston St",
  suburb: "Collingwood",
  startsAt: "2027-03-06T09:00:00.000Z",
  endsAt: "2027-03-06T12:30:00.000Z",
  organiserName: "Static Collective",
  ticketTypes: [],
};

describe("adaptPublicEvent: external ticketing fields", () => {
  it("carries an external event's link, free flag and provider name", () => {
    const adapted = adaptPublicEvent({
      ...base,
      ticketingMode: "external",
      externalTicketUrl: "https://events.humanitix.com/neon-static",
      externalFree: true,
      externalProvider: "Humanitix",
    });
    expect(adapted).toMatchObject({
      ticketingMode: "external",
      externalTicketUrl: "https://events.humanitix.com/neon-static",
      externalFree: true,
      externalProvider: "Humanitix",
      ticketTypes: [],
    });
  });

  it("an unknown site keeps a null provider (shown as the organiser's site)", () => {
    const adapted = adaptPublicEvent({
      ...base,
      ticketingMode: "external",
      externalTicketUrl: "https://www.my-venue.com.au/tickets",
      externalFree: false,
      externalProvider: null,
    });
    expect(adapted.externalProvider).toBeNull();
  });

  it("a Sheltüh-ticketed event (or a payload without the field) has no external fields", () => {
    for (const event of [base, { ...base, ticketingMode: "sheltuh" as const, externalFree: false, externalProvider: null }]) {
      const adapted = adaptPublicEvent(event);
      expect(adapted.ticketingMode).toBe("sheltuh");
      expect(adapted).not.toHaveProperty("externalTicketUrl");
      expect(adapted).not.toHaveProperty("externalFree");
      expect(adapted).not.toHaveProperty("externalProvider");
    }
  });
});
