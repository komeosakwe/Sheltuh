import { describe, expect, it } from "vitest";
import { appleMapsHref, directionsHref, googlePlaceHref, pinMapHref, venuePin } from "@/lib/maps";

describe("directionsHref (Get directions, mobile-redesign.md §6.5)", () => {
  it("is Google's cross-platform directions URL to the venue's name and street address, encoded", () => {
    expect(directionsHref({ venueName: "The Tote", venueAddress: "71 Johnston St, Collingwood VIC 3066", suburb: "Collingwood" })).toBe(
      "https://www.google.com/maps/dir/?api=1&destination=The%20Tote%2C%2071%20Johnston%20St%2C%20Collingwood%20VIC%203066",
    );
  });

  it("falls back to the suburb without a street address, and to whatever's there", () => {
    expect(directionsHref({ venueName: "Back room & bar", venueAddress: "  ", suburb: "Fitzroy" })).toBe(
      "https://www.google.com/maps/dir/?api=1&destination=Back%20room%20%26%20bar%2C%20Fitzroy",
    );
    expect(directionsHref({ venueName: "", venueAddress: "", suburb: "Brunswick" })).toBe(
      "https://www.google.com/maps/dir/?api=1&destination=Brunswick",
    );
  });

  it("is null with nothing to route to", () => {
    expect(directionsHref({ venueName: " ", venueAddress: "", suburb: "" })).toBeNull();
  });
});

const TOTE = { venueName: "The Tote", venueAddress: "71 Johnston St, Collingwood VIC 3066", suburb: "Collingwood" };
const TOTE_TEXT = "The%20Tote%2C%2071%20Johnston%20St%2C%20Collingwood%20VIC%203066";
const PLACE_ID = "ChIJN1t_tDeuEmsRUsoyG83frY4";
const PIN = { lat: -37.7983429, lng: 144.98861234 };

describe("directionsHref with a linked place or the organiser's pin (owner decision A-D1)", () => {
  it("routes to a linked Google place by id, with the venue's text alongside", () => {
    expect(directionsHref({ ...TOTE, venuePlaceId: PLACE_ID })).toBe(
      `https://www.google.com/maps/dir/?api=1&destination=${TOTE_TEXT}&destination_place_id=${PLACE_ID}`,
    );
    // The place id wins over the pin: Google's own place, never coordinates, is the Google destination.
    expect(directionsHref({ ...TOTE, venuePlaceId: PLACE_ID, venuePinned: true, coordinates: PIN })).toBe(
      `https://www.google.com/maps/dir/?api=1&destination=${TOTE_TEXT}&destination_place_id=${PLACE_ID}`,
    );
  });

  it("encodes the place id, and ignores a blank one", () => {
    expect(directionsHref({ ...TOTE, venuePlaceId: "a b&c=d/e" })).toBe(
      `https://www.google.com/maps/dir/?api=1&destination=${TOTE_TEXT}&destination_place_id=a%20b%26c%3Dd%2Fe`,
    );
    expect(directionsHref({ ...TOTE, venuePlaceId: "  " })).toBe(directionsHref(TOTE));
  });

  it("routes to the organiser's pin without a place id, to 6 decimal places", () => {
    expect(directionsHref({ ...TOTE, venuePinned: true, coordinates: PIN })).toBe(
      "https://www.google.com/maps/dir/?api=1&destination=-37.798343,144.988612",
    );
  });

  it("uses the pin as the destination with a place id but no text at all", () => {
    expect(
      directionsHref({ venueName: "", venueAddress: "", suburb: "", venuePlaceId: PLACE_ID, venuePinned: true, coordinates: PIN }),
    ).toBe(`https://www.google.com/maps/dir/?api=1&destination=-37.798343,144.988612&destination_place_id=${PLACE_ID}`);
    expect(directionsHref({ venueName: "", venueAddress: "", suburb: "", venuePlaceId: PLACE_ID })).toBeNull();
  });

  it("never routes to coordinates that aren't the organiser's pin, or that aren't in Australia", () => {
    // The demo's sample coordinates (no venuePinned): directions stay by the text.
    expect(directionsHref({ ...TOTE, coordinates: PIN })).toBe(directionsHref(TOTE));
    expect(directionsHref({ ...TOTE, venuePinned: true, coordinates: { lat: 51.5, lng: -0.12 } })).toBe(directionsHref(TOTE));
    expect(directionsHref({ ...TOTE, venuePinned: true, coordinates: { lat: Number.NaN, lng: 144.9 } })).toBe(directionsHref(TOTE));
    expect(directionsHref({ ...TOTE, venuePinned: true })).toBe(directionsHref(TOTE));
  });
});

