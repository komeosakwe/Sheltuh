import { describe, expect, it } from "vitest";
import { bareSuburb, eventPlaceName, placeName, placeNameParts, placeQuery, sameStreetLine, STATE_NAMES, venueLines } from "@/lib/place";
import { STATE_CODES } from "@/lib/time-zones";

describe("placeNameParts (a line that cuts the suburb short, never the state)", () => {
  it("splits placeName's suburb and state, and is null for an empty suburb", () => {
    expect(placeNameParts("Fortitude Valley", "QLD")).toEqual({ suburb: "Fortitude Valley", state: "QLD" });
    expect(placeNameParts("Richmond NSW", "NSW")).toEqual({ suburb: "Richmond", state: "NSW" });
    expect(placeNameParts("Richmond NSW")).toEqual({ suburb: "Richmond", state: "NSW" });
    expect(placeNameParts("Fitzroy")).toEqual({ suburb: "Fitzroy", state: "VIC" });
    expect(placeNameParts("  ")).toBeNull();
    for (const [suburb, state] of [["Perth", "WA"], ["Richmond (Mackay) QLD", "QLD"], ["Newtown", null]] as const) {
      const parts = placeNameParts(suburb, state);
      expect(parts && `${parts.suburb}, ${parts.state}`).toBe(placeName(suburb, state));
    }
  });
});

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

// Round 2: "170 Russell Street / 170 Russell St" (a Google address pick filled the venue name with the street line).
describe("sameStreetLine", () => {
  it.each<[string, string]>([
    ["170 Russell Street", "170 Russell St"],
    ["170 Russell St.", "170 RUSSELL STREET"],
    ["170 Russell Street", "170 Russell St, Melbourne VIC 3000"],

    ["5 Glenferrie Road", "5 Glenferrie Rd"],
    ["1/23 High Street", "1/23 High St"],
    ["3 Acland Avenue", "3 Acland Av"],
  ])("%s is the street line of %s", (name, address) => {
    expect(sameStreetLine(name, address)).toBe(true);
  });

  // CodeRabbit (PR #61, round 3): after a comma, only the event's own locality is dropped; anything else is the name's.
  it.each<[string, string]>([
    ["12-14 Smith Street, Fitzroy", "12-14 Smith St"],
    ["12-14 Smith Street, Fitzroy VIC 3065", "12-14 Smith St"],
    ["12-14 Smith Street, Fitzroy, Victoria, Australia", "12-14 Smith St, Fitzroy VIC 3065"],
    ["12-14 Smith Street, Fitzroy, VIC 3065", "12-14 Smith St"],
  ])("%s is the street line of %s in Fitzroy, VIC", (name, address) => {
    expect(sameStreetLine(name, address, { suburb: "Fitzroy", state: "VIC" })).toBe(true);
  });

  it.each<[string, string]>([
    ["170 Russell Street, Rooftop", "170 Russell St"],
    ["170 Russell Street, Rooftop", "170 Russell St, Fitzroy VIC 3065"],
    ["170 Russell Street, Rooftop, Fitzroy", "170 Russell St"],
    ["170 Russell Street, Collingwood", "170 Russell St"],
    ["170 Russell Street, Fitzroy NSW", "170 Russell St"],
    ["170 Russell Street, Fitzroy, NSW 2000", "170 Russell St"],
    ["170 Russell Street, VIC 3065", "170 Russell St"],
  ])("%s keeps its own words over %s in Fitzroy, VIC", (name, address) => {
    expect(sameStreetLine(name, address, { suburb: "Fitzroy", state: "VIC" })).toBe(false);
  });

  it("without the event's place, any comma suffix keeps the name", () => {
    expect(sameStreetLine("12-14 Smith Street, Fitzroy", "12-14 Smith St")).toBe(false);
  });

  // CodeRabbit (PR #61, round 4): a precomposed and a decomposed accent are the same street.
  it("compares composed and decomposed accents as one, keeping the accent", () => {
    expect(sameStreetLine("10 Caf\u00e9 Street", "10 Cafe\u0301 St")).toBe(true);
    expect(sameStreetLine("10 Cafe Street", "10 Caf\u00e9 St")).toBe(false);
    expect(venueLines({ suburb: "Fitzroy", state: "VIC", venueName: "10 Cafe\u0301 Street", venueAddress: "10 Caf\u00e9 St" }).named).toBe(false);
  });

  it.each<[string, string]>([
    ["Brunswick Street Print Hall", "Brunswick St"],
    ["Brunswick Street Print Hall", "12 Brunswick St"],
    ["Brunswick", "Brunswick St"],
    ["The Tote", "71 Johnston St"],
    ["Street Art Hall", "Street Art Hall Lane"],
    ["170 Russell Street", "17 Russell St"],
    ["", "170 Russell St"],
    ["170 Russell Street", ""],
  ])("%s is not the street line of %s", (name, address) => {
    expect(sameStreetLine(name, address)).toBe(false);
  });
});

