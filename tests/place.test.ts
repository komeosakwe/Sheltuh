import { describe, expect, it } from "vitest";
import { bareSuburb, eventPlaceName, placeName, placeQuery, STATE_NAMES } from "@/lib/place";
import { STATE_CODES } from "@/lib/time-zones";

describe("placeName (owner decision D4: \"Suburb, STATE\")", () => {
  it.each([
    ["Fitzroy", "VIC", "Fitzroy, VIC"],
    ["Perth", "WA", "Perth, WA"],
    // The table's name for a shared one carries the state: never said twice.
    ["Richmond NSW", "NSW", "Richmond, NSW"],
    ["Richmond (Mackay) QLD", "QLD", "Richmond (Mackay), QLD"],
    ["  Newtown  ", "NSW", "Newtown, NSW"],
  ] as const)("%j in %s → %j", (suburb, state, shown) => {
    expect(placeName(suburb, state)).toBe(shown);
  });

  it("without a state: the one the suburb names, else Victoria (every earlier event)", () => {
    expect(placeName("Collingwood")).toBe("Collingwood, VIC");
    expect(placeName("Richmond NSW")).toBe("Richmond, NSW");
    expect(eventPlaceName({ suburb: "Fortitude Valley", state: "QLD" })).toBe("Fortitude Valley, QLD");
  });

  it("is empty for an empty suburb", () => {
    expect(placeName("   ", "VIC")).toBe("");
  });

  it("keeps a suburb whose last word isn't the state it's in", () => {
    expect(bareSuburb("Richmond NSW", "VIC")).toBe("Richmond NSW");
    expect(bareSuburb("St Kilda")).toBe("St Kilda");
  });

  it("names every state and territory", () => {
    for (const code of STATE_CODES) expect(STATE_NAMES[code]).toMatch(/^[A-Z]/);
  });
});

describe("placeQuery: the text that finds an event's suburb", () => {
  it("adds the state, unless the suburb already ends with it", () => {
    expect(placeQuery({ suburb: "Perth", state: "WA" })).toBe("Perth WA");
    expect(placeQuery({ suburb: "Richmond NSW", state: "NSW" })).toBe("Richmond NSW");
    expect(placeQuery({ suburb: " Newtown ", state: "NSW" })).toBe("Newtown NSW");
  });

  it("is the suburb alone without a state (owner decision D7: a bare name is the Victorian one)", () => {
    expect(placeQuery({ suburb: "Richmond" })).toBe("Richmond");
    expect(placeQuery({ suburb: "Richmond", state: null })).toBe("Richmond");
    expect(placeQuery({ suburb: "", state: "VIC" })).toBe("");
  });
});