// CodeRabbit (PR #61): the text goes where the event page says the venue is (lib/place.ts venueLines).
describe("the text without a real venue name: the address and the place it's in", () => {
  const decoded = (href: string | null) => decodeURIComponent(href ?? "");
  const STREET_LINE = { venueName: "71 Johnston Street", venueAddress: "71 Johnston St", suburb: "Collingwood", state: "VIC" as const };

  it("a name that's only the street line, or none: Google and Apple both get the address with its suburb and state", () => {
    for (const target of [STREET_LINE, { ...STREET_LINE, venueName: "" }]) {
      expect(decoded(directionsHref(target))).toBe("https://www.google.com/maps/dir/?api=1&destination=71 Johnston St, Collingwood, VIC");
      expect(decoded(appleMapsHref(target))).toBe("https://maps.apple.com/?daddr=71 Johnston St, Collingwood, VIC");
    }
    expect(decoded(googlePlaceHref({ ...STREET_LINE, venuePlaceId: PLACE_ID }))).toBe(
      `https://www.google.com/maps/search/?api=1&query=71 Johnston St, Collingwood, VIC&query_place_id=${PLACE_ID}`,
    );
  });

  it("never says the place twice, and keeps a shared name's state", () => {
    expect(decoded(appleMapsHref({ ...STREET_LINE, venueAddress: "71 Johnston St, Collingwood VIC 3066" }))).toBe(
      "https://maps.apple.com/?daddr=71 Johnston St, Collingwood VIC 3066",
    );
    const richmond = { venueName: "", venueAddress: "1 March St, Richmond VIC 3121", suburb: "Richmond NSW", state: "NSW" as const };
    expect(decoded(directionsHref(richmond))).toBe("https://www.google.com/maps/dir/?api=1&destination=1 March St, Richmond VIC 3121, Richmond, NSW");
  });

  // CodeRabbit (PR #61, round 4): the event page can leave the state out after "Richmond"; a map query can't.
  it("adds the event's state to an address that names only its suburb, and leaves one that says the state", () => {
    const nsw = { venueName: "", suburb: "Richmond NSW", state: "NSW" as const };
    expect(decoded(directionsHref({ ...nsw, venueAddress: "1 March St, Richmond" }))).toBe(
      "https://www.google.com/maps/dir/?api=1&destination=1 March St, Richmond, NSW",
    );
    expect(decoded(appleMapsHref({ ...nsw, venueAddress: "1 March St, Richmond 2753" }))).toBe("https://maps.apple.com/?daddr=1 March St, Richmond 2753, NSW");
    expect(decoded(appleMapsHref({ ...nsw, venueAddress: "1 March St, Richmond NSW 2753" }))).toBe("https://maps.apple.com/?daddr=1 March St, Richmond NSW 2753");
    expect(decoded(appleMapsHref({ ...nsw, venueAddress: "1 March St, Richmond, NSW 2753" }))).toBe("https://maps.apple.com/?daddr=1 March St, Richmond, NSW 2753");
    // No state on the event (the ticket email, an older event): as written.
    expect(decoded(appleMapsHref({ venueName: "", suburb: "Richmond", venueAddress: "1 Swan St, Richmond" }))).toBe("https://maps.apple.com/?daddr=1 Swan St, Richmond");
  });

  // CodeRabbit (PR #61, round 3): no street address, no pin: the suburb with its state, as the event page says it.
  it("without a street address, says the suburb with its state when the event has one", () => {
    const richmond = { venueName: "", venueAddress: "", suburb: "Richmond NSW", state: "NSW" as const };
    expect(decoded(directionsHref(richmond))).toBe("https://www.google.com/maps/dir/?api=1&destination=Richmond, NSW");
    expect(decoded(appleMapsHref(richmond))).toBe("https://maps.apple.com/?daddr=Richmond, NSW");
    const backRoom = { ...richmond, venueName: "Back room" };
    expect(decoded(directionsHref(backRoom))).toBe("https://www.google.com/maps/dir/?api=1&destination=Back room, Richmond, NSW");
    expect(decoded(appleMapsHref(backRoom))).toBe("https://maps.apple.com/?daddr=Back room, Richmond, NSW");
  });

  // CodeRabbit (PR #61, round 3): "170 Russell Street, Rooftop" is a name, not the street line.
  it("keeps a name that adds its own qualifier after the street line", () => {
    const rooftop = { venueName: "170 Russell Street, Rooftop", venueAddress: "170 Russell St", suburb: "Melbourne", state: "VIC" as const };
    expect(decoded(directionsHref(rooftop))).toBe("https://www.google.com/maps/dir/?api=1&destination=170 Russell Street, Rooftop, 170 Russell St");
    const located = { ...rooftop, venueName: "170 Russell Street, Melbourne VIC 3000" };
    expect(decoded(directionsHref(located))).toBe("https://www.google.com/maps/dir/?api=1&destination=170 Russell St, Melbourne, VIC");
  });

  it("a named venue keeps its name and address for Google; Apple gets the address with its place", () => {
    const tote = { venueName: "The Tote", venueAddress: "71 Johnston St", suburb: "Collingwood", state: "VIC" as const };
    expect(decoded(directionsHref(tote))).toBe("https://www.google.com/maps/dir/?api=1&destination=The Tote, 71 Johnston St");
    expect(decoded(appleMapsHref(tote))).toBe("https://maps.apple.com/?daddr=71 Johnston St, Collingwood, VIC");
  });
});