describe("venueLines", () => {
  const base = { suburb: "Collingwood", state: "VIC" as const };

  it("a named venue: its name, then its address (or, without one, its place)", () => {
    expect(venueLines({ ...base, venueName: "The Tote", venueAddress: "71 Johnston St" })).toEqual({ first: "The Tote", second: "71 Johnston St", named: true });
    expect(venueLines({ ...base, venueName: "The Tote", venueAddress: " " })).toEqual({ first: "The Tote", second: "Collingwood, VIC", named: true });
  });

  it("a name with its own qualifier after the street line is the name ('170 Russell Street, Rooftop')", () => {
    expect(venueLines({ suburb: "Melbourne", state: "VIC", venueName: "170 Russell Street, Rooftop", venueAddress: "170 Russell St" })).toEqual({
      first: "170 Russell Street, Rooftop",
      second: "170 Russell St",
      named: true,
    });
    expect(venueLines({ suburb: "Melbourne", state: "VIC", venueName: "170 Russell Street, Melbourne", venueAddress: "170 Russell St" })).toEqual({
      first: "170 Russell St",
      second: "Melbourne, VIC",
      named: false,
    });
  });

  it("a name that's only the street line: the address, then the place; never the address twice", () => {
    expect(venueLines({ suburb: "Melbourne", state: "VIC", venueName: "170 Russell Street", venueAddress: "170 Russell St" })).toEqual({
      first: "170 Russell St",
      second: "Melbourne, VIC",
      named: false,
    });
  });

  it("no name: the address, then the place unless the address already names the suburb", () => {
    expect(venueLines({ ...base, venueName: "", venueAddress: "71 Johnston St" })).toEqual({ first: "71 Johnston St", second: "Collingwood, VIC", named: false });
    expect(venueLines({ ...base, venueName: "", venueAddress: "71 Johnston St, Collingwood VIC 3066" })).toEqual({
      first: "71 Johnston St, Collingwood VIC 3066",
      second: "",
      named: false,
    });
  });

  it("nothing but a place: the place alone; nothing at all: empty", () => {
    expect(venueLines({ ...base, venueName: "", venueAddress: "" })).toEqual({ first: "Collingwood, VIC", second: "", named: false });
    expect(venueLines({ suburb: "", venueName: "", venueAddress: "" })).toEqual({ first: "", second: "", named: false });
  });

  it("counts the suburb as named only as a whole comma-separated part, never inside a word or a street", () => {
    // "Kew" is in "Kewney", and "Carlton" is the street's name: neither address names the suburb.
    expect(venueLines({ suburb: "Kew", state: "VIC", venueName: "", venueAddress: "5 Kewney Ave" })).toEqual({ first: "5 Kewney Ave", second: "Kew, VIC", named: false });
    expect(venueLines({ suburb: "Carlton", state: "VIC", venueName: "", venueAddress: "12 Carlton St" })).toEqual({ first: "12 Carlton St", second: "Carlton, VIC", named: false });
    expect(venueLines({ suburb: "Carlton", state: "VIC", venueName: "", venueAddress: "12 Carlton St, Carlton" }).second).toBe("");
    expect(venueLines({ suburb: "St Kilda", state: "VIC", venueName: "", venueAddress: "1 Acland St, St Kilda Victoria 3182, Australia" }).second).toBe("");
    expect(venueLines({ suburb: "Kew", state: "VIC", venueName: "", venueAddress: "5 Kewney Ave, Kew East VIC 3102" }).second).toBe("Kew, VIC");
  });

  it("keeps the state another state shares a name with ('Richmond, NSW')", () => {
    expect(venueLines({ suburb: "Richmond NSW", state: "NSW", venueName: "", venueAddress: "1 March St" }).second).toBe("Richmond, NSW");
  });

  // CodeRabbit (PR #61): an address naming the suburb in another state doesn't name the event's place.
  it("counts the suburb as named only with the event's own state, when the address names one", () => {
    const nsw = { suburb: "Richmond NSW", state: "NSW" as const, venueName: "" };
    expect(venueLines({ ...nsw, venueAddress: "1 March St, Richmond VIC 3121" }).second).toBe("Richmond, NSW");
    expect(venueLines({ ...nsw, venueAddress: "1 March St, Richmond Victoria 3121" }).second).toBe("Richmond, NSW");
    expect(venueLines({ ...nsw, venueAddress: "1 March St, Richmond NSW 2753" }).second).toBe("");
    expect(venueLines({ ...nsw, venueAddress: "1 March St, Richmond New South Wales" }).second).toBe("");
    expect(venueLines({ ...nsw, venueAddress: "1 March St, Richmond 2753" }).second).toBe("");
    // No state on the event: Victorian, as everywhere.
    expect(venueLines({ suburb: "Richmond", venueName: "", venueAddress: "1 Swan St, Richmond NSW 2753" }).second).toBe("Richmond, VIC");
    expect(venueLines({ suburb: "Richmond", venueName: "", venueAddress: "1 Swan St, Richmond VIC 3121" }).second).toBe("");
  });

  // CodeRabbit (PR #61, round 3): the state can follow a bare suburb as its own part ("Richmond, VIC 3121").
  it("reads a state in the part after a bare suburb", () => {
    const nsw = { suburb: "Richmond NSW", state: "NSW" as const, venueName: "" };
    expect(venueLines({ ...nsw, venueAddress: "1 Swan St, Richmond, VIC 3121" }).second).toBe("Richmond, NSW");
    expect(venueLines({ ...nsw, venueAddress: "1 Swan St, Richmond, Victoria, Australia" }).second).toBe("Richmond, NSW");
    expect(venueLines({ ...nsw, venueAddress: "1 March St, Richmond, NSW 2753" }).second).toBe("");
    expect(venueLines({ ...nsw, venueAddress: "1 March St, Richmond, 2753" }).second).toBe("");
    expect(venueLines({ ...nsw, venueAddress: "1 March St, Richmond, Australia" }).second).toBe("");
    expect(venueLines({ ...nsw, venueAddress: "1 March St, Richmond" }).second).toBe("");
  });
});
