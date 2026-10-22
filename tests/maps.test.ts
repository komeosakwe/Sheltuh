import { describe, expect, it } from "vitest";
import { directionsHref } from "@/lib/maps";

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