describe("appleMapsHref", () => {
  it("is directions to the street address as written, encoded", () => {
    expect(appleMapsHref(TOTE)).toBe("https://maps.apple.com/?daddr=71%20Johnston%20St%2C%20Collingwood%20VIC%203066");
  });

  it("without a street address, is directions to the venue's name and suburb", () => {
    expect(appleMapsHref({ venueName: "Back room & bar", venueAddress: " ", suburb: "Fitzroy" })).toBe(
      "https://maps.apple.com/?daddr=Back%20room%20%26%20bar%2C%20Fitzroy",
    );
    expect(appleMapsHref({ venueName: "", venueAddress: "", suburb: "Brunswick" })).toBe("https://maps.apple.com/?daddr=Brunswick");
  });

  it("with the organiser's pin, opens on that spot labelled with the venue's name", () => {
    expect(appleMapsHref({ ...TOTE, venuePinned: true, coordinates: PIN })).toBe(
      "https://maps.apple.com/?ll=-37.798343,144.988612&q=The%20Tote",
    );
    expect(appleMapsHref({ venueName: " ", venueAddress: "", suburb: "Fitzroy", venuePinned: true, coordinates: PIN })).toBe(
      "https://maps.apple.com/?ll=-37.798343,144.988612&q=Fitzroy",
    );
    expect(appleMapsHref({ venueName: "", venueAddress: "", suburb: "", venuePinned: true, coordinates: PIN })).toBe(
      "https://maps.apple.com/?ll=-37.798343,144.988612",
    );
  });

  it("never uses the Google place id, nor coordinates that aren't the organiser's pin", () => {
    expect(appleMapsHref({ ...TOTE, venuePlaceId: PLACE_ID })).toBe(appleMapsHref(TOTE));
    expect(appleMapsHref({ ...TOTE, venuePlaceId: PLACE_ID })).not.toContain(PLACE_ID);
    expect(appleMapsHref({ ...TOTE, coordinates: PIN })).toBe(appleMapsHref(TOTE));
  });

  it("is null with nothing to go to", () => {
    expect(appleMapsHref({ venueName: " ", venueAddress: "", suburb: "" })).toBeNull();
  });
});

describe("googlePlaceHref (Check on Google Maps)", () => {
  it("is Google's search URL for the linked place, with the venue's text as the query", () => {
    expect(googlePlaceHref({ ...TOTE, venuePlaceId: PLACE_ID })).toBe(
      `https://www.google.com/maps/search/?api=1&query=${TOTE_TEXT}&query_place_id=${PLACE_ID}`,
    );
    expect(googlePlaceHref({ ...TOTE, venuePlaceId: "x/y?z" })).toBe(
      `https://www.google.com/maps/search/?api=1&query=${TOTE_TEXT}&query_place_id=x%2Fy%3Fz`,
    );
  });

  it("is null without a place id, or without any text for the query", () => {
    expect(googlePlaceHref(TOTE)).toBeNull();
    expect(googlePlaceHref({ ...TOTE, venuePlaceId: " " })).toBeNull();
    expect(googlePlaceHref({ venueName: "", venueAddress: "", suburb: "", venuePlaceId: PLACE_ID })).toBeNull();
  });
});

describe("venuePin", () => {
  it("is the coordinates only while they're the organiser's pin in Australia", () => {
    expect(venuePin({ ...TOTE, venuePinned: true, coordinates: PIN })).toEqual(PIN);
    expect(venuePin({ ...TOTE, coordinates: PIN })).toBeNull();
    expect(venuePin({ ...TOTE, venuePinned: false, coordinates: PIN })).toBeNull();
    expect(venuePin({ ...TOTE, venuePinned: true, coordinates: { lat: -50, lng: 144 } })).toBeNull();
  });
});

describe("pinMapHref (the admin queue's check of an organiser's pin)", () => {
  it("is Google's search URL at the pin, to 6 decimal places", () => {
    expect(pinMapHref({ lat: -37.79912345678, lng: 144.9871234 })).toBe(
      "https://www.google.com/maps/search/?api=1&query=-37.799123,144.987123",
    );
  });

  it("is null for a pin that isn't a real position in Australia", () => {
    expect(pinMapHref({ lat: -50, lng: 144 })).toBeNull();
    expect(pinMapHref({ lat: Number.NaN, lng: 144 })).toBeNull();
  });
});
