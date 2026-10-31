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

describe("adaptPublicEvent: the event's state and time zone", () => {
  it("carries them when sent", () => {
    const adapted = adaptPublicEvent({ ...base, state: "WA", timeZone: "Australia/Perth" });
    expect(adapted.state).toBe("WA");
    expect(adapted.timeZone).toBe("Australia/Perth");
  });

  it("leaves them out of an older payload (absent means VIC, Melbourne)", () => {
    const adapted = adaptPublicEvent(base);
    expect(adapted).not.toHaveProperty("state");
    expect(adapted).not.toHaveProperty("timeZone");
  });
});

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

describe("adaptPublicEvent: sold-out data (docs/architecture.md, Waitlist)", () => {
  const ga = { id: "t1", name: "GA", priceCents: 3000, feePolicy: "buyer-pays" as const, quantityAvailable: 100 };

  it("passes the server's soldOut and remaining through, and invents neither", () => {
    const adapted = adaptPublicEvent({
      ...base,
      soldOut: false,
      ticketTypes: [
        { ...ga, soldOut: false, remaining: 4 },
        { ...ga, id: "t2", soldOut: true, remaining: 0 },
        { ...ga, id: "t3", soldOut: false },
      ],
    });
    expect(adapted.soldOut).toBeUndefined();
    expect(adapted.ticketTypes[0]).toEqual({ ...ga, remaining: 4 });
    expect(adapted.ticketTypes[1]).toEqual({ ...ga, id: "t2", soldOut: true, remaining: 0 });
    expect(adapted.ticketTypes[2]).toEqual({ ...ga, id: "t3" });
  });

  it("marks the event sold out only when the server does, and never an external one", () => {
    const tiers = [{ ...ga, soldOut: true, remaining: 0 }];
    expect(adaptPublicEvent({ ...base, soldOut: true, ticketTypes: tiers }).soldOut).toBe(true);
    expect(adaptPublicEvent({ ...base, ticketTypes: tiers }).soldOut).toBeUndefined();
    expect(
      adaptPublicEvent({ ...base, soldOut: true, ticketingMode: "external", externalTicketUrl: "https://dice.fm/x" }).soldOut,
    ).toBeUndefined();
  });
});

describe("adaptPublicEvent: reserved seating", () => {
  const ga = { id: "t1", name: "GA", priceCents: 3000, feePolicy: "buyer-pays" as const, quantityAvailable: 100 };

  it("carries the map's version and the seated flag on seated tiers only", () => {
    const adapted = adaptPublicEvent({
      ...base,
      seating: { version: 7 },
      ticketTypes: [
        { ...ga, id: "stalls", seated: true },
        { ...ga, id: "standing" },
      ],
    });
    expect(adapted.seating).toEqual({ version: 7 });
    expect(adapted.ticketTypes[0]).toEqual({ ...ga, id: "stalls", seated: true });
    expect(adapted.ticketTypes[1]).toEqual({ ...ga, id: "standing" });
  });

  it("a general admission event has no seating", () => {
    expect(adaptPublicEvent({ ...base, ticketTypes: [ga] })).not.toHaveProperty("seating");
  });
});

describe("adaptPublicEvent: organiser logo", () => {
  it("carries the logo thumbnail when the API sends one", () => {
    const url = "/api/organisers/org-1/logo?size=thumb&v=1730000000000";
    expect(adaptPublicEvent({ ...base, organiserLogoThumbUrl: url }).organiserLogoThumbUrl).toBe(url);
  });

  it("has no logo field without one (the event page shows initials)", () => {
    expect(adaptPublicEvent(base)).not.toHaveProperty("organiserLogoThumbUrl");
    expect(adaptPublicEvent({ ...base, organiserLogoThumbUrl: "" })).not.toHaveProperty("organiserLogoThumbUrl");
  });
});

describe("adaptPublicEvent: refund policy (docs/architecture.md, Refund policy)", () => {
  it("carries the policy, and the days only for days_before", () => {
    expect(adaptPublicEvent({ ...base, refundPolicy: "days_before", refundDays: 7 })).toMatchObject({
      refundPolicy: "days_before",
      refundDays: 7,
    });
    const none = adaptPublicEvent({ ...base, refundPolicy: "no_change_of_mind" });
    expect(none.refundPolicy).toBe("no_change_of_mind");
    expect(none).not.toHaveProperty("refundDays");
  });

  it("a payload without the field gets the default", () => {
    expect(adaptPublicEvent(base).refundPolicy).toBe("no_change_of_mind");
  });

  it("an external event has none (the ticketing site's terms apply)", () => {
    const adapted = adaptPublicEvent({
      ...base,
      ticketingMode: "external",
      externalTicketUrl: "https://events.humanitix.com/neon-static",
      refundPolicy: "days_before",
      refundDays: 7,
    });
    expect(adapted).not.toHaveProperty("refundPolicy");
    expect(adapted).not.toHaveProperty("refundDays");
  });
});

describe("adaptPublicEvent: the venue location", () => {
  const PLACE_ID = "ChIJtoteHotelCollingwood001";
  const PIN = { lat: -37.79794, lng: 144.98884 };

  it("a Google place with the organiser's pin: the place id, pinned, and the pin as the coordinates", () => {
    const adapted = adaptPublicEvent({ ...base, location: { source: "places", placeId: PLACE_ID, pin: PIN } });
    expect(adapted.venuePlaceId).toBe(PLACE_ID);
    expect(adapted.venuePinned).toBe(true);
    expect(adapted.coordinates).toEqual(PIN);
  });

  it("a Google place not yet pinned: the place id only (the maps fall back to the suburb's centre)", () => {
    const adapted = adaptPublicEvent({ ...base, location: { source: "places", placeId: PLACE_ID } });
    expect(adapted.venuePlaceId).toBe(PLACE_ID);
    expect(adapted.venuePinned).toBe(false);
    expect(adapted).not.toHaveProperty("coordinates");
  });

  it("a manual pin: pinned, no place id", () => {
    const adapted = adaptPublicEvent({ ...base, location: { source: "manual_pin", pin: PIN } });
    expect(adapted).not.toHaveProperty("venuePlaceId");
    expect(adapted.venuePinned).toBe(true);
    expect(adapted.coordinates).toEqual(PIN);
  });

  it("none: nothing added, as before", () => {
    const adapted = adaptPublicEvent(base);
    for (const key of ["venuePlaceId", "venuePinned", "coordinates"]) expect(adapted).not.toHaveProperty(key);
  });
});

describe("adaptPublicEvent: the photo's focus point", () => {
  it("carries it when sent, and leaves it out of a payload without one", () => {
    expect(adaptPublicEvent({ ...base, imageUrl: "/api/events/evt-1/image?v=1", imageFocus: { x: 25, y: 75 } }).imageFocus).toEqual({ x: 25, y: 75 });
    expect(adaptPublicEvent(base)).not.toHaveProperty("imageFocus");
  });
});
