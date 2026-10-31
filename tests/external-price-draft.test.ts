import { describe, expect, it } from "vitest";
import { draftErrors, parseExternalPriceFrom, stepOfControlId, stepOfErrorKey } from "@/components/dashboard/editor/draft";

describe("parseExternalPriceFrom", () => {
  it.each([
    ["", null],
    ["  ", null],
    ["89", 8900],
    ["120.5", 12050],
    ["0.01", 1],
    ["10000", 1_000_000],
    ["19.99", 1999],
  ])("%j is %j cents", (text, cents) => {
    expect(parseExternalPriceFrom(text)).toBe(cents);
  });

  it.each(["0", "-5", "10000.01", "1.005", "abc", "1e9", "Infinity"])("%j isn't a price", (text) => {
    expect(parseExternalPriceFrom(text)).toBeNaN();
  });
});

describe("the editor's check of the price", () => {
  const base = {
    title: "T",
    description: "D",
    venueName: "V",
    venueAddress: "A",
    place: { kind: "empty" as const },
    start: { date: "", time: "" },
    end: { date: "", time: "" },
    organiserMissing: false,
    isAdmin: false,
    platformManaged: false,
    ticketingMode: "external" as const,
    externalTicketUrl: "",
    ticketTypes: [],
    refundPolicy: "no_change_of_mind" as const,
    refundDays: Number.NaN,
  };

  it("flags a bad price on an external event only, and not on a free one", () => {
    expect(draftErrors({ ...base, externalPrice: "0" }).externalPriceFromCents).toBeTruthy();
    expect(draftErrors({ ...base, externalPrice: "50" }).externalPriceFromCents).toBeUndefined();
    expect(draftErrors({ ...base, externalPrice: "" }).externalPriceFromCents).toBeUndefined();
    expect(draftErrors({ ...base, externalPrice: "0", externalFree: true }).externalPriceFromCents).toBeUndefined();
    expect(draftErrors({ ...base, ticketingMode: "sheltuh", externalPrice: "0" }).externalPriceFromCents).toBeUndefined();
  });

  it("belongs to the tickets step", () => {
    expect(stepOfErrorKey("externalPriceFromCents")).toBe(2);
    expect(stepOfControlId("externalPriceFromCents")).toBe(2);
  });
});
